package localfiles

import (
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFiles(t *testing.T) {
	root := t.TempDir()
	ep := filepath.Join(root, "source", "video", "ep1")
	if err := os.MkdirAll(ep, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ep, "clip.ts"), []byte("0123456789"), 0600); err != nil {
		t.Fatal(err)
	}
	h := New(root)
	for _, tt := range []struct {
		name, method, file, span string
		status                   int
		body                     string
	}{
		{"all", "GET", "clip.ts", "", 200, "0123456789"},
		{"head", "HEAD", "clip.ts", "", 200, ""},
		{"range", "GET", "clip.ts", "bytes=2-4", 206, "234"},
		{"suffix", "GET", "clip.ts", "bytes=-3", 206, "789"},
		{"bad range", "GET", "clip.ts", "bytes=90-100", 416, ""},
		{"invalid range", "GET", "clip.ts", "bytes=no", 416, ""},
		{"traversal", "GET", "../clip.ts", "", 400, ""},
		{"windows", "GET", `..\clip.ts`, "", 400, ""},
		{"absolute", "GET", "/clip.ts", "", 400, ""},
		{"directory", "GET", "dir", "", 404, ""},
	} {
		t.Run(tt.name, func(t *testing.T) {
			q := url.Values{"source": {"source"}, "videoId": {"video"}, "episodeIndex": {"0"}, "file": {tt.file}, "format": {"query"}}
			req := httptest.NewRequest(tt.method, "/v1/local-files?"+q.Encode(), nil)
			req.Header.Set("Range", tt.span)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, req)
			if w.Code != tt.status {
				t.Fatalf("status %d body %s", w.Code, w.Body.String())
			}
			if tt.status < 400 && w.Body.String() != tt.body {
				t.Fatalf("body %q", w.Body.String())
			}
			if tt.method == "HEAD" && w.Header().Get("Content-Length") != "10" {
				t.Fatal("missing HEAD size")
			}
			if tt.name == "bad range" && w.Header().Get("Content-Range") != "bytes */10" {
				t.Fatal("missing unsatisfied range")
			}
		})
	}
	outside := filepath.Join(t.TempDir(), "secret")
	if err := os.WriteFile(outside, []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(ep, "link")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/v1/local-files?source=source&videoId=video&episodeIndex=0&file=link&format=query", nil))
	if w.Code != 404 || strings.Contains(w.Body.String(), "secret") {
		t.Fatal("escaped root")
	}
}

func TestPlaylist(t *testing.T) {
	content := "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"../key.key?token=a%26b\"\n#EXT-X-MAP:URI=\"init.mp4\"\nseg%20one.ts?token=a%26b\nhttps://cdn.example/external.ts\nvariant.m3u8\n"
	q := url.Values{"source": {"s &"}, "videoId": {"v"}, "episodeIndex": {"0"}, "file": {"nested/playlist.m3u8"}, "format": {"query"}}
	out, err := rewrite(content, q)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "file=key.key") || !strings.Contains(out, "file=nested%2Fseg+one.ts") || !strings.Contains(out, "token=a%26b") || !strings.Contains(out, "file=nested%2Finit.mp4") || !strings.Contains(out, "https://cdn.example/external.ts") {
		t.Fatal(out)
	}
	q.Set("format", "path")
	out, err = rewrite(content, q)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "/api/offline-download/local/s%20&/v/0/nested/seg%20one.ts?token=a%26b") || !strings.Contains(out, "/v/0/key.key?token=a%26b") {
		t.Fatal(out)
	}
}

func TestPlaylistExpansionLimit(t *testing.T) {
	q := url.Values{"source": {strings.Repeat("s", 512)}, "videoId": {"v"}, "episodeIndex": {"0"}, "file": {"playlist.m3u8"}, "format": {"query"}}
	if _, err := rewrite(strings.Repeat("a\n", 20000), q); err == nil {
		t.Fatal("expected expanded output limit")
	}
	if _, err := rewrite(strings.Repeat("https://cdn.test/a\n", 100001), q); err == nil {
		t.Fatal("expected URI count limit")
	}
	if validPart(strings.Repeat("x", 513)) || validFile(strings.Repeat("a/", 3000)+"a") {
		t.Fatal("expected path length limits")
	}
}
