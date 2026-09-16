package config

import (
	"encoding/json"
	"errors"
	"net"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	DownloadsEnabled      bool
	LocalFilesEnabled     bool
	NetdiskEnabled        bool
	TasksEnabled          bool
	AnimeDownloadsEnabled bool
	StateDir              string
	ListenAddr            string
	Token                 string
	DownloadDir           string
	ProxyURL              string
	AllowedOrigins        []string
	MaxDownloads          int
	SegmentConcurrency    int
	ScanConcurrency       int
}

func Load(getenv func(string) string) (Config, error) {
	cfg := Config{ListenAddr: "127.0.0.1:8081", Token: getenv("PURETV_GO_TOKEN"), DownloadDir: getenv("OFFLINE_DOWNLOAD_DIR"), ProxyURL: getenv("OFFLINE_DOWNLOAD_PROXY")}
	cfg.DownloadsEnabled = getenv("PURETV_GO_OFFLINE_DOWNLOADS") == "true"
	cfg.LocalFilesEnabled = getenv("PURETV_GO_LOCAL_FILES") == "true"
	cfg.NetdiskEnabled = getenv("PURETV_GO_NETDISK_CHECK") == "true"
	cfg.TasksEnabled = getenv("PURETV_GO_TASKS") == "true"
	cfg.AnimeDownloadsEnabled = getenv("PURETV_GO_ANIME_DOWNLOADS") == "true"
	cfg.StateDir = getenv("PURETV_GO_STATE_DIR")
	if cfg.StateDir == "" {
		cfg.StateDir = filepath.Join(".data", "worker")
	}
	var stateErr error
	cfg.StateDir, stateErr = filepath.Abs(cfg.StateDir)
	if stateErr != nil {
		return Config{}, errors.New("invalid worker state directory")
	}
	if len(cfg.Token) < 32 || strings.ContainsAny(cfg.Token, " \t\r\n") {
		return Config{}, errors.New("PURETV_GO_TOKEN must contain at least 32 characters without whitespace")
	}
	if value := getenv("PURETV_GO_LISTEN_ADDR"); value != "" {
		cfg.ListenAddr = value
	}
	_, port, err := net.SplitHostPort(cfg.ListenAddr)
	if err != nil {
		return Config{}, errors.New("PURETV_GO_LISTEN_ADDR must be host:port")
	}
	number, err := strconv.Atoi(port)
	if err != nil || number < 0 || number > 65535 {
		return Config{}, errors.New("invalid worker listen port")
	}
	if cfg.DownloadDir == "" {
		cfg.DownloadDir = filepath.Join(".data", "downloads")
	}
	cfg.DownloadDir, err = filepath.Abs(cfg.DownloadDir)
	if err != nil {
		return Config{}, errors.New("invalid download directory")
	}
	if value := getenv("PURETV_GO_ALLOWED_ORIGINS"); value != "" {
		if err = json.Unmarshal([]byte(value), &cfg.AllowedOrigins); err != nil {
			return Config{}, errors.New("PURETV_GO_ALLOWED_ORIGINS must be a JSON string array")
		}
	}
	cfg.MaxDownloads, err = positive(getenv("PURETV_GO_MAX_DOWNLOADS"), 2)
	if err != nil {
		return Config{}, err
	}
	cfg.SegmentConcurrency, err = positive(getenv("PURETV_GO_SEGMENT_CONCURRENCY"), 6)
	if err != nil {
		return Config{}, err
	}
	cfg.ScanConcurrency, err = positive(getenv("PURETV_GO_SCAN_CONCURRENCY"), 4)
	if err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func positive(value string, fallback int) (int, error) {
	if value == "" {
		return fallback, nil
	}
	number, err := strconv.Atoi(value)
	if err != nil || number < 1 || number > 16 {
		return 0, errors.New("worker concurrency must be an integer between 1 and 16")
	}
	return number, nil
}
