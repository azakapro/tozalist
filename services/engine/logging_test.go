package main

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
	"time"
)

// --- 8. the full input email never appears in logs ---

func TestLogsNeverContainTheEmailAddress(t *testing.T) {
	const email = "very.secret.person@example.test"
	const localPart = "very.secret.person"

	cfg := testConfig()
	cfg.SMTPEnabled = true
	stub := &stubVerifier{
		mxResult:   mxRecords("mx.example.test."),
		smtpResult: &emailverifierSMTP,
	}
	s, logs := newTestServer(t, cfg, stub)

	postVerify(t, s, `{"email":"`+email+`","smtp":true,"catch_all":false}`)

	output := logs.String()
	if output == "" {
		t.Fatal("no log output captured")
	}
	if strings.Contains(output, email) {
		t.Fatalf("log output contains the full email address:\n%s", output)
	}
	if strings.Contains(output, localPart) {
		t.Fatalf("log output contains the raw local part:\n%s", output)
	}
	if strings.Contains(output, cfg.SMTPProbeFrom) {
		t.Fatalf("log output contains the SMTP probe-from value:\n%s", output)
	}

	// What the logs must contain instead: the domain and the local-part hash.
	if !strings.Contains(output, `"domain":"example.test"`) {
		t.Errorf("log output is missing the domain:\n%s", output)
	}
	digest := sha256.Sum256([]byte(localPart))
	if !strings.Contains(output, hex.EncodeToString(digest[:])) {
		t.Errorf("log output is missing the local-part hash:\n%s", output)
	}
}

func TestLogsStayCleanOnErrorPaths(t *testing.T) {
	const email = "still.secret@broken.test"

	cases := map[string]*stubVerifier{
		"dns failure": {mxErr: errTestDNS},
		"slow lookup": {mxDelay: 5 * time.Second},
	}

	for name, stub := range cases {
		t.Run(name, func(t *testing.T) {
			cfg := testConfig()
			cfg.VerifyTimeout = 50 * time.Millisecond
			s, logs := newTestServer(t, cfg, stub)

			postVerify(t, s, `{"email":"`+email+`"}`)

			if strings.Contains(logs.String(), email) {
				t.Fatalf("log output contains the email on the %s path:\n%s", name, logs.String())
			}
			if strings.Contains(logs.String(), "still.secret") {
				t.Fatalf("log output contains the local part on the %s path:\n%s", name, logs.String())
			}
		})
	}
}
