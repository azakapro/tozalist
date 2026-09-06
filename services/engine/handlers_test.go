package main

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func testConfig() config {
	return config{
		Port:            8080,
		SMTPEnabled:     false,
		SMTPHelloDomain: "helo.test",
		SMTPProbeFrom:   "probe-from-secret@helo.test",
		VerifyTimeout:   2 * time.Second,
	}
}

// newTestServer wires a server around a stub and captures its log output.
func newTestServer(t *testing.T, cfg config, stub *stubVerifier) (*server, *bytes.Buffer) {
	t.Helper()
	logs := &bytes.Buffer{}
	logger := slog.New(slog.NewJSONHandler(logs, nil))
	return newServer(cfg, stub, logger), logs
}

func postVerify(t *testing.T, s *server, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/verify", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	s.routes().ServeHTTP(recorder, req)
	return recorder
}

func decodeResponse(t *testing.T, recorder *httptest.ResponseRecorder) verifyResponse {
	t.Helper()
	var resp verifyResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &resp); err != nil {
		t.Fatalf("response is not valid JSON: %v\nbody: %s", err, recorder.Body.String())
	}
	return resp
}

// --- 1. health endpoint ---

func TestHealthReturnsExactBody(t *testing.T) {
	s, _ := newTestServer(t, testConfig(), &stubVerifier{})

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	recorder := httptest.NewRecorder()
	s.routes().ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	if got := strings.TrimSpace(recorder.Body.String()); got != `{"status":"ok"}` {
		t.Fatalf("body = %q, want {\"status\":\"ok\"}", got)
	}
}

// --- 2. successful mapping ---

func TestVerifyMapsAllSignals(t *testing.T) {
	stub := &stubVerifier{
		freeDomains:  map[string]bool{"gmail.test": true},
		roleAccounts: map[string]bool{"support": true},
		disposable:   map[string]bool{},
		mxResult:     mxRecords("mx1.gmail.test.", "mx2.gmail.test."),
	}
	s, _ := newTestServer(t, testConfig(), stub)

	recorder := postVerify(t, s, `{"email":"support@gmail.test","smtp":false,"catch_all":false}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body %s", recorder.Code, recorder.Body.String())
	}
	resp := decodeResponse(t, recorder)

	if resp.Email != "support@gmail.test" {
		t.Errorf("email = %q", resp.Email)
	}
	if !resp.Syntax.Valid || resp.Syntax.Username != "support" || resp.Syntax.Domain != "gmail.test" {
		t.Errorf("syntax = %+v", resp.Syntax)
	}
	if resp.MX.HasMX == nil || !*resp.MX.HasMX {
		t.Errorf("has_mx = %v, want true", resp.MX.HasMX)
	}
	if len(resp.MX.Records) != 2 || resp.MX.Records[0] != "mx1.gmail.test." {
		t.Errorf("records = %v", resp.MX.Records)
	}
	if resp.MX.Error != "" {
		t.Errorf("mx.error = %q, want empty", resp.MX.Error)
	}
	if !resp.FreeProvider || !resp.RoleAccount || resp.Disposable {
		t.Errorf("flags = free %v role %v disposable %v", resp.FreeProvider, resp.RoleAccount, resp.Disposable)
	}
	if resp.SMTP != nil {
		t.Errorf("smtp = %+v, want null when request smtp=false", resp.SMTP)
	}
	if resp.DurationMS < 0 {
		t.Errorf("duration_ms = %d", resp.DurationMS)
	}
}

func TestVerifyFlagsDisposableDomain(t *testing.T) {
	stub := &stubVerifier{
		disposable: map[string]bool{"mailinator.test": true},
		mxResult:   mxRecords("mx.mailinator.test."),
	}
	s, _ := newTestServer(t, testConfig(), stub)

	resp := decodeResponse(t, postVerify(t, s, `{"email":"x@mailinator.test"}`))
	if !resp.Disposable {
		t.Error("disposable = false, want true")
	}
}

// --- 3. syntax failure ---

func TestVerifySyntaxFailureSkipsLookups(t *testing.T) {
	stub := &stubVerifier{}
	s, _ := newTestServer(t, testConfig(), stub)

	recorder := postVerify(t, s, `{"email":"not-an-email","smtp":false,"catch_all":false}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	resp := decodeResponse(t, recorder)

	if resp.Syntax.Valid {
		t.Error("syntax.valid = true, want false")
	}
	if stub.mxCalls != 0 || stub.smtpCalls != 0 {
		t.Errorf("lookups ran for invalid syntax: mx=%d smtp=%d", stub.mxCalls, stub.smtpCalls)
	}
	if resp.SMTP != nil {
		t.Errorf("smtp = %+v, want null", resp.SMTP)
	}
}

// --- 4. SMTP disabled by policy ---

func TestVerifySMTPDisabledByPolicy(t *testing.T) {
	cfg := testConfig()
	cfg.SMTPEnabled = false
	stub := &stubVerifier{mxResult: mxRecords("mx.example.test.")}
	s, _ := newTestServer(t, cfg, stub)

	resp := decodeResponse(t, postVerify(t, s, `{"email":"a@example.test","smtp":true,"catch_all":true}`))

	if resp.SMTP == nil {
		t.Fatal("smtp = null, want an object when the request asked for smtp")
	}
	if resp.SMTP.Attempted {
		t.Error("attempted = true, want false")
	}
	if !resp.SMTP.Disabled {
		t.Error("disabled = false, want true")
	}
	if stub.smtpCalls != 0 {
		t.Errorf("smtp probe ran %d times despite SMTP_ENABLED=false", stub.smtpCalls)
	}
}

// --- 5. catch-all disabled unless requested ---

func TestVerifyCatchAllOnlyWhenRequested(t *testing.T) {
	cfg := testConfig()
	cfg.SMTPEnabled = true

	for _, catchAll := range []bool{false, true} {
		stub := &stubVerifier{
			mxResult:   mxRecords("mx.example.test."),
			smtpResult: &emailverifierSMTP,
		}
		s, _ := newTestServer(t, cfg, stub)

		body := `{"email":"a@example.test","smtp":true,"catch_all":` + boolString(catchAll) + `}`
		resp := decodeResponse(t, postVerify(t, s, body))

		if stub.smtpCalls != 1 {
			t.Fatalf("smtp calls = %d, want 1", stub.smtpCalls)
		}
		if stub.lastCatchAll != catchAll {
			t.Errorf("catch-all probing = %v, want %v", stub.lastCatchAll, catchAll)
		}
		if resp.SMTP == nil || !resp.SMTP.Attempted {
			t.Errorf("smtp = %+v, want attempted=true", resp.SMTP)
		}
	}
}

// --- 6. timeout: HTTP 200 with partial data ---

func TestVerifyTimeoutReturnsPartialData(t *testing.T) {
	cfg := testConfig()
	cfg.VerifyTimeout = 50 * time.Millisecond
	stub := &stubVerifier{
		freeDomains: map[string]bool{"slow.test": true},
		mxDelay:     5 * time.Second,
	}
	s, _ := newTestServer(t, cfg, stub)

	started := time.Now()
	recorder := postVerify(t, s, `{"email":"a@slow.test","smtp":false,"catch_all":false}`)
	elapsed := time.Since(started)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 even on timeout", recorder.Code)
	}
	if elapsed > 2*time.Second {
		t.Fatalf("request took %s; the deadline did not cut the lookup short", elapsed)
	}

	resp := decodeResponse(t, recorder)
	if !resp.Syntax.Valid || !resp.FreeProvider {
		t.Errorf("partial results missing: syntax=%+v free=%v", resp.Syntax, resp.FreeProvider)
	}
	if resp.MX.Error == "" || !strings.Contains(resp.MX.Error, "timeout") {
		t.Errorf("mx.error = %q, want a timeout description", resp.MX.Error)
	}
	if resp.MX.HasMX != nil {
		t.Errorf("has_mx = %v, want null on timeout", *resp.MX.HasMX)
	}
}

// --- 7. DNS failure populates mx.error, has_mx stays unknown ---

func TestVerifyDNSFailureIsNotNoMX(t *testing.T) {
	stub := &stubVerifier{mxErr: errTestDNS}
	s, _ := newTestServer(t, testConfig(), stub)

	recorder := postVerify(t, s, `{"email":"a@broken.test"}`)
	resp := decodeResponse(t, recorder)

	if resp.MX.Error == "" {
		t.Fatal("mx.error is empty for a DNS failure")
	}
	if resp.MX.HasMX != nil {
		t.Fatalf("has_mx = %v; a DNS failure must not claim a has_mx verdict", *resp.MX.HasMX)
	}

	// The raw JSON must still carry the field, as null.
	var rawResponse map[string]json.RawMessage
	if err := json.Unmarshal(recorder.Body.Bytes(), &rawResponse); err != nil {
		t.Fatal(err)
	}
	var rawMX map[string]json.RawMessage
	if err := json.Unmarshal(rawResponse["mx"], &rawMX); err != nil {
		t.Fatal(err)
	}
	if string(rawMX["has_mx"]) != "null" {
		t.Errorf("has_mx JSON = %s, want null", rawMX["has_mx"])
	}
}

func TestVerifyNoMXRecordsIsAnHonestFalse(t *testing.T) {
	stub := &stubVerifier{mxResult: mxRecords()}
	s, _ := newTestServer(t, testConfig(), stub)

	resp := decodeResponse(t, postVerify(t, s, `{"email":"a@nomx.test"}`))
	if resp.MX.HasMX == nil || *resp.MX.HasMX {
		t.Errorf("has_mx = %v, want false when the lookup succeeded and found nothing", resp.MX.HasMX)
	}
	if resp.MX.Error != "" {
		t.Errorf("mx.error = %q, want empty for a successful lookup", resp.MX.Error)
	}
}

func TestVerifyNXDOMAINIsAnHonestNoMX(t *testing.T) {
	// An authoritative "name does not exist" is a completed lookup: the domain
	// has no mail servers because it has no records at all.
	stub := &stubVerifier{mxErr: &net.DNSError{Err: "no such host", Name: "gone.test", IsNotFound: true}}
	s, _ := newTestServer(t, testConfig(), stub)

	resp := decodeResponse(t, postVerify(t, s, `{"email":"a@gone.test"}`))
	if resp.MX.HasMX == nil || *resp.MX.HasMX {
		t.Errorf("has_mx = %v, want false for NXDOMAIN", resp.MX.HasMX)
	}
	if resp.MX.Error != "" {
		t.Errorf("mx.error = %q, want empty for NXDOMAIN", resp.MX.Error)
	}
}

func TestVerifyDNSServerFailureStaysUnknown(t *testing.T) {
	// SERVFAIL / temporary failures are NOT NXDOMAIN: the lookup did not complete.
	stub := &stubVerifier{mxErr: &net.DNSError{Err: "server misbehaving", Name: "flaky.test", IsTemporary: true}}
	s, _ := newTestServer(t, testConfig(), stub)

	resp := decodeResponse(t, postVerify(t, s, `{"email":"a@flaky.test"}`))
	if resp.MX.HasMX != nil {
		t.Errorf("has_mx = %v, want null for a server failure", *resp.MX.HasMX)
	}
	if resp.MX.Error == "" {
		t.Error("mx.error is empty for a server failure")
	}
}

// catchAllSMTP mirrors the library's default: CatchAll starts true and is only
// cleared when the catch-all probe itself runs.
var catchAllSMTP = emailverifierSMTP

func init() { catchAllSMTP.CatchAll = true }

func TestVerifyCatchAllNotClaimedWhenUnchecked(t *testing.T) {
	// The library's SMTP result starts with CatchAll=true and only clears it
	// when the catch-all probe runs. With catch_all=false the flag must not
	// leak through as a finding.
	stub := &stubVerifier{mxResult: mxRecords("mx.example.test"), smtpResult: &catchAllSMTP}
	cfg := testConfig()
	cfg.SMTPEnabled = true
	s, _ := newTestServer(t, cfg, stub)

	resp := decodeResponse(t, postVerify(t, s, `{"email":"a@example.test","smtp":true,"catch_all":false}`))
	if resp.SMTP == nil || !resp.SMTP.Attempted {
		t.Fatal("smtp probe was not attempted")
	}
	if resp.SMTP.CatchAll {
		t.Error("catch_all = true although the catch-all probe was not requested")
	}

	resp = decodeResponse(t, postVerify(t, s, `{"email":"a@example.test","smtp":true,"catch_all":true}`))
	if resp.SMTP == nil || !resp.SMTP.CatchAll {
		t.Error("catch_all = false although the probe ran and reported a catch-all domain")
	}
}

// --- 9. unknown fields rejected, plus other malformed bodies ---

func TestVerifyRejectsBadRequests(t *testing.T) {
	cases := map[string]string{
		"unknown field":    `{"email":"a@b.test","smtp":false,"catch_all":false,"extra":1}`,
		"malformed json":   `{"email":`,
		"missing email":    `{"smtp":true}`,
		"empty email":      `{"email":"  "}`,
		"wrong field type": `{"email":true}`,
		"trailing data":    `{"email":"a@b.test"}{"email":"c@d.test"}`,
	}

	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			stub := &stubVerifier{}
			s, _ := newTestServer(t, testConfig(), stub)

			recorder := postVerify(t, s, body)
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body %s", recorder.Code, recorder.Body.String())
			}
			var errResp errorResponse
			if err := json.Unmarshal(recorder.Body.Bytes(), &errResp); err != nil || errResp.Error == "" {
				t.Fatalf("error body = %q, want a clear error message", recorder.Body.String())
			}
			if stub.mxCalls+stub.smtpCalls != 0 {
				t.Error("lookups ran for a rejected request")
			}
		})
	}
}

// --- 10. contract completeness ---

func TestVerifyResponseContractHasEveryField(t *testing.T) {
	cfg := testConfig()
	cfg.SMTPEnabled = true
	stub := &stubVerifier{
		mxResult:   mxRecords("mx.example.test."),
		smtpResult: &emailverifierSMTP,
	}
	s, _ := newTestServer(t, cfg, stub)

	recorder := postVerify(t, s, `{"email":"x@example.test","smtp":true,"catch_all":false}`)

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(recorder.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"email", "syntax", "mx", "disposable", "role_account", "free_provider", "smtp", "duration_ms"} {
		if _, ok := raw[field]; !ok {
			t.Errorf("top-level field %q missing", field)
		}
	}

	var syntax map[string]json.RawMessage
	mustUnmarshal(t, raw["syntax"], &syntax)
	for _, field := range []string{"valid", "username", "domain"} {
		if _, ok := syntax[field]; !ok {
			t.Errorf("syntax.%s missing", field)
		}
	}

	var mx map[string]json.RawMessage
	mustUnmarshal(t, raw["mx"], &mx)
	for _, field := range []string{"has_mx", "records", "error"} {
		if _, ok := mx[field]; !ok {
			t.Errorf("mx.%s missing", field)
		}
	}

	var smtp map[string]json.RawMessage
	mustUnmarshal(t, raw["smtp"], &smtp)
	for _, field := range []string{"attempted", "mailbox_accepted", "catch_all", "full_inbox", "disabled", "error"} {
		if _, ok := smtp[field]; !ok {
			t.Errorf("smtp.%s missing", field)
		}
	}
}

func mustUnmarshal(t *testing.T, data json.RawMessage, target any) {
	t.Helper()
	if err := json.Unmarshal(data, target); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
}

func boolString(v bool) string {
	if v {
		return "true"
	}
	return "false"
}

// Shared fixtures.
var errTestDNS = &testDNSError{}

type testDNSError struct{}

func (*testDNSError) Error() string { return "lookup broken.test on 10.0.0.53:53: no such host" }
