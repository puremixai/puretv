package downloads_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/puremixai/puretv/services/go-worker/internal/downloads"
)

func request(t *testing.T, m *downloads.Manager, method, query string, body any) (int, map[string]any) {
	t.Helper()
	var data []byte
	if body != nil {
		var err error
		data, err = json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
	}
	r := httptest.NewRequest(method, "/v1/offline-download"+query, strings.NewReader(string(data)))
	w := httptest.NewRecorder()
	m.ServeHTTP(w, r)
	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("HTTP %d invalid JSON: %s", w.Code, w.Body.String())
	}
	return w.Code, result
}

func newManager(t *testing.T, root string, client *http.Client, concurrency, segments int) *downloads.Manager {
	t.Helper()
	m, err := downloads.New(downloads.Options{Root: root, Client: client, Concurrency: concurrency, SegmentConcurrency: segments})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := m.Close(ctx); err != nil {
			t.Error(err)
		}
	})
	return m
}

func create(t *testing.T, m *downloads.Manager, source, video, stream string) map[string]any {
	t.Helper()
	code, result := request(t, m, "POST", "", map[string]any{
		"source": source, "videoId": video, "episodeIndex": 0, "title": "测试_第1集", "m3u8Url": stream,
		"metadata": map[string]any{"videoTitle": "测试", "cover": "https://image.example/poster.jpg", "description": "剧情", "year": "2026", "rating": 8.5, "totalEpisodes": 12},
	})
	if code != 200 || result["message"] != "任务已创建" {
		t.Fatalf("create: %d %#v", code, result)
	}
	return result["task"].(map[string]any)
}

func eventually(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(6 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("condition not reached")
}

func waitTask(t *testing.T, m *downloads.Manager, id, state string) map[string]any {
	t.Helper()
	var task map[string]any
	eventually(t, func() bool {
		_, body := request(t, m, "GET", "", nil)
		for _, item := range body["tasks"].([]any) {
			candidate := item.(map[string]any)
			if candidate["id"] == id {
				task = candidate
				return task["status"] == state
			}
		}
		return false
	})
	return task
}

func TestMasterEncryptedDownloadContractAndDeletion(t *testing.T) {
	var badRequests atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") == "" || r.Header.Get("Origin") == "" || r.Header.Get("Referer") == "" {
			badRequests.Add(1)
		}
		switch r.URL.Path {
		case "/master.m3u8":
			fmt.Fprint(w, "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=9000000,RESOLUTION=640x360\nlow/list.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1920x1080\nhigh/list.m3u8?token=a%2Fb%2Bc\n")
		case "/high/list.m3u8":
			if r.URL.RawQuery != "token=a%2Fb%2Bc" {
				badRequests.Add(1)
			}
			fmt.Fprint(w, "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-MEDIA-SEQUENCE:9\n#EXT-X-KEY:METHOD=AES-128,URI=\"../secret.key?token=a%2Fb\",IV=0x00000000000000000000000000000009\n#EXTINF:4.0,\npart.ts?token=x%2By\n#EXT-X-DISCONTINUITY\n#EXTINF:5,\n/second.ts\n#EXT-X-ENDLIST\n")
		case "/secret.key":
			fmt.Fprint(w, "0123456789abcdef")
		case "/high/part.ts":
			if r.URL.RawQuery != "token=x%2By" {
				badRequests.Add(1)
			}
			fmt.Fprint(w, "encrypted-segment-one")
		case "/second.ts":
			fmt.Fprint(w, "encrypted-segment-two")
		default:
			badRequests.Add(1)
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(s.Close)
	root := t.TempDir()
	m := newManager(t, root, s.Client(), 2, 2)
	created := create(t, m, "source", "video", s.URL+"/master.m3u8")
	id := created["id"].(string)
	finished := waitTask(t, m, id, "completed")
	if finished["progress"] != float64(100) || finished["totalSegments"] != float64(2) || finished["downloadedSegments"] != float64(2) {
		t.Fatalf("progress: %#v", finished)
	}
	if finished["metadata"].(map[string]any)["videoTitle"] != "测试" {
		t.Fatalf("metadata: %#v", finished)
	}
	if _, err := time.Parse(time.RFC3339Nano, finished["createdAt"].(string)); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(root, "source", "video", "ep1")
	for name, want := range map[string]string{"segment_00000.ts": "encrypted-segment-one", "segment_00001.ts": "encrypted-segment-two", "key.key": "0123456789abcdef"} {
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil || string(data) != want {
			t.Fatalf("file %s: %q %v", name, data, err)
		}
	}
	playlist, err := os.ReadFile(filepath.Join(dir, "playlist.m3u8"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"URI=\"key.key\"", "IV=0x00000000000000000000000000000009", "#EXT-X-MEDIA-SEQUENCE:9", "#EXT-X-DISCONTINUITY", "segment_00000.ts", "segment_00001.ts"} {
		if !strings.Contains(string(playlist), want) {
			t.Errorf("missing %q in %s", want, playlist)
		}
	}
	if badRequests.Load() != 0 {
		t.Fatalf("bad upstream requests: %d", badRequests.Load())
	}
	code, check := request(t, m, "GET", "?action=check&source=source&videoId=video&episodeIndex=0", nil)
	if code != 200 || check["downloaded"] != true {
		t.Fatalf("check: %d %#v", code, check)
	}
	code, duplicate := request(t, m, "POST", "", map[string]any{"source": "source", "videoId": "video", "episodeIndex": 0, "title": "other", "m3u8Url": s.URL + "/master.m3u8"})
	if code != 400 || duplicate["task"].(map[string]any)["id"] != id {
		t.Fatalf("duplicate: %d %#v", code, duplicate)
	}
	code, deleted := request(t, m, "DELETE", "?taskId="+url.QueryEscape(id), nil)
	if code != 200 || deleted["message"] != "任务已删除" {
		t.Fatalf("delete: %d %#v", code, deleted)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("episode still exists: %v", err)
	}
	_, check = request(t, m, "GET", "?action=check&source=source&videoId=video&episodeIndex=0", nil)
	if check["downloaded"] != false {
		t.Fatal(check)
	}
}

func TestGlobalQueueAndDeleteCancelActualRequest(t *testing.T) {
	var active, maxActive atomic.Int32
	started := make(chan struct{}, 2)
	cancelled := make(chan struct{}, 2)
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, ".m3u8") {
			fmt.Fprint(w, "#EXTM3U\n#EXTINF:1,\n"+strings.TrimSuffix(r.URL.Path, ".m3u8")+".ts\n#EXT-X-ENDLIST\n")
			return
		}
		n := active.Add(1)
		defer active.Add(-1)
		for old := maxActive.Load(); n > old && !maxActive.CompareAndSwap(old, n); old = maxActive.Load() {
		}
		if r.URL.Path == "/first.ts" {
			started <- struct{}{}
			<-r.Context().Done()
			cancelled <- struct{}{}
			return
		}
		fmt.Fprint(w, "second")
	}))
	t.Cleanup(s.Close)
	root := t.TempDir()
	m := newManager(t, root, s.Client(), 1, 1)
	first := create(t, m, "s", "first", s.URL+"/first.m3u8")
	id := first["id"].(string)
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("download not started")
	}
	second := create(t, m, "s", "second", s.URL+"/second.m3u8")
	code, body := request(t, m, "PUT", "?action=retry&taskId="+url.QueryEscape(id), nil)
	if code != 400 || body["error"] != "任务正在进行中，无法重试" {
		t.Fatalf("retry running: %d %#v", code, body)
	}
	code, _ = request(t, m, "DELETE", "?taskId="+url.QueryEscape(id), nil)
	if code != 200 {
		t.Fatal(code)
	}
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("DELETE did not cancel upstream")
	}
	waitTask(t, m, second["id"].(string), "completed")
	if maxActive.Load() != 1 {
		t.Fatalf("global concurrency=%d", maxActive.Load())
	}
	_, body = request(t, m, "GET", "", nil)
	if len(body["tasks"].([]any)) != 1 {
		t.Fatalf("deleted task resurrected: %#v", body)
	}
	if _, err := os.Stat(filepath.Join(root, "s", "first", "ep1")); !os.IsNotExist(err) {
		t.Fatalf("deleted files resurrected: %v", err)
	}
}

func TestSegmentConcurrencyAndNoPartialFinalFiles(t *testing.T) {
	var active, maxActive atomic.Int32
	release := make(chan struct{})
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/list.m3u8" {
			fmt.Fprint(w, "#EXTM3U\n#EXTINF:1,\na.ts\n#EXTINF:1,\nb.ts\n#EXTINF:1,\nc.ts\n#EXT-X-ENDLIST\n")
			return
		}
		n := active.Add(1)
		defer active.Add(-1)
		for old := maxActive.Load(); n > old && !maxActive.CompareAndSwap(old, n); old = maxActive.Load() {
		}
		w.WriteHeader(200)
		fmt.Fprint(w, "partial")
		w.(http.Flusher).Flush()
		select {
		case <-release:
			fmt.Fprint(w, "complete")
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(s.Close)
	root := t.TempDir()
	m := newManager(t, root, s.Client(), 1, 2)
	task := create(t, m, "s", "v", s.URL+"/list.m3u8")
	eventually(t, func() bool { return active.Load() == 2 })
	if _, err := os.Stat(filepath.Join(root, "s", "v", "ep1", "segment_00000.ts")); !os.IsNotExist(err) {
		t.Fatalf("partial committed: %v", err)
	}
	close(release)
	waitTask(t, m, task["id"].(string), "completed")
	if maxActive.Load() != 2 {
		t.Fatalf("segment concurrency=%d", maxActive.Load())
	}
}

func TestLegacyRecoveryLockAndRetry(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "s", "v", "ep1")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "segment_00000.ts"), []byte("existing"), 0600); err != nil {
		t.Fatal(err)
	}
	var firstRequests atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/list.m3u8":
			fmt.Fprint(w, "#EXTM3U\n#EXTINF:1,\na.ts\n#EXTINF:1,\nb.ts\n#EXT-X-ENDLIST\n")
		case "/a.ts":
			firstRequests.Add(1)
			fmt.Fprint(w, "wrong")
		default:
			fmt.Fprint(w, "new")
		}
	}))
	t.Cleanup(s.Close)
	legacy := []map[string]any{{"id": "legacy", "source": "s", "videoId": "v", "episodeIndex": 0, "title": "旧任务", "m3u8Url": s.URL + "/list.m3u8", "status": "downloading", "progress": 50, "totalSegments": 2, "downloadedSegments": 1, "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z", "downloadDir": "/untrusted/old/path", "metadata": map[string]any{"videoTitle": "保留标题"}}}
	data, _ := json.Marshal(legacy)
	if err := os.WriteFile(filepath.Join(root, "tasks.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	m := newManager(t, root, s.Client(), 1, 1)
	_, body := request(t, m, "GET", "", nil)
	task := body["tasks"].([]any)[0].(map[string]any)
	if task["status"] != "paused" || task["progress"] != float64(50) || task["downloadDir"] != dir || task["errorMessage"] != "服务器重启，任务已暂停" {
		t.Fatalf("recovery: %#v", task)
	}
	other, err := downloads.New(downloads.Options{Root: root, Client: s.Client()})
	if err == nil {
		other.Close(context.Background())
		t.Fatal("second manager acquired same root")
	}
	code, body := request(t, m, "PUT", "?taskId=legacy&action=retry", nil)
	if code != 200 || body["message"] != "任务已重新开始" {
		t.Fatalf("retry: %d %#v", code, body)
	}
	finished := waitTask(t, m, "legacy", "completed")
	if finished["metadata"].(map[string]any)["videoTitle"] != "保留标题" || firstRequests.Load() != 0 {
		t.Fatalf("resume changed metadata or fetched completed segment: %#v", finished)
	}
	if err := m.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	reopened := newManager(t, root, s.Client(), 1, 1)
	waitTask(t, reopened, "legacy", "completed")
}

func TestUnsupportedHLSFailsBeforePublishingPlaylist(t *testing.T) {
	for name, tag := range map[string]string{"map": "#EXT-X-MAP:URI=\"init.mp4\"", "byterange": "#EXT-X-BYTERANGE:5@0", "rotation": "#EXT-X-KEY:METHOD=AES-128,URI=\"one.key\"\n#EXTINF:1,\na.ts\n#EXT-X-KEY:METHOD=AES-128,URI=\"two.key\"", "sampleaes": "#EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"key\"", "unquoted-key": "#EXT-X-KEY:METHOD=AES-128,URI=key"} {
		t.Run(name, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				fmt.Fprint(w, "#EXTM3U\n"+tag+"\n#EXTINF:1,\nb.ts\n#EXT-X-ENDLIST\n")
			}))
			t.Cleanup(s.Close)
			root := t.TempDir()
			m := newManager(t, root, s.Client(), 1, 1)
			task := create(t, m, "s", "v", s.URL+"/list.m3u8")
			failed := waitTask(t, m, task["id"].(string), "error")
			if !strings.Contains(failed["errorMessage"].(string), "不支持") {
				t.Fatalf("unclear error: %#v", failed)
			}
			if _, err := os.Stat(filepath.Join(root, "s", "v", "ep1", "playlist.m3u8")); !os.IsNotExist(err) {
				t.Fatalf("invalid playlist published: %v", err)
			}
		})
	}
}

func TestUTF8BOMPlaylistKeepsHeaderAndDoesNotInventSegment(t *testing.T) {
	var unexpected atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/list.m3u8":
			fmt.Fprint(w, "\ufeff#EXTM3U\r\n#EXTINF:4,\r\npart.ts\r\n#EXT-X-ENDLIST\r\n")
		case "/part.ts":
			fmt.Fprint(w, "video")
		default:
			unexpected.Add(1)
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(s.Close)
	root := t.TempDir()
	m := newManager(t, root, s.Client(), 1, 1)
	task := create(t, m, "s", "v", s.URL+"/list.m3u8")
	completed := waitTask(t, m, task["id"].(string), "completed")
	if completed["totalSegments"] != float64(1) || unexpected.Load() != 0 {
		t.Fatalf("BOM treated as segment: %#v requests=%d", completed, unexpected.Load())
	}
	data, err := os.ReadFile(filepath.Join(root, "s", "v", "ep1", "playlist.m3u8"))
	if err != nil || !strings.HasPrefix(string(data), "#EXTM3U") {
		t.Fatalf("invalid header: %q %v", data, err)
	}
}

func TestLegacyCompleteBOMPlaylistRetriesWithoutFetchingExpiredSource(t *testing.T) {
	var requests atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests.Add(1); http.Error(w, "expired", 403) }))
	t.Cleanup(s.Close)
	root := t.TempDir()
	dir := filepath.Join(root, "s", "v", "ep1")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	for file, data := range map[string]string{"playlist.m3u8": "\ufeff#EXTM3U\n#EXTINF:4,\nsegment_00000.ts\n#EXT-X-ENDLIST\n", "segment_00000.ts": "complete-video"} {
		if err := os.WriteFile(filepath.Join(dir, file), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	legacy := []map[string]any{{"id": "bom-legacy", "source": "s", "videoId": "v", "episodeIndex": 0, "title": "old", "m3u8Url": s.URL + "/expired.m3u8", "status": "paused", "progress": 100, "totalSegments": 1, "downloadedSegments": 1, "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z", "downloadDir": dir}}
	data, _ := json.Marshal(legacy)
	if err := os.WriteFile(filepath.Join(root, "tasks.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	m := newManager(t, root, s.Client(), 1, 1)
	code, _ := request(t, m, "PUT", "?taskId=bom-legacy&action=retry", nil)
	if code != 200 {
		t.Fatal(code)
	}
	waitTask(t, m, "bom-legacy", "completed")
	if requests.Load() != 0 {
		t.Fatalf("complete legacy files refetched expired source: %d", requests.Load())
	}
}

func TestValidationAndSymlinkContainment(t *testing.T) {
	root := t.TempDir()
	m := newManager(t, root, http.DefaultClient, 1, 1)
	for _, source := range []string{"..", "../escape", "a/b", "a\\b", "C:", "."} {
		code, _ := request(t, m, "POST", "", map[string]any{"source": source, "videoId": "v", "episodeIndex": 0, "title": "t", "m3u8Url": "https://example.com/a.m3u8"})
		if code != 400 {
			t.Errorf("unsafe source %q: %d", source, code)
		}
	}
	for _, item := range []struct {
		method, query string
		code          int
	}{{"GET", "?action=check", 400}, {"PUT", "?action=retry", 400}, {"PUT", "?taskId=x&action=pause", 400}, {"PUT", "?taskId=x&action=retry", 404}, {"DELETE", "", 400}, {"DELETE", "?taskId=missing", 404}} {
		code, _ := request(t, m, item.method, item.query, nil)
		if code != item.code {
			t.Errorf("%s %s got %d", item.method, item.query, code)
		}
	}
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "linked")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	code, _ := request(t, m, "GET", "?action=check&source=linked&videoId=v&episodeIndex=0", nil)
	if code == 200 {
		t.Fatal("followed outside symlink")
	}
	entries, err := os.ReadDir(outside)
	if err != nil || len(entries) != 0 {
		t.Fatalf("outside modified: %v %v", entries, err)
	}
}

func TestSameAESKeySupportsIVChangesAndUnencryptedSections(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/list.m3u8":
			fmt.Fprint(w, "#EXTM3U\n#EXTINF:1,\nplain.ts\n#EXT-X-KEY:METHOD=AES-128,URI=\"key\",IV=0x01\n#EXTINF:1,\none.ts\n#EXT-X-KEY:METHOD=AES-128,URI=\"key\",IV=0x02\n#EXTINF:1,\ntwo.ts\n#EXT-X-KEY:METHOD=NONE\n#EXTINF:1,\nplain.ts\n#EXT-X-ENDLIST\n")
		case "/key":
			fmt.Fprint(w, "0123456789abcdef")
		default:
			fmt.Fprint(w, "media")
		}
	}))
	t.Cleanup(s.Close)
	root := t.TempDir()
	m := newManager(t, root, s.Client(), 1, 2)
	task := create(t, m, "s", "v", s.URL+"/list.m3u8")
	completed := waitTask(t, m, task["id"].(string), "completed")
	if completed["downloadedSegments"] != float64(4) {
		t.Fatal(completed)
	}
	playlist, err := os.ReadFile(filepath.Join(root, "s", "v", "ep1", "playlist.m3u8"))
	if err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{`URI="key.key",IV=0x01`, `URI="key.key",IV=0x02`, "#EXT-X-KEY:METHOD=NONE"} {
		if !strings.Contains(string(playlist), text) {
			t.Fatalf("missing %q: %s", text, playlist)
		}
	}
}

func TestClosePausesWritersAndRetryFetchesPartialSegmentAgain(t *testing.T) {
	started := make(chan struct{}, 1)
	var complete atomic.Bool
	var calls atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/list.m3u8" {
			fmt.Fprint(w, "#EXTM3U\n#EXTINF:1,\npart.ts\n#EXT-X-ENDLIST\n")
			return
		}
		calls.Add(1)
		if complete.Load() {
			fmt.Fprint(w, "whole-segment")
			return
		}
		fmt.Fprint(w, "partial")
		w.(http.Flusher).Flush()
		started <- struct{}{}
		<-r.Context().Done()
	}))
	t.Cleanup(s.Close)
	root := t.TempDir()
	m := newManager(t, root, s.Client(), 1, 1)
	task := create(t, m, "s", "v", s.URL+"/list.m3u8")
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("segment not started")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := m.Close(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "s", "v", "ep1", "segment_00000.ts")); !os.IsNotExist(err) {
		t.Fatalf("partial final segment exists: %v", err)
	}
	complete.Store(true)
	reopened := newManager(t, root, s.Client(), 1, 1)
	paused := waitTask(t, reopened, task["id"].(string), "paused")
	if paused["errorMessage"] != "服务器重启，任务已暂停" {
		t.Fatal(paused)
	}
	code, _ := request(t, reopened, "PUT", "?taskId="+url.QueryEscape(task["id"].(string))+"&action=retry", nil)
	if code != 200 {
		t.Fatal(code)
	}
	waitTask(t, reopened, task["id"].(string), "completed")
	if calls.Load() != 2 {
		t.Fatalf("partial segment was not fetched again: %d", calls.Load())
	}
}

func TestRetryUpstreamAndKeepSignedURLsOutOfErrorMessages(t *testing.T) {
	var attempts atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/list.m3u8" {
			fmt.Fprint(w, "#EXTM3U\n#EXTINF:1,\npart.ts?token=secret\n#EXT-X-ENDLIST\n")
			return
		}
		if attempts.Add(1) == 1 {
			http.Error(w, "private server details", 503)
			return
		}
		fmt.Fprint(w, "recovered")
	}))
	t.Cleanup(s.Close)
	m := newManager(t, t.TempDir(), s.Client(), 1, 1)
	task := create(t, m, "s", "v", s.URL+"/list.m3u8")
	waitTask(t, m, task["id"].(string), "completed")
	if attempts.Load() != 2 {
		t.Fatalf("retry attempts: %d", attempts.Load())
	}
	s.Close()
	failedTask := create(t, m, "s", "failed", s.URL+"/list.m3u8?password=secret")
	failed := waitTask(t, m, failedTask["id"].(string), "error")
	message := failed["errorMessage"].(string)
	if strings.Contains(message, "secret") || strings.Contains(message, s.URL) || strings.Contains(message, "password") {
		t.Fatalf("sensitive URL in error: %q", message)
	}
}

func TestCorruptStoreFailsWithoutOverwritingAndReleasesLock(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "tasks.json")
	invalid := []byte("{broken")
	if err := os.WriteFile(path, invalid, 0600); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		m, err := downloads.New(downloads.Options{Root: root, Client: http.DefaultClient})
		if err == nil {
			m.Close(context.Background())
			t.Fatal("corrupt store was accepted")
		}
		if strings.Contains(err.Error(), "already in use") {
			t.Fatal("failed constructor leaked lock")
		}
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != string(invalid) {
		t.Fatalf("corrupt store overwritten: %q %v", data, err)
	}
	if m, err := downloads.New(downloads.Options{Root: t.TempDir()}); err == nil {
		m.Close(context.Background())
		t.Fatal("accepted client without outbound policy")
	}
}

type observedBody struct {
	io.ReadCloser
	once    sync.Once
	reading chan struct{}
}

func (b *observedBody) Read(p []byte) (int, error) {
	b.once.Do(func() { close(b.reading) })
	return b.ReadCloser.Read(p)
}

func TestSlowHTTPBodyDoesNotBlockReadsOrShutdown(t *testing.T) {
	m := newManager(t, t.TempDir(), http.DefaultClient, 1, 1)
	reading := make(chan struct{})
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			r.Body = &observedBody{ReadCloser: r.Body, reading: reading}
		}
		m.ServeHTTP(w, r)
	}))
	t.Cleanup(s.Close)
	reader, writer := io.Pipe()
	defer writer.Close()
	defer reader.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r, _ := http.NewRequestWithContext(ctx, "POST", s.URL+"/v1/offline-download", reader)
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		resp, err := s.Client().Do(r)
		if err == nil {
			resp.Body.Close()
		}
	}()
	if _, err := writer.Write([]byte("{")); err != nil {
		t.Fatal(err)
	}
	select {
	case <-reading:
	case <-time.After(time.Second):
		t.Fatal("request body not read")
	}
	client := &http.Client{Timeout: 300 * time.Millisecond}
	response, err := client.Get(s.URL + "/v1/offline-download")
	if err != nil {
		t.Fatalf("slow POST blocked unrelated GET: %v", err)
	}
	response.Body.Close()
	closeCtx, closeCancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer closeCancel()
	if err := m.Close(closeCtx); err != nil {
		t.Fatalf("slow body blocked shutdown: %v", err)
	}
	writer.Close()
	cancel()
	<-finished
}

func TestSlowHTTPResponseDoesNotBlockTaskAccessOrShutdown(t *testing.T) {
	root := t.TempDir()
	large := strings.Repeat("x", 512*1024)
	items := make([]map[string]any, 20)
	for i := range items {
		items[i] = map[string]any{"id": fmt.Sprint(i), "source": "s", "videoId": fmt.Sprint(i), "episodeIndex": 0, "title": "v", "m3u8Url": "https://example.com/a.m3u8", "status": "paused", "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z", "metadata": map[string]string{"description": large}}
	}
	data, _ := json.Marshal(items)
	if err := os.WriteFile(filepath.Join(root, "tasks.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	m := newManager(t, root, http.DefaultClient, 1, 1)
	s := httptest.NewServer(m)
	t.Cleanup(s.Close)
	response, err := s.Client().Get(s.URL + "/v1/offline-download")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	client := &http.Client{Timeout: 300 * time.Millisecond}
	check, err := client.Get(s.URL + "/v1/offline-download?action=check&source=s&videoId=0&episodeIndex=0")
	if err != nil {
		t.Fatalf("slow response blocked unrelated request: %v", err)
	}
	check.Body.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := m.Close(ctx); err != nil {
		t.Fatalf("slow response blocked shutdown: %v", err)
	}
}
