// Package receipts prevents automatic replay of external anime download writes.
// A receipt is durable before dispatch. Ambiguous outcomes require human review.
package receipts

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/puremixai/puretv/services/go-worker/internal/filelock"
)

const maxState = 16 << 20
const maxReceipts = 50000

type Options struct {
	StateDir string
	Handler  http.Handler
}
type receipt struct {
	Digest    string `json:"digest"`
	Status    string `json:"status"`
	UpdatedAt int64  `json:"updatedAt"`
}
type Handler struct {
	mu         sync.Mutex
	entries    map[string]receipt
	dir        string
	lock       *os.File
	operation  http.Handler
	closed     bool
	failed     bool
	wg         sync.WaitGroup
	active     int
	activeKeys map[string]bool
}

func New(o Options) (*Handler, error) {
	if o.StateDir == "" || o.Handler == nil {
		return nil, errors.New("invalid receipt configuration")
	}
	dir := filepath.Join(o.StateDir, "anime-receipts")
	if os.MkdirAll(dir, 0700) != nil {
		return nil, errors.New("receipt storage unavailable")
	}
	f, e := os.OpenFile(filepath.Join(dir, ".lock"), os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, errors.New("receipt storage unavailable")
	}
	if filelock.Lock(f) != nil {
		f.Close()
		return nil, errors.New("receipt storage locked")
	}
	h := &Handler{dir: dir, lock: f, operation: o.Handler, entries: map[string]receipt{}, activeKeys: map[string]bool{}}
	stored, e := os.Open(filepath.Join(dir, "receipts.json"))
	if e == nil {
		b, err := io.ReadAll(io.LimitReader(stored, maxState+1))
		stored.Close()
		if err != nil || len(b) > maxState || json.Unmarshal(b, &h.entries) != nil || h.entries == nil || len(h.entries) > maxReceipts {
			f.Close()
			return nil, errors.New("invalid receipt state")
		}
	} else if !os.IsNotExist(e) {
		f.Close()
		return nil, errors.New("receipt storage unavailable")
	}
	for key, r := range h.entries {
		if len(key) != 64 || len(r.Digest) != 64 || (r.Status != "uncertain" && r.Status != "succeeded") {
			f.Close()
			return nil, errors.New("invalid receipt state")
		}
	}
	if h.persist() != nil {
		f.Close()
		return nil, errors.New("receipt storage unavailable")
	}
	return h, nil
}
func (h *Handler) persist() (err error) {
	defer func() {
		if err != nil {
			h.failed = true
		}
	}()
	b, err := json.Marshal(h.entries)
	if err != nil || len(b) > maxState {
		return errors.New("receipt storage capacity exceeded")
	}
	f, err := os.CreateTemp(h.dir, ".receipts-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	_ = f.Chmod(0600)
	if _, err = f.Write(b); err == nil {
		err = f.Sync()
	}
	ce := f.Close()
	if err == nil {
		err = ce
	}
	if err == nil {
		err = os.Rename(name, filepath.Join(h.dir, "receipts.json"))
	}
	return err
}
func hash(s string) string { sum := sha256.Sum256([]byte(s)); return hex.EncodeToString(sum[:]) }
func answer(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/v1/anime/receipts/resolve" {
		h.resolve(w, r)
		return
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(75 * time.Second))
	if r.Method != "POST" {
		answer(w, 405, map[string]string{"error": "请求方法不支持"})
		return
	}
	var in struct {
		Owner     string `json:"owner"`
		Key       string `json:"key"`
		Operation struct {
			URL      string            `json:"url"`
			Username string            `json:"username"`
			Password string            `json:"password"`
			Path     string            `json:"path"`
			Method   string            `json:"method"`
			Body     string            `json:"body"`
			Headers  map[string]string `json:"headers"`
		} `json:"operation"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512<<10))
	d.DisallowUnknownFields()
	if d.Decode(&in) != nil || d.Decode(&struct{}{}) != io.EOF || strings.TrimSpace(in.Owner) == "" || len(in.Owner) > 256 || in.Key == "" || len(in.Key) > 512 || in.Operation.Path != "/api/fs/add_offline_download" || in.Operation.Method != "POST" {
		answer(w, 400, map[string]string{"error": "追番提交请求无效"})
		return
	}
	var payload struct {
		Path string   `json:"path"`
		URLs []string `json:"urls"`
		Tool string   `json:"tool"`
	}
	if json.Unmarshal([]byte(in.Operation.Body), &payload) != nil || payload.Path == "" || len(payload.URLs) != 1 || payload.URLs[0] == "" || len(payload.URLs[0]) > 16384 {
		answer(w, 400, map[string]string{"error": "追番提交请求无效"})
		return
	}
	// Password rotation must not change operation identity. Hash the destination/account/body; never store them.
	canonical, _ := json.Marshal([]any{in.Operation.URL, in.Operation.Username, payload})
	digest := hash(string(canonical))
	key := hash(in.Owner + "\x00" + in.Key)
	h.mu.Lock()
	if h.closed || h.failed {
		h.mu.Unlock()
		answer(w, 503, map[string]string{"error": "追番收据存储不可用，请核对下载队列"})
		return
	}
	if old, ok := h.entries[key]; ok {
		h.mu.Unlock()
		if old.Digest == digest && old.Status == "succeeded" {
			answer(w, 200, map[string]any{"code": 200, "replayed": true})
			return
		}
		answer(w, 409, map[string]string{"error": "此集下载提交结果不确定或请求已改变，请核对 OpenList 下载队列后处理", "status": "uncertain", "receiptId": key})
		return
	}
	if len(h.entries) >= maxReceipts || h.active >= 5 {
		h.mu.Unlock()
		answer(w, 503, map[string]string{"error": "追番收据容量或并发已达上限"})
		return
	}
	h.entries[key] = receipt{Digest: digest, Status: "uncertain", UpdatedAt: time.Now().UnixMilli()}
	if h.persist() != nil {
		h.mu.Unlock()
		answer(w, 503, map[string]string{"error": "追番收据存储不可用，请核对下载队列"})
		return
	}
	h.active++
	h.activeKeys[key] = true
	h.wg.Add(1)
	h.mu.Unlock()
	defer func() { h.mu.Lock(); h.active--; delete(h.activeKeys, key); h.mu.Unlock(); h.wg.Done() }()
	body, _ := json.Marshal(in.Operation)
	ctx, cancel := context.WithTimeout(r.Context(), 65*time.Second)
	defer cancel()
	operation, _ := http.NewRequestWithContext(ctx, "POST", "http://worker/v1/openlist/operations", bytes.NewReader(body))
	capture := &boundedResponse{header: make(http.Header)}
	h.operation.ServeHTTP(capture, operation)
	var envelope struct {
		Code int `json:"code"`
	}
	success := !capture.overflow && capture.status >= 200 && capture.status < 300 && json.Unmarshal(capture.body.Bytes(), &envelope) == nil && envelope.Code == 200
	if success {
		h.mu.Lock()
		h.entries[key] = receipt{Digest: digest, Status: "succeeded", UpdatedAt: time.Now().UnixMilli()}
		err := h.persist()
		h.mu.Unlock()
		if err == nil {
			answer(w, 200, map[string]any{"code": 200, "replayed": false})
			return
		}
	}
	answer(w, 409, map[string]string{"error": "下载提交结果不确定，请核对 OpenList 下载队列；不会自动重复提交", "status": "uncertain", "receiptId": key})
}

type boundedResponse struct {
	header   http.Header
	body     bytes.Buffer
	status   int
	overflow bool
}

func (b *boundedResponse) Header() http.Header { return b.header }
func (b *boundedResponse) WriteHeader(s int)   { b.status = s }
func (b *boundedResponse) Write(p []byte) (int, error) {
	if b.status == 0 {
		b.status = 200
	}
	if b.body.Len()+len(p) > 8<<20 {
		b.overflow = true
		return 0, errors.New("response too large")
	}
	return b.body.Write(p)
}
func (h *Handler) Close(ctx context.Context) error {
	h.mu.Lock()
	h.closed = true
	h.mu.Unlock()
	done := make(chan struct{})
	go func() { h.wg.Wait(); close(done) }()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-done:
	}
	return h.lock.Close()
}

// resolve is an operator-only recovery action behind the worker bearer-token middleware.
func (h *Handler) resolve(w http.ResponseWriter, r *http.Request) {
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(15 * time.Second))
	if r.Method != "POST" {
		answer(w, 405, map[string]string{"error": "请求方法不支持"})
		return
	}
	var in struct {
		ReceiptID string `json:"receiptId"`
		Action    string `json:"action"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	d.DisallowUnknownFields()
	if d.Decode(&in) != nil || d.Decode(&struct{}{}) != io.EOF || len(in.ReceiptID) != 64 || (in.Action != "confirm-succeeded" && in.Action != "allow-retry") {
		answer(w, 400, map[string]string{"error": "收据处理请求无效"})
		return
	}
	h.mu.Lock()
	if h.closed || h.failed {
		h.mu.Unlock()
		answer(w, 503, map[string]string{"error": "收据存储不可用"})
		return
	}
	old, ok := h.entries[in.ReceiptID]
	if !ok {
		h.mu.Unlock()
		answer(w, 404, map[string]string{"error": "收据不存在"})
		return
	}
	if h.activeKeys[in.ReceiptID] || old.Status != "uncertain" {
		h.mu.Unlock()
		answer(w, 409, map[string]string{"error": "执行中或已成功的收据不能解除"})
		return
	}
	if in.Action == "allow-retry" {
		delete(h.entries, in.ReceiptID)
	} else {
		old.Status = "succeeded"
		old.UpdatedAt = time.Now().UnixMilli()
		h.entries[in.ReceiptID] = old
	}
	err := h.persist()
	h.mu.Unlock()
	if err != nil {
		answer(w, 503, map[string]string{"error": "收据保存失败"})
		return
	}
	answer(w, 200, map[string]any{"code": 200, "receiptId": in.ReceiptID, "action": in.Action})
}
