package main

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// config is everything the engine reads from the environment, validated once at
// startup so a bad value fails the process instead of a request.
type config struct {
	// Port the HTTP server listens on. Internal-only: the container port is
	// never published to a host.
	Port int
	// SMTPEnabled is the process-level switch. A request asking for SMTP while
	// this is false gets attempted=false, disabled=true and no network probe.
	SMTPEnabled bool
	// SMTPHelloDomain is used in the EHLO command when SMTP probing runs.
	SMTPHelloDomain string
	// SMTPProbeFrom is used in MAIL FROM when SMTP probing runs. It is
	// configuration, not data: it must never be logged or echoed in responses.
	SMTPProbeFrom string
	// VerifyTimeout bounds one whole /verify request, DNS and SMTP included.
	VerifyTimeout time.Duration
}

const (
	defaultPort                 = 8080
	defaultVerifyTimeoutSeconds = 15
	// Defaults mirror the placeholders in .env.example; real deployments set
	// their own. These are not secrets.
	defaultHelloDomain = "localhost"
	defaultProbeFrom   = "postmaster@localhost"
)

func loadConfig(getenv func(string) string) (config, error) {
	cfg := config{
		Port:            defaultPort,
		SMTPEnabled:     false,
		SMTPHelloDomain: defaultHelloDomain,
		SMTPProbeFrom:   defaultProbeFrom,
		VerifyTimeout:   defaultVerifyTimeoutSeconds * time.Second,
	}

	if raw := getenv("ENGINE_PORT"); raw != "" {
		port, err := strconv.Atoi(raw)
		if err != nil || port < 1 || port > 65535 {
			return config{}, fmt.Errorf("ENGINE_PORT must be an integer between 1 and 65535, received %q", raw)
		}
		cfg.Port = port
	}

	if raw := getenv("SMTP_ENABLED"); raw != "" {
		enabled, err := strconv.ParseBool(raw)
		if err != nil {
			return config{}, fmt.Errorf("SMTP_ENABLED must be a boolean, received %q", raw)
		}
		cfg.SMTPEnabled = enabled
	}

	if raw := getenv("SMTP_HELO_DOMAIN"); raw != "" {
		cfg.SMTPHelloDomain = raw
	}
	if raw := getenv("SMTP_PROBE_FROM"); raw != "" {
		cfg.SMTPProbeFrom = raw
	}

	if raw := getenv("VERIFY_TIMEOUT_SECONDS"); raw != "" {
		seconds, err := strconv.Atoi(raw)
		if err != nil || seconds < 1 || seconds > 300 {
			return config{}, fmt.Errorf("VERIFY_TIMEOUT_SECONDS must be an integer between 1 and 300, received %q", raw)
		}
		cfg.VerifyTimeout = time.Duration(seconds) * time.Second
	}

	if cfg.SMTPEnabled {
		if cfg.SMTPHelloDomain == "" {
			return config{}, fmt.Errorf("SMTP_HELO_DOMAIN must be set when SMTP_ENABLED=true")
		}
		if cfg.SMTPProbeFrom == "" {
			return config{}, fmt.Errorf("SMTP_PROBE_FROM must be set when SMTP_ENABLED=true")
		}
	}

	return cfg, nil
}

func envOrDefault(key string) string { return os.Getenv(key) }
