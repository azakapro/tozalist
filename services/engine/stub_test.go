package main

import (
	"context"
	"net"
	"time"

	emailverifier "github.com/AfterShip/email-verifier"
)

// stubVerifier lets every handler test script the verifier's behaviour without
// any live DNS or SMTP traffic.
type stubVerifier struct {
	freeDomains  map[string]bool
	roleAccounts map[string]bool
	disposable   map[string]bool

	mxResult *emailverifier.Mx
	mxErr    error
	// mxDelay simulates a slow lookup so timeout paths can be exercised.
	mxDelay time.Duration

	smtpResult *emailverifier.SMTP
	smtpErr    error
	smtpDelay  time.Duration

	// Recorded calls, so tests can assert what was (not) attempted.
	mxCalls   int
	smtpCalls int
	// catchAll flag seen by the last CheckSMTP call.
	lastCatchAll bool
}

// parseAddress mirrors the library's real parsing closely enough for tests.
func (s *stubVerifier) ParseAddress(email string) emailverifier.Syntax {
	base := emailverifier.NewVerifier().DisableSMTPCheck().DisableCatchAllCheck()
	return base.ParseAddress(email)
}

func (s *stubVerifier) IsFreeDomain(domain string) bool { return s.freeDomains[domain] }

func (s *stubVerifier) IsRoleAccount(username string) bool { return s.roleAccounts[username] }

func (s *stubVerifier) IsDisposable(domain string) bool { return s.disposable[domain] }

func (s *stubVerifier) CheckMX(ctx context.Context, _ string) (*emailverifier.Mx, error) {
	s.mxCalls++
	if s.mxDelay > 0 {
		select {
		case <-ctx.Done():
			return nil, context.Cause(ctx)
		case <-time.After(s.mxDelay):
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return s.mxResult, s.mxErr
}

func (s *stubVerifier) CheckSMTP(ctx context.Context, _, _ string, catchAll bool) (*emailverifier.SMTP, error) {
	s.smtpCalls++
	s.lastCatchAll = catchAll
	if s.smtpDelay > 0 {
		select {
		case <-ctx.Done():
			return nil, context.Cause(ctx)
		case <-time.After(s.smtpDelay):
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return s.smtpResult, s.smtpErr
}

func mxRecords(hosts ...string) *emailverifier.Mx {
	records := make([]*net.MX, len(hosts))
	for i, host := range hosts {
		records[i] = &net.MX{Host: host}
	}
	return &emailverifier.Mx{HasMXRecord: len(hosts) > 0, Records: records}
}

// emailverifierSMTP is a happy-path SMTP probe outcome shared by tests.
var emailverifierSMTP = emailverifier.SMTP{
	HostExists:  true,
	Deliverable: true,
	CatchAll:    false,
	FullInbox:   false,
	Disabled:    false,
}
