package downloads

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type apiResponse struct {
	headers http.Header
	status  int
	body    any
}

func (w *apiResponse) Header() http.Header { return w.headers }
func reply(w *apiResponse, status int, body any) {
	w.status = status
	w.body = body
}
func failure(w *apiResponse, status int, message string) {
	reply(w, status, map[string]string{"error": message})
}

func writeResponse(w http.ResponseWriter, response apiResponse) {
	for key, values := range response.headers {
		w.Header()[key] = values
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(response.status)
	_ = json.NewEncoder(w).Encode(response.body)
}

func (m *Manager) ServeHTTP(writer http.ResponseWriter, r *http.Request) {
	w := &apiResponse{headers: make(http.Header)}
	if r.URL.Path != "/v1/offline-download" {
		failure(w, 404, "接口不存在")
		writeResponse(writer, *w)
		return
	}
	m.mu.Lock()
	if m.stopping {
		m.mu.Unlock()
		failure(w, 503, "下载服务正在关闭")
		writeResponse(writer, *w)
		return
	}
	m.requests.Add(1)
	m.mu.Unlock()
	defer m.requests.Done()
	// Neither request body reads nor response encoding/writes hold the state lock.
	// Close interrupts a slow peer even when the caller has no HTTP server timeout.
	controller := http.NewResponseController(writer)
	_ = controller.SetReadDeadline(time.Now().Add(10 * time.Second))
	_ = controller.SetWriteDeadline(time.Now().Add(10 * time.Second))
	body := r.Body
	stop := context.AfterFunc(m.ctx, func() {
		_ = controller.SetReadDeadline(time.Now())
		_ = controller.SetWriteDeadline(time.Now())
		_ = body.Close()
	})
	defer stop()
	if r.Method == http.MethodPost {
		data, err := io.ReadAll(http.MaxBytesReader(writer, r.Body, 1024*1024))
		if err != nil {
			failure(w, 400, "无效的请求内容")
			writeResponse(writer, *w)
			return
		}
		copy := r.Clone(r.Context())
		copy.Body = io.NopCloser(bytes.NewReader(data))
		r = copy
	}
	m.mu.Lock()
	if m.stopping {
		failure(w, 503, "下载服务正在关闭")
	} else {
		m.dispatchLocked(w, r)
	}
	m.mu.Unlock()
	writeResponse(writer, *w)
}

func (m *Manager) dispatchLocked(w *apiResponse, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		if r.URL.Query().Get("action") == "check" {
			q := r.URL.Query()
			episode, err := strconv.Atoi(q.Get("episodeIndex"))
			if err != nil {
				failure(w, 400, "参数不完整")
				return
			}
			if _, err := episodePath(q.Get("source"), q.Get("videoId"), episode); err != nil {
				failure(w, 400, "参数不完整")
				return
			}
			downloaded, err := m.checkDownloaded(q.Get("source"), q.Get("videoId"), episode)
			if err != nil {
				failure(w, 403, "非法路径")
				return
			}
			reply(w, 200, map[string]bool{"downloaded": downloaded})
			return
		}
		reply(w, 200, map[string]any{"tasks": m.snapshotLocked()})
	case http.MethodPost:
		m.createHTTP(w, r)
	case http.MethodPut:
		m.retryHTTP(w, r)
	case http.MethodDelete:
		m.deleteHTTP(w, r)
	default:
		w.Header().Set("Allow", "GET, POST, PUT, DELETE")
		failure(w, 405, "不支持的请求方法")
	}
}

func (m *Manager) createHTTP(w *apiResponse, r *http.Request) {
	var body struct {
		Source   string          `json:"source"`
		VideoID  string          `json:"videoId"`
		Episode  *int            `json:"episodeIndex"`
		Title    string          `json:"title"`
		URL      string          `json:"m3u8Url"`
		Metadata json.RawMessage `json:"metadata"`
	}
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&body); err != nil {
		failure(w, 400, "参数不完整")
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		failure(w, 400, "无效的请求内容")
		return
	}
	if body.Episode == nil || body.Title == "" || !validURL(body.URL) {
		failure(w, 400, "参数不完整")
		return
	}
	rel, err := episodePath(body.Source, body.VideoID, *body.Episode)
	if err != nil {
		failure(w, 400, "参数不完整")
		return
	}
	if len(body.Metadata) > 0 && string(body.Metadata) != "null" && !strings.HasPrefix(strings.TrimSpace(string(body.Metadata)), "{") {
		failure(w, 400, "无效的视频元数据")
		return
	}
	for _, e := range m.tasks {
		if e.task.Source == body.Source && e.task.VideoID == body.VideoID && e.task.EpisodeIndex == *body.Episode {
			message := "该任务已存在但未完成，请使用重试功能继续下载"
			if e.task.Status == "pending" || e.task.Status == "downloading" {
				message = "该任务正在下载中，请勿重复添加"
			} else if e.task.Status == "completed" {
				message = "该视频已下载完成，如需重新下载请先删除任务"
			}
			reply(w, 400, map[string]any{"task": e.task, "message": message})
			return
		}
	}
	downloaded, err := m.checkDownloaded(body.Source, body.VideoID, *body.Episode)
	if err != nil {
		failure(w, 403, "非法路径")
		return
	}
	if downloaded {
		reply(w, 400, map[string]any{"message": "该视频文件已存在，无需重复下载", "downloaded": true})
		return
	}
	now := timestamp()
	task := Task{ID: m.newID(body.Source, body.VideoID, *body.Episode), Source: body.Source, VideoID: body.VideoID, EpisodeIndex: *body.Episode, Title: body.Title, M3U8URL: body.URL, Status: "pending", CreatedAt: now, UpdatedAt: now, DownloadDir: filepath.Join(m.options.Root, rel), Metadata: body.Metadata}
	m.tasks[task.ID] = &entry{task: task}
	m.order = append(m.order, task.ID)
	m.dirty = true
	err = m.checkCapacityLocked()
	if err == nil {
		err = m.saveLocked()
	}
	if err != nil {
		delete(m.tasks, task.ID)
		m.order = m.order[:len(m.order)-1]
		if errors.Is(err, errStoreCapacity) {
			failure(w, 507, errStoreCapacity.Error())
		} else {
			failure(w, 500, "无法保存下载任务")
		}
		return
	}
	m.cond.Broadcast()
	reply(w, 200, map[string]any{"task": task, "message": "任务已创建"})
}

func (m *Manager) retryHTTP(w *apiResponse, r *http.Request) {
	id := r.URL.Query().Get("taskId")
	if id == "" {
		failure(w, 400, "缺少任务ID")
		return
	}
	if r.URL.Query().Get("action") != "retry" {
		failure(w, 400, "无效的操作")
		return
	}
	e := m.tasks[id]
	if e == nil || e.deleting {
		failure(w, 404, "任务不存在")
		return
	}
	if e.task.Status == "downloading" || e.task.Status == "pending" {
		failure(w, 400, "任务正在进行中，无法重试")
		return
	}
	if e.cancel != nil {
		failure(w, 400, "任务已在重试中")
		return
	}
	previous := e.task
	e.task.Status = "pending"
	e.task.ErrorMessage = ""
	e.task.UpdatedAt = timestamp()
	m.dirty = true
	if err := m.saveLocked(); err != nil {
		e.task = previous
		failure(w, 500, "无法保存下载任务")
		return
	}
	m.cond.Broadcast()
	reply(w, 200, map[string]any{"task": e.task, "message": "任务已重新开始"})
}

// Called with the manager mutex held; release it while the cancelled writer exits.
func (m *Manager) deleteHTTP(w *apiResponse, r *http.Request) {
	id := r.URL.Query().Get("taskId")
	if id == "" {
		failure(w, 400, "缺少任务ID")
		return
	}
	e := m.tasks[id]
	if e == nil || e.deleting {
		failure(w, 404, "任务不存在")
		return
	}
	e.deleting = true
	if e.cancel != nil {
		e.cancel()
		done := e.done
		m.mu.Unlock()
		<-done
		m.mu.Lock()
	}
	rel, _ := episodePath(e.task.Source, e.task.VideoID, e.task.EpisodeIndex)
	if err := m.root.RemoveAll(rel); err != nil {
		e.deleting = false
		e.task.Status = "error"
		e.task.ErrorMessage = "删除下载文件失败"
		m.dirty = true
		failure(w, 500, "删除下载文件失败")
		return
	}
	delete(m.tasks, id)
	for i, value := range m.order {
		if value == id {
			m.order = append(m.order[:i], m.order[i+1:]...)
			break
		}
	}
	m.dirty = true
	if err := m.saveLocked(); err != nil {
		failure(w, 500, "无法保存下载任务")
		return
	}
	reply(w, 200, map[string]string{"message": "任务已删除"})
}
