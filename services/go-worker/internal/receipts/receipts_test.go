package receipts

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func input(owner, key, password string) string {
	b, _ := json.Marshal(map[string]any{"owner": owner, "key": key, "operation": map[string]any{"url": "https://openlist.example", "username": "account", "password": password, "path": "/api/fs/add_offline_download", "method": "POST", "body": `{"path":"/anime","urls":["magnet:?xt=urn:btih:abc"],"tool":"aria2"}`, "headers": map[string]string{}}})
	return string(b)
}
func call(h *Handler, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/v1/anime/download", strings.NewReader(body)))
	return w
}
func TestSuccessReplayRestartAndSecrets(t *testing.T) {
	dir := t.TempDir()
	var count atomic.Int32
	operation := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count.Add(1)
		w.Write([]byte(`{"code":200,"secret":"UPSTREAM-SECRET"}`))
	})
	h, e := New(Options{StateDir: dir, Handler: operation})
	if e != nil {
		t.Fatal(e)
	}
	first := call(h, input("alice", "episode-1", "PASSWORD-SECRET"))
	if first.Code != 200 {
		t.Fatal(first.Body.String())
	}
	if strings.Contains(first.Body.String(), "SECRET") {
		t.Fatal("upstream leaked")
	}
	if replay := call(h, input("alice", "episode-1", "rotated-password")); replay.Code != 200 || !strings.Contains(replay.Body.String(), `"replayed":true`) {
		t.Fatal(replay.Body.String())
	}
	if count.Load() != 1 {
		t.Fatal("duplicate dispatched")
	}
	if other, e := New(Options{StateDir: dir, Handler: operation}); e == nil {
		other.Close(context.Background())
		t.Fatal("lock failed")
	}
	h.Close(context.Background())
	b, _ := os.ReadFile(filepath.Join(dir, "anime-receipts", "receipts.json"))
	for _, secret := range []string{"PASSWORD", "UPSTREAM", "openlist.example", "magnet", "alice"} {
		if strings.Contains(string(b), secret) {
			t.Fatal("sensitive data persisted")
		}
	}
	h, e = New(Options{StateDir: dir, Handler: operation})
	if e != nil {
		t.Fatal(e)
	}
	defer h.Close(context.Background())
	if w := call(h, input("alice", "episode-1", "new-password")); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if count.Load() != 1 {
		t.Fatal("restart duplicated")
	}
	if w := call(h, input("bob", "episode-1", "password")); w.Code != 200 || count.Load() != 2 {
		t.Fatal("owners not isolated")
	}
}
func TestUncertainNeverRetriesAndPayloadConflict(t *testing.T) {
	var count atomic.Int32
	h, e := New(Options{StateDir: t.TempDir(), Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count.Add(1)
		w.WriteHeader(502)
		w.Write([]byte(`{"error":"SECRET"}`))
	})})
	if e != nil {
		t.Fatal(e)
	}
	defer h.Close(context.Background())
	for i := 0; i < 2; i++ {
		w := call(h, input("alice", "ep", "password"))
		if w.Code != 409 || strings.Contains(w.Body.String(), "SECRET") {
			t.Fatal(w.Body.String())
		}
	}
	changed := strings.ReplaceAll(input("alice", "ep", "password"), "openlist.example", "different.example")
	if call(h, changed).Code != 409 || count.Load() != 1 {
		t.Fatal("uncertain request replayed")
	}
}
func TestConcurrentSubmissionOnlyDispatchesOnce(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	h, e := New(Options{StateDir: t.TempDir(), Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-release
		w.Write([]byte(`{"code":200}`))
	})})
	if e != nil {
		t.Fatal(e)
	}
	defer h.Close(context.Background())
	done := make(chan struct{})
	go func() { call(h, input("a", "ep", "secret")); close(done) }()
	<-entered
	if w := call(h, input("a", "ep", "secret")); w.Code != 409 {
		t.Fatal("concurrent write admitted")
	}
	close(release)
	<-done
}
func TestInterruptedReceiptAndInvalidAction(t *testing.T) {
	dir := t.TempDir()
	h, e := New(Options{StateDir: dir, Handler: http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("unexpected dispatch") })})
	if e != nil {
		t.Fatal(e)
	}
	h.entries[hash("a\x00ep")] = receipt{Digest: strings.Repeat("0", 64), Status: "uncertain"}
	h.persist()
	h.Close(context.Background())
	h, e = New(Options{StateDir: dir, Handler: http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("unexpected dispatch") })})
	if e != nil {
		t.Fatal(e)
	}
	defer h.Close(context.Background())
	if call(h, input("a", "ep", "secret")).Code != 409 {
		t.Fatal("interrupted replay admitted")
	}
	if call(h, `{"owner":"a","key":"x","operation":{"path":"/api/fs/remove"}}`).Code != 400 {
		t.Fatal("arbitrary operation allowed")
	}
}

func resolve(h *Handler, id, action string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	b, _ := json.Marshal(map[string]string{"receiptId": id, "action": action})
	h.ServeHTTP(w, httptest.NewRequest("POST", "/v1/anime/receipts/resolve", strings.NewReader(string(b))))
	return w
}
func TestOperatorRecovery(t *testing.T) {
	dir := t.TempDir()
	var calls atomic.Int32
	h, e := New(Options{StateDir: dir, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(502) })})
	if e != nil {
		t.Fatal(e)
	}
	w := call(h, input("a", "ep", "secret"))
	var failure map[string]string
	json.Unmarshal(w.Body.Bytes(), &failure)
	id := failure["receiptId"]
	if len(id) != 64 {
		t.Fatal("missing receipt id")
	}
	h.Close(context.Background())
	h, e = New(Options{StateDir: dir, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.Write([]byte(`{"code":200}`)) })})
	if e != nil {
		t.Fatal(e)
	}
	defer h.Close(context.Background())
	if w := resolve(h, strings.Repeat("0", 64), "allow-retry"); w.Code != 404 {
		t.Fatal(w.Body.String())
	}
	if w := resolve(h, id, "allow-retry"); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := call(h, input("a", "ep", "secret")); w.Code != 200 || calls.Load() != 2 {
		t.Fatal("explicit retry failed")
	}
	if w := resolve(h, id, "allow-retry"); w.Code != 409 {
		t.Fatal("successful receipt deleted")
	}
}
func TestExecutingReceiptCannotBeResolved(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	h, e := New(Options{StateDir: t.TempDir(), Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-release
		w.Write([]byte(`{"code":200}`))
	})})
	if e != nil {
		t.Fatal(e)
	}
	defer h.Close(context.Background())
	done := make(chan struct{})
	go func() { call(h, input("a", "ep", "secret")); close(done) }()
	<-entered
	w := resolve(h, hash("a\x00ep"), "allow-retry")
	close(release)
	<-done
	if w.Code != 409 {
		t.Fatal("executing receipt removed")
	}
}
