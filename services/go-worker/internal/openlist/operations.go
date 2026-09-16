package openlist

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"
)

// Operations exposes only the finite set of OpenList control operations used by
// the server client. It cannot forward a browser-selected URL or credentials.
func (h *Handler) Operations() http.Handler {
	permits := make(chan struct{}, h.concurrency)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w = &finiteResponseWriter{ResponseWriter: w}
		if r.Method != http.MethodPost {
			writeError(w, 405, "请求方法不支持")
			return
		}
		select {
		case permits <- struct{}{}:
			defer func() { <-permits }()
		default:
			writeError(w, 429, "OpenList 请求繁忙")
			return
		}
		var input struct {
			URL      string            `json:"url"`
			Username string            `json:"username"`
			Password string            `json:"password"`
			Path     string            `json:"path"`
			Method   string            `json:"method"`
			Body     string            `json:"body"`
			Headers  map[string]string `json:"headers"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&input) != nil {
			writeError(w, 400, "请求内容无效")
			return
		}
		var extra any
		if decoder.Decode(&extra) != io.EOF {
			writeError(w, 400, "请求内容无效")
			return
		}
		methods := map[string]string{
			"/api/fs/list": "POST", "/api/fs/get": "POST", "/api/fs/other": "POST",
			"/api/fs/remove": "POST", "/api/fs/put": "PUT", "/api/me": "GET",
			"/api/fs/add_offline_download": "POST",
		}
		if methods[input.Path] == "" || methods[input.Path] != input.Method {
			writeError(w, 400, "OpenList 操作无效")
			return
		}
		base, err := validateInput(rootsRequest{URL: input.URL, Username: input.Username, Password: input.Password, RootPaths: []string{"/"}})
		if err != nil {
			writeError(w, 400, "OpenList 配置无效")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
		defer cancel()
		session := newSession(h.client, base, input.Username, input.Password)
		token, err := session.getToken(ctx, "")
		if err != nil {
			writeError(w, 502, "OpenList 登录失败")
			return
		}
		for attempt := 0; attempt < 2; attempt++ {
			req, err := http.NewRequestWithContext(ctx, input.Method, session.base+input.Path, bytes.NewBufferString(input.Body))
			if err != nil {
				writeError(w, 400, "OpenList 请求无效")
				return
			}
			req.Header.Set("Content-Type", "application/json")
			for name, value := range input.Headers {
				switch http.CanonicalHeaderKey(name) {
				case "Content-Type", "File-Path", "As-Task":
					req.Header.Set(name, value)
				default:
					writeError(w, 400, "OpenList 请求头无效")
					return
				}
			}
			req.Header.Set("Authorization", token)
			res, err := session.client.Do(req)
			if err != nil {
				writeError(w, 502, "OpenList 请求失败")
				return
			}
			body, readErr := io.ReadAll(io.LimitReader(res.Body, (8<<20)+1))
			_ = res.Body.Close()
			if readErr != nil || len(body) > 8<<20 {
				writeError(w, 502, "OpenList 响应过大或读取失败")
				return
			}
			var envelope struct {
				Code int `json:"code"`
			}
			_ = json.Unmarshal(body, &envelope)
			if attempt == 0 && (res.StatusCode == 401 || (res.StatusCode >= 200 && res.StatusCode < 300 && envelope.Code == 401)) {
				token, err = session.getToken(ctx, token)
				if err != nil {
					writeError(w, 502, "OpenList 登录失败")
					return
				}
				continue
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(res.StatusCode)
			_, _ = w.Write(body)
			return
		}
	})
}
