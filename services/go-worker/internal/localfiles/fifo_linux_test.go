//go:build linux

package localfiles

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestFIFORejected(t *testing.T) {
	dir := t.TempDir()
	ep := filepath.Join(dir, "s", "v", "ep1")
	if err := os.MkdirAll(ep, 0700); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Mkfifo(filepath.Join(ep, "pipe"), 0600); err != nil {
		t.Fatal(err)
	}
	done := make(chan int, 1)
	go func() {
		w := httptest.NewRecorder()
		New(dir).ServeHTTP(w, httptest.NewRequest("GET", "/v1/local-files?source=s&videoId=v&episodeIndex=0&file=pipe&format=query", nil))
		done <- w.Code
	}()
	select {
	case status := <-done:
		if status != 404 {
			t.Fatal(status)
		}
	case <-time.After(time.Second):
		t.Fatal("FIFO open blocked")
	}
}
