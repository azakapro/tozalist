// Command engine is the internal email-validation sidecar for TozaList.
//
// TRUST BOUNDARY: this process is internal-only. It is never published to the
// host and must never be reachable from the public internet. Only the API and
// worker, from inside the private network, may call it. See
// docs/architecture.md and README.md.
//
// Scope note (step 1.1): email verification only - syntax, MX, disposable,
// role-account and free-provider checks, plus an SMTP probe that is off by
// default. No phone logic, no enrichment, no external data providers.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	cfg, err := loadConfig(envOrDefault)
	if err != nil {
		logger.Error("invalid configuration", slog.String("error", err.Error()))
		os.Exit(1)
	}

	srv := newServer(cfg, newAftershipVerifier(cfg), logger)

	httpServer := &http.Server{
		Addr:    fmt.Sprintf(":%d", cfg.Port),
		Handler: srv.routes(),
		// The verify deadline bounds request work; these bound slow clients.
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      cfg.VerifyTimeout + 5*time.Second,
		IdleTimeout:       60 * time.Second,
	}

	shutdownCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		<-shutdownCtx.Done()
		graceCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(graceCtx)
	}()

	logger.Info("engine ready",
		slog.Int("port", cfg.Port),
		slog.Bool("smtp_enabled", cfg.SMTPEnabled),
		slog.String("verify_timeout", cfg.VerifyTimeout.String()),
	)

	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("server failed", slog.String("error", err.Error()))
		os.Exit(1)
	}

	logger.Info("engine shut down")
}
