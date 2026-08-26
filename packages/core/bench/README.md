# Accuracy regression corpus

This bench (`pnpm core:bench`) runs the real local verdict-aggregation pipeline
over a deterministic synthetic corpus of **500** labelled email fixtures and
checks it reproduces every expected verdict and reason-code list exactly. It
prints a verdict confusion matrix and per-reason-code precision/recall, and
**exits non-zero on any mismatch** — so it is a regression gate, not a quality
score.

## What this measures — and what it does NOT

**This measures LOGIC CORRECTNESS, not real-world deliverability accuracy.**

- Every fixture is synthetic. The engine response is _stubbed_ per fixture, and
  each fixture's expected verdict and reason codes are written from the
  documented aggregation rules, independently of calling `aggregate()`. Because
  the inputs and labels are fixed, correctness must be **100%** — anything less
  is a logic regression in the pipeline, not a measure of how well the product
  judges real mailboxes.
- It proves the aggregator turns a given engine response into the intended
  verdict and reasons: syntax failures, no-MX domains, disposable/role/typo
  cautions, catch-all and SMTP-failure handling, operational fallbacks, and
  clean valid addresses.

**Real-world accuracy cannot be measured here.** It can only be measured against
a **consented** customer list with observed bounce outcomes — comparing our
verdicts to what actually bounced — which happens during the design-partner
beta (see `docs/beta/accuracy-measurement.md`, added in Phase 9.2). There,
`unknown` is excluded from accuracy scoring rather than counted as a miss, and a
minimum sample size is required for a meaningful result.

## No network, ever

The corpus performs **no DNS or other network access**. Non-existent domains
use the reserved `.invalid` and `.test` TLDs specifically so a run can never
touch real DNS, and the engine is never invoked — its responses are the stubs.

The Unicode/IDN valid fixtures include genuine non-ASCII addresses
(Cyrillic, CJK, Greek, and Latin-with-diacritics local parts and/or domains),
alongside ASCII punycode IDN domains and very long ASCII local parts.

## Corpus coverage (500 fixtures)

| Group                                                              | Count | Expected outcome                             |
| ------------------------------------------------------------------ | ----- | -------------------------------------------- |
| Valid at global providers (gmail, yahoo, outlook, icloud, proton…) | 55    | `valid`                                      |
| Valid at CIS/UZ providers (mail.ru, yandex.ru, umail.uz, exat.uz…) | 55    | `valid`                                      |
| Valid at corporate domains                                         | 40    | `valid`                                      |
| Syntax failures (every class, incl. control chars)                 | 50    | `invalid` / `SYNTAX_INVALID`                 |
| Disposable domains                                                 | 40    | `risky` / `DISPOSABLE_DOMAIN`                |
| Role accounts                                                      | 40    | `risky` / `ROLE_ACCOUNT`                     |
| Non-existent domains (`.invalid` / `.test`, no MX)                 | 40    | `invalid` / `DOMAIN_NO_MX`                   |
| Typo domains (must trigger a suggestion)                           | 45    | `risky` / `POSSIBLE_TYPO`                    |
| Unicode / IDN / long — valid (genuine non-ASCII + punycode + long) | 25    | `valid`                                      |
| Unicode / IDN / long — over-long invalid                           | 15    | `invalid` / `SYNTAX_INVALID`                 |
| Catch-all domains                                                  | 25    | `unknown` / `CATCH_ALL_DOMAIN`               |
| SMTP failures (rejected / full / disabled / error)                 | 40    | invalid / risky / unknown                    |
| MX lookup unavailable                                              | 6     | `unknown` / `MX_LOOKUP_UNAVAILABLE`          |
| SMTP not checked (no probe)                                        | 20    | `unknown` / `SMTP_NOT_CHECKED`               |
| Operational (SMTP disabled / circuit open)                         | 4     | `unknown` / `SMTP_DISABLED` · `CIRCUIT_OPEN` |

Each fixture is `{ email, category, stubbedEngineResponse, expectedVerdict,
expectedReasonCodes }`, plus an optional `operationalReason` for the two
operational reason codes that the aggregator takes as a separate input rather
than deriving from an engine response.

## Running it

```bash
pnpm core:bench
```

The same invariants also run inside the normal test suite
(`packages/core/bench/corpus.test.ts`, executed by `pnpm -r test`), and the gate
is wired into CI so a logic regression fails the build.
