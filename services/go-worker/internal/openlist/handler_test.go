package openlist

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type testResult struct {
	Groups []struct {
		RootPath string            `json:"rootPath"`
		Folders  []json.RawMessage `json:"folders"`
	} `json:"groups"`
	Errors []struct {
		RootPath string `json:"rootPath"`
		Error    string `json:"error"`
	} `json:"errors"`
	Error string `json:"error"`
}

func testHandler(t *testing.T, client *http.Client, concurrency int) *Handler {
	t.Helper()
	h, err := New(Options{Client: client, Concurrency: concurrency})
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func rootRequest(t *testing.T, upstream string, roots []string) *http.Request {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"url": upstream, "username": "test-user", "password": "private-password", "rootPaths": roots,
	})
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodPost, "/v1/openlist/roots", strings.NewReader(string(body)))
	r.Header.Set("Content-Type", "application/json")
	return r
}

func runRoots(t *testing.T, h *Handler, upstream string, roots []string) (*httptest.ResponseRecorder, testResult) {
	t.Helper()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, rootRequest(t, upstream, roots))
	var result testResult
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("response was not JSON: %v", err)
	}
	if w.Header().Get("Content-Type") != "application/json; charset=utf-8" {
		t.Errorf("missing JSON content type: %q", w.Header().Get("Content-Type"))
	}
	return w, result
}

func writeLogin(w http.ResponseWriter, token string) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"code": 200, "data": map[string]string{"token": token}})
}

func writePage(w http.ResponseWriter, content []json.RawMessage) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"code": 200, "data": map[string]any{"content": content}})
}

func TestPaginationPreservesDirectoryFieldsAndPageOrder(t *testing.T) {
	var pages []int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("unexpected upstream request method/content type")
		}
		switch r.URL.Path {
		case "/prefix/api/auth/login":
			var credentials map[string]string
			_ = json.NewDecoder(r.Body).Decode(&credentials)
			if credentials["username"] != "test-user" || credentials["password"] != "private-password" {
				t.Error("login credentials were not passed through")
			}
			writeLogin(w, "private-token")
		case "/prefix/api/fs/list":
			if r.Header.Get("Authorization") != "private-token" {
				t.Error("OpenList expects a raw token without Bearer")
			}
			var body struct {
				Path     string `json:"path"`
				Page     int    `json:"page"`
				PerPage  int    `json:"per_page"`
				Refresh  bool   `json:"refresh"`
				Password string `json:"password"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body.Path != "/电影" || body.PerPage != 100 || !body.Refresh || body.Password != "" {
				t.Errorf("invalid directory request: %+v", body)
			}
			pages = append(pages, body.Page)
			if body.Page == 1 {
				content := make([]json.RawMessage, 100)
				for i := range content {
					content[i] = json.RawMessage(`{"name":"file.mp4","is_dir":false}`)
				}
				content[0] = json.RawMessage(`{"name":"第一部","size":9007199254740993,"is_dir":true,"modified":"2026-01-01","sign":"signed-value","raw_url":"https://example.com/media","thumb":"cover","type":1,"path":"/电影/第一部","extension":{"preserved":true}}`)
				writePage(w, content)
			} else {
				writePage(w, []json.RawMessage{json.RawMessage(`{"name":"第二部","is_dir":true}`)})
			}
		default:
			t.Errorf("unexpected upstream path %q", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	w, result := runRoots(t, testHandler(t, upstream.Client(), 2), upstream.URL+"/prefix/", []string{"/电影"})
	if w.Code != 200 || len(result.Groups) != 1 || len(result.Groups[0].Folders) != 2 || len(result.Errors) != 0 {
		t.Fatalf("unexpected roots response: status %d, %+v", w.Code, result)
	}
	if fmt.Sprint(pages) != "[1 2]" {
		t.Fatalf("unexpected page sequence: %v", pages)
	}
	first := string(result.Groups[0].Folders[0])
	for _, field := range []string{`"size":9007199254740993`, `"sign":"signed-value"`, `"extension":{"preserved":true}`, `"path":"/电影/第一部"`} {
		if !strings.Contains(first, field) {
			t.Errorf("lost raw folder field %s", field)
		}
	}
	if !strings.Contains(string(result.Groups[0].Folders[1]), "第二部") {
		t.Error("folder order was changed")
	}
}

func TestPartialFailureKeepsRootOrderAndBoundsConcurrency(t *testing.T) {
	var active, peak atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/login" {
			writeLogin(w, "token")
			return
		}
		current := active.Add(1)
		defer active.Add(-1)
		for previous := peak.Load(); current > previous && !peak.CompareAndSwap(previous, current); previous = peak.Load() {
		}
		var body struct {
			Path string `json:"path"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.Path == "/first" {
			time.Sleep(40 * time.Millisecond)
		}
		if body.Path == "/failed" {
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`{"message":"private-password private-token test-user"}`))
			return
		}
		writePage(w, []json.RawMessage{})
	}))
	defer upstream.Close()
	w, result := runRoots(t, testHandler(t, upstream.Client(), 2), upstream.URL, []string{"/first", "/failed", "/third", "/fourth"})
	if w.Code != 200 || len(result.Groups) != 3 || len(result.Errors) != 1 {
		t.Fatalf("unexpected partial result: %d %+v", w.Code, result)
	}
	for i, path := range []string{"/first", "/third", "/fourth"} {
		if result.Groups[i].RootPath != path || result.Groups[i].Folders == nil {
			t.Errorf("root ordering or empty array changed at %d", i)
		}
	}
	if result.Errors[0].RootPath != "/failed" || result.Errors[0].Error == "" {
		t.Error("missing safe root error")
	}
	if peak.Load() > 2 || peak.Load() < 2 {
		t.Errorf("configured concurrency was not used: %d", peak.Load())
	}
	for _, secret := range []string{"private-password", "private-token", "test-user"} {
		if strings.Contains(w.Body.String(), secret) {
			t.Errorf("upstream error leaked a credential")
		}
	}
}

func TestAuthenticationRefreshesOnceForHTTPAndJSON401(t *testing.T) {
	for _, mode := range []string{"http", "json", "repeated"} {
		t.Run(mode, func(t *testing.T) {
			var logins, lists atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/auth/login" {
					writeLogin(w, fmt.Sprintf("token-%d", logins.Add(1)))
					return
				}
				attempt := lists.Add(1)
				if attempt == 1 || mode == "repeated" {
					if mode != "json" {
						w.WriteHeader(http.StatusUnauthorized)
					}
					_, _ = w.Write([]byte(`{"code":401,"message":"private-password"}`))
					return
				}
				if r.Header.Get("Authorization") != "token-2" {
					t.Error("retry used expired token")
				}
				writePage(w, []json.RawMessage{})
			}))
			defer upstream.Close()
			w, result := runRoots(t, testHandler(t, upstream.Client(), 1), upstream.URL, []string{"/"})
			wantStatus := 200
			if mode == "repeated" {
				wantStatus = 502
			}
			if w.Code != wantStatus || logins.Load() != 2 || lists.Load() != 2 {
				t.Fatalf("retry was not bounded to once: status %d login %d list %d", w.Code, logins.Load(), lists.Load())
			}
			if mode == "repeated" && result.Error != "所有根目录列举失败" {
				t.Errorf("unexpected error %q", result.Error)
			}
		})
	}
}

func TestConcurrent401SharesOneRefresh(t *testing.T) {
	var logins, expired atomic.Int32
	ready := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/login" {
			writeLogin(w, fmt.Sprintf("token-%d", logins.Add(1)))
			return
		}
		if r.Header.Get("Authorization") == "token-1" {
			if expired.Add(1) == 3 {
				close(ready)
			}
			select {
			case <-ready:
			case <-r.Context().Done():
				return
			}
			w.WriteHeader(401)
			return
		}
		writePage(w, []json.RawMessage{})
	}))
	defer upstream.Close()
	w, result := runRoots(t, testHandler(t, upstream.Client(), 3), upstream.URL, []string{"/a", "/b", "/c"})
	if w.Code != 200 || len(result.Groups) != 3 || logins.Load() != 2 {
		t.Fatalf("concurrent refresh mismatch: status %d groups %d logins %d", w.Code, len(result.Groups), logins.Load())
	}
}

func TestRequestCancellationStopsDirectoryHTTPCall(t *testing.T) {
	started, stopped := make(chan struct{}), make(chan struct{})
	cleanup := make(chan struct{})
	var once sync.Once
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/login" {
			writeLogin(w, "token")
			return
		}
		// Consume the POST body so net/http can observe the peer disconnect.
		_, _ = io.Copy(io.Discard, r.Body)
		once.Do(func() { close(started) })
		select {
		case <-r.Context().Done():
			close(stopped)
		case <-cleanup:
		}
	}))
	defer upstream.Close()
	defer close(cleanup)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r := rootRequest(t, upstream.URL, []string{"/"}).WithContext(ctx)
	h := testHandler(t, upstream.Client(), 1)
	completed := make(chan struct{})
	go func() { h.ServeHTTP(httptest.NewRecorder(), r); close(completed) }()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("upstream never started")
	}
	cancel()
	select {
	case <-completed:
	case <-time.After(2 * time.Second):
		t.Fatal("handler ignored cancellation")
	}
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("upstream request survived cancellation")
	}
}

func TestCredentialsNeverFollowCrossOriginRedirects(t *testing.T) {
	for _, stage := range []string{"login", "list"} {
		t.Run(stage, func(t *testing.T) {
			var foreignCalls atomic.Int32
			foreign := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { foreignCalls.Add(1); writeLogin(w, "stolen") }))
			defer foreign.Close()
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if stage == "list" && r.URL.Path == "/api/auth/login" {
					writeLogin(w, "private-token")
					return
				}
				http.Redirect(w, r, foreign.URL+"/private-password", http.StatusTemporaryRedirect)
			}))
			defer upstream.Close()
			w, result := runRoots(t, testHandler(t, upstream.Client(), 1), upstream.URL, []string{"/"})
			if foreignCalls.Load() != 0 || w.Code != 502 || result.Error != "所有根目录列举失败" {
				t.Fatalf("unsafe redirect result: foreign calls %d status %d", foreignCalls.Load(), w.Code)
			}
			if strings.Contains(w.Body.String(), "private-password") {
				t.Error("redirect URL leaked")
			}
		})
	}
}

func TestCallerRedirectPolicyRemainsEffective(t *testing.T) {
	var redirects, destinationCalls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/login" {
			http.Redirect(w, r, "/blocked-login", http.StatusTemporaryRedirect)
			return
		}
		destinationCalls.Add(1)
		writeLogin(w, "token")
	}))
	defer upstream.Close()
	client := upstream.Client()
	client.CheckRedirect = func(*http.Request, []*http.Request) error {
		redirects.Add(1)
		return errors.New("private-password from caller policy")
	}
	w, _ := runRoots(t, testHandler(t, client, 1), upstream.URL, []string{"/"})
	if w.Code != 502 || redirects.Load() != 1 || destinationCalls.Load() != 0 {
		t.Fatalf("caller redirect policy bypassed: status %d callbacks %d destinations %d", w.Code, redirects.Load(), destinationCalls.Load())
	}
	if strings.Contains(w.Body.String(), "private-password") {
		t.Error("caller error leaked into response")
	}
}

func TestCredentialsAndTokensAreScopedToEachScan(t *testing.T) {
	var logins atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/login" {
			var credentials map[string]string
			_ = json.NewDecoder(r.Body).Decode(&credentials)
			if credentials["password"] != "password-for-"+credentials["username"] {
				t.Error("credentials crossed incoming scan requests")
			}
			logins.Add(1)
			writeLogin(w, "token-for-"+credentials["username"])
			return
		}
		var body struct {
			Path string `json:"path"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if r.Header.Get("Authorization") != "token-for-"+strings.TrimPrefix(body.Path, "/") {
			t.Error("token crossed incoming scan requests")
		}
		writePage(w, []json.RawMessage{})
	}))
	defer upstream.Close()
	h := testHandler(t, upstream.Client(), 2)
	for _, username := range []string{"alice", "bob"} {
		payload, _ := json.Marshal(map[string]any{
			"url": upstream.URL, "username": username, "password": "password-for-" + username, "rootPaths": []string{"/" + username},
		})
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/v1/openlist/roots", strings.NewReader(string(payload))))
		if w.Code != 200 {
			t.Fatalf("scan failed: %d", w.Code)
		}
	}
	if logins.Load() != 2 {
		t.Errorf("token survived its incoming scan: %d logins", logins.Load())
	}
}

func TestOversizedAndUnboundedUpstreamResponsesFailSafely(t *testing.T) {
	for _, mode := range []string{"oversized", "endless", "aggregate"} {
		t.Run(mode, func(t *testing.T) {
			var calls atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/auth/login" {
					writeLogin(w, "token")
					return
				}
				calls.Add(1)
				if mode == "oversized" {
					_, _ = w.Write([]byte(`{"code":200,"data":{"content":[]},"message":"` + strings.Repeat("x", 2<<20) + `"}`))
					return
				}
				content := make([]json.RawMessage, 100)
				for i := range content {
					content[i] = json.RawMessage(`{"name":"file","is_dir":false}`)
					if mode == "aggregate" {
						content[i] = json.RawMessage(`{"name":"` + strings.Repeat("x", 10000) + `","is_dir":true}`)
					}
				}
				writePage(w, content)
			}))
			defer upstream.Close()
			w, result := runRoots(t, testHandler(t, upstream.Client(), 1), upstream.URL, []string{"/"})
			if w.Code != 502 || result.Error != "所有根目录列举失败" {
				t.Fatalf("unbounded response accepted: %d", w.Code)
			}
			if calls.Load() > 1000 {
				t.Fatalf("pagination exceeded limit: %d", calls.Load())
			}
			if mode == "aggregate" && calls.Load() > 17 {
				t.Fatalf("aggregate folder memory was unbounded: %d megabyte pages", calls.Load())
			}
		})
	}
}

func TestInputAndOptionsAreBounded(t *testing.T) {
	for _, options := range []Options{{}, {Client: http.DefaultClient, Concurrency: -1}, {Client: http.DefaultClient, Concurrency: 17}} {
		if _, err := New(options); err == nil {
			t.Error("invalid client/concurrency accepted")
		}
	}
	h := testHandler(t, http.DefaultClient, 0)
	for _, body := range []string{
		`{"url":"file:///private-password","username":"u","password":"p","rootPaths":["/"]}`,
		`{"url":"http://u:private-password@example.com","username":"u","password":"p","rootPaths":["/"]}`,
		`{"url":"http://example.com","username":"u","password":"p","rootPaths":[]}`,
		strings.Repeat(" ", 64<<10) + `{}`,
	} {
		r := httptest.NewRequest(http.MethodPost, "/v1/openlist/roots", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 400 && w.Code != 413 {
			t.Errorf("invalid input accepted: status %d", w.Code)
		}
		if strings.Contains(w.Body.String(), "private-password") {
			t.Error("input validation leaked credentials")
		}
	}
}
