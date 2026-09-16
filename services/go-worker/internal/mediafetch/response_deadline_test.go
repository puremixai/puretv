package mediafetch

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"
)

// Model a non-reading socket with an accelerated clock. Writes cannot finish
// until the handler sets a deadline; request contexts intentionally stay live.
type nonreadingWriter struct {
	header   http.Header
	expired  chan struct{}
	rescue   chan struct{}
	once     sync.Once
	status   int
	timedOut bool
}

func (w *nonreadingWriter) Header() http.Header    { return w.header }
func (w *nonreadingWriter) WriteHeader(status int) { w.status = status }
func (w *nonreadingWriter) SetWriteDeadline(deadline time.Time) error {
	if deadline.IsZero() || time.Until(deadline) > 11*time.Second {
		return nil
	}
	w.once.Do(func() { time.AfterFunc(15*time.Millisecond, func() { close(w.expired) }) })
	return nil
}
func (w *nonreadingWriter) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	select {
	case <-w.expired:
		w.timedOut = true
	case <-w.rescue:
	}
	return 0, os.ErrDeadlineExceeded
}

func TestResponseWriteDeadlineReleasesAdmission(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {

		_, _ = w.Write([]byte(`{"title":"ok"}`))
	}))
	defer upstream.Close()
	h := New(upstream.Client())
	payload, _ := json.Marshal(map[string]any{"url": upstream.URL})
	makeRequest := func(invalid bool) *http.Request {
		body := payload
		if invalid {
			body = []byte(`{`)
		}
		return httptest.NewRequest("POST", "/v1/metadata/fetch", bytes.NewReader(body))
	}
	for _, invalid := range []bool{false, true} {
		done := make(chan *nonreadingWriter, 4)
		rescue := make(chan struct{})
		for i := 0; i < 4; i++ {
			writer := &nonreadingWriter{header: make(http.Header), expired: make(chan struct{}), rescue: rescue}
			go func() { h.ServeHTTP(writer, makeRequest(invalid)); done <- writer }()
		}
		for i := 0; i < 4; i++ {
			select {
			case writer := <-done:
				want := 200
				if invalid {
					want = 400
				}
				if writer.status != want || !writer.timedOut {
					close(rescue)
					t.Fatalf("status=%d timedOut=%v invalid=%v", writer.status, writer.timedOut, invalid)
				}
			case <-time.After(time.Second):
				close(rescue)
				t.Fatal("blocked downstream write retained handler admission")
			}
		}
		close(rescue)
		// All permits must be reusable after the expired writes, without cancelling
		// incoming request contexts or waiting for upstream request timeouts.
		w := httptest.NewRecorder()
		h.ServeHTTP(w, makeRequest(false))
		if w.Code != 200 {
			t.Fatalf("permit not released: %d %s", w.Code, w.Body)
		}
	}
}
