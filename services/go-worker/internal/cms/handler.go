// Package cms executes standard JSON CMS requests; source authorization and result policies remain in Node.
package cms

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const maxBody = 8 << 20

type input struct {
	URL        string            `json:"url"`
	Headers    map[string]string `json:"headers"`
	TimeoutMS  int               `json:"timeoutMs"`
	Operation  string            `json:"operation"`
	Query      string            `json:"query"`
	Page       string            `json:"page"`
	CategoryID string            `json:"categoryId"`
}

// New requires the application's DNS-pinned outbound client in production.
func New(client *http.Client) http.Handler {
	slots := make(chan struct{}, 16)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w = &finiteResponseWriter{ResponseWriter: w}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		fail := func(status int) { w.WriteHeader(status); _, _ = w.Write([]byte(`{"error":"CMS request failed"}`)) }
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			fail(405)
			return
		}
		var in input
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&in) != nil {
			fail(400)
			return
		}
		var extra any
		if decoder.Decode(&extra) != io.EOF {
			fail(400)
			return
		}
		u, err := url.Parse(in.URL)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.Fragment != "" {
			fail(400)
			return
		}
		q := u.Query()
		switch in.Operation {
		case "categories":
			q.Set("ac", "list")
		case "search", "downstream", "videos":
			q.Set("ac", "videolist")
			if in.Page == "" {
				in.Page = "1"
			}
			page, err := strconv.ParseUint(in.Page, 10, 31)
			if err != nil || page == 0 {
				fail(400)
				return
			}
			q.Set("pg", in.Page)
			if in.Operation == "videos" {
				if in.CategoryID == "" {
					fail(400)
					return
				}
				q.Set("t", in.CategoryID)
			} else {
				if strings.TrimSpace(in.Query) == "" {
					fail(400)
					return
				}
				q.Set("wd", in.Query)
			}
		default:
			fail(400)
			return
		}
		u.RawQuery = q.Encode()
		if in.TimeoutMS <= 0 {
			in.TimeoutMS = 8000
		}
		if in.TimeoutMS > 30000 {
			in.TimeoutMS = 30000
		}
		ctx, cancel := context.WithTimeout(r.Context(), time.Duration(in.TimeoutMS)*time.Millisecond)
		defer cancel()
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			fail(429)
			return
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
		if err != nil {
			fail(400)
			return
		}
		for key, value := range in.Headers {
			if strings.EqualFold(key, "User-Agent") || strings.EqualFold(key, "Accept") {
				req.Header.Set(key, value)
			}
		}
		response, err := client.Do(req)
		if err != nil {
			if ctx.Err() != nil {
				fail(504)
			} else {
				fail(502)
			}
			return
		}
		defer response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			fail(response.StatusCode)
			return
		}
		data, err := io.ReadAll(io.LimitReader(response.Body, maxBody+1))
		if err != nil || len(data) > maxBody {
			fail(502)
			return
		}
		var document map[string]any
		parsed := json.NewDecoder(bytes.NewReader(data))
		parsed.UseNumber()
		if parsed.Decode(&document) != nil || document == nil || parsed.Decode(&extra) != io.EOF {
			fail(502)
			return
		}
		if !normalize(document, in.Operation) {
			fail(502)
			return
		}
		if ctx.Err() != nil {
			fail(504)
			return
		}
		encoded, err := json.Marshal(document)
		if err != nil || len(encoded) > maxBody {
			fail(502)
			return
		}
		_, _ = w.Write(encoded)
	})
}

// Keep both existing playback contracts: specified-source pages accept any named
// URL, whereas aggregate search chooses the longest group of strict .m3u8 URLs.
func episodes(item map[string]any, aggregate bool) ([]string, []string) {
	urls, titles := []string{}, []string{}
	raw, _ := item["vod_play_url"].(string)
	from, _ := item["vod_play_from"].(string)
	if !aggregate && from == "" {
		return urls, titles
	}
	groups := []string{raw}
	if aggregate {
		groups = strings.Split(raw, "$$$")
	}
	for _, group := range groups {
		current, names := []string{}, []string{}
		for _, entry := range strings.Split(group, "#") {
			parts := strings.Split(entry, "$")
			if aggregate {
				if len(parts) == 2 && strings.HasSuffix(parts[1], ".m3u8") {
					names = append(names, parts[0])
					current = append(current, parts[1])
				}
			} else if len(parts) >= 2 && parts[0] != "" && parts[1] != "" {
				names = append(names, strings.TrimSpace(parts[0]))
				current = append(current, strings.TrimSpace(parts[1]))
			}
		}
		if len(current) > len(urls) {
			urls, titles = current, names
		}
	}
	return urls, titles
}

func normalize(document map[string]any, operation string) bool {
	for _, field := range []string{"page", "pagecount", "total", "limit"} {
		if value, ok := document[field]; ok && value != nil {
			var raw string
			switch v := value.(type) {
			case json.Number:
				raw = string(v)
			case string:
				raw = v
			default:
				return false
			}
			if raw == "" {
				raw = "0"
			}
			n, err := strconv.ParseUint(raw, 10, 53)
			if err != nil {
				return false
			}
			document[field] = n
		}
	}
	field := "list"
	if operation == "categories" {
		field = "class"
	}
	raw, ok := document[field]
	if !ok || raw == nil {
		return true
	}
	items, ok := raw.([]any)
	if !ok {
		return false
	}
	for _, rawItem := range items {
		item, ok := rawItem.(map[string]any)
		if !ok {
			return false
		}
		idKey, nameKey := "vod_id", "vod_name"
		if operation == "categories" {
			idKey, nameKey = "type_id", "type_name"
		}
		switch id := item[idKey].(type) {
		case string:
		case json.Number:
			item[idKey] = string(id)
		default:
			return false
		}
		if _, ok := item[nameKey].(string); !ok {
			return false
		}
		if operation != "categories" {
			item["puretv_episodes"], item["puretv_episode_titles"] = episodes(item, operation == "downstream")
		}
	}
	return true
}
