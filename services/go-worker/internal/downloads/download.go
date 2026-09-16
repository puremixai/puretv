package downloads

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

func (m *Manager) fetch(ctx context.Context, raw string) (*http.Response, error) {
	if !validURL(raw) {
		return nil, errors.New("不支持的下载地址")
	}
	r, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, errors.New("无效的下载请求")
	}
	u, _ := url.Parse(raw)
	origin := u.Scheme + "://" + u.Host
	r.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	r.Header.Set("Accept", "*/*")
	r.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	r.Header.Set("Origin", origin)
	r.Header.Set("Referer", origin+"/")
	response, err := m.options.Client.Do(r)
	if err != nil {
		if ctx.Err() != nil {
			return nil, errors.New("下载请求已取消或超时")
		}
		return nil, errors.New("下载请求失败")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		response.Body.Close()
		return nil, fmt.Errorf("下载请求失败（HTTP %d）", response.StatusCode)
	}
	return response, nil
}

func (m *Manager) fetchPlaylist(parent context.Context, raw string) (string, string, error) {
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	response, err := m.fetch(ctx, raw)
	if err != nil {
		return "", "", err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 4*1024*1024+1))
	if err != nil {
		return "", "", errors.New("读取播放列表失败或超时")
	}
	if len(data) > 4*1024*1024 {
		return "", "", errors.New("播放列表过大")
	}
	base := raw
	if response.Request != nil && response.Request.URL != nil {
		base = response.Request.URL.String()
	}
	return string(data), base, nil
}

func (m *Manager) download(ctx context.Context, task Task, progress func(int, int)) error {
	rel, err := episodePath(task.Source, task.VideoID, task.EpisodeIndex)
	if err != nil {
		return err
	}
	if err := m.root.MkdirAll(rel, 0700); err != nil {
		return errors.New("无法创建下载目录")
	}
	dir, err := m.root.OpenRoot(rel)
	if err != nil {
		return errors.New("无法打开下载目录")
	}
	defer dir.Close()
	if count, complete := verifyExisting(dir); complete {
		progress(count, count)
		return nil
	}
	content, base, err := m.fetchPlaylist(ctx, task.M3U8URL)
	if err != nil {
		return err
	}
	if strings.Contains(content, "#EXT-X-STREAM-INF:") {
		variant, err := chooseVariant(content, base)
		if err != nil {
			return err
		}
		content, base, err = m.fetchPlaylist(ctx, variant)
		if err != nil {
			return err
		}
	}
	plan, err := parsePlaylist(content, base)
	if err != nil {
		return err
	}
	// Keep already completed segments in the first retry progress snapshot.
	missing := make([]segment, 0, len(plan.segments))
	completed := 0
	for _, item := range plan.segments {
		if existingFile(dir, item.name, false) {
			completed++
		} else {
			missing = append(missing, item)
		}
	}
	progress(completed, len(plan.segments))
	if plan.keyURL != "" {
		if err := m.downloadWithRetry(ctx, dir, plan.keyURL, "key.key", true); err != nil {
			return err
		}
	}
	workCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	var mu sync.Mutex
	next := 0
	var firstErr error
	var workers sync.WaitGroup
	for i := 0; i < min(m.options.SegmentConcurrency, len(missing)); i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for {
				mu.Lock()
				if workCtx.Err() != nil || next >= len(missing) {
					mu.Unlock()
					return
				}
				item := missing[next]
				next++
				mu.Unlock()
				if err := m.downloadWithRetry(workCtx, dir, item.url, item.name, false); err != nil {
					mu.Lock()
					if firstErr == nil {
						firstErr = err
					}
					mu.Unlock()
					cancel()
					return
				}
				mu.Lock()
				completed++
				progress(completed, len(plan.segments))
				mu.Unlock()
			}
		}()
	}
	workers.Wait()
	if ctx.Err() != nil {
		return errors.New("下载已取消")
	}
	if firstErr != nil {
		return firstErr
	}
	if err := atomicWrite(dir, "playlist.m3u8", strings.NewReader(plan.content)); err != nil {
		return errors.New("保存播放列表失败")
	}
	return nil
}

func existingFile(dir *os.Root, name string, key bool) bool {
	info, err := dir.Stat(name)
	return err == nil && info.Mode().IsRegular() && ((key && info.Size() == 16) || (!key && info.Size() > 0))
}

func verifyExisting(dir *os.Root) (int, bool) {
	content, err := dir.ReadFile("playlist.m3u8")
	if err != nil {
		return 0, false
	}
	normalized := strings.TrimPrefix(string(content), "\ufeff")
	if !strings.HasPrefix(strings.TrimSpace(normalized), "#EXTM3U") {
		return 0, false
	}
	if _, err := parsePlaylist(normalized, "https://offline.invalid/"); err != nil {
		return 0, false
	}
	count := 0
	for _, line := range strings.Split(normalized, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "#EXT-X-KEY:") && attrs(line)["METHOD"] != "NONE" {
			if attrs(line)["URI"] != "key.key" || !existingFile(dir, "key.key", true) {
				return 0, false
			}
		}
		if line != "" && !strings.HasPrefix(line, "#") {
			if !validComponent(line) || !existingFile(dir, line, false) {
				return 0, false
			}
			count++
		}
	}
	return count, count > 0
}

func (m *Manager) downloadWithRetry(ctx context.Context, dir *os.Root, raw, name string, key bool) error {
	if existingFile(dir, name, key) {
		return nil
	}
	var last error
	for attempt := 0; attempt < 3; attempt++ {
		if ctx.Err() != nil {
			return errors.New("下载已取消")
		}
		if attempt > 0 {
			timer := time.NewTimer(time.Duration(attempt) * time.Second)
			select {
			case <-ctx.Done():
				timer.Stop()
				return errors.New("下载已取消")
			case <-timer.C:
			}
		}
		last = m.downloadFile(ctx, dir, raw, name, key)
		if last == nil {
			return nil
		}
	}
	return fmt.Errorf("下载失败（已尝试 3 次）：%w", last)
}

func (m *Manager) downloadFile(parent context.Context, dir *os.Root, raw, name string, key bool) error {
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()
	response, err := m.fetch(ctx, raw)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if key {
		data, err := io.ReadAll(io.LimitReader(response.Body, 17))
		if err != nil {
			return errors.New("读取 HLS 密钥失败或超时")
		}
		if len(data) != 16 {
			return errors.New("无效的 AES-128 密钥长度")
		}
		if err := atomicWrite(dir, name, strings.NewReader(string(data))); err != nil {
			return errors.New("保存 HLS 密钥失败")
		}
		return nil
	}
	// The HTTP body is copied incrementally; a failed/cancelled copy cannot publish
	// its final filename, which is the recovery marker for a complete segment.
	if err := atomicWrite(dir, name, response.Body); err != nil {
		return errors.New("读取或保存视频片段失败")
	}
	if !existingFile(dir, name, false) {
		_ = dir.Remove(name)
		return errors.New("视频片段为空")
	}
	return nil
}
