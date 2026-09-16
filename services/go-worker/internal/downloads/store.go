package downloads

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf8"
)

var errStoreCapacity = errors.New("任务存储空间已满，请删除旧任务后重试")

type Task struct {
	ID                 string          `json:"id"`
	Source             string          `json:"source"`
	VideoID            string          `json:"videoId"`
	EpisodeIndex       int             `json:"episodeIndex"`
	Title              string          `json:"title"`
	M3U8URL            string          `json:"m3u8Url"`
	Status             string          `json:"status"`
	Progress           int             `json:"progress"`
	TotalSegments      int             `json:"totalSegments"`
	DownloadedSegments int             `json:"downloadedSegments"`
	ErrorMessage       string          `json:"errorMessage,omitempty"`
	CreatedAt          string          `json:"createdAt"`
	UpdatedAt          string          `json:"updatedAt"`
	DownloadDir        string          `json:"downloadDir"`
	Metadata           json.RawMessage `json:"metadata,omitempty"`
}

func validComponent(value string) bool {
	if value == "" || value == "." || value == ".." || strings.TrimRight(value, " .") != value || strings.ContainsAny(value, "/\\:") || !filepath.IsLocal(value) {
		return false
	}
	for _, r := range value {
		if r < 32 || r == 127 {
			return false
		}
	}
	return true
}

func episodePath(source, video string, episode int) (string, error) {
	if !validComponent(source) || !validComponent(video) || episode < 0 || episode > 2147483646 {
		return "", errors.New("非法下载路径或集数")
	}
	return filepath.Join(source, video, "ep"+strconv.Itoa(episode+1)), nil
}

func (m *Manager) load() error {
	file, err := m.root.Open("tasks.json")
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, int64(m.storeLimit)+1))
	if err != nil {
		return err
	}
	if len(data) > m.storeLimit {
		return errStoreCapacity
	}
	var tasks []Task
	if err := json.Unmarshal(data, &tasks); err != nil {
		return fmt.Errorf("invalid tasks.json: %w", err)
	}
	identities := make(map[string]bool)
	for _, task := range tasks {
		rel, err := episodePath(task.Source, task.VideoID, task.EpisodeIndex)
		if err != nil {
			return fmt.Errorf("invalid persisted task: %w", err)
		}
		if task.ID == "" || m.tasks[task.ID] != nil || identities[rel] {
			return errors.New("duplicate or missing persisted task identity")
		}
		identities[rel] = true
		switch task.Status {
		case "pending", "downloading":
			task.Status = "paused"
			task.ErrorMessage = "服务器重启，任务已暂停"
			m.dirty = true
		case "completed", "error", "paused":
		default:
			return errors.New("invalid persisted task status")
		}
		derived := filepath.Join(m.options.Root, rel)
		if task.DownloadDir != derived {
			task.DownloadDir = derived
			m.dirty = true
		}
		m.tasks[task.ID] = &entry{task: task}
		m.order = append(m.order, task.ID)
	}
	return m.checkCapacityLocked()
}

func (m *Manager) snapshotLocked() []Task {
	return m.taskSnapshotLocked(false)
}

func (m *Manager) taskSnapshotLocked(includeDeleting bool) []Task {
	items := make([]Task, 0, len(m.tasks))
	for _, id := range m.order {
		if e := m.tasks[id]; e != nil && (includeDeleting || !e.deleting) {
			items = append(items, e.task)
		}
	}
	return items
}

// Admission accounts for the largest future encoding of each mutable field,
// including JSON escaping in bounded errors. Progress/status updates therefore
// cannot make a store accepted here exceed the same limit on its next restart.
func (m *Manager) checkCapacityLocked() error {
	worst := m.taskSnapshotLocked(true)
	maxCount := int(^uint(0) >> 1)
	message := strings.Repeat("<", 512)
	maxMessage, _ := json.Marshal(message)
	for i := range worst {
		task := &worst[i]
		task.Status = "downloading"
		task.Progress = maxCount
		task.TotalSegments = maxCount
		task.DownloadedSegments = maxCount
		encoded, _ := json.Marshal(task.ErrorMessage)
		if len(encoded) < len(maxMessage) {
			task.ErrorMessage = message
		}
		if len(task.UpdatedAt) < len("2000-01-01T00:00:00.000Z") {
			task.UpdatedAt = "2000-01-01T00:00:00.000Z"
		}
	}
	data, err := json.Marshal(worst)
	if err != nil {
		return err
	}
	if len(data) > m.storeLimit {
		return errStoreCapacity
	}
	return nil
}

func boundedError(message string) string {
	if len(message) <= 512 {
		return message
	}
	message = message[:512]
	for !utf8.ValidString(message) {
		message = message[:len(message)-1]
	}
	return message
}

func (m *Manager) saveLocked() error {
	// A cancelling entry remains recoverable until file removal succeeds.
	data, err := json.Marshal(m.taskSnapshotLocked(true))
	if err != nil {
		return err
	}
	if len(data) > m.storeLimit {
		m.dirty = true
		return errStoreCapacity
	}
	if err := atomicWrite(m.root, "tasks.json", strings.NewReader(string(data))); err != nil {
		m.dirty = true
		return err
	}
	m.dirty = false
	return nil
}

func atomicWrite(root *os.Root, name string, body io.Reader) (err error) {
	temporary := name + ".tmp"
	if err := root.Remove(temporary); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	file, err := root.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer func() {
		file.Close()
		if err != nil {
			_ = root.Remove(temporary)
		}
	}()
	if _, err = io.Copy(file, body); err != nil {
		return err
	}
	if err = file.Sync(); err != nil {
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return root.Rename(temporary, name)
}

func acquireLock(root *os.Root) (*os.File, error) {
	if info, err := root.Lstat(".downloads.lock"); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("download lock may not be a symlink")
	}
	file, err := root.OpenFile(".downloads.lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err := lockFile(file); err != nil {
		file.Close()
		return nil, fmt.Errorf("download root is already in use: %w", err)
	}
	return file, nil
}

func (m *Manager) checkDownloaded(source, video string, episode int) (bool, error) {
	rel, err := episodePath(source, video, episode)
	if err != nil {
		return false, err
	}
	info, err := m.root.Stat(filepath.Join(rel, "playlist.m3u8"))
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return info.Mode().IsRegular(), nil
}
