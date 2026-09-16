package httpapi

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type Options struct {
	Token     string
	Downloads http.Handler
	OpenList  http.Handler
	// Extra contains exact internal routes, all protected by the same token gate.
	Extra map[string]http.Handler
}

func NewRouter(options Options) (http.Handler, error) {
	if len(options.Token) < 32 || strings.TrimSpace(options.Token) != options.Token {
		return nil, errors.New("worker token must contain at least 32 characters and no surrounding whitespace")
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.URL.Path == "/healthz" || r.URL.Path == "/readyz" {
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				w.Header().Set("Allow", "GET, HEAD")
				jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			if r.Method == http.MethodGet {
				_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok", "service": "puretv-go-worker"})
			}
			return
		}
		values := r.Header.Values("Authorization")
		if len(values) != 1 || subtle.ConstantTimeCompare([]byte(values[0]), []byte("Bearer "+options.Token)) != 1 {
			jsonError(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		// The caller is Node after its existing session and feature/role checks.
		// Native handlers receive bounded request bodies, never browser credentials.
		r.Body = http.MaxBytesReader(w, r.Body, 1024*1024)
		switch r.URL.Path {
		case "/v1/offline-download":
			if options.Downloads != nil {
				options.Downloads.ServeHTTP(w, r)
				return
			}
		case "/v1/openlist/roots":
			if options.OpenList != nil {
				options.OpenList.ServeHTTP(w, r)
				return
			}
		default:
			if handler, ok := options.Extra[r.URL.Path]; ok {
				if handler == nil {
					jsonError(w, "Worker module unavailable", http.StatusServiceUnavailable)
				} else {
					handler.ServeHTTP(w, r)
				}
				return
			}
			jsonError(w, "Not found", http.StatusNotFound)
			return
		}
		jsonError(w, "Worker module unavailable", http.StatusServiceUnavailable)
	}), nil
}

func jsonError(w http.ResponseWriter, message string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
