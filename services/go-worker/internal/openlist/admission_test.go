package openlist

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type countedBody struct {
	io.ReadCloser
	reads int
}

func (b *countedBody) Read(p []byte) (int, error) {
	b.reads++
	return b.ReadCloser.Read(p)
}

func TestConcurrentScansRejectWithoutReadingBodyAndReleaseAdmission(t *testing.T) {
	for _, outcome := range []string{"success", "failure", "canceled"} {
		t.Run(outcome, func(t *testing.T) {
			started, release := make(chan struct{}), make(chan struct{})
			var releaseOnce sync.Once
			unblock := func() { releaseOnce.Do(func() { close(release) }) }
			var logins atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/auth/login" {
					logins.Add(1)
					writeLogin(w, "private-token")
					return
				}
				var body struct {
					Path string `json:"path"`
				}
				_ = json.NewDecoder(r.Body).Decode(&body)
				_, _ = io.Copy(io.Discard, r.Body)
				if body.Path == "/first" {
					close(started)
					select {
					case <-release:
					case <-r.Context().Done():
						return
					}
					if outcome == "failure" {
						w.WriteHeader(http.StatusBadGateway)
						return
					}
				}
				writePage(w, []json.RawMessage{})
			}))
			defer upstream.Close()
			defer unblock()
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			h := testHandler(t, upstream.Client(), 2)
			first := rootRequest(t, upstream.URL, []string{"/first"}).WithContext(ctx)
			firstResponse := httptest.NewRecorder()
			completed := make(chan struct{})
			go func() { h.ServeHTTP(firstResponse, first); close(completed) }()
			select {
			case <-started:
			case <-time.After(2 * time.Second):
				t.Fatal("first scan never reached the upstream")
			}

			second := rootRequest(t, upstream.URL, []string{"/second"})
			body := &countedBody{ReadCloser: second.Body}
			second.Body = body
			busy := httptest.NewRecorder()
			h.ServeHTTP(busy, second)
			if busy.Code != http.StatusTooManyRequests || body.reads != 0 || logins.Load() != 1 {
				t.Errorf("concurrent scan was not rejected before work: status %d body reads %d logins %d", busy.Code, body.reads, logins.Load())
			}
			var rejected testResult
			if err := json.Unmarshal(busy.Body.Bytes(), &rejected); err != nil || rejected.Error == "" || strings.Contains(busy.Body.String(), "private-") {
				t.Error("busy response must contain a safe JSON error")
			}

			if outcome == "canceled" {
				cancel()
			} else {
				unblock()
			}
			select {
			case <-completed:
			case <-time.After(2 * time.Second):
				t.Fatal("first scan did not finish")
			}
			wantStatus := http.StatusBadGateway
			if outcome == "success" {
				wantStatus = http.StatusOK
			}
			if firstResponse.Code != wantStatus {
				t.Errorf("first scan status = %d, want %d", firstResponse.Code, wantStatus)
			}
			next, _ := runRoots(t, h, upstream.URL, []string{"/next"})
			if next.Code != http.StatusOK {
				t.Errorf("admission was not released after %s: status %d", outcome, next.Code)
			}
		})
	}
}
