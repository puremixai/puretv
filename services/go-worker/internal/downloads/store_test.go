package downloads

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestDeletingTaskRemainsPersistentUntilWriterAndFilesAreGone(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	finish := func() { once.Do(func() { close(release) }) }
	defer finish()
	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if strings.HasSuffix(r.URL.Path, ".m3u8") {
			return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("#EXTM3U\n#EXTINF:1,\npart.ts\n#EXT-X-ENDLIST\n")), Request: r}, nil
		}
		close(started)
		<-r.Context().Done()
		<-release
		return nil, errors.New("cancelled transport")
	})}
	root := t.TempDir()
	m, err := New(Options{Root: root, Client: client, Concurrency: 1, SegmentConcurrency: 1})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		finish()
		if err := m.Close(context.Background()); err != nil {
			t.Error(err)
		}
	})
	created := httptest.NewRecorder()
	m.ServeHTTP(created, httptest.NewRequest("POST", "/v1/offline-download", strings.NewReader(`{"source":"s","videoId":"v","episodeIndex":0,"title":"t","m3u8Url":"https://fixture.example/list.m3u8"}`)))
	var body struct {
		Task Task `json:"task"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &body); err != nil || created.Code != 200 {
		t.Fatalf("create: %s %v", created.Body.String(), err)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("download not started")
	}
	deleted := make(chan int, 1)
	go func() {
		w := httptest.NewRecorder()
		m.ServeHTTP(w, httptest.NewRequest("DELETE", "/v1/offline-download?taskId="+body.Task.ID, nil))
		deleted <- w.Code
	}()
	deadline := time.Now().Add(time.Second)
	for {
		m.mu.Lock()
		deleting := m.tasks[body.Task.ID].deleting
		m.mu.Unlock()
		if deleting {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("delete did not start")
		}
		time.Sleep(time.Millisecond)
	}
	m.mu.Lock()
	err = m.saveLocked()
	m.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "tasks.json"))
	if err != nil {
		t.Fatal(err)
	}
	var saved []Task
	if err := json.Unmarshal(data, &saved); err != nil {
		t.Fatal(err)
	}
	if len(saved) != 1 || saved[0].ID != body.Task.ID {
		t.Fatalf("in-flight delete erased recoverable task: %s", data)
	}
	recovery := t.TempDir()
	if err := os.WriteFile(filepath.Join(recovery, "tasks.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	reopened, err := New(Options{Root: recovery, Client: client})
	if err != nil {
		t.Fatal(err)
	}
	if reopened.tasks[body.Task.ID].task.Status != "paused" {
		t.Fatal("interrupted deletion not recoverable")
	}
	reopened.Close(context.Background())
	finish()
	if code := <-deleted; code != 200 {
		t.Fatal(code)
	}
	data, err = os.ReadFile(filepath.Join(root, "tasks.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(data)) != "[]" {
		t.Fatalf("finished deletion persisted: %s", data)
	}
}

func TestStoreAdmissionRollsBackAndReservesFutureStateGrowth(t *testing.T) {
	root := t.TempDir()
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) { return nil, errors.New("offline") })}
	m, err := newWithStoreLimit(Options{Root: root, Client: client}, 15000)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := m.Close(context.Background()); err != nil {
			t.Error(err)
		}
	})
	createTask := func(video string) *httptest.ResponseRecorder {
		data, _ := json.Marshal(map[string]any{"source": "s", "videoId": video, "episodeIndex": 0, "title": "t", "m3u8Url": "https://fixture.example/list.m3u8", "metadata": map[string]string{"description": strings.Repeat("x", 8000)}})
		w := httptest.NewRecorder()
		m.ServeHTTP(w, httptest.NewRequest("POST", "/v1/offline-download", strings.NewReader(string(data))))
		return w
	}
	first := createTask("first")
	if first.Code != 200 {
		t.Fatalf("first task: %d %s", first.Code, first.Body.String())
	}
	rejected := createTask("over-budget")
	if rejected.Code != 507 || !strings.Contains(rejected.Body.String(), "已满") {
		t.Fatalf("capacity admission: %d %s", rejected.Code, rejected.Body.String())
	}
	deadline := time.Now().Add(time.Second)
	for {
		m.mu.Lock()
		task := m.tasks[m.order[0]]
		done := task.cancel == nil && task.task.Status == "error"
		m.mu.Unlock()
		if done {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("task not finished")
		}
		time.Sleep(time.Millisecond)
	}
	m.mu.Lock()
	if len(m.tasks) != 1 || len(m.order) != 1 {
		m.mu.Unlock()
		t.Fatal("rejected task not rolled back")
	}
	e := m.tasks[m.order[0]]
	e.task.ErrorMessage = strings.Repeat("<", 512)
	e.task.Progress = 100
	e.task.TotalSegments = 2147483647
	e.task.DownloadedSegments = 2147483647
	err = m.saveLocked()
	m.mu.Unlock()
	if err != nil {
		t.Fatalf("reserved lifecycle growth cannot persist: %v", err)
	}
	if err := m.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "tasks.json"))
	if err != nil || len(data) > 15000 {
		t.Fatalf("wrote unreadable store: bytes=%d err=%v", len(data), err)
	}
	reopened, err := newWithStoreLimit(Options{Root: root, Client: client}, 15000)
	if err != nil {
		t.Fatalf("accepted store cannot restart: %v", err)
	}
	defer reopened.Close(context.Background())
	if len(reopened.tasks) != 1 {
		t.Fatal("rejected task reappeared after restart")
	}
}

func TestDeepMetadataPersistsCompactlyWithinTheSameReadBudget(t *testing.T) {
	const limit = 16 * 1024
	root := t.TempDir()
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) { return nil, errors.New("offline") })}
	m, err := newWithStoreLimit(Options{Root: root, Client: client}, limit)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := m.Close(context.Background()); err != nil {
			t.Error(err)
		}
	})
	// A small JSON object can expand quadratically if every level is indented.
	metadata := strings.Repeat(`{"nested":`, 512) + `"leaf"` + strings.Repeat("}", 512)
	body := `{"source":"s","videoId":"deep","episodeIndex":0,"title":"t","m3u8Url":"https://fixture.example/list.m3u8","metadata":` + metadata + `}`
	w := httptest.NewRecorder()
	m.ServeHTTP(w, httptest.NewRequest("POST", "/v1/offline-download", strings.NewReader(body)))
	if w.Code != 200 {
		t.Fatalf("compact metadata was rejected: HTTP %d", w.Code)
	}
	if err := m.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "tasks.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(data) > limit || bytes.Contains(data, []byte("\n")) {
		t.Fatalf("store expanded instead of remaining compact: %d bytes", len(data))
	}
	reopened, err := newWithStoreLimit(Options{Root: root, Client: client}, limit)
	if err != nil {
		t.Fatalf("compact store cannot restart: %v", err)
	}
	defer reopened.Close(context.Background())
	if len(reopened.tasks) != 1 {
		t.Fatal("deep metadata task missing after restart")
	}
	for _, e := range reopened.tasks {
		if string(e.task.Metadata) != metadata {
			t.Fatal("nested metadata changed during persistence")
		}
	}
}
