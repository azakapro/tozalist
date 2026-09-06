package main

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/smtp"
	"net/textproto"
	"regexp"
	"sort"
	"strings"
	"time"

	emailverifier "github.com/AfterShip/email-verifier"
)

// The SMTP mailbox probe.
//
// The upstream library's probe starts from "catch-all = true" and only clears
// it when the random-recipient test is refused with one particular error
// class. Any other refusal - a policy block ("550 5.7.1 ... Spamhaus"), a
// greylisting 4xx, a rate limit - therefore came back as a confident
// "catch-all domain", which is a false finding. This probe runs the same
// conversation itself and reports every outcome for what it is:
//
//   - random recipient accepted            -> catch-all (mailbox cannot be told apart)
//   - random refused as unknown mailbox    -> not catch-all; probe the real one
//   - real accepted / refused as unknown   -> deliverable true / false
//   - full mailbox / disabled mailbox      -> reported as such
//   - policy block, temporary failure, or
//     anything else                        -> an error: the probe could not run,
//     which the aggregator turns into `unknown`, never a verdict.
//
// Error strings carry only the reply code and category; never the recipient,
// never the server's free text (which may echo the address).

// replyKind is the coarse classification of one SMTP reply.
type replyKind int

const (
	replyAccepted  replyKind = iota // 2xx
	replyUnknown                    // the mailbox does not exist (5.1.x, generic 550)
	replyFull                       // mailbox over quota
	replyDisabled                   // mailbox disabled / suspended
	replyBlocked                    // policy refusal aimed at us (5.7.x, blocklists)
	replyTemporary                  // 4xx: greylisting, rate limits, try later
	replyOther                      // anything else we do not want to guess about
)

var enhancedCodePattern = regexp.MustCompile(`^\s*(\d)\.(\d+)\.(\d+)`)

// classifyReply maps an SMTP reply to a replyKind. err is nil for 2xx.
func classifyReply(err error) (replyKind, int) {
	if err == nil {
		return replyAccepted, 250
	}
	var tpErr *textproto.Error
	if !errors.As(err, &tpErr) {
		return replyOther, 0
	}
	code := tpErr.Code
	msg := strings.ToLower(tpErr.Msg)
	enhanced := ""
	if m := enhancedCodePattern.FindStringSubmatch(tpErr.Msg); m != nil {
		enhanced = m[1] + "." + m[2] + "." + m[3]
	}

	blockedWords := []string{"blocked", "blacklist", "block list", "spamhaus", "denied", "policy", "spam", "reputation", "not permitted", "banned"}
	fullWords := []string{"full", "quota", "over limit", "storage"}
	disabledWords := []string{"disabled", "suspended", "inactive", "deactivated", "locked"}
	unknownWords := []string{"does not exist", "no such user", "unknown user", "user unknown", "no such recipient", "recipient rejected", "not found", "invalid recipient", "unknown recipient", "no mailbox", "bad destination"}

	contains := func(words []string) bool {
		for _, w := range words {
			if strings.Contains(msg, w) {
				return true
			}
		}
		return false
	}

	switch {
	case code >= 200 && code < 300:
		return replyAccepted, code
	case code >= 400 && code < 500:
		if strings.HasPrefix(enhanced, "4.2.2") || contains(fullWords) {
			return replyFull, code
		}
		// Some Postfix deployments answer unknown recipients with the temporary
		// form ("450 4.1.1 ... User unknown in virtual mailbox table"). The
		// enhanced code x.1.1 means "bad destination mailbox" either way.
		if strings.HasPrefix(enhanced, "4.1.1") || contains(unknownWords) {
			return replyUnknown, code
		}
		return replyTemporary, code
	case strings.HasPrefix(enhanced, "5.7.") || contains(blockedWords):
		return replyBlocked, code
	case strings.HasPrefix(enhanced, "5.2.2") || contains(fullWords):
		return replyFull, code
	case strings.HasPrefix(enhanced, "5.2.1") || contains(disabledWords):
		return replyDisabled, code
	case strings.HasPrefix(enhanced, "5.1.") || contains(unknownWords) || code == 550 || code == 551 || code == 553:
		return replyUnknown, code
	default:
		return replyOther, code
	}
}

// probeError reports a probe that could not reach a conclusion. Its text is
// safe to place in the response contract and in logs.
type probeError struct {
	stage string
	kind  replyKind
	code  int
}

func (e *probeError) Error() string {
	label := map[replyKind]string{
		replyBlocked:   "probe blocked by the mail server",
		replyTemporary: "mail server asked to try again later",
		replyOther:     "mail server gave an unexpected reply",
	}[e.kind]
	if label == "" {
		label = "probe failed"
	}
	return fmt.Sprintf("%s at %s (%d)", label, e.stage, e.code)
}

// smtpProbeOptions configures one probeMailbox call.
type smtpProbeOptions struct {
	// hosts are "host:port" addresses to try in order. Empty means: resolve
	// the domain's MX records (lowest preference first) on port 25.
	hosts        []string
	helloDomain  string
	fromAddress  string
	timeout      time.Duration
	catchAll     bool
	randomSuffix func(domain string) string
}

// probeMailbox runs the SMTP conversation and returns the library-shaped
// result so the rest of the engine is unchanged. A non-nil error means the
// probe did not reach a conclusion; the result is then nil.
func probeMailbox(ctx context.Context, domain, username string, opts smtpProbeOptions) (*emailverifier.SMTP, error) {
	hosts := opts.hosts
	if len(hosts) == 0 {
		records, err := net.DefaultResolver.LookupMX(ctx, domain)
		if err != nil {
			return nil, err
		}
		if len(records) == 0 {
			return nil, errors.New("no MX records")
		}
		sort.SliceStable(records, func(i, j int) bool { return records[i].Pref < records[j].Pref })
		for _, r := range records {
			hosts = append(hosts, net.JoinHostPort(strings.TrimSuffix(r.Host, "."), "25"))
		}
	}

	timeout := opts.timeout
	if timeout <= 0 {
		timeout = 15 * time.Second
	}

	var lastErr error
	for _, addr := range hosts {
		result, err := probeOneHost(ctx, addr, domain, username, opts, timeout, true)
		if errors.Is(err, errRetryWithoutTLS) {
			result, err = probeOneHost(ctx, addr, domain, username, opts, timeout, false)
		}
		if err == nil {
			return result, nil
		}
		var pe *probeError
		if errors.As(err, &pe) {
			// The server answered; trying another MX would only repeat the answer.
			return nil, err
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		lastErr = err
	}
	if lastErr == nil {
		lastErr = errors.New("no mail server could be reached")
	}
	return nil, lastErr
}

// errRetryWithoutTLS signals that the STARTTLS upgrade failed on a host that
// otherwise answered; the caller redials it in plain text.
var errRetryWithoutTLS = errors.New("starttls failed")

func probeOneHost(ctx context.Context, addr, domain, username string, opts smtpProbeOptions, timeout time.Duration, tryTLS bool) (*emailverifier.SMTP, error) {
	dialer := net.Dialer{Timeout: timeout}
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(timeout))

	// Cancel the conversation promptly if the request context ends.
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			conn.Close()
		case <-done:
		}
	}()

	host, _, _ := net.SplitHostPort(addr)
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		// A 4xx/5xx greeting ("421 ... Administrative reject") is the server
		// refusing us before any command; categorise it rather than echo it.
		var tpErr *textproto.Error
		if errors.As(err, &tpErr) {
			return nil, stageError("greeting", err)
		}
		return nil, err
	}
	defer client.Close()

	if err := client.Hello(opts.helloDomain); err != nil {
		return nil, stageError("HELO", err)
	}
	// Opportunistic TLS: some providers insist on it before accepting RCPT.
	// A failed upgrade (bad certificate, handshake error) leaves the socket
	// unusable, so the caller retries this host once without TLS.
	if ok, _ := client.Extension("STARTTLS"); ok && tryTLS {
		if err := client.StartTLS(&tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}); err != nil {
			return nil, errRetryWithoutTLS
		}
	}
	// "<>" is the null (bounce) sender: the conventional identity for a
	// verification probe, and the only one that passes sender-domain checks
	// when the probing domain has no DNS presence of its own.
	from := opts.fromAddress
	if from == "<>" {
		from = ""
	}
	if err := client.Mail(from); err != nil {
		return nil, stageError("MAIL FROM", err)
	}

	result := &emailverifier.SMTP{HostExists: true}

	if opts.catchAll {
		random := opts.randomSuffix
		if random == nil {
			random = emailverifier.GenerateRandomEmail
		}
		kind, code := classifyReply(client.Rcpt(random(domain)))
		switch kind {
		case replyAccepted:
			result.CatchAll = true
			_ = client.Quit()
			return result, nil
		case replyUnknown:
			// Good: the server distinguishes mailboxes.
		case replyFull, replyDisabled:
			// A random address cannot be full or disabled; treat as unknown-mailbox.
		default:
			_ = client.Quit()
			return nil, &probeError{stage: "RCPT (catch-all test)", kind: kind, code: code}
		}
	}

	if username == "" {
		_ = client.Quit()
		return result, nil
	}

	kind, code := classifyReply(client.Rcpt(username + "@" + domain))
	_ = client.Quit()
	switch kind {
	case replyAccepted:
		result.Deliverable = true
	case replyUnknown:
		result.Deliverable = false
	case replyFull:
		result.FullInbox = true
	case replyDisabled:
		result.Disabled = true
	default:
		return nil, &probeError{stage: "RCPT", kind: kind, code: code}
	}
	return result, nil
}

// stageError wraps a refusal of a preliminary command. Servers that refuse
// HELO or MAIL FROM are refusing us, not judging a mailbox.
func stageError(stage string, err error) error {
	kind, code := classifyReply(err)
	if kind == replyAccepted {
		return err
	}
	if kind == replyUnknown || kind == replyFull || kind == replyDisabled {
		kind = replyOther
	}
	return &probeError{stage: stage, kind: kind, code: code}
}
