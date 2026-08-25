package main

import (
	"context"
	"fmt"

	emailverifier "github.com/AfterShip/email-verifier"
)

// verifier is the seam between the HTTP layer and the AfterShip library.
// Handler tests stub it, so no test ever performs live DNS or SMTP traffic.
type verifier interface {
	ParseAddress(email string) emailverifier.Syntax
	IsFreeDomain(domain string) bool
	IsRoleAccount(username string) bool
	IsDisposable(domain string) bool
	// CheckMX must honour ctx: on expiry it returns ctx.Err() promptly even if
	// the underlying lookup is still in flight.
	CheckMX(ctx context.Context, domain string) (*emailverifier.Mx, error)
	// CheckSMTP probes the mailbox over SMTP. catchAll toggles the upstream
	// catch-all probe for this call only.
	CheckSMTP(ctx context.Context, domain, username string, catchAll bool) (*emailverifier.SMTP, error)
}

// aftershipVerifier adapts github.com/AfterShip/email-verifier.
//
// A fresh library verifier is built per SMTP call because the library's
// Enable/Disable switches mutate shared state, which would race under
// concurrent requests with different smtp/catch_all flags. Construction is a
// small struct allocation; the heavy metadata sets are package-level in the
// library either way.
//
// Deliberately never enabled here: Gravatar, SOCKS proxy, vendor API
// verifiers, automatic disposable-list updates, and domain suggestions.
type aftershipVerifier struct {
	cfg config
	// base handles the pure, side-effect-free checks.
	base *emailverifier.Verifier
}

func newAftershipVerifier(cfg config) *aftershipVerifier {
	return &aftershipVerifier{
		cfg: cfg,
		// The library enables catch-all by default; switch everything off so
		// the base verifier can never touch the network.
		base: emailverifier.NewVerifier().DisableSMTPCheck().DisableCatchAllCheck(),
	}
}

func (a *aftershipVerifier) ParseAddress(email string) emailverifier.Syntax {
	return a.base.ParseAddress(email)
}

func (a *aftershipVerifier) IsFreeDomain(domain string) bool { return a.base.IsFreeDomain(domain) }

func (a *aftershipVerifier) IsRoleAccount(username string) bool {
	return a.base.IsRoleAccount(username)
}

func (a *aftershipVerifier) IsDisposable(domain string) bool { return a.base.IsDisposable(domain) }

func (a *aftershipVerifier) CheckMX(ctx context.Context, domain string) (*emailverifier.Mx, error) {
	return await(ctx, func() (*emailverifier.Mx, error) {
		return a.base.CheckMX(domain)
	})
}

func (a *aftershipVerifier) CheckSMTP(ctx context.Context, domain, username string, catchAll bool) (*emailverifier.SMTP, error) {
	probe := emailverifier.NewVerifier().
		EnableSMTPCheck().
		DisableCatchAllCheck().
		HelloName(a.cfg.SMTPHelloDomain).
		FromEmail(a.cfg.SMTPProbeFrom).
		ConnectTimeout(a.cfg.VerifyTimeout).
		OperationTimeout(a.cfg.VerifyTimeout)
	if catchAll {
		probe.EnableCatchAllCheck()
	}

	return await(ctx, func() (*emailverifier.SMTP, error) {
		return probe.CheckSMTP(domain, username)
	})
}

// await runs fn in a goroutine and returns early when ctx expires. The
// goroutine itself is not abandoned forever: the library calls it wraps are
// bounded by the resolver's own timeout (MX) or by the Connect/Operation
// timeouts configured above (SMTP), so it terminates on its own shortly after
// and the buffered channel lets it exit without a reader.
func await[T any](ctx context.Context, fn func() (T, error)) (T, error) {
	type outcome struct {
		value T
		err   error
	}
	done := make(chan outcome, 1)

	go func() {
		value, err := fn()
		done <- outcome{value: value, err: err}
	}()

	select {
	case <-ctx.Done():
		var zero T
		return zero, fmt.Errorf("verify deadline exceeded: %w", ctx.Err())
	case result := <-done:
		return result.value, result.err
	}
}
