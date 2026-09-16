package openlist

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func operationRequest(t *testing.T, base, path, method string) *http.Request {
	t.Helper()
	payload, _ := json.Marshal(map[string]any{"url": base, "username": "user", "password": "secret", "path": path, "method": method, "body": "{\"path\":\"/电影\"}", "headers": map[string]string{"Content-Type": "application/json"}})
	return httptest.NewRequest("POST", "/v1/openlist/operations", strings.NewReader(string(payload)))
}

func TestOperationRetriesOnlyExplicitUnauthorized(t *testing.T) {
	logins, calls := 0, 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/prefix/api/auth/login" {
			logins++
			if logins == 1 {
				writeLogin(w, "expired")
			} else {
				writeLogin(w, "fresh")
			}
			return
		}
		calls++
		if r.Header.Get("Authorization") == "expired" {
			_, _ = io.WriteString(w, `{"code":401}`)
			return
		}
		if r.Header.Get("Authorization") != "fresh" {
			t.Error("wrong credential")
		}
		body, _ := io.ReadAll(r.Body)
		if string(body) != "{\"path\":\"/电影\"}" {
			t.Error("body changed")
		}
		_, _ = io.WriteString(w, `{"code":200,"data":{"content":[],"total":0}}`)
	}))
	defer upstream.Close()
	h := testHandler(t, upstream.Client(), 2).Operations()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, operationRequest(t, upstream.URL+"/prefix", "/api/fs/list", "POST"))
	if w.Code != 200 || calls != 2 || logins != 2 || !strings.Contains(w.Body.String(), `"total":0`) {
		t.Fatalf("status %d calls %d logins %d body %s", w.Code, calls, logins, w.Body)
	}
}

func TestOperationDoesNotRetryFailedWrite(t *testing.T) {
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/login" {
			writeLogin(w, "token")
			return
		}
		calls++
		w.WriteHeader(500)
		_, _ = io.WriteString(w, `{"code":500}`)
	}))
	defer upstream.Close()
	h := testHandler(t, upstream.Client(), 2).Operations()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, operationRequest(t, upstream.URL, "/api/fs/add_offline_download", "POST"))
	if w.Code != 500 || calls != 1 {
		t.Fatalf("status %d calls %d", w.Code, calls)
	}
}

func TestOperationRejectsUnknownEndpointBeforeNetworking(t *testing.T) {
	h := testHandler(t, &http.Client{}, 2).Operations()
	for _, p := range []string{"/api/fs/list?path=bad", "https://private.example/", "/api/auth/login", "/api/../admin"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, operationRequest(t, "http://127.0.0.1:1", p, "POST"))
		if w.Code != 400 {
			t.Errorf("path %s status %d", p, w.Code)
		}
	}
}
