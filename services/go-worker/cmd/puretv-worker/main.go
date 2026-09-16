package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/puremixai/puretv/services/go-worker/internal/cms"
	"github.com/puremixai/puretv/services/go-worker/internal/config"
	"github.com/puremixai/puretv/services/go-worker/internal/downloads"
	"github.com/puremixai/puretv/services/go-worker/internal/httpapi"
	"github.com/puremixai/puretv/services/go-worker/internal/jobs"
	"github.com/puremixai/puretv/services/go-worker/internal/localfiles"
	"github.com/puremixai/puretv/services/go-worker/internal/mediafetch"
	"github.com/puremixai/puretv/services/go-worker/internal/netdisk"
	"github.com/puremixai/puretv/services/go-worker/internal/openlist"
	"github.com/puremixai/puretv/services/go-worker/internal/outbound"
	"github.com/puremixai/puretv/services/go-worker/internal/receipts"
)

func main() {
	healthcheck := flag.Bool("healthcheck", false, "Check the running worker readiness and exit")
	flag.Parse()
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := run(*healthcheck); err != nil {
		// Transport errors may contain upstream URLs. Startup errors are deliberately generic.
		slog.Error("worker stopped", "reason", err.Error())
		os.Exit(1)
	}
}

func run(healthcheck bool) error {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}
	if healthcheck {
		host, port, _ := net.SplitHostPort(cfg.ListenAddr)
		if host == "" || host == "0.0.0.0" || host == "::" {
			host = "127.0.0.1"
		}
		client := http.Client{Timeout: 5 * time.Second}
		response, err := client.Get("http://" + net.JoinHostPort(host, port) + "/readyz")
		if err != nil {
			return errors.New("worker readiness unavailable")
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return errors.New("worker is not ready")
		}
		return nil
	}
	scanClient, err := outbound.NewClient(outbound.Options{AllowedOrigins: cfg.AllowedOrigins, Timeout: 30 * time.Second})
	if err != nil {
		return errors.New("invalid worker outbound configuration")
	}
	var downloadHandler http.Handler
	closeDownloads := func(context.Context) error { return nil }
	if cfg.DownloadsEnabled {
		downloadClient, err := outbound.NewClient(outbound.Options{AllowedOrigins: cfg.AllowedOrigins, ProxyURL: cfg.ProxyURL, Timeout: 30 * time.Second})
		if err != nil {
			return errors.New("invalid worker outbound configuration")
		}
		manager, err := downloads.New(downloads.Options{Root: cfg.DownloadDir, Concurrency: cfg.MaxDownloads, SegmentConcurrency: cfg.SegmentConcurrency, Client: downloadClient})
		if err != nil {
			return errors.New("download storage could not be opened; check the volume and worker lock")
		}
		downloadHandler = manager
		closeDownloads = manager.Close
	}
	scanner, err := openlist.New(openlist.Options{Client: scanClient, Concurrency: cfg.ScanConcurrency})
	if err != nil {
		_ = closeDownloads(context.Background())
		return errors.New("scanner configuration is invalid")
	}
	extra := map[string]http.Handler{"/v1/local-files": nil, "/v1/jobs": nil,
		"/v1/netdisk/check/start": nil, "/v1/netdisk/check/task": nil, "/v1/netdisk/check/cancel": nil,
		"/v1/openlist/operations": scanner.Operations()}
	if cfg.LocalFilesEnabled {
		extra["/v1/local-files"] = localfiles.New(cfg.DownloadDir)
	}
	// Danmaku historically permits two minutes for headers/body. Each other
	// media operation still applies its shorter total request context deadline.
	mediaClient, err := outbound.NewClient(outbound.Options{AllowedOrigins: cfg.AllowedOrigins, Timeout: 120 * time.Second})
	if err != nil {
		_ = closeDownloads(context.Background())
		return errors.New("invalid media outbound configuration")
	}
	media := mediafetch.New(mediaClient, cfg.AllowedOrigins)
	extra["/v1/anime/download"] = nil
	extra["/v1/anime/receipts/resolve"] = nil
	closeReceipts := func(context.Context) error { return nil }
	if cfg.AnimeDownloadsEnabled {
		manager, openErr := receipts.New(receipts.Options{StateDir: cfg.StateDir, Handler: scanner.Operations()})
		if openErr != nil {
			_ = closeDownloads(context.Background())
			return errors.New("download receipt storage could not be opened")
		}
		extra["/v1/anime/download"] = manager
		extra["/v1/anime/receipts/resolve"] = manager
		closeReceipts = manager.Close
		defer func() { _ = closeReceipts(context.Background()) }()
	}
	extra["/v1/cms"] = cms.New(scanClient)
	for _, path := range []string{"/v1/live/precheck", "/v1/live/epg", "/v1/live/epg/download", "/v1/danmaku/comment", "/v1/metadata/fetch", "/v1/subscriptions/fetch"} {
		extra[path] = media
	}
	closeNetdisk := func(context.Context) error { return nil }
	if cfg.NetdiskEnabled {
		manager, openErr := netdisk.New(netdisk.Options{StateDir: cfg.StateDir, Client: scanClient})
		if openErr != nil {
			_ = closeDownloads(context.Background())
			return errors.New("netdisk storage could not be opened")
		}
		closeNetdisk = manager.Close
		defer func() { _ = closeNetdisk(context.Background()) }()
		for _, path := range []string{"/v1/netdisk/check/start", "/v1/netdisk/check/task", "/v1/netdisk/check/cancel"} {
			extra[path] = manager
		}
	}
	if cfg.TasksEnabled {
		manager, openErr := jobs.New(cfg.StateDir)
		if openErr != nil {
			_ = closeDownloads(context.Background())
			return errors.New("job storage could not be opened")
		}
		defer manager.Close()
		extra["/v1/jobs"] = manager
	}
	router, err := httpapi.NewRouter(httpapi.Options{Token: cfg.Token, Downloads: downloadHandler, OpenList: scanner, Extra: extra})
	if err != nil {
		_ = closeDownloads(context.Background())
		return err
	}
	listener, err := net.Listen("tcp", cfg.ListenAddr)
	if err != nil {
		_ = closeDownloads(context.Background())
		return errors.New("worker could not bind its listener")
	}
	server := &http.Server{Handler: router, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 * 1024}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	server.BaseContext = func(net.Listener) context.Context { return ctx }
	stopped := make(chan error, 1)
	go func() { stopped <- server.Serve(listener) }()
	slog.Info("worker listening", "address", listener.Addr().String())
	select {
	case <-ctx.Done():
	case err = <-stopped:
		if !errors.Is(err, http.ErrServerClosed) {
			_ = closeDownloads(context.Background())
			return errors.New("worker HTTP server failed")
		}
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	// Stop accepting new work, cancel active downloads, then drain HTTP requests.
	_ = listener.Close()
	closeErr := closeDownloads(shutdownCtx)
	netdiskErr := closeNetdisk(shutdownCtx)
	receiptsErr := closeReceipts(shutdownCtx)
	serverErr := server.Shutdown(shutdownCtx)
	if closeErr != nil || netdiskErr != nil || receiptsErr != nil || serverErr != nil {
		return errors.New("worker shutdown did not finish within its deadline")
	}
	return nil
}
