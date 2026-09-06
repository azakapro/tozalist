package main

import (
	"context"
	"errors"
	"net"
	"strings"
	"time"

	emailverifier "github.com/AfterShip/email-verifier"
)

// runVerify orchestrates one verification. It never returns an error: whatever
// goes wrong mid-flight (DNS failure, timeout) is reported inside the response
// contract, because a lookup problem is a result, not a server fault.
func runVerify(ctx context.Context, v verifier, cfg config, req verifyRequest, now func() time.Time) verifyResponse {
	started := now()
	resp := verifyResponse{
		Email: req.Email,
		MX:    mxResult{HasMX: boolPtr(false), Records: []string{}},
	}

	syntax := v.ParseAddress(req.Email)
	resp.Syntax = syntaxResult{Valid: syntax.Valid, Username: syntax.Username, Domain: syntax.Domain}

	if !syntax.Valid {
		// Nothing to look up. SMTP mirrors the request shape: null unless asked.
		if req.SMTP {
			resp.SMTP = &smtpResult{}
		}
		resp.DurationMS = now().Sub(started).Milliseconds()
		return resp
	}

	resp.FreeProvider = v.IsFreeDomain(syntax.Domain)
	resp.RoleAccount = v.IsRoleAccount(syntax.Username)
	resp.Disposable = v.IsDisposable(syntax.Domain)

	resp.MX = lookupMX(ctx, v, syntax.Domain, cfg)

	if req.SMTP {
		resp.SMTP = probeSMTP(ctx, v, cfg, syntax, req.CatchAll, resp.MX)
	}

	resp.DurationMS = now().Sub(started).Milliseconds()
	return resp
}

// lookupMX maps the library's MX result onto the contract. A lookup failure is
// never reported as has_mx=false - the domain might have MX records we simply
// could not see - so has_mx becomes null and mx.error says why.
//
// The one exception is an authoritative NXDOMAIN: the resolver answered, and
// the answer is that the name does not exist. That is a successful lookup of a
// domain with no mail servers (has_mx=false), not an unavailable lookup.
// Timeouts, SERVFAIL, and network errors stay null.
func lookupMX(ctx context.Context, v verifier, domain string, cfg config) mxResult {
	mx, err := v.CheckMX(ctx, domain)
	if err != nil {
		var dnsErr *net.DNSError
		if errors.As(err, &dnsErr) && dnsErr.IsNotFound {
			return mxResult{HasMX: boolPtr(false), Records: []string{}, Error: ""}
		}
		return mxResult{
			HasMX:   nil,
			Records: []string{},
			Error:   describeLookupError(err, cfg),
		}
	}

	records := make([]string, 0, len(mx.Records))
	for _, record := range mx.Records {
		if record != nil {
			records = append(records, record.Host)
		}
	}

	return mxResult{HasMX: boolPtr(mx.HasMXRecord), Records: records, Error: ""}
}

// probeSMTP applies the layered policy: the request must ask for SMTP and the
// process must allow it, otherwise no network probe happens at all.
func probeSMTP(ctx context.Context, v verifier, cfg config, syntax emailverifier.Syntax, catchAll bool, mx mxResult) *smtpResult {
	if !cfg.SMTPEnabled {
		// Refused by policy: attempted=false + disabled=true is the documented
		// signature of "the engine would not probe", distinct from a provider
		// reporting a disabled mailbox (which has attempted=true).
		return &smtpResult{Attempted: false, Disabled: true}
	}

	// A probe needs somewhere to connect. If the MX lookup already failed or
	// found nothing, say so instead of dialling a domain we know nothing about.
	if mx.Error != "" {
		return &smtpResult{Attempted: false, Error: "smtp probe skipped: mx lookup failed"}
	}
	if mx.HasMX != nil && !*mx.HasMX {
		return &smtpResult{Attempted: false, Error: "smtp probe skipped: domain has no MX records"}
	}

	result, err := v.CheckSMTP(ctx, syntax.Domain, syntax.Username, catchAll)
	if err != nil {
		return &smtpResult{Attempted: true, Error: describeLookupError(err, cfg)}
	}
	if result == nil {
		// The library returns nil,nil when its SMTP switch is off. Reaching
		// this would be a wiring bug, not a mailbox verdict; be explicit.
		return &smtpResult{Attempted: false, Error: "smtp probe not performed"}
	}

	return &smtpResult{
		Attempted:       true,
		MailboxAccepted: result.Deliverable,
		CatchAll:        result.CatchAll,
		FullInbox:       result.FullInbox,
		Disabled:        result.Disabled,
		Error:           "",
	}
}

// describeLookupError turns a low-level failure into a short, stable category
// string. It must stay free of anything derived from the local part.
func describeLookupError(err error, cfg config) string {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout: lookup exceeded the " + cfg.VerifyTimeout.String() + " verify deadline"
	case errors.Is(err, context.Canceled):
		return "cancelled: request aborted before the lookup finished"
	}

	message := err.Error()
	// The library formats DNS problems via LookupError; net.DNSError messages
	// contain only the domain, which is allowed in responses and logs.
	if strings.Contains(strings.ToLower(message), "timeout") {
		return "timeout: " + message
	}
	return "lookup failed: " + message
}
