// Package jobs keeps durable leases and progress for cooperating Node executors.
// It never replays side effects automatically when an executor disappears.
package jobs

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/puremixai/puretv/services/go-worker/internal/filelock"
)

const leaseDuration = 2 * time.Minute
const maxStoreBytes = 16 << 20

type Job struct {
	ID       string          `json:"id"`
	Scope    string          `json:"scope"`
	Token    string          `json:"token,omitempty"`
	Status   string          `json:"status"`
	Started  int64           `json:"started"`
	Updated  int64           `json:"updated"`
	Expires  int64           `json:"expires"`
	Cooldown int64           `json:"cooldown"`
	Payload  json.RawMessage `json:"payload,omitempty"`
}

type Manager struct {
	mu     sync.Mutex
	root   *os.Root
	lock   *os.File
	jobs   map[string]Job
	now    func() time.Time
	closed bool
}

func New(directory string) (*Manager, error) {
	directory = filepath.Join(directory, "jobs")
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, err
	}
	closeRoot := true
	defer func() {
		if closeRoot {
			_ = root.Close()
		}
	}()
	if info, e := root.Lstat(".lock"); e == nil && !info.Mode().IsRegular() {
		return nil, errors.New("invalid jobs lock")
	}
	lock, err := root.OpenFile(".lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = filelock.Lock(lock); err != nil {
		_ = lock.Close()
		return nil, errors.New("jobs storage already in use")
	}
	m := &Manager{root: root, lock: lock, jobs: map[string]Job{}, now: time.Now}
	input, err := root.Open("jobs.json")
	if err == nil {
		content, e := io.ReadAll(io.LimitReader(input, maxStoreBytes+1))
		_ = input.Close()
		if e != nil || len(content) > maxStoreBytes || json.Unmarshal(content, &m.jobs) != nil || m.jobs == nil {
			_ = lock.Close()
			return nil, errors.New("invalid jobs store")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		_ = lock.Close()
		return nil, err
	}
	closeRoot = false
	return m, nil
}

func (m *Manager) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil
	}
	m.closed = true
	_ = m.lock.Close()
	return m.root.Close()
}

func (m *Manager) save() error {
	data, err := json.Marshal(m.jobs)
	if err != nil {
		return err
	}
	if len(data) > maxStoreBytes {
		return errors.New("jobs store full")
	}
	temp, err := m.root.OpenFile("jobs.tmp", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, err = temp.Write(data)
	if err == nil {
		err = temp.Sync()
	}
	closeErr := temp.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		_ = m.root.Remove("jobs.tmp")
		return err
	}
	return m.root.Rename("jobs.tmp", "jobs.json")
}

func randomID() string {
	var value [24]byte
	_, err := rand.Read(value[:])
	if err != nil {
		panic(err)
	}
	return hex.EncodeToString(value[:])
}

func (m *Manager) expire(now int64) {
	for id, j := range m.jobs {
		if j.Status == "running" && j.Expires <= now {
			j.Status = "failed"
			j.Token = ""
			j.Updated = now
			m.jobs[id] = j
		}
		if j.Status != "running" && now-j.Updated > 24*60*60*1000 {
			delete(m.jobs, id)
		}
	}
}

func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func failure(w http.ResponseWriter, status int, message string) {
	respond(w, status, map[string]string{"error": message})
}

func (m *Manager) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Action   string          `json:"action"`
		ID       string          `json:"id"`
		Scope    string          `json:"scope"`
		Token    string          `json:"token"`
		Cooldown int64           `json:"cooldown"`
		Payload  json.RawMessage `json:"payload"`
	}
	if r.Method != "POST" {
		failure(w, 405, "请求方法不支持")
		return
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128<<10))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&in) != nil {
		failure(w, 400, "任务请求无效")
		return
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		failure(w, 400, "任务请求无效")
		return
	}
	if len(in.Payload) > 64<<10 {
		failure(w, 413, "任务进度过大")
		return
	}
	m.mu.Lock()
	var response any
	status := 200
	// Encode/write only after releasing the mutex; slow peers cannot block leases.
	defer func() { m.mu.Unlock(); respond(w, status, response) }()
	fail := func(code int, message string) { status = code; response = map[string]string{"error": message} }
	if m.closed {
		fail(503, "任务服务正在关闭")
		return
	}
	before := make(map[string]Job, len(m.jobs))
	for k, v := range m.jobs {
		before[k] = v
	}
	now := m.now().UnixMilli()
	m.expire(now)
	switch in.Action {
	case "acquire":
		if (in.Scope != "openlist-refresh" && in.Scope != "cron" && in.Scope != "anime-subscriptions") || in.Cooldown < 0 || in.Cooldown > 24*60*60*1000 {
			fail(400, "任务范围无效")
			return
		}
		for _, j := range m.jobs {
			if j.Scope == in.Scope && (j.Status == "running" || j.Started+j.Cooldown > now) {
				status = 409
				response = map[string]any{"error": "任务正在运行或冷却中", "remainingSeconds": max(int64(1), (max(j.Expires, j.Started+j.Cooldown)-now+999)/1000)}
				return
			}
		}
		if len(m.jobs) >= 512 {
			fail(429, "任务记录已满")
			return
		}
		j := Job{ID: randomID(), Scope: in.Scope, Token: randomID(), Status: "running", Started: now, Updated: now, Expires: now + leaseDuration.Milliseconds(), Cooldown: in.Cooldown, Payload: in.Payload}
		m.jobs[j.ID] = j
		response = j
	case "get":
		j, ok := m.jobs[in.ID]
		if !ok {
			fail(404, "任务不存在")
			return
		}
		j.Token = ""
		response = j
	case "renew", "complete", "fail":
		j, ok := m.jobs[in.ID]
		if !ok || j.Status != "running" || in.Token == "" || j.Token != in.Token {
			fail(409, "任务租约已失效")
			return
		}
		j.Updated = now
		j.Expires = now + leaseDuration.Milliseconds()
		if len(in.Payload) > 0 {
			j.Payload = in.Payload
		}
		if in.Action != "renew" {
			if in.Action == "complete" {
				j.Status = "completed"
			} else {
				j.Status = "failed"
			}
			j.Token = ""
		}
		m.jobs[j.ID] = j
		j.Token = ""
		response = j
	default:
		fail(400, "任务操作无效")
		return
	}
	if err := m.save(); err != nil {
		m.jobs = before
		fail(503, "任务状态保存失败")
	}
}
