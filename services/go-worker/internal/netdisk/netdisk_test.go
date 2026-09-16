package netdisk

import (
	"bytes"
	"compress/gzip"
	"compress/zlib"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestCompressedVendorResponsesAndTimeout(t *testing.T) {
	for _, encoding := range []string{"gzip", "deflate"} {
		t.Run(encoding, func(t *testing.T) {
			var compressed bytes.Buffer
			var writer io.WriteCloser
			if encoding == "gzip" {
				writer = gzip.NewWriter(&compressed)
			} else {
				writer = zlib.NewWriter(&compressed)
			}
			_, _ = writer.Write([]byte(`{"share_status":"OK"}`))
			_ = writer.Close()
			m := &Manager{client: &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
				if strings.Contains(r.URL.Path, "captcha") {
					return response(200, `{"captcha_token":"test"}`), nil
				}
				res := response(200, compressed.String())
				res.Header.Set("Content-Encoding", encoding)
				return res, nil
			})}}
			if result := m.check(context.Background(), "xunlei", "https://pan.xunlei.com/s/abc"); result.Status != "valid" {
				t.Fatal(result)
			}
		})
	}
	cancelled := make(chan struct{})
	m := &Manager{client: &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		<-r.Context().Done()
		close(cancelled)
		return nil, r.Context().Err()
	})}}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	result := m.check(ctx, "aliyun", "https://alipan.com/s/abc")
	if result.Status != "unknown" {
		t.Fatal(result)
	}
	select {
	case <-cancelled:
	default:
		t.Fatal("timeout did not cancel HTTP")
	}
	if len(m.cache) != 0 {
		t.Fatal("cancelled result was cached")
	}
}

func TestBoundedCachePreservesResultTimestamp(t *testing.T) {
	var calls atomic.Int32
	m := &Manager{client: &http.Client{Transport: transportFunc(func(*http.Request) (*http.Response, error) { calls.Add(1); return response(200, `{}`), nil })}}
	first := m.check(context.Background(), "aliyun", "https://alipan.com/s/a")
	second := m.check(context.Background(), "aliyun", "https://alipan.com/s/a")
	if calls.Load() != 1 || !second.FromCache || second.CheckedAt != first.CheckedAt {
		t.Fatal("cache contract changed")
	}
	for i := 0; i < 3001; i++ {
		m.check(context.Background(), "aliyun", "invalid"+strings.Repeat("x", i))
	}
	if len(m.cache) > 3000 {
		t.Fatal("unbounded cache")
	}
}

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func response(s int, b string) *http.Response {
	return &http.Response{StatusCode: s, Body: io.NopCloser(strings.NewReader(b)), Header: make(http.Header)}
}
func TestVendorFixtures(t *testing.T) {
	encrypted, _ := cmccEncrypt([]byte(`{"resultCode":"0","data":{}}`))
	tests := []struct {
		name, p, link string
		status        int
		body          string
		want          string
	}{
		{"ali", "aliyun", "https://alipan.com/s/abc", 200, `{"code":"ShareLink.Cancelled"}`, "valid"},
		{"ali limit", "aliyun", "https://alipan.com/s/abc", 429, `{}`, "rate_limited"},
		{"115", "115", "https://115.com/s/abc#password=1234", 200, `{"state":true,"errno":0,"data":{"shareinfo":{"share_state":1}}}`, "valid"},
		{"115 missing code", "115", "https://115.com/s/abc", 200, `{}`, "invalid"},
		{"123 protected", "pan123", "https://123684.com/s/abc", 200, `{"data":{"HasPwd":true}}`, "valid"},
		{"123 restricted", "pan123", "https://123pan.cn/s/abc", 403, `denied`, "valid"},
		{"123 malformed", "pan123", "https://123pan.com/s/abc", 200, `broken`, "valid"},
		{"123 invalid", "pan123", "https://123pan.com/s/abc", 200, `{"code":1}`, "invalid"},
		{"uc valid", "uc", "https://drive.uc.cn/s/abc", 200, `分享文件`, "valid"},
		{"uc deleted", "uc", "https://drive.uc.cn/s/abc", 200, `分享文件已删除`, "invalid"},
		{"uc ambiguous", "uc", "https://drive.uc.cn/s/abc", 200, `hello`, "invalid"},
		{"baidu", "baidu", "https://pan.baidu.com/s/1abc?pwd=1234", 200, `{"errno":0}`, "valid"},
		{"baidu limit", "baidu", "https://pan.baidu.com/s/1abc", 200, `{"errno":-62}`, "rate_limited"},
		{"quark", "quark", "https://pan.qoark.cn/s/abc?pwd=1234", 200, `{"data":{"list":[{}]}}`, "valid"},
		{"quark empty", "quark", "https://pan.quark.cn/s/abc", 200, `{"data":{"list":[]}}`, "invalid"},
		{"tianyi", "tianyi", "https://cloud.189.cn/web/share?code=abc", 200, `{"shareId":12}`, "valid"},
		{"cmcc", "cmcc", "https://yun.139.com/shareweb/#/w/i/abc", 200, encrypted, "valid"},
		{"xunlei", "xunlei", "https://pan.xunlei.com/s/abc?pwd=1234", 200, `{"share_status":"OK"}`, "valid"},
		{"xunlei limited", "xunlei", "https://pan.xunlei.com/s/abc", 403, `{"error_code":9,"secret":"NEVER-LEAK"}`, "rate_limited"},
		{"error sanitized", "tianyi", "https://cloud.189.cn/t/abc", 200, `{"res_message":"NEVER-LEAK"}`, "invalid"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := &Manager{client: &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
				if r.URL.Path == "/share/verify" {
					b, _ := io.ReadAll(r.Body)
					if !strings.Contains(string(b), "pwd=1234") {
						t.Error("missing verify password")
					}
					return response(200, `{"errno":0,"randsk":"COOKIE-SECRET"}`), nil
				}
				if r.URL.Path == "/share/list" && strings.Contains(tt.link, "pwd=") {
					if r.Header.Get("Cookie") != "BDCLND=COOKIE-SECRET" {
						t.Error("missing verified cookie")
					}
					if r.URL.Query().Get("shorturl") != "abc" {
						t.Error("wrong shorturl")
					}
				}
				if strings.HasSuffix(r.URL.Path, "/token") {
					var body map[string]any
					_ = json.NewDecoder(r.Body).Decode(&body)
					if body["pwd_id"] != "abc" || body["support_visit_limit_private_share"] != true {
						t.Error("wrong token payload")
					}
					return response(200, `{"status":200,"code":0,"data":{"stoken":"TOKEN-SECRET"}}`), nil
				}
				if strings.HasSuffix(r.URL.Path, "/detail") && r.URL.Query().Get("stoken") != "TOKEN-SECRET" {
					t.Error("missing stoken")
				}
				if strings.HasSuffix(r.URL.Path, "/captcha/init") {
					var b map[string]any
					_ = json.NewDecoder(r.Body).Decode(&b)
					if !strings.HasPrefix(str(obj(b["meta"])["captcha_sign"]), "1.") {
						t.Error("bad captcha sign")
					}
					return response(200, `{"captcha_token":"CAPTCHA-SECRET"}`), nil
				}
				if r.URL.Host == "api-pan.xunlei.com" && r.Header.Get("X-Captcha-Token") != "CAPTCHA-SECRET" {
					t.Error("missing captcha")
				}
				if tt.p == "cmcc" {
					var b string
					_ = json.NewDecoder(r.Body).Decode(&b)
					plain, e := cmccDecrypt(b)
					if e != nil || !strings.Contains(string(plain), `"linkID":"abc"`) {
						t.Error("bad encrypted request")
					}
				}
				return response(tt.status, tt.body), nil
			})}}
			result := m.check(context.Background(), tt.p, tt.link)
			if result.Status != tt.want {
				t.Fatalf("got %+v want %s", result, tt.want)
			}
			if strings.Contains(result.Reason, "SECRET") || strings.Contains(result.Reason, "NEVER-LEAK") {
				t.Fatal("leaked upstream")
			}
		})
	}
}
func TestMalformedLinksNeverCallNetwork(t *testing.T) {
	m := &Manager{client: &http.Client{Transport: transportFunc(func(*http.Request) (*http.Response, error) { t.Fatal("unexpected network"); return nil, nil })}}
	for _, p := range []string{"115", "aliyun", "baidu", "cmcc", "pan123", "quark", "tianyi", "uc", "xunlei"} {
		for _, link := range []string{"bad", "file:///etc/passwd", "https://pan.baidu.com.evil/s/x", "https://user:secret@alipan.com/s/x", "http://127.0.0.1/s/x"} {
			if r := m.check(context.Background(), p, link); r.Status != "invalid" {
				t.Fatalf("%s %s: %+v", p, link, r)
			}
		}
	}
}
func call(m *Manager, method, path, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	m.ServeHTTP(w, httptest.NewRequest(method, "/v1/netdisk/check/"+path, strings.NewReader(body)))
	return w
}
func TestOwnershipCancellationPersistenceAndLock(t *testing.T) {
	dir := t.TempDir()
	started := make(chan struct{}, 3)
	stopped := make(chan struct{}, 3)
	client := &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		started <- struct{}{}
		<-r.Context().Done()
		stopped <- struct{}{}
		return nil, r.Context().Err()
	})}
	m, e := New(Options{StateDir: dir, Client: client})
	if e != nil {
		t.Fatal(e)
	}
	if other, e := New(Options{StateDir: dir, Client: client}); e == nil {
		other.Close(context.Background())
		t.Fatal("concurrent store allowed")
	}
	if w := call(m, "POST", "start", `{"platform":"aliyun","links":["https://alipan.com/s/a"]}`); w.Code != 401 {
		t.Fatal(w.Code)
	}
	w := call(m, "POST", "start", `{"owner":"alice","platform":"aliyun","links":["https://alipan.com/s/a","https://alipan.com/s/a"]}`)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var result struct {
		TaskID string `json:"taskId"`
		Task   Task   `json:"task"`
	}
	json.Unmarshal(w.Body.Bytes(), &result)
	if result.Task.Progress.Total != 1 {
		t.Fatal("no dedupe")
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("not started")
	}
	for _, action := range []string{"task", "cancel"} {
		var denied *httptest.ResponseRecorder
		if action == "task" {
			denied = call(m, "GET", "task?id="+result.TaskID+"&owner=bob", "")
		} else {
			denied = call(m, "POST", "cancel", `{"owner":"bob","taskId":"`+result.TaskID+`"}`)
		}
		if denied.Code != 404 {
			t.Fatal("ownership bypass")
		}
	}
	w = call(m, "POST", "cancel", `{"owner":"alice","taskId":"`+result.TaskID+`"}`)
	if !strings.Contains(w.Body.String(), `"status":"cancelled"`) {
		t.Fatal(w.Body.String())
	}
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("request not cancelled")
	}
	if e = m.Close(context.Background()); e != nil {
		t.Fatal(e)
	}
	m, e = New(Options{StateDir: dir, Client: client})
	if e != nil {
		t.Fatal(e)
	}
	defer m.Close(context.Background())
	w = call(m, "GET", "task?id="+result.TaskID+"&owner=alice", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"status":"cancelled"`) {
		t.Fatal(w.Body.String())
	}
}
func TestInterruptedRestartAndRetention(t *testing.T) {
	dir := t.TempDir()
	os.Mkdir(filepath.Join(dir, "netdisk"), 0700)
	now := time.Now().UnixMilli()
	state := diskState{Tasks: map[string]record{"running": {Owner: "a", Task: &Task{ID: "running", Status: "running", UpdatedAt: now}}, "old": {Owner: "a", Task: &Task{ID: "old", Status: "completed", UpdatedAt: now - 3600001}}}}
	b, _ := json.Marshal(state)
	os.WriteFile(filepath.Join(dir, "netdisk", "tasks.json"), b, 0600)
	var calls atomic.Int32
	m, e := New(Options{StateDir: dir, Client: &http.Client{Transport: transportFunc(func(*http.Request) (*http.Response, error) { calls.Add(1); return response(200, `{}`), nil })}})
	if e != nil {
		t.Fatal(e)
	}
	defer m.Close(context.Background())
	if m.state.Tasks["running"].Task.Status != "failed" || len(m.state.Tasks) != 1 || calls.Load() != 0 {
		t.Fatal("unsafe restart")
	}
}
func TestCooldownAndBounds(t *testing.T) {
	m, e := New(Options{StateDir: t.TempDir(), Client: &http.Client{Transport: transportFunc(func(*http.Request) (*http.Response, error) { return response(429, `secret`), nil })}})
	if e != nil {
		t.Fatal(e)
	}
	defer m.Close(context.Background())
	w := call(m, "POST", "start", `{"owner":"a","platform":"aliyun","links":["https://alipan.com/s/a"]}`)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		m.mu.Lock()
		cool := m.cooldown()
		m.mu.Unlock()
		if cool > 0 {
			break
		}
		time.Sleep(time.Millisecond)
	}
	w = call(m, "POST", "start", `{"owner":"a","platform":"aliyun","links":["https://alipan.com/s/b"]}`)
	if w.Code != 400 {
		t.Fatal("cooldown missing")
	}
	if w = call(m, "POST", "start", string(bytes.Repeat([]byte("x"), 513<<10))); w.Code != 400 {
		t.Fatal("unbounded body")
	}
}

type blockingWriter struct {
	header  http.Header
	entered chan struct{}
	release chan struct{}
}

func (w *blockingWriter) Header() http.Header { return w.header }
func (w *blockingWriter) WriteHeader(int)     {}
func (w *blockingWriter) Write(b []byte) (int, error) {
	close(w.entered)
	<-w.release
	return len(b), nil
}
func TestSlowResponseDoesNotHoldTaskLock(t *testing.T) {
	m, e := New(Options{StateDir: t.TempDir(), Client: &http.Client{}})
	if e != nil {
		t.Fatal(e)
	}
	defer m.Close(context.Background())
	w := &blockingWriter{header: make(http.Header), entered: make(chan struct{}), release: make(chan struct{})}
	done := make(chan struct{})
	go func() {
		m.ServeHTTP(w, httptest.NewRequest("GET", "/v1/netdisk/check/task?id=missing&owner=a", nil))
		close(done)
	}()
	<-w.entered
	lock := make(chan struct{})
	go func() { m.mu.Lock(); m.mu.Unlock(); close(lock) }()
	select {
	case <-lock:
	case <-time.After(time.Second):
		close(w.release)
		t.Fatal("socket write holds mutex")
	}
	close(w.release)
	<-done
}
func TestStorageCapacityAndOversizedRecovery(t *testing.T) {
	dir := t.TempDir()
	m, e := New(Options{StateDir: dir, Client: &http.Client{}})
	if e != nil {
		t.Fatal(e)
	}
	m.mu.Lock()
	m.state.Tasks["big"] = record{Owner: "a", Task: &Task{ID: "big", Status: "completed", UpdatedAt: time.Now().UnixMilli(), Error: strings.Repeat("x", 31<<20)}}
	m.mu.Unlock()
	w := call(m, "POST", "start", `{"owner":"a","platform":"aliyun","links":["https://alipan.com/s/a"]}`)
	if w.Code != 400 || len(m.active) != 0 {
		t.Fatal("accepted beyond capacity")
	}
	m.mu.Lock()
	delete(m.state.Tasks, "big")
	m.mu.Unlock()
	m.Close(context.Background())
	f, e := os.OpenFile(filepath.Join(dir, "netdisk", "tasks.json"), os.O_WRONLY|os.O_TRUNC, 0600)
	if e != nil {
		t.Fatal(e)
	}
	f.Truncate((32 << 20) + 1)
	f.Close()
	if other, e := New(Options{StateDir: dir, Client: &http.Client{}}); e == nil {
		other.Close(context.Background())
		t.Fatal("accepted oversized disk state")
	}
}
