// Package mediafetch performs bounded, cancellable media metadata requests.
package mediafetch

import (
	"bufio"
	"compress/gzip"
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"io"
	"math"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/puremixai/puretv/services/go-worker/internal/outbound"
)

const maxBody = 32 * 1024 * 1024

type Handler struct {
	client         *http.Client
	slots          chan struct{}
	allowedOrigins []string
}

// Optional origins come exclusively from trusted worker configuration, never request input.
func New(client *http.Client, allowedOrigins ...[]string) http.Handler {
	h := &Handler{client: client, slots: make(chan struct{}, 4)}
	if len(allowedOrigins) > 0 {
		h.allowedOrigins = append([]string(nil), allowedOrigins[0]...)
	}
	return h
}

type input struct {
	URL     string            `json:"url"`
	UA      string            `json:"ua"`
	TvgIDs  []string          `json:"tvgIds"`
	Headers map[string]string `json:"headers"`
	Proxy   string            `json:"proxy"`
}
type program struct {
	Start string `json:"start"`
	End   string `json:"end"`
	Title string `json:"title"`
}

func reply(w http.ResponseWriter, status int, v any) {
	data, err := json.Marshal(v)
	if err != nil || len(data) > 64*1024*1024 {
		http.Error(w, "response exceeds encoded size limit", 502)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(data)
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w = &finiteResponseWriter{ResponseWriter: w}
	switch r.URL.Path {
	case "/v1/live/precheck", "/v1/live/epg", "/v1/live/epg/download", "/v1/danmaku/comment", "/v1/metadata/fetch", "/v1/subscriptions/fetch":
	default:
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", 405)
		return
	}
	var in input
	select {
	case h.slots <- struct{}{}:
		defer func() { <-h.slots }()
	default:
		reply(w, 429, map[string]string{"error": "media worker busy"})
		return
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&in); err != nil || in.URL == "" {
		reply(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		reply(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	timeout := 30 * time.Second
	if r.URL.Path == "/v1/danmaku/comment" {
		timeout = 120 * time.Second
	}
	if r.URL.Path == "/v1/subscriptions/fetch" {
		timeout = 20 * time.Second
	}
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, in.URL, nil)
	if err != nil {
		reply(w, 400, map[string]string{"error": "invalid URL"})
		return
	}
	req.Header.Set("Accept-Encoding", "identity")
	// Never forward authentication or arbitrary hop-by-hop headers supplied by callers.
	for k, v := range in.Headers {
		if strings.EqualFold(k, "Accept") || strings.EqualFold(k, "User-Agent") {
			req.Header.Set(k, v)
		}
	}
	if in.UA != "" {
		req.Header.Set("User-Agent", in.UA)
	}
	client := h.client
	if in.Proxy != "" {
		if r.URL.Path != "/v1/metadata/fetch" {
			reply(w, 400, map[string]string{"error": "proxy unsupported for this operation"})
			return
		}
		client, err = outbound.NewClient(outbound.Options{AllowedOrigins: h.allowedOrigins, ProxyURL: in.Proxy, Timeout: timeout})
		if err != nil {
			reply(w, 400, map[string]string{"error": "invalid metadata proxy"})
			return
		}
		defer client.CloseIdleConnections()
	}
	resp, err := client.Do(req)
	if err != nil {
		reply(w, 502, map[string]string{"error": "upstream request failed"})
		return
	}
	defer resp.Body.Close()
	if r.URL.Path == "/v1/live/precheck" {
		precheck(w, resp)
		return
	}
	if r.URL.Path != "/v1/metadata/fetch" && (resp.StatusCode < 200 || resp.StatusCode >= 300) {
		reply(w, 502, map[string]string{"error": "upstream request failed"})
		return
	}
	body, err := decodedBody(resp)
	if err != nil {
		reply(w, 502, map[string]string{"error": "invalid compressed response"})
		return
	}
	switch r.URL.Path {
	case "/v1/subscriptions/fetch":
		data, err := io.ReadAll(&limitReader{r: body, left: 256 * 1024})
		if err != nil {
			reply(w, 502, map[string]string{"error": "subscription response exceeds limit or failed"})
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write(data)
	case "/v1/live/epg":
		result, err := parseEPG(body, in.TvgIDs)
		if err != nil {
			reply(w, 502, map[string]string{"error": "invalid EPG response"})
			return
		}
		reply(w, 200, result)
	case "/v1/live/epg/download":
		data, err := io.ReadAll(body)
		if err != nil {
			reply(w, 502, map[string]string{"error": "EPG download failed"})
			return
		}
		w.Header().Set("Content-Type", "application/xml; charset=utf-8")
		_, _ = w.Write(data)
	case "/v1/danmaku/comment":
		comments, err := parseComments(body)
		if err != nil {
			reply(w, 502, map[string]string{"error": "invalid danmaku response"})
			return
		}
		reply(w, 200, map[string]any{"count": len(comments), "comments": comments})
	case "/v1/metadata/fetch":
		// JSON quoting expands a byte by at most six; stay below the bridge's 64MiB cap.
		data, err := io.ReadAll(&limitReader{r: body, left: 8 * 1024 * 1024})
		if err != nil {
			reply(w, 502, map[string]string{"error": "metadata response exceeds limit or failed"})
			return
		}
		reply(w, 200, map[string]any{"status": resp.StatusCode, "statusText": http.StatusText(resp.StatusCode), "body": string(data), "contentType": resp.Header.Get("Content-Type")})
	default:
		http.NotFound(w, r)
	}
}

// limitReader errors instead of silently accepting a truncated XML/JSON body.
type limitReader struct {
	r    io.Reader
	left int64
}

func (l *limitReader) Read(p []byte) (int, error) {
	if int64(len(p)) > l.left+1 {
		p = p[:l.left+1]
	}
	n, err := l.r.Read(p)
	l.left -= int64(n)
	if l.left < 0 {
		return 0, errors.New("response exceeds size limit")
	}
	return n, err
}
func decodedBody(resp *http.Response) (io.Reader, error) {
	raw := bufio.NewReader(&limitReader{r: resp.Body, left: maxBody})
	magic, _ := raw.Peek(2)
	// Sniff magic: Go may already have decoded Content-Encoding, while .gz files
	// commonly omit that header. Never decompress an already decoded body twice.
	if len(magic) == 2 && magic[0] == 0x1f && magic[1] == 0x8b {
		gz, err := gzip.NewReader(raw)
		if err != nil {
			return nil, err
		}
		return &limitReader{r: gz, left: maxBody}, nil
	}
	return raw, nil
}
func precheck(w http.ResponseWriter, resp *http.Response) {
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		reply(w, 500, map[string]string{"error": "Failed to fetch", "message": http.StatusText(resp.StatusCode)})
		return
	}
	ct := resp.Header.Get("Content-Type")
	lower := strings.ToLower(ct)
	path := strings.ToLower(resp.Request.URL.Path)
	kind := ""
	switch {
	case strings.Contains(lower, "video/mp4") || strings.HasSuffix(path, ".mp4"):
		kind = "mp4"
	case strings.Contains(lower, "video/x-flv") || strings.Contains(lower, "video/flv") || strings.HasSuffix(path, ".flv"):
		kind = "flv"
	case strings.Contains(lower, "mpegurl") || strings.Contains(lower, "application/vnd.apple") || strings.HasSuffix(path, ".m3u8") || strings.HasSuffix(path, ".m3u"):
		kind = "m3u8"
	}
	if kind == "" {
		reply(w, 415, map[string]string{"error": "Unsupported live stream type", "contentType": ct})
		return
	}
	reply(w, 200, map[string]any{"success": true, "type": kind})
}
func parseEPG(body io.Reader, ids []string) (map[string][]program, error) {
	result := map[string][]program{}
	wanted := map[string]bool{}
	names := map[string]string{}
	for _, id := range ids {
		wanted[id] = true
	}
	dec := xml.NewDecoder(body)
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			return result, nil
		}
		if err != nil {
			return nil, err
		}
		start, ok := tok.(xml.StartElement)
		if !ok {
			continue
		}
		switch start.Name.Local {
		case "channel":
			var ch struct {
				ID    string   `xml:"id,attr"`
				Names []string `xml:"display-name"`
			}
			if err := dec.DecodeElement(&ch, &start); err != nil {
				return nil, err
			}
			if len(ch.Names) > 0 {
				names[ch.ID] = ch.Names[0]
			}
		case "programme":
			var p struct {
				ID     string   `xml:"channel,attr"`
				Start  string   `xml:"start,attr"`
				End    string   `xml:"stop,attr"`
				Titles []string `xml:"title"`
			}
			if err := dec.DecodeElement(&p, &start); err != nil {
				return nil, err
			}
			id := p.ID
			if names[id] != "" {
				id = names[id]
			}
			if wanted[id] && p.Start != "" && p.End != "" && len(p.Titles) > 0 {
				result[id] = append(result[id], program{p.Start, p.End, p.Titles[0]})
			}
		}
	}
}

type comment struct {
	P   string `json:"p"`
	M   string `json:"m"`
	CID any    `json:"cid"`
}

func parseComments(body io.Reader) ([]comment, error) {
	result := []comment{}
	dec := xml.NewDecoder(body)
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			return result, nil
		}
		if err != nil {
			return nil, err
		}
		start, ok := tok.(xml.StartElement)
		if !ok || start.Name.Local != "d" {
			continue
		}
		var d struct {
			P   string `xml:"p,attr"`
			Raw string `xml:",innerxml"`
		}
		if err := dec.DecodeElement(&d, &start); err != nil {
			return nil, err
		}
		if d.P == "" || strings.Contains(d.Raw, "<") {
			continue
		}
		var cid any = 0
		parts := strings.Split(d.P, ",")
		if len(parts) > 7 && parts[7] != "" {
			cid = jsParseInt(parts[7])
		}
		// Keep the route's historical raw XML entity representation for compatibility.
		result = append(result, comment{d.P, d.Raw, cid})
	}
}

// JavaScript parseInt without a radix accepts a signed decimal prefix or 0x hex.
// Returning a float also preserves JS rounding for identifiers beyond 2^53.
func jsParseInt(value string) any {
	s := strings.TrimSpace(value)
	sign := 1.0
	if strings.HasPrefix(s, "-") {
		sign = -1
		s = s[1:]
	} else if strings.HasPrefix(s, "+") {
		s = s[1:]
	}
	base := 10
	if strings.HasPrefix(strings.ToLower(s), "0x") {
		base = 16
		s = s[2:]
	}
	n := 0
	for n < len(s) {
		c := s[n]
		if c >= '0' && c <= '9' || base == 16 && (c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
			n++
		} else {
			break
		}
	}
	if n == 0 {
		return nil
	}
	digits := strings.TrimLeft(s[:n], "0")
	if digits == "" {
		return float64(0)
	}
	// Longer significant prefixes already overflow a JS Number. Avoid spending
	// quadratic big-integer work on an attacker-controlled multi-megabyte CID.
	if base == 10 && len(digits) > 309 || base == 16 && len(digits) > 256 {
		return nil
	}
	i, ok := new(big.Int).SetString(digits, base)
	if !ok {
		return nil
	}
	f, _ := new(big.Float).SetInt(i).Float64()
	if math.IsInf(f, 0) {
		return nil
	}
	return sign * f
}
