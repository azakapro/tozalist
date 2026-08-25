package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// maxVerifyBodyBytes bounds the request body; a verify request is tiny.
const maxVerifyBodyBytes = 4 << 10

type server struct {
	cfg      config
	verifier verifier
	logger   *slog.Logger
	now      func() time.Time
}

func newServer(cfg config, v verifier, logger *slog.Logger) *server {
	return &server{cfg: cfg, verifier: v, logger: logger, now: time.Now}
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("POST /verify", s.handleVerify)
	return mux
}

func (s *server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *server) handleVerify(w http.ResponseWriter, r *http.Request) {
	req, err := decodeVerifyRequest(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.VerifyTimeout)
	defer cancel()

	resp := runVerify(ctx, s.verifier, s.cfg, req, s.now)

	attrs := emailLogAttrs(req.Email)
	attrs = append(attrs,
		slog.Bool("syntax_valid", resp.Syntax.Valid),
		slog.Int64("duration_ms", resp.DurationMS),
		slog.String("outcome", outcomeCategory(resp)),
	)
	s.logger.LogAttrs(r.Context(), slog.LevelInfo, "verify", attrs...)

	// Lookup problems are results, not server faults: always 200 here.
	writeJSON(w, http.StatusOK, resp)
}

// decodeVerifyRequest parses the body strictly: unknown fields, malformed JSON,
// trailing garbage and a missing email are all rejected with a clear message.
// The email travels only in the body - never in a URL, where it would end up in
// access logs and proxies.
func decodeVerifyRequest(r *http.Request) (verifyRequest, error) {
	if ct := r.Header.Get("Content-Type"); ct != "" && !strings.HasPrefix(ct, "application/json") {
		return verifyRequest{}, errors.New("Content-Type must be application/json")
	}

	decoder := json.NewDecoder(io.LimitReader(r.Body, maxVerifyBodyBytes))
	decoder.DisallowUnknownFields()

	var req verifyRequest
	if err := decoder.Decode(&req); err != nil {
		return verifyRequest{}, errors.New("invalid request body: " + sanitizeDecodeError(err))
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return verifyRequest{}, errors.New("invalid request body: unexpected trailing data")
	}
	if strings.TrimSpace(req.Email) == "" {
		return verifyRequest{}, errors.New("email is required")
	}
	return req, nil
}

// sanitizeDecodeError keeps decoder messages useful without ever echoing body
// content (which contains the email address) back through logs or proxies.
func sanitizeDecodeError(err error) string {
	var unmarshalErr *json.UnmarshalTypeError
	if errors.As(err, &unmarshalErr) {
		return "field " + unmarshalErr.Field + " has the wrong type"
	}

	message := err.Error()
	if strings.HasPrefix(message, "json: unknown field") {
		// Keep the field name: it is a JSON key, not body data.
		return strings.TrimPrefix(message, "json: ")
	}
	return "malformed JSON"
}

func outcomeCategory(resp verifyResponse) string {
	switch {
	case !resp.Syntax.Valid:
		return "syntax_invalid"
	case resp.MX.Error != "":
		return "mx_error"
	case resp.SMTP != nil && resp.SMTP.Error != "":
		return "smtp_error"
	default:
		return "ok"
	}
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
