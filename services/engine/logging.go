package main

import (
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"strings"
)

// emailLogAttrs returns the only representation of an email address that may
// ever reach a log line: the domain in the clear (needed for operations) and a
// SHA-256 of the local part (needed for correlation). The full address, the raw
// local part, the SMTP probe-from value and configuration secrets must never be
// logged - the tests capture log output and enforce this.
func emailLogAttrs(email string) []slog.Attr {
	domain := ""
	local := email
	if at := strings.LastIndex(email, "@"); at >= 0 {
		local = email[:at]
		domain = email[at+1:]
	}

	digest := sha256.Sum256([]byte(local))
	return []slog.Attr{
		slog.String("domain", domain),
		slog.String("local_hash", hex.EncodeToString(digest[:])),
	}
}
