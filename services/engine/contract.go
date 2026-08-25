package main

// The response contract for POST /verify. This shape is stable: the Fastify API
// will parse it in a later step, so every field stays present in its object,
// including false booleans and empty error strings.

// verifyRequest is the only accepted request body. Unknown fields are rejected
// by the decoder, so the contract cannot drift silently.
type verifyRequest struct {
	Email    string `json:"email"`
	SMTP     bool   `json:"smtp"`
	CatchAll bool   `json:"catch_all"`
}

type syntaxResult struct {
	Valid    bool   `json:"valid"`
	Username string `json:"username"`
	Domain   string `json:"domain"`
}

// mxResult reports the MX lookup. HasMX is a pointer on purpose: when the
// lookup itself failed we do not know whether the domain has MX records, and
// reporting false would turn an infrastructure failure into a claim about the
// domain. On failure HasMX serialises as null and Error is non-empty.
type mxResult struct {
	HasMX   *bool    `json:"has_mx"`
	Records []string `json:"records"`
	Error   string   `json:"error"`
}

// smtpResult reports the SMTP probe. MailboxAccepted is a low-level protocol
// signal (RCPT TO was accepted), not a promise that mail will be delivered.
// Disabled is true either when the provider reports the mailbox disabled or
// when this engine refused to probe because SMTP_ENABLED=false; Attempted
// distinguishes the two.
type smtpResult struct {
	Attempted       bool   `json:"attempted"`
	MailboxAccepted bool   `json:"mailbox_accepted"`
	CatchAll        bool   `json:"catch_all"`
	FullInbox       bool   `json:"full_inbox"`
	Disabled        bool   `json:"disabled"`
	Error           string `json:"error"`
}

type verifyResponse struct {
	Email        string       `json:"email"`
	Syntax       syntaxResult `json:"syntax"`
	MX           mxResult     `json:"mx"`
	Disposable   bool         `json:"disposable"`
	RoleAccount  bool         `json:"role_account"`
	FreeProvider bool         `json:"free_provider"`
	// SMTP is null exactly when the request had "smtp": false.
	SMTP       *smtpResult `json:"smtp"`
	DurationMS int64       `json:"duration_ms"`
}

type errorResponse struct {
	Error string `json:"error"`
}

func boolPtr(v bool) *bool { return &v }
