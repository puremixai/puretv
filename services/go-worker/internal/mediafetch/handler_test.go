package mediafetch

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestMetadataProxyPreservesTrustedOrigins(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"name":"LAN mirror"}`)
	}))
	defer upstream.Close()
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "CONNECT" {
			http.Error(w, "CONNECT required", 405)
			return
		}
		target, err := net.DialTimeout("tcp", r.Host, time.Second)
		if err != nil {
			http.Error(w, "dial failed", 502)
			return
		}
		defer target.Close()
		conn, buffered, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		defer conn.Close()
		_, _ = buffered.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n")
		_ = buffered.Flush()
		done := make(chan struct{})
		go func() { _, _ = io.Copy(target, buffered); _ = target.Close(); close(done) }()
		_, _ = io.Copy(conn, target)
		_ = conn.Close()
		<-done
	}))
	defer proxy.Close()
	grants := []string{upstream.URL}
	h := New(upstream.Client(), grants)
	// Constructor takes a copy: a caller mutating its config slice cannot change policy.
	grants[0] = "https://unrelated.example"
	w := call(t, h, "/v1/metadata/fetch", input{URL: upstream.URL, Proxy: proxy.URL})
	if w.Code != 200 || !strings.Contains(w.Body.String(), "LAN mirror") {
		t.Fatalf("granted proxy target rejected: %d %s", w.Code, w.Body)
	}
	w = call(t, New(upstream.Client()), "/v1/metadata/fetch", input{URL: upstream.URL, Proxy: proxy.URL})
	if w.Code != 502 {
		t.Fatalf("ungranted proxy target accepted: %d", w.Code)
	}
}

func call(t *testing.T, h http.Handler, path string, in input) *httptest.ResponseRecorder {
	t.Helper()
	data, _ := json.Marshal(in)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", path, bytes.NewReader(data)))
	return w
}
func TestPrecheckRedirectSignedURLAndCancelBody(t *testing.T) {
	stopped := make(chan struct{})
	var upstream *httptest.Server
	upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") != "Example Player" {
			t.Errorf("UA lost: %q", r.Header.Get("User-Agent"))
		}
		if r.URL.Path == "/start" {
			http.Redirect(w, r, upstream.URL+"/stream.M3U8?sig=a%2Fb%26c%2Bz", 302)
			return
		}
		if r.URL.RawQuery != "sig=a%2Fb%26c%2Bz" {
			t.Errorf("signature changed: %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(stopped)
	}))
	defer upstream.Close()
	w := call(t, New(upstream.Client()), "/v1/live/precheck", input{URL: upstream.URL + "/start", UA: "Example Player"})
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"type":"m3u8"`) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("precheck did not cancel upstream body")
	}
}
func TestEPGMappingTimezonesGzipAndMinifiedXML(t *testing.T) {
	xml := `<?xml version="1.0"?><tv><channel id="1"><display-name>CCTV1</display-name></channel><programme start="20260914120000 +0800" stop="20260914130000 +0800" channel="1"><title lang="zh">新闻 &amp; 天气</title></programme><programme channel="other" start="x" stop="y"><title>skip</title></programme></tv>`
	for _, compressed := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "gzip"}[compressed], func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if compressed {
					g := gzip.NewWriter(w)
					_, _ = io.WriteString(g, xml)
					_ = g.Close()
				} else {
					_, _ = io.WriteString(w, xml)
				}
			}))
			defer upstream.Close()
			w := call(t, New(upstream.Client()), "/v1/live/epg", input{URL: upstream.URL + "/guide.gz", TvgIDs: []string{"CCTV1"}})
			var got map[string][]program
			if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if w.Code != 200 || len(got) != 1 || len(got["CCTV1"]) != 1 || got["CCTV1"][0].Start != "20260914120000 +0800" || got["CCTV1"][0].Title != "新闻 & 天气" {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
		})
	}
}
func TestCompressedLimitAndInvalidXML(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		g := gzip.NewWriter(w)
		_, _ = io.WriteString(g, strings.Repeat("x", maxBody+1))
		_ = g.Close()
	}))
	defer upstream.Close()
	w := call(t, New(upstream.Client()), "/v1/live/epg/download", input{URL: upstream.URL})
	if w.Code != 502 {
		t.Fatalf("gzip bomb accepted: %d", w.Code)
	}
	if _, err := parseEPG(strings.NewReader(`<tv><programme>`), nil); err == nil {
		t.Fatal("malformed XML accepted")
	}
}
func TestDanmakuPayloadAndMetadataStatus(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/comments" {
			_, _ = io.WriteString(w, `<i><d p="1,2,3,4,5,6,7,123">Hi &amp; bye</d></i>`)
			return
		}
		w.WriteHeader(429)
		_, _ = io.WriteString(w, `{"error":"limit"}`)
	}))
	defer upstream.Close()
	h := New(upstream.Client())
	w := call(t, h, "/v1/danmaku/comment", input{URL: upstream.URL + "/comments"})
	var v struct {
		Count    int
		Comments []comment
	}
	_ = json.Unmarshal(w.Body.Bytes(), &v)
	if w.Code != 200 || v.Count != 1 || v.Comments[0].M != "Hi &amp; bye" || v.Comments[0].CID != float64(123) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	w = call(t, h, "/v1/metadata/fetch", input{URL: upstream.URL})
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"status":429`) {
		t.Fatalf("metadata error status lost: %s", w.Body)
	}
}
func TestCancellationAndSubscriptionCap(t *testing.T) {
	started := make(chan struct{})
	stopped := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/large" {
			_, _ = io.WriteString(w, strings.Repeat("x", 256*1024+1))
			return
		}
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
		close(stopped)
	}))
	defer upstream.Close()
	h := New(upstream.Client())
	w := call(t, h, "/v1/subscriptions/fetch", input{URL: upstream.URL + "/large"})
	if w.Code != 502 {
		t.Fatal("oversize subscription accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	data, _ := json.Marshal(input{URL: upstream.URL})
	r := httptest.NewRequest("POST", "/v1/live/epg/download", bytes.NewReader(data)).WithContext(ctx)
	done := make(chan struct{})
	go func() { h.ServeHTTP(httptest.NewRecorder(), r); close(done) }()
	<-started
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("request did not cancel")
	}
	<-stopped
}

func TestStrictJSONAndSharedAdmission(t *testing.T) {
	h := New(&http.Client{}).(*Handler)
	for _, body := range []string{`{"url":"https://example.com","unknown":true}`, `{"url":"https://example.com"}{}`} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("POST", "/v1/live/epg", strings.NewReader(body)))
		if w.Code != 400 {
			t.Fatalf("invalid JSON accepted: %d", w.Code)
		}
	}
	for i := 0; i < cap(h.slots); i++ {
		h.slots <- struct{}{}
	}
	w := call(t, h, "/v1/metadata/fetch", input{URL: "https://example.com"})
	if w.Code != 429 {
		t.Fatalf("admission unbounded: %d", w.Code)
	}
}

func TestJSCommentIDs(t *testing.T) {
	for _, tc := range []struct {
		value string
		want  any
	}{{"123abc", float64(123)}, {" -0x10tail", float64(-16)}, {"08abc", float64(8)}, {"abc", nil}, {"9007199254740993", float64(9007199254740992)}} {
		if got := jsParseInt(tc.value); got != tc.want {
			t.Errorf("parseInt(%q)=%v want %v", tc.value, got, tc.want)
		}
	}
}

func TestMetadataCapBeforeJSONExpansion(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, strings.Repeat("\x00", 8*1024*1024+1))
	}))
	defer upstream.Close()
	w := call(t, New(upstream.Client()), "/v1/metadata/fetch", input{URL: upstream.URL})
	if w.Code != 502 {
		t.Fatal("metadata expansion cap missing")
	}
}

func TestEPGLateChannelMappingRetainsSinglePassContract(t *testing.T) {
	result, err := parseEPG(strings.NewReader(`<tv><programme channel="1" start="a" stop="b"><title>before map</title></programme><channel id="1"><display-name>CCTV1</display-name></channel><programme channel="1" start="c" stop="d"><title>after map</title></programme></tv>`), []string{"CCTV1"})
	if err != nil || len(result["CCTV1"]) != 1 || result["CCTV1"][0].Title != "after map" {
		t.Fatalf("%v %v", result, err)
	}
}
