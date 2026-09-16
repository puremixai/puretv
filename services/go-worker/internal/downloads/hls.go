package downloads

import (
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

type segment struct{ url, name string }
type playlist struct {
	segments []segment
	keyURL   string
	content  string
}

var attributes = regexp.MustCompile(`([A-Z0-9-]+)=("[^"]*"|[^,]*)`)
var keyURI = regexp.MustCompile(`URI="[^"]+"`)

func attrs(line string) map[string]string {
	result := make(map[string]string)
	for _, match := range attributes.FindAllStringSubmatch(line, -1) {
		result[match[1]] = strings.Trim(match[2], `"`)
	}
	return result
}

func validURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Hostname() != "" && u.User == nil
}

func resolveURL(raw, base string) (string, error) {
	b, err := url.Parse(base)
	if err != nil {
		return "", errors.New("无效的播放地址")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", errors.New("无效的播放地址")
	}
	result := b.ResolveReference(u).String()
	if !validURL(result) {
		return "", errors.New("不支持的播放地址协议")
	}
	return result, nil
}

func chooseVariant(content, base string) (string, error) {
	lines := strings.Split(content, "\n")
	type variant struct {
		url               string
		pixels, bandwidth int64
	}
	var best *variant
	for i, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "#EXT-X-MEDIA:") && attrs(line)["URI"] != "" {
			return "", errors.New("不支持独立音轨或字幕的 HLS 播放列表")
		}
		if !strings.HasPrefix(line, "#EXT-X-STREAM-INF:") {
			continue
		}
		if i+1 >= len(lines) || strings.HasPrefix(strings.TrimSpace(lines[i+1]), "#") || strings.TrimSpace(lines[i+1]) == "" {
			return "", errors.New("无效的 HLS 主播放列表")
		}
		fields := attrs(line)
		bandwidth, _ := strconv.ParseInt(fields["BANDWIDTH"], 10, 64)
		var width, height int64
		_, _ = fmt.Sscanf(fields["RESOLUTION"], "%dx%d", &width, &height)
		if width < 0 || height < 0 || width > 100000 || height > 100000 {
			return "", errors.New("无效的 HLS 分辨率")
		}
		u, err := resolveURL(strings.TrimSpace(lines[i+1]), base)
		if err != nil {
			return "", err
		}
		next := variant{url: u, pixels: width * height, bandwidth: bandwidth}
		if best == nil || next.pixels > best.pixels || (next.pixels == best.pixels && next.bandwidth > best.bandwidth) {
			copy := next
			best = &copy
		}
	}
	if best == nil {
		return "", errors.New("无效的 HLS 主播放列表")
	}
	return best.url, nil
}

func parsePlaylist(content, base string) (playlist, error) {
	var result playlist
	content = strings.TrimPrefix(content, "\ufeff")
	if !strings.HasPrefix(strings.TrimSpace(content), "#EXTM3U") {
		return result, errors.New("无效的 HLS 播放列表")
	}
	lines := strings.Split(content, "\n")
	var keyDefinition string
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(trimmed, "#EXT-X-MAP:"), strings.HasPrefix(trimmed, "#EXT-X-BYTERANGE:"), strings.HasPrefix(trimmed, "#EXT-X-STREAM-INF:"), strings.HasPrefix(trimmed, "#EXT-X-PART:"), strings.HasPrefix(trimmed, "#EXT-X-PRELOAD-HINT:"), strings.HasPrefix(trimmed, "#EXT-X-SESSION-KEY:"):
			return result, errors.New("不支持此 HLS 播放列表特性（MAP、BYTERANGE、多层或低延迟流）")
		case strings.HasPrefix(trimmed, "#EXT-X-MEDIA:"):
			if attrs(trimmed)["URI"] != "" {
				return result, errors.New("不支持独立音轨或字幕的 HLS 播放列表")
			}
		case strings.HasPrefix(trimmed, "#EXT-X-KEY:"):
			fields := attrs(trimmed)
			if fields["METHOD"] == "NONE" {
				continue
			}
			if fields["METHOD"] != "AES-128" || fields["URI"] == "" || (fields["KEYFORMAT"] != "" && fields["KEYFORMAT"] != "identity") {
				return result, errors.New("不支持此 HLS 加密方式")
			}
			if !keyURI.MatchString(line) {
				return result, errors.New("不支持未加引号的 HLS 密钥 URI")
			}
			u, err := resolveURL(fields["URI"], base)
			if err != nil {
				return result, err
			}
			// Multiple IVs and METHOD=NONE intervals can use the same key file.
			// A different key URI cannot be represented by the legacy layout.
			definition := u
			if keyDefinition != "" && definition != keyDefinition {
				return result, errors.New("不支持 HLS 密钥轮换")
			}
			keyDefinition = definition
			result.keyURL = u
			lines[i] = keyURI.ReplaceAllString(line, `URI="key.key"`)
		case trimmed != "" && !strings.HasPrefix(trimmed, "#"):
			u, err := resolveURL(trimmed, base)
			if err != nil {
				return result, err
			}
			name := fmt.Sprintf("segment_%05d.ts", len(result.segments))
			result.segments = append(result.segments, segment{url: u, name: name})
			lines[i] = line[:len(line)-len(strings.TrimLeft(line, " \t"))] + name
		}
	}
	if len(result.segments) == 0 {
		return result, errors.New("HLS 播放列表没有视频片段")
	}
	result.content = strings.Join(lines, "\n")
	return result, nil
}
