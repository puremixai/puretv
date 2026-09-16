package config

import (
	"strings"
	"testing"
)

func TestLoadRequiresTokenAndValidConfiguration(t *testing.T) {
	get := func(values map[string]string) func(string) string {
		return func(key string) string { return values[key] }
	}
	if _, err := Load(get(nil)); err == nil {
		t.Fatal("accepted missing authentication")
	}
	for _, values := range []map[string]string{
		{"PURETV_GO_TOKEN": "short"},
		{"PURETV_GO_TOKEN": strings.Repeat("s", 32), "PURETV_GO_MAX_DOWNLOADS": "0"},
		{"PURETV_GO_TOKEN": strings.Repeat("s", 32), "PURETV_GO_ALLOWED_ORIGINS": "not-json"},
		{"PURETV_GO_TOKEN": strings.Repeat("s", 32), "PURETV_GO_LISTEN_ADDR": "not-a-listener"},
	} {
		if _, err := Load(get(values)); err == nil {
			t.Fatal("accepted invalid config")
		}
	}
	cfg, err := Load(get(map[string]string{"PURETV_GO_TOKEN": strings.Repeat("s", 32)}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ListenAddr != "127.0.0.1:8081" || cfg.MaxDownloads != 2 || cfg.SegmentConcurrency != 6 || cfg.ScanConcurrency != 4 {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}
}

func TestLoadUsesExplicitLegacyDownloadDirectory(t *testing.T) {
	root := t.TempDir()
	cfg, err := Load(func(key string) string {
		return map[string]string{
			"PURETV_GO_TOKEN": strings.Repeat("s", 32), "OFFLINE_DOWNLOAD_DIR": root, "OFFLINE_DOWNLOAD_PROXY": "http://proxy.example:8080",
			"PURETV_GO_ALLOWED_ORIGINS": `["http://openlist:5244"]`, "PURETV_GO_MAX_DOWNLOADS": "3",
		}[key]
	})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DownloadDir != root || cfg.ProxyURL != "http://proxy.example:8080" || cfg.MaxDownloads != 3 || len(cfg.AllowedOrigins) != 1 {
		t.Fatal("lost explicit config")
	}
}

func TestDownloadsRequireExplicitEnable(t *testing.T) {
	for _, value := range []string{"", "false", "TRUE", "true"} {
		cfg, err := Load(func(key string) string {
			return map[string]string{"PURETV_GO_TOKEN": strings.Repeat("s", 32), "PURETV_GO_OFFLINE_DOWNLOADS": value}[key]
		})
		if err != nil || cfg.DownloadsEnabled != (value == "true") {
			t.Fatalf("download opt-in %q: enabled=%v error=%v", value, cfg.DownloadsEnabled, err)
		}
	}
}
