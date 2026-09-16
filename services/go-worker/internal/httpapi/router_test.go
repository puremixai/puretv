package httpapi

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHealthAndInternalAuthorization(t *testing.T) {
	calls := 0
	upstream := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(202)
		_, _ = w.Write([]byte(`{"task":"existing-contract"}`))
	})
	handler, err := NewRouter(Options{Token: strings.Repeat("s", 32), Downloads: upstream, OpenList: upstream})
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		path, token string
		status      int
	}{
		{"/healthz", "", 200}, {"/readyz", "", 200},
		{"/v1/offline-download", "", 401}, {"/v1/openlist/roots", "Bearer wrong", 401},
		{"/v1/offline-download", "Bearer " + strings.Repeat("s", 32), 202},
	} {
		req := httptest.NewRequest("GET", tc.path, nil)
		req.Header.Set("Authorization", tc.token)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != tc.status {
			t.Errorf("%s: got %d want %d", tc.path, rec.Code, tc.status)
		}
		if rec.Header().Get("Cache-Control") != "no-store" {
			t.Errorf("%s must not be cached", tc.path)
		}
	}
	if calls != 1 {
		t.Errorf("unauthorized request reached worker: %d calls", calls)
	}
}

func TestRouterPreservesPayloadAndQuery(t *testing.T) {
	token := strings.Repeat("k", 32)
	called := false
	handler, err := NewRouter(Options{Token: token, Downloads: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if r.Method != "POST" || r.URL.RawQuery != "taskId=a%2Fb&action=retry" {
			t.Errorf("request changed: %s %s", r.Method, r.URL.RawQuery)
		}
		body, _ := io.ReadAll(r.Body)
		if string(body) != `{"m3u8Url":"https://cdn.example/a?sig=a%2Fb"}` {
			t.Errorf("body changed: %s", body)
		}
		w.WriteHeader(400)
		_, _ = w.Write([]byte(`{"error":"任务已存在"}`))
	})})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("POST", "/v1/offline-download?taskId=a%2Fb&action=retry", strings.NewReader(`{"m3u8Url":"https://cdn.example/a?sig=a%2Fb"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if !called || rec.Code != 400 || rec.Body.String() != `{"error":"任务已存在"}` {
		t.Fatalf("lost contract: %d %s", rec.Code, rec.Body)
	}
}

func TestRouterRequiresStrongToken(t *testing.T) {
	for _, token := range []string{"", "short"} {
		if _, err := NewRouter(Options{Token: token}); err == nil {
			t.Fatal("accepted missing/short token")
		}
	}
}

func TestExtraRoutesUseAuthenticationAndDisabledModulesFailClosed(t *testing.T) {
	called := false
	token := strings.Repeat("k", 32)
	h, _ := NewRouter(Options{Token: token, Extra: map[string]http.Handler{
		"/v1/jobs":        http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true; w.WriteHeader(202) }),
		"/v1/local-files": nil,
	}})
	for _, tc := range []struct {
		path, authorization string
		want                int
	}{
		{"/v1/jobs", "", 401}, {"/v1/jobs", "Bearer " + token, 202}, {"/v1/local-files", "Bearer " + token, 503}, {"/v1/jobs/extra", "Bearer " + token, 404},
	} {
		r := httptest.NewRequest("POST", tc.path, nil)
		r.Header.Set("Authorization", tc.authorization)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tc.want {
			t.Errorf("%s status%d", tc.path, w.Code)
		}
		if tc.authorization == "" && called {
			t.Fatal("anonymous dispatch")
		}
	}
}
