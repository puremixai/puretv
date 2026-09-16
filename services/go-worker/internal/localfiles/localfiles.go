// Package localfiles serves downloaded media through an authenticated internal route.
package localfiles

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"regexp"
	"strconv"
	"strings"
)

const maxPlaylist = 8 << 20

var uriAttribute = regexp.MustCompile(`URI="([^"]*)"`)

func validPart(s string) bool {
	return len(s) <= 512 && s != "" && s != "." && s != ".." && !strings.ContainsAny(s, "/\\:\x00")
}

func validFile(s string) bool {
	if len(s) > 4096 {
		return false
	}
	for _, p := range strings.Split(s, "/") {
		if !validPart(p) {
			return false
		}
	}
	return true
}

// New opens the configured root on each request so downloads may be enabled before it exists.
func New(directory string) http.Handler {
	playlists := make(chan struct{}, 4)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		q := r.URL.Query()
		source, video, episode, file := q.Get("source"), q.Get("videoId"), q.Get("episodeIndex"), q.Get("file")
		index, err := strconv.ParseUint(episode, 10, 31)
		if err != nil || !validPart(source) || !validPart(video) || !validFile(file) || (q.Get("format") != "query" && q.Get("format") != "path") {
			http.Error(w, "invalid local file path", http.StatusBadRequest)
			return
		}
		root, err := os.OpenRoot(directory)
		if err != nil {
			http.Error(w, "download directory unavailable", http.StatusNotFound)
			return
		}
		defer root.Close()
		// An episode root also prevents symlinks from crossing into another download.
		ep, err := root.OpenRoot(source + "/" + video + "/ep" + strconv.FormatUint(index+1, 10))
		if err != nil {
			http.Error(w, "file not found", http.StatusNotFound)
			return
		}
		defer ep.Close()
		before, err := ep.Lstat(file)
		if err != nil || !before.Mode().IsRegular() {
			http.Error(w, "file not found", http.StatusNotFound)
			return
		}
		f, err := openFile(ep, file)
		if err != nil {
			http.Error(w, "file not found", http.StatusNotFound)
			return
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil || !info.Mode().IsRegular() {
			http.Error(w, "file not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Cache-Control", "private, no-cache")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if strings.EqualFold(path.Ext(file), ".m3u8") {
			select {
			case playlists <- struct{}{}:
				defer func() { <-playlists }()
			default:
				http.Error(w, "playlist service busy", http.StatusTooManyRequests)
				return
			}
			b, err := io.ReadAll(io.LimitReader(f, maxPlaylist+1))
			if err != nil || len(b) > maxPlaylist {
				http.Error(w, "playlist too large or unreadable", http.StatusUnprocessableEntity)
				return
			}
			content, err := rewrite(string(b), q)
			if err != nil {
				http.Error(w, "playlist expansion limit exceeded", http.StatusUnprocessableEntity)
				return
			}
			w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
			http.ServeContent(w, r, file, info.ModTime(), bytes.NewReader([]byte(content)))
			return
		}
		contentType := "application/octet-stream"
		switch strings.ToLower(path.Ext(file)) {
		case ".ts":
			contentType = "video/mp2t"
		case ".mp4", ".m4s":
			contentType = "video/mp4"
		case ".vtt":
			contentType = "text/vtt"
		}
		w.Header().Set("Content-Type", contentType)
		http.ServeContent(w, r, file, info.ModTime(), f)
	})
}

func rewrite(content string, q url.Values) (string, error) {
	count, expanded := 0, 0
	failed := false
	convert := func(raw string) string {
		count++
		if count > 100000 || expanded > maxPlaylist {
			failed = true
			return ""
		}
		u, err := url.Parse(raw)
		if err != nil || u.IsAbs() || u.Host != "" || strings.HasPrefix(u.Path, "/") {
			return raw
		}
		file := path.Join(path.Dir(q.Get("file")), u.Path)
		if !validFile(file) {
			return raw
		}
		if q.Get("format") == "path" {
			parts := []string{q.Get("source"), q.Get("videoId"), q.Get("episodeIndex")}
			parts = append(parts, strings.Split(file, "/")...)
			for i := range parts {
				parts[i] = url.PathEscape(parts[i])
			}
			out := "/api/offline-download/local/" + strings.Join(parts, "/")
			if u.RawQuery != "" {
				out += "?" + u.RawQuery
			}
			if u.Fragment != "" {
				out += "#" + u.EscapedFragment()
			}
			expanded += len(out)
			return out
		}
		out := u.Query()
		out.Set("source", q.Get("source"))
		out.Set("videoId", q.Get("videoId"))
		out.Set("episodeIndex", q.Get("episodeIndex"))
		out.Set("file", file)
		result := "/api/offline-download/local?" + out.Encode()
		if u.Fragment != "" {
			result += "#" + u.EscapedFragment()
		}
		expanded += len(result)
		return result
	}
	var output strings.Builder
	for {
		line, rest, more := strings.Cut(content, "\n")
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "#") {
			line = uriAttribute.ReplaceAllStringFunc(line, func(attr string) string { return `URI="` + convert(attr[5:len(attr)-1]) + `"` })
		} else if t != "" {
			line = convert(t)
		}
		if failed || output.Len()+len(line)+1 > maxPlaylist {
			return "", errors.New("playlist expansion limit")
		}
		output.WriteString(line)
		if !more {
			break
		}
		output.WriteByte('\n')
		content = rest
	}
	return output.String(), nil
}
