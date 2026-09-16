// Package openlist enumerates root directories without resolving media metadata.
package openlist

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	maxRequestBytes = 64 << 10
	maxRoots        = 64
	maxPathBytes    = 4096
	maxConcurrency  = 16
	maxPages        = 1000
	pageSize        = 100
	maxFolderBytes  = 16 << 20
	maxScanDuration = 5 * time.Minute
)

type Options struct {
	// Client must provide the application's outbound network restrictions.
	Client *http.Client
	// Concurrency bounds simultaneous root enumeration; zero selects four workers.
	Concurrency int
}

type Handler struct {
	client      *http.Client
	concurrency int
	active      atomic.Bool
}

func New(options Options) (*Handler, error) {
	if options.Client == nil {
		return nil, errors.New("OpenList requires an outbound HTTP client")
	}
	if options.Concurrency < 0 || options.Concurrency > maxConcurrency {
		return nil, errors.New("OpenList concurrency must be between 1 and 16")
	}
	if options.Concurrency == 0 {
		options.Concurrency = 4
	}
	client := *options.Client
	return &Handler{client: &client, concurrency: options.Concurrency}, nil
}

type rootsRequest struct {
	URL       string   `json:"url"`
	Username  string   `json:"username"`
	Password  string   `json:"password"`
	RootPaths []string `json:"rootPaths"`
}

type rootGroup struct {
	RootPath string `json:"rootPath"`
	// RawMessage preserves upstream extensions and integers larger than 2^53.
	Folders []json.RawMessage `json:"folders"`
}

type rootError struct {
	RootPath string `json:"rootPath"`
	Error    string `json:"error"`
}

type rootResult struct {
	folders []json.RawMessage
	err     error
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/v1/openlist/roots" {
		writeError(w, http.StatusNotFound, "接口不存在")
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeError(w, http.StatusMethodNotAllowed, "请求方法不支持")
		return
	}
	if contentType := r.Header.Get("Content-Type"); contentType != "" {
		mediaType, _, err := mime.ParseMediaType(contentType)
		if err != nil || mediaType != "application/json" {
			writeError(w, http.StatusUnsupportedMediaType, "请求必须是 JSON")
			return
		}
	}
	// One scan owns this handler's workers and result budget. Reject additional
	// requests before reading their bodies instead of building an unbounded queue.
	if !h.active.CompareAndSwap(false, true) {
		writeError(w, http.StatusTooManyRequests, "已有 OpenList 扫描正在进行，请稍后重试")
		return
	}
	defer h.active.Store(false)
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var input rootsRequest
	err := decoder.Decode(&input)
	if err == nil {
		var extra any
		if trailing := decoder.Decode(&extra); trailing != io.EOF {
			if trailing == nil {
				trailing = errors.New("extra JSON value")
			}
			err = trailing
		}
	}
	if err != nil {
		var sizeError *http.MaxBytesError
		if errors.As(err, &sizeError) {
			writeError(w, http.StatusRequestEntityTooLarge, "请求内容过大")
		} else {
			writeError(w, http.StatusBadRequest, "请求内容无效")
		}
		return
	}
	base, err := validateInput(input)
	if err != nil {
		writeError(w, http.StatusBadRequest, "OpenList 配置无效")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), maxScanDuration)
	defer cancel()
	session := newSession(h.client, base, input.Username, input.Password)
	results := make([]rootResult, len(input.RootPaths))
	jobs := make(chan int, len(results))
	for index := range results {
		jobs <- index
	}
	close(jobs)
	var remaining atomic.Int64
	remaining.Store(maxFolderBytes)
	var workers sync.WaitGroup
	for i := 0; i < min(h.concurrency, len(results)); i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for index := range jobs {
				folders, err := session.listRoot(ctx, input.RootPaths[index], &remaining)
				results[index] = rootResult{folders: folders, err: err}
			}
		}()
	}
	workers.Wait()

	response := struct {
		Groups []rootGroup `json:"groups"`
		Errors []rootError `json:"errors"`
	}{Groups: make([]rootGroup, 0, len(results)), Errors: make([]rootError, 0)}
	for index, result := range results {
		if result.err != nil {
			response.Errors = append(response.Errors, rootError{RootPath: input.RootPaths[index], Error: result.err.Error()})
		} else {
			response.Groups = append(response.Groups, rootGroup{RootPath: input.RootPaths[index], Folders: result.folders})
		}
	}
	if len(response.Groups) == 0 {
		writeError(w, http.StatusBadGateway, "所有根目录列举失败")
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func validateInput(input rootsRequest) (*url.URL, error) {
	base, err := url.Parse(strings.TrimRight(strings.TrimSpace(input.URL), "/"))
	if err != nil {
		return nil, err
	}
	if (base.Scheme != "http" && base.Scheme != "https") || base.Hostname() == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" || base.Opaque != "" {
		return nil, errors.New("invalid base URL")
	}
	if input.Username == "" || input.Password == "" || len(input.RootPaths) == 0 || len(input.RootPaths) > maxRoots {
		return nil, errors.New("invalid credentials or roots")
	}
	for _, path := range input.RootPaths {
		if strings.TrimSpace(path) == "" || len(path) > maxPathBytes {
			return nil, errors.New("invalid root path")
		}
	}
	return base, nil
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, struct {
		Error string `json:"error"`
	}{Error: message})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	encoder := json.NewEncoder(w)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(value)
}
