package netdisk

import (
	"bytes"
	"context"
	"crypto/rand"
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
)

type Options struct {
	StateDir string
	Client   *http.Client
}
type Result struct {
	Status     string `json:"status"`
	Reason     string `json:"reason,omitempty"`
	CheckedAt  int64  `json:"checkedAt,omitempty"`
	DurationMs int64  `json:"durationMs,omitempty"`
	FromCache  bool   `json:"fromCache,omitempty"`
}
type Progress struct {
	Total        int `json:"total"`
	Done         int `json:"done"`
	Valid        int `json:"valid"`
	Invalid      int `json:"invalid"`
	Unknown      int `json:"unknown"`
	RateLimited  int `json:"rateLimited"`
	CurrentBatch int `json:"currentBatch"`
	TotalBatches int `json:"totalBatches"`
}
type Task struct {
	ID         string            `json:"id"`
	Platform   string            `json:"platform"`
	Status     string            `json:"status"`
	Progress   Progress          `json:"progress"`
	Results    map[string]Result `json:"results"`
	CreatedAt  int64             `json:"createdAt"`
	UpdatedAt  int64             `json:"updatedAt"`
	Error      string            `json:"error,omitempty"`
	ShouldStop bool              `json:"shouldStop,omitempty"`
}
type record struct {
	Owner string `json:"owner"`
	Task  *Task  `json:"task"`
}
type diskState struct {
	Tasks    map[string]record `json:"tasks"`
	Cooldown int64             `json:"cooldown"`
}
type Manager struct {
	mu             sync.Mutex
	cacheMu        sync.Mutex
	cache          map[string]cacheEntry
	state          diskState
	client         *http.Client
	dir            string
	lock           *os.File
	active         map[string]context.CancelFunc
	wg             sync.WaitGroup
	closed         bool
	persistenceErr bool
}

func New(o Options) (*Manager, error) {
	if o.StateDir == "" || o.Client == nil {
		return nil, errors.New("invalid netdisk configuration")
	}
	dir := filepath.Join(o.StateDir, "netdisk")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, errors.New("netdisk storage unavailable")
	}
	f, err := os.OpenFile(filepath.Join(dir, ".lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, errors.New("netdisk storage unavailable")
	}
	if err = lockFile(f); err != nil {
		f.Close()
		return nil, errors.New("netdisk storage locked")
	}
	m := &Manager{dir: dir, lock: f, client: o.Client, active: map[string]context.CancelFunc{}, state: diskState{Tasks: map[string]record{}}}
	var b []byte
	stored, err := os.Open(filepath.Join(dir, "tasks.json"))
	if err == nil {
		b, err = io.ReadAll(io.LimitReader(stored, (32<<20)+1))
		_ = stored.Close()
	}
	if err == nil {
		if len(b) > 32<<20 || json.Unmarshal(b, &m.state) != nil || m.state.Tasks == nil {
			f.Close()
			return nil, errors.New("invalid netdisk state")
		}
	} else if !os.IsNotExist(err) {
		f.Close()
		return nil, errors.New("netdisk storage unavailable")
	}
	for _, r := range m.state.Tasks {
		if r.Task == nil {
			f.Close()
			return nil, errors.New("invalid netdisk state")
		}
		if r.Task.Status == "running" {
			r.Task.Status = "failed"
			r.Task.Error = "检测任务因服务重启中断，请重新发起"
			r.Task.UpdatedAt = time.Now().UnixMilli()
		}
	}
	m.cleanup()
	if err = m.persist(); err != nil {
		f.Close()
		return nil, err
	}
	return m, nil
}
func (m *Manager) persist() (err error) {
	defer func() {
		if err != nil {
			m.persistenceErr = true
		}
	}()
	b, err := json.Marshal(m.state)
	if err != nil {
		return err
	}
	if len(b) > 32<<20 {
		return errors.New("netdisk storage capacity exceeded")
	}
	f, err := os.CreateTemp(m.dir, ".tasks-*")
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
		err = os.Rename(name, filepath.Join(m.dir, "tasks.json"))
	}
	if err != nil {
		m.persistenceErr = true
		return errors.New("netdisk storage unavailable")
	}
	return nil
}
func (m *Manager) cleanup() {
	now := time.Now().UnixMilli()
	for id, r := range m.state.Tasks {
		if r.Task != nil && r.Task.Status != "running" && now-r.Task.UpdatedAt > 3600000 {
			delete(m.state.Tasks, id)
		}
	}
}
func (m *Manager) cooldown() int64 { return max(0, m.state.Cooldown-time.Now().UnixMilli()) }
func reply(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func (m *Manager) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(15 * time.Second))
	var in struct {
		Owner    string   `json:"owner"`
		Platform string   `json:"platform"`
		Links    []string `json:"links"`
		TaskID   string   `json:"taskId"`
	}
	action := strings.TrimPrefix(r.URL.Path, "/v1/netdisk/check/")
	if action == "task" && r.Method == "GET" {
		in.Owner = r.URL.Query().Get("owner")
		in.TaskID = r.URL.Query().Get("id")
	} else if (action == "start" || action == "cancel") && r.Method == "POST" {
		d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512<<10))
		if d.Decode(&in) != nil || d.Decode(&struct{}{}) != io.EOF {
			reply(w, 400, map[string]string{"error": "请求无效"})
			return
		}
	} else {
		reply(w, 405, map[string]string{"error": "请求方法无效"})
		return
	}
	if strings.TrimSpace(in.Owner) == "" || len(in.Owner) > 256 {
		reply(w, 401, map[string]string{"error": "Unauthorized"})
		return
	}
	m.mu.Lock()
	actual := w
	buffered := &bufferedResponse{headers: make(http.Header)}
	w = buffered
	defer func() {
		m.mu.Unlock()
		for k, values := range buffered.headers {
			actual.Header()[k] = values
		}
		actual.WriteHeader(buffered.status)
		_, _ = actual.Write(buffered.Bytes())
	}()
	m.cleanup()
	if m.closed || m.persistenceErr {
		reply(w, 503, map[string]string{"error": "网盘检测服务不可用"})
		return
	}
	if action != "start" {
		rec, ok := m.state.Tasks[in.TaskID]
		if !ok || rec.Owner != in.Owner {
			reply(w, 404, map[string]string{"error": "任务不存在"})
			return
		}
		if action == "cancel" {
			rec.Task.ShouldStop = true
			if cancel := m.active[in.TaskID]; cancel != nil && rec.Task.Status == "running" {
				cancel()
				rec.Task.Status = "cancelled"
			}
			rec.Task.UpdatedAt = time.Now().UnixMilli()
			if m.persist() != nil {
				reply(w, 503, map[string]string{"error": "网盘检测服务不可用"})
				return
			}
			reply(w, 200, map[string]any{"task": rec.Task})
			return
		}
		reply(w, 200, map[string]any{"task": rec.Task, "cooldownRemainingMs": m.cooldown()})
		return
	}
	if !allowedPlatform(in.Platform) {
		reply(w, 400, map[string]string{"error": "不支持的网盘平台"})
		return
	}
	if m.cooldown() > 0 || len(m.active) >= 5 || len(m.state.Tasks) >= 1000 {
		reply(w, 400, map[string]string{"error": "检测任务繁忙或冷却中，请稍后再试"})
		return
	}
	links := []string{}
	seen := map[string]bool{}
	for _, v := range in.Links {
		v = strings.TrimSpace(v)
		if len(v) > 4096 {
			reply(w, 400, map[string]string{"error": "链接过长"})
			return
		}
		if v != "" && !seen[v] {
			seen[v] = true
			links = append(links, v)
		}
		if len(links) == 60 {
			break
		}
	}
	if len(links) == 0 {
		reply(w, 400, map[string]string{"error": "没有可检测的链接"})
		return
	}
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		reply(w, 503, map[string]string{"error": "网盘检测服务不可用"})
		return
	}
	id := "netdisk_check_" + hex.EncodeToString(b)
	now := time.Now().UnixMilli()
	t := &Task{ID: id, Platform: in.Platform, Status: "running", Progress: Progress{Total: len(links), TotalBatches: (len(links) + 2) / 3}, Results: map[string]Result{}, CreatedAt: now, UpdatedAt: now}
	for _, v := range links {
		t.Results[v] = Result{Status: "pending"}
	}
	m.state.Tasks[id] = record{Owner: in.Owner, Task: t}
	snapshot, capacityErr := json.Marshal(m.state)
	if capacityErr != nil || len(snapshot) > 31<<20 {
		delete(m.state.Tasks, id)
		reply(w, 400, map[string]string{"error": "检测任务存储已满，请稍后再试"})
		return
	}
	if m.persist() != nil {
		delete(m.state.Tasks, id)
		reply(w, 503, map[string]string{"error": "网盘检测服务不可用"})
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	m.active[id] = cancel
	m.wg.Add(1)
	go m.run(ctx, t, links)
	reply(w, 200, map[string]any{"taskId": id, "task": t, "cooldownRemainingMs": m.cooldown()})
}
func (m *Manager) run(ctx context.Context, t *Task, links []string) {
	defer m.wg.Done()
	defer func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		if c := m.active[t.ID]; c != nil {
			c()
		}
		delete(m.active, t.ID)
	}()
	for offset := 0; offset < len(links); offset += 3 {
		m.mu.Lock()
		if ctx.Err() != nil {
			m.mu.Unlock()
			return
		}
		if m.cooldown() > 0 {
			t.Status = "failed"
			t.Error = "检测功能冷却中，请稍后再试"
			t.UpdatedAt = time.Now().UnixMilli()
			_ = m.persist()
			m.mu.Unlock()
			return
		}
		t.Progress.CurrentBatch++
		batch := links[offset:min(offset+3, len(links))]
		for _, v := range batch {
			t.Results[v] = Result{Status: "checking"}
		}
		m.mu.Unlock()
		results := make([]Result, len(batch))
		var wg sync.WaitGroup
		for i, v := range batch {
			wg.Add(1)
			go func(i int, v string) {
				defer wg.Done()
				c, cancel := context.WithTimeout(ctx, 12*time.Second)
				defer cancel()
				results[i] = m.check(c, t.Platform, v)
			}(i, v)
		}
		wg.Wait()
		m.mu.Lock()
		if ctx.Err() != nil {
			m.mu.Unlock()
			return
		}
		limited := false
		for i, v := range batch {
			res := results[i]
			t.Results[v] = res
			t.Progress.Done++
			switch res.Status {
			case "valid":
				t.Progress.Valid++
			case "invalid":
				t.Progress.Invalid++
			case "rate_limited":
				t.Progress.RateLimited++
				limited = true
			default:
				t.Progress.Unknown++
			}
		}
		t.UpdatedAt = time.Now().UnixMilli()
		if limited {
			m.state.Cooldown = t.UpdatedAt + 60000
			t.Status = "failed"
			t.Error = "触发网盘平台限流，请稍后重试"
		} else if offset+3 >= len(links) {
			t.Status = "completed"
		}
		err := m.persist()
		m.mu.Unlock()
		if limited || err != nil {
			return
		}
		if offset+3 < len(links) {
			timer := time.NewTimer(2 * time.Second)
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
			}
		}
	}
}
func (m *Manager) Close(ctx context.Context) error {
	m.mu.Lock()
	m.closed = true
	for id, c := range m.active {
		c()
		t := m.state.Tasks[id].Task
		if t.Status == "running" {
			t.Status = "failed"
			t.Error = "检测任务因服务停止中断，请重新发起"
			t.UpdatedAt = time.Now().UnixMilli()
		}
	}
	err := m.persist()
	m.mu.Unlock()
	done := make(chan struct{})
	go func() { m.wg.Wait(); close(done) }()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-done:
	}
	ce := m.lock.Close()
	if err != nil {
		return err
	}
	return ce
}

type bufferedResponse struct {
	bytes.Buffer
	headers http.Header
	status  int
}

func (b *bufferedResponse) Header() http.Header    { return b.headers }
func (b *bufferedResponse) WriteHeader(status int) { b.status = status }
