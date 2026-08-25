package main

import (
	"strings"
	"testing"
	"time"
)

func envMap(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func TestLoadConfigDefaults(t *testing.T) {
	cfg, err := loadConfig(envMap(nil))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Port != 8080 {
		t.Errorf("port = %d, want 8080", cfg.Port)
	}
	if cfg.SMTPEnabled {
		t.Error("smtp enabled by default; must default to false")
	}
	if cfg.VerifyTimeout != 15*time.Second {
		t.Errorf("verify timeout = %s, want 15s", cfg.VerifyTimeout)
	}
}

func TestLoadConfigReadsEnvironment(t *testing.T) {
	cfg, err := loadConfig(envMap(map[string]string{
		"ENGINE_PORT":            "9090",
		"SMTP_ENABLED":           "true",
		"SMTP_HELO_DOMAIN":       "mail.tozalist.test",
		"SMTP_PROBE_FROM":        "postmaster@tozalist.test",
		"VERIFY_TIMEOUT_SECONDS": "30",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Port != 9090 || !cfg.SMTPEnabled || cfg.VerifyTimeout != 30*time.Second {
		t.Errorf("cfg = %+v", cfg)
	}
	if cfg.SMTPHelloDomain != "mail.tozalist.test" || cfg.SMTPProbeFrom != "postmaster@tozalist.test" {
		t.Errorf("smtp identity = %q / %q", cfg.SMTPHelloDomain, cfg.SMTPProbeFrom)
	}
}

func TestLoadConfigRejectsBadValues(t *testing.T) {
	cases := map[string]map[string]string{
		"port not a number":  {"ENGINE_PORT": "http"},
		"port out of range":  {"ENGINE_PORT": "70000"},
		"smtp not a boolean": {"SMTP_ENABLED": "maybe"},
		"timeout zero":       {"VERIFY_TIMEOUT_SECONDS": "0"},
		"timeout huge":       {"VERIFY_TIMEOUT_SECONDS": "9000"},
	}

	for name, env := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := loadConfig(envMap(env)); err == nil {
				t.Fatalf("loadConfig accepted %v", env)
			}
		})
	}
}

func TestLoadConfigErrorsNeverLeakValuesSilently(t *testing.T) {
	_, err := loadConfig(envMap(map[string]string{"ENGINE_PORT": "not-a-port"}))
	if err == nil || !strings.Contains(err.Error(), "ENGINE_PORT") {
		t.Fatalf("error %v should name the variable", err)
	}
}
