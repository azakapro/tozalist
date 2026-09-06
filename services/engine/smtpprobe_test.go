package main

import (
	"bufio"
	"context"
	"errors"
	"net"
	"net/textproto"
	"strings"
	"testing"
	"time"
)

// fakeSMTP is a scripted SMTP server: it greets, answers EHLO, and replies to
// each RCPT TO with the next line from rcptReplies (repeating the last one).
type fakeSMTP struct {
	addr         string
	rcptReplies  []string
	mailReply    string
	seen         []string
	advertiseTLS bool
}

func startFakeSMTP(t *testing.T, rcptReplies []string, mailReply string) *fakeSMTP {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeSMTP{addr: ln.Addr().String(), rcptReplies: rcptReplies, mailReply: mailReply}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go f.serve(conn)
		}
	}()
	return f
}

func (f *fakeSMTP) serve(conn net.Conn) {
	defer conn.Close()
	w := bufio.NewWriter(conn)
	r := bufio.NewReader(conn)
	write := func(s string) { _, _ = w.WriteString(s + "\r\n"); _ = w.Flush() }
	if strings.HasPrefix(f.mailReply, "GREETING:") {
		write(strings.TrimPrefix(f.mailReply, "GREETING:"))
		return
	}
	write("220 fake.test ESMTP")
	rcpt := 0
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimRight(line, "\r\n")
		upper := strings.ToUpper(line)
		switch {
		case strings.HasPrefix(upper, "EHLO"), strings.HasPrefix(upper, "HELO"):
			write("250-fake.test")
			if f.advertiseTLS {
				write("250-STARTTLS")
			}
			write("250 PIPELINING")
		case strings.HasPrefix(upper, "STARTTLS"):
			// Say yes, then talk plain text: the client's TLS handshake fails.
			write("220 Ready to start TLS")
			write("garbage that is not a TLS record")
		case strings.HasPrefix(upper, "MAIL FROM"):
			f.seen = append(f.seen, line)
			if f.mailReply != "" && !strings.HasPrefix(f.mailReply, "GREETING:") {
				write(f.mailReply)
			} else {
				write("250 2.1.0 Ok")
			}
		case strings.HasPrefix(upper, "RCPT TO"):
			f.seen = append(f.seen, line)
			idx := rcpt
			if idx >= len(f.rcptReplies) {
				idx = len(f.rcptReplies) - 1
			}
			rcpt++
			write(f.rcptReplies[idx])
		case strings.HasPrefix(upper, "QUIT"):
			write("221 Bye")
			return
		default:
			write("250 Ok")
		}
	}
}

func rcptLines(f *fakeSMTP) []string {
	var out []string
	for _, l := range f.seen {
		if strings.HasPrefix(strings.ToUpper(l), "RCPT") {
			out = append(out, l)
		}
	}
	return out
}

func probeAgainst(t *testing.T, f *fakeSMTP, username string, catchAll bool) (accepted, isCatchAll, full, disabled bool, err error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	res, err := probeMailbox(ctx, "example.test", username, smtpProbeOptions{
		hosts:        []string{f.addr},
		helloDomain:  "probe.test",
		fromAddress:  "postmaster@probe.test",
		timeout:      3 * time.Second,
		catchAll:     catchAll,
		randomSuffix: func(domain string) string { return "random-probe@" + domain },
	})
	if err != nil {
		return false, false, false, false, err
	}
	return res.Deliverable, res.CatchAll, res.FullInbox, res.Disabled, nil
}

func TestProbeRealMailboxAccepted(t *testing.T) {
	f := startFakeSMTP(t, []string{"550 5.1.1 The email account does not exist", "250 2.1.5 Ok"}, "")
	accepted, catchAll, _, _, err := probeAgainst(t, f, "alice", true)
	if err != nil {
		t.Fatal(err)
	}
	if catchAll || !accepted {
		t.Errorf("accepted=%v catch_all=%v, want accepted and not catch-all", accepted, catchAll)
	}
	if rcpts := rcptLines(f); len(rcpts) != 2 || !strings.Contains(rcpts[0], "random-probe@") || !strings.Contains(rcpts[1], "alice@") {
		t.Errorf("unexpected RCPT sequence: %v", rcpts)
	}
}

func TestProbeRealMailboxRejected(t *testing.T) {
	f := startFakeSMTP(t, []string{"550 5.1.1 does not exist", "550 5.1.1 does not exist"}, "")
	accepted, catchAll, _, _, err := probeAgainst(t, f, "nobody", true)
	if err != nil {
		t.Fatal(err)
	}
	if catchAll || accepted {
		t.Errorf("accepted=%v catch_all=%v, want rejected and not catch-all", accepted, catchAll)
	}
}

func TestProbeCatchAllWhenRandomAccepted(t *testing.T) {
	f := startFakeSMTP(t, []string{"250 Go ahead"}, "")
	_, catchAll, _, _, err := probeAgainst(t, f, "anyone", true)
	if err != nil {
		t.Fatal(err)
	}
	if !catchAll {
		t.Error("random recipient was accepted; expected catch_all=true")
	}
	if rcpts := rcptLines(f); len(rcpts) != 1 {
		t.Errorf("a catch-all domain must not be probed for the real mailbox; RCPTs: %v", rcpts)
	}
}

func TestProbePolicyBlockIsNotCatchAll(t *testing.T) {
	// The exact shape of an IP-reputation refusal: random recipient refused
	// with 5.7.1. The library reported this as catch-all; we report "blocked".
	f := startFakeSMTP(t, []string{"550 5.7.1 Mail from IP 203.0.113.9 was rejected due to listing in Spamhaus SBL"}, "")
	_, _, _, _, err := probeAgainst(t, f, "alice", true)
	var pe *probeError
	if !errors.As(err, &pe) || pe.kind != replyBlocked {
		t.Fatalf("expected a blocked probeError, got %v", err)
	}
	if strings.Contains(err.Error(), "203.0.113.9") || strings.Contains(err.Error(), "alice") {
		t.Errorf("error text leaks server free text or the recipient: %q", err.Error())
	}
	if !strings.Contains(err.Error(), "550") {
		t.Errorf("error text should carry the reply code: %q", err.Error())
	}
}

func TestProbeTemporaryFailureIsAnError(t *testing.T) {
	f := startFakeSMTP(t, []string{"451 4.7.1 Greylisted, try again later"}, "")
	_, _, _, _, err := probeAgainst(t, f, "alice", true)
	var pe *probeError
	if !errors.As(err, &pe) || pe.kind != replyTemporary {
		t.Fatalf("expected a temporary probeError, got %v", err)
	}
}

func TestProbeFullAndDisabledMailboxes(t *testing.T) {
	full := startFakeSMTP(t, []string{"550 5.1.1 no such user", "452 4.2.2 Mailbox full"}, "")
	_, _, isFull, _, err := probeAgainst(t, full, "packed", true)
	if err != nil || !isFull {
		t.Errorf("full mailbox: full=%v err=%v", isFull, err)
	}
	disabled := startFakeSMTP(t, []string{"550 5.1.1 no such user", "550 5.2.1 Mailbox disabled"}, "")
	_, _, _, isDisabled, err := probeAgainst(t, disabled, "gone", true)
	if err != nil || !isDisabled {
		t.Errorf("disabled mailbox: disabled=%v err=%v", isDisabled, err)
	}
}

func TestProbeWithoutCatchAllCheckDoesNotClaimCatchAll(t *testing.T) {
	f := startFakeSMTP(t, []string{"250 Ok"}, "")
	accepted, catchAll, _, _, err := probeAgainst(t, f, "alice", false)
	if err != nil {
		t.Fatal(err)
	}
	if catchAll || !accepted {
		t.Errorf("accepted=%v catch_all=%v; without the check catch_all must stay false", accepted, catchAll)
	}
	if rcpts := rcptLines(f); len(rcpts) != 1 || !strings.Contains(rcpts[0], "alice@") {
		t.Errorf("only the real mailbox should be probed: %v", rcpts)
	}
}

func TestProbeMailFromRefusedIsAnError(t *testing.T) {
	f := startFakeSMTP(t, []string{"250 Ok"}, "554 5.7.1 Service unavailable; client blocked")
	_, _, _, _, err := probeAgainst(t, f, "alice", true)
	var pe *probeError
	if !errors.As(err, &pe) || pe.kind != replyBlocked || pe.stage != "MAIL FROM" {
		t.Fatalf("expected a blocked probeError at MAIL FROM, got %v", err)
	}
}

func TestProbeGreetingRejectIsCategorised(t *testing.T) {
	// gmx.net greets blocklisted IPs with "421 ... Administrative reject" and
	// a URL carrying the caller's IP. That must surface as a category, not text.
	f := startFakeSMTP(t, []string{"250 Ok"}, "GREETING:421 gmx.net Nemesis ESMTP Service not available; visit https://postmaster.example/case?ip=203.0.113.9")
	_, _, _, _, err := probeAgainst(t, f, "alice", true)
	var pe *probeError
	if !errors.As(err, &pe) || pe.stage != "greeting" || pe.kind != replyTemporary {
		t.Fatalf("expected a temporary probeError at greeting, got %v", err)
	}
	if strings.Contains(err.Error(), "203.0.113.9") || strings.Contains(err.Error(), "postmaster.example") {
		t.Errorf("greeting text leaked: %q", err.Error())
	}
}

func TestProbeTemporaryFormUserUnknownIsRejected(t *testing.T) {
	// umail.uz (Postfix) answers unknown recipients with 450 4.1.1.
	f := startFakeSMTP(t, []string{"450 4.1.1 <x@example.test>: Recipient address rejected: User unknown in virtual mailbox table"}, "")
	accepted, catchAll, _, _, err := probeAgainst(t, f, "nobody", true)
	if err != nil {
		t.Fatal(err)
	}
	if catchAll || accepted {
		t.Errorf("accepted=%v catch_all=%v, want rejected", accepted, catchAll)
	}
}

func TestProbeNullSender(t *testing.T) {
	f := startFakeSMTP(t, []string{"550 5.1.1 no such user", "250 Ok"}, "")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := probeMailbox(ctx, "example.test", "alice", smtpProbeOptions{hosts: []string{f.addr}, helloDomain: "probe.test", fromAddress: "<>", timeout: 3 * time.Second, catchAll: true, randomSuffix: func(d string) string { return "r@" + d }})
	if err != nil {
		t.Fatal(err)
	}
	var mailFrom string
	for _, l := range f.seen {
		if strings.HasPrefix(strings.ToUpper(l), "MAIL FROM") {
			mailFrom = l
		}
	}
	if !strings.Contains(mailFrom, "<>") {
		t.Errorf("expected the null sender, sent %q", mailFrom)
	}
}

func TestProbeRetriesWithoutTLSWhenStartTLSFails(t *testing.T) {
	f := startFakeSMTP(t, []string{"550 5.1.1 no such user", "250 Ok"}, "")
	f.advertiseTLS = true
	accepted, _, _, _, err := probeAgainst(t, f, "alice", true)
	if err != nil {
		t.Fatalf("expected a plain-text retry to succeed, got %v", err)
	}
	if !accepted {
		t.Error("mailbox should be accepted on the plain-text retry")
	}
}

func TestProbeUnreachableHostIsAPlainError(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	ln.Close() // nothing listens here any more
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, err = probeMailbox(ctx, "example.test", "alice", smtpProbeOptions{hosts: []string{addr}, helloDomain: "probe.test", fromAddress: "p@probe.test", timeout: time.Second})
	var pe *probeError
	if err == nil || errors.As(err, &pe) {
		t.Fatalf("expected a plain connection error, got %v", err)
	}
}

func TestClassifyReplyTable(t *testing.T) {
	cases := []struct {
		code int
		msg  string
		want replyKind
	}{
		{550, "5.1.1 The email account that you tried to reach does not exist", replyUnknown},
		{550, "5.7.1 Mail from IP was rejected due to listing in Spamhaus SBL", replyBlocked},
		{554, "5.7.1 Service unavailable; Client host blocked using zen.spamhaus.org", replyBlocked},
		{550, "5.2.1 The email account that you tried to reach is disabled", replyDisabled},
		{552, "5.2.2 The email account that you tried to reach is over quota", replyFull},
		{452, "4.2.2 Mailbox full", replyFull},
		{451, "4.7.1 Greylisting in action, please come back later", replyTemporary},
		{421, "4.7.0 Try again later, closing connection", replyTemporary},
		{550, "Recipient address rejected: User unknown in virtual mailbox table", replyUnknown},
		{553, "5.3.0 Rejected", replyUnknown},
		{521, "5.5.0 We do not accept mail", replyOther},
	}
	for _, c := range cases {
		got, _ := classifyReply(&textproto.Error{Code: c.code, Msg: c.msg})
		if got != c.want {
			t.Errorf("%d %q: got %v want %v", c.code, c.msg, got, c.want)
		}
	}
}
