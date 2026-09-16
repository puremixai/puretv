// Package downloads executes HLS downloads using the existing API task format.
// Authentication belongs to the calling HTTP gateway.
package downloads

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Options struct {
	Root               string
	Concurrency        int
	SegmentConcurrency int
	// Client must enforce the deployment's outbound URL and proxy policy.
	Client *http.Client
}

type entry struct {
	task     Task
	cancel   context.CancelFunc
	done     chan struct{}
	deleting bool
}

type Manager struct {
	mu         sync.Mutex
	cond       *sync.Cond
	root       *os.Root
	lock       *os.File
	options    Options
	storeLimit int
	tasks      map[string]*entry
	order      []string
	dirty      bool
	stopping   bool
	ctx        context.Context
	cancel     context.CancelFunc
	wg         sync.WaitGroup
	requests   sync.WaitGroup
	closeOnce  sync.Once
	closed     chan struct{}
	closeErr   error
}

func New(options Options) (*Manager, error) {
	return newWithStoreLimit(options, 32*1024*1024)
}

func newWithStoreLimit(options Options, storeLimit int) (*Manager, error) {
	if storeLimit < 1 {
		return nil, errors.New("invalid download store size limit")
	}
	if options.Client == nil {
		return nil, errors.New("downloads requires an outbound-policy HTTP client")
	}
	if options.Root == "" {
		return nil, errors.New("downloads root is required")
	}
	if options.Concurrency == 0 {
		options.Concurrency = 2
	}
	if options.SegmentConcurrency == 0 {
		options.SegmentConcurrency = 6
	}
	if options.Concurrency < 1 || options.Concurrency > 128 || options.SegmentConcurrency < 1 || options.SegmentConcurrency > 128 {
		return nil, errors.New("download concurrency must be between 1 and 128")
	}
	abs, err := filepath.Abs(options.Root)
	if err != nil {
		return nil, err
	}
	options.Root = abs
	if err := os.MkdirAll(abs, 0700); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(abs)
	if err != nil {
		return nil, err
	}
	lock, err := acquireLock(root)
	if err != nil {
		root.Close()
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	m := &Manager{root: root, lock: lock, options: options, tasks: make(map[string]*entry), ctx: ctx, cancel: cancel, closed: make(chan struct{})}
	m.storeLimit = storeLimit
	m.cond = sync.NewCond(&m.mu)
	if err := m.load(); err != nil {
		cancel()
		lock.Close()
		root.Close()
		return nil, err
	}
	if m.dirty {
		if err := m.saveLocked(); err != nil {
			cancel()
			lock.Close()
			root.Close()
			return nil, err
		}
	}
	for i := 0; i < options.Concurrency; i++ {
		m.wg.Add(1)
		go m.worker()
	}
	m.wg.Add(1)
	go m.persistProgress()
	return m, nil
}

func (m *Manager) persistProgress() {
	defer m.wg.Done()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-m.ctx.Done():
			return
		case <-ticker.C:
			m.mu.Lock()
			if m.dirty {
				_ = m.saveLocked()
			}
			m.mu.Unlock()
		}
	}
}

func (m *Manager) worker() {
	defer m.wg.Done()
	for {
		m.mu.Lock()
		var current *entry
		for !m.stopping {
			for _, id := range m.order {
				candidate := m.tasks[id]
				if candidate != nil && !candidate.deleting && candidate.cancel == nil && candidate.task.Status == "pending" {
					current = candidate
					break
				}
			}
			if current != nil {
				break
			}
			m.cond.Wait()
		}
		if m.stopping {
			m.mu.Unlock()
			return
		}
		ctx, cancel := context.WithCancel(m.ctx)
		current.cancel = cancel
		current.done = make(chan struct{})
		current.task.Status = "downloading"
		current.task.UpdatedAt = timestamp()
		m.dirty = true
		task := current.task
		if err := m.saveLocked(); err != nil {
			current.task.Status = "error"
			current.task.ErrorMessage = "无法保存下载任务"
			current.cancel = nil
			close(current.done)
			cancel()
			m.mu.Unlock()
			continue
		}
		m.mu.Unlock()
		err := m.download(ctx, task, func(done, total int) {
			m.mu.Lock()
			defer m.mu.Unlock()
			if current.deleting || ctx.Err() != nil {
				return
			}
			current.task.DownloadedSegments = done
			current.task.TotalSegments = total
			if total > 0 {
				current.task.Progress = int(float64(done)*100/float64(total) + 0.5)
			}
			current.task.UpdatedAt = timestamp()
			m.dirty = true
		})
		cancel()
		m.mu.Lock()
		if !current.deleting {
			current.task.UpdatedAt = timestamp()
			if m.stopping {
				current.task.Status = "paused"
				current.task.ErrorMessage = "服务器重启，任务已暂停"
			} else if err != nil {
				current.task.Status = "error"
				current.task.ErrorMessage = boundedError(err.Error())
			} else {
				current.task.Status = "completed"
				current.task.Progress = 100
				current.task.ErrorMessage = ""
			}
			m.dirty = true
			_ = m.saveLocked()
		}
		current.cancel = nil
		close(current.done)
		m.cond.Broadcast()
		m.mu.Unlock()
	}
}

// A Close deadline bounds the caller's wait, not cleanup. Ownership of the root
// remains held until every writer exits and final state is persisted.
func (m *Manager) Close(ctx context.Context) error {
	m.closeOnce.Do(func() {
		m.mu.Lock()
		m.stopping = true
		m.cancel()
		m.cond.Broadcast()
		m.mu.Unlock()
		go func() {
			m.requests.Wait()
			m.wg.Wait()
			m.mu.Lock()
			for _, e := range m.tasks {
				if e.task.Status == "pending" || e.task.Status == "downloading" {
					e.task.Status = "paused"
					e.task.ErrorMessage = "服务器重启，任务已暂停"
					e.task.UpdatedAt = timestamp()
				}
			}
			m.closeErr = m.saveLocked()
			m.mu.Unlock()
			m.closeErr = errors.Join(m.closeErr, m.lock.Close(), m.root.Close())
			close(m.closed)
		}()
	})
	select {
	case <-m.closed:
		return m.closeErr
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (m *Manager) newID(source, video string, episode int) string {
	now := time.Now().UnixMilli()
	for {
		id := fmt.Sprintf("%s_%s_%d_%d", source, video, episode, now)
		if m.tasks[id] == nil {
			return id
		}
		now++
	}
}

func timestamp() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }
