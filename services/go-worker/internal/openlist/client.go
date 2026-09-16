package openlist

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const maxUpstreamBytes = 2 << 20

// All errors exposed to callers are fixed messages: upstream messages, URLs,
// credentials, response bodies and transport errors never become API errors.
var (
	errLogin         = errors.New("OpenList 登录失败")
	errDirectory     = errors.New("OpenList 目录请求失败")
	errResponse      = errors.New("OpenList 响应格式无效")
	errResponseLimit = errors.New("OpenList 响应超过大小上限")
	errPageLimit     = errors.New("目录分页超过上限")
	errFolderLimit   = errors.New("目录结果超过大小上限")
	errCanceled      = errors.New("目录请求已取消或超时")
)

type upstreamSession struct {
	client   *http.Client
	base     string
	username string
	password string
	mu       sync.Mutex
	token    string
}

// Credentials are scoped to this request and the configured origin. The caller's
// redirect policy still runs, after this additional origin check.
func newSession(client *http.Client, base *url.URL, username, password string) *upstreamSession {
	guarded := *client
	previousRedirect := client.CheckRedirect
	guarded.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if req.URL.User != nil || !strings.EqualFold(req.URL.Scheme, base.Scheme) || !strings.EqualFold(req.URL.Host, base.Host) || len(via) >= 10 {
			return errors.New("OpenList redirect refused")
		}
		if previousRedirect != nil {
			return previousRedirect(req, via)
		}
		return nil
	}
	return &upstreamSession{client: &guarded, base: base.String(), username: username, password: password}
}

func (s *upstreamSession) getToken(ctx context.Context, rejectedToken string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ctx.Err() != nil {
		return "", errCanceled
	}
	if s.token != "" && (rejectedToken == "" || s.token != rejectedToken) {
		return s.token, nil
	}
	status, payload, err := s.post(ctx, "/api/auth/login", "", struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}{Username: s.username, Password: s.password})
	if err != nil {
		if ctx.Err() != nil {
			return "", errCanceled
		}
		return "", errLogin
	}
	var response struct {
		Code int `json:"code"`
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if status < 200 || status >= 300 || json.Unmarshal(payload, &response) != nil || response.Code != 200 || response.Data.Token == "" {
		return "", errLogin
	}
	s.token = response.Data.Token
	return s.token, nil
}

func (s *upstreamSession) listPage(ctx context.Context, path string, page int) ([]json.RawMessage, error) {
	token, err := s.getToken(ctx, "")
	if err != nil {
		return nil, err
	}
	for attempt := 0; attempt < 2; attempt++ {
		status, payload, err := s.post(ctx, "/api/fs/list", token, struct {
			Path     string `json:"path"`
			Password string `json:"password"`
			Refresh  bool   `json:"refresh"`
			Page     int    `json:"page"`
			PerPage  int    `json:"per_page"`
		}{Path: path, Password: "", Refresh: true, Page: page, PerPage: pageSize})
		if err != nil {
			return nil, err
		}
		var response struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		if status >= 200 && status < 300 && json.Unmarshal(payload, &response) != nil {
			return nil, errResponse
		}
		if status == http.StatusUnauthorized || (status >= 200 && status < 300 && response.Code == 401) {
			if attempt == 1 {
				return nil, errDirectory
			}
			token, err = s.getToken(ctx, token)
			if err != nil {
				return nil, err
			}
			continue
		}
		if status < 200 || status >= 300 || response.Code != 200 {
			return nil, errDirectory
		}
		var data struct {
			Content []json.RawMessage `json:"content"`
		}
		if len(response.Data) == 0 || bytes.Equal(response.Data, []byte("null")) || json.Unmarshal(response.Data, &data) != nil {
			return nil, errResponse
		}
		return data.Content, nil
	}
	return nil, errDirectory
}

func (s *upstreamSession) listRoot(ctx context.Context, path string, remaining *atomic.Int64) ([]json.RawMessage, error) {
	folders := make([]json.RawMessage, 0)
	for page := 1; page <= maxPages; page++ {
		if ctx.Err() != nil {
			return nil, errCanceled
		}
		content, err := s.listPage(ctx, path, page)
		if err != nil {
			return nil, err
		}
		for _, raw := range content {
			var item struct {
				IsDir bool `json:"is_dir"`
			}
			if len(raw) == 0 || raw[0] != '{' || json.Unmarshal(raw, &item) != nil {
				return nil, errResponse
			}
			if !item.IsDir {
				continue
			}
			if !reserveBytes(remaining, int64(len(raw))) {
				return nil, errFolderLimit
			}
			folders = append(folders, raw)
		}
		// Match OpenListClient pagination: count all entries before filtering.
		if len(content) < pageSize {
			return folders, nil
		}
	}
	return nil, errPageLimit
}

func reserveBytes(remaining *atomic.Int64, size int64) bool {
	for {
		available := remaining.Load()
		if size > available {
			return false
		}
		if remaining.CompareAndSwap(available, available-size) {
			return true
		}
	}
}

func (s *upstreamSession) post(ctx context.Context, path, token string, input any) (int, []byte, error) {
	payload, err := json.Marshal(input)
	if err != nil {
		return 0, nil, errDirectory
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.base+path, bytes.NewReader(payload))
	if err != nil {
		return 0, nil, errDirectory
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if token != "" {
		req.Header.Set("Authorization", token)
	}
	response, err := s.client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return 0, nil, errCanceled
		}
		return 0, nil, errDirectory
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return response.StatusCode, nil, nil
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxUpstreamBytes+1))
	if err != nil {
		if ctx.Err() != nil {
			return 0, nil, errCanceled
		}
		return 0, nil, errDirectory
	}
	if len(body) > maxUpstreamBytes {
		return 0, nil, errResponseLimit
	}
	return response.StatusCode, body, nil
}
