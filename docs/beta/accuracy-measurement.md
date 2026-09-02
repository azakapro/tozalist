# Measuring real accuracy with a design partner

Synthetic benchmarks (the 500-fixture corpus in `packages/core/bench/`) prove
**logic correctness** — that the pipeline maps evidence to verdicts exactly as
designed. They say nothing about real-world accuracy. Real accuracy can only
be measured by comparing our verdicts against **observed delivery outcomes**
on a real, consented list. This document defines how to do that lawfully and
in a way whose numbers mean something.

Related documents: [onboarding-checklist.md](onboarding-checklist.md)
(consent prerequisites) ·
[weekly-report-template.md](weekly-report-template.md) (where false-positive
reports accumulate) · [stop-criteria.md](stop-criteria.md).

## Lawful measurement — preconditions

All of these must hold before measurement starts. Any one missing means
measurement does not happen:

1. The Uzbekistan legal review gate in `docs/PRE-PRODUCTION-GATES.md` is
   closed. Until then, no real customer list is processed at all.
2. The partner completed [onboarding-checklist.md](onboarding-checklist.md),
   including the written consent-basis statement covering third-party
   verification processing.
3. The partner has authorized, in writing, the use of their **send outcomes**
   (bounce logs) for accuracy comparison.
4. Bounce outcomes are joined to our verdicts **on the partner's side or in
   the partner's account context only**. We never pool one partner's
   addresses or outcomes with another's, and no address list ever appears in
   a report, a relay file, or this repository.
5. Retention applies to measurement data like any other result data: after
   the partner's `retention_days` window, our side of the join is gone.

## The comparison

For each address that was (a) checked by us and (b) actually sent to by the
partner within 30 days of the check:

- Our label: the verdict — `valid`, `invalid`, `risky`, or `unknown`.
- Ground truth: the observed outcome — **hard bounce** (permanent rejection,
  SMTP 5xx / provider "bad address" classification) or **accepted** (no hard
  bounce). Soft bounces (mailbox full, greylisting, temporary errors) are
  recorded separately and excluded from the accuracy join, because they do
  not establish that the address is bad.

## Definitions per verdict class

"Positive" means "we said the address is bad" (`invalid`). The costly error
for the customer is the **false positive**: a deliverable address we told
them to remove.

| Verdict   | Outcome: hard bounce      | Outcome: accepted           |
| --------- | ------------------------- | --------------------------- |
| `invalid` | **True positive (TP)**    | **False positive (FP)**     |
| `valid`   | **False negative (FN)**   | **True negative (TN)**      |
| `risky`   | risky-confirmed (TP-risk) | risky-unconfirmed (FP-risk) |
| `unknown` | excluded                  | excluded                    |

- `invalid` / `valid` form the primary confusion matrix. Headline metrics:
  - **Precision on invalid** = TP / (TP + FP) — "when we say remove, how
    often are we right?" This is the number partners feel.
  - **Recall on invalid** = TP / (TP + FN) — "of the addresses that really
    bounce, how many did we catch?"
- `risky` is reported as its own two rates (confirmed vs unconfirmed), never
  folded into precision/recall. `risky` is advice ("send with care"), not a
  removal verdict; judging it as if it were `invalid` would punish the
  product for being honest about uncertainty.
- **`unknown` is excluded from accuracy scoring entirely — it is not counted
  as a miss.** `unknown` is the product explicitly declining to judge
  (catch-all domain, SMTP probing off or unreachable, lookup unavailable).
  Scoring it as wrong would create pressure to guess instead of abstain,
  which is the opposite of what a verification product should do. Report the
  **unknown rate** (share of checked addresses returning `unknown`) as its
  own transparency metric alongside accuracy — a high unknown rate is a
  coverage problem even when accuracy is high. Note that with
  `SMTP_ENABLED=false` (the current supported configuration) the unknown
  rate will be structurally higher; record the SMTP setting with every
  measurement so numbers are compared like with like.

## Minimum sample size

For a meaningful result:

- At least **1,000 addresses** in the joined set (checked by us **and** sent
  to by the partner), and
- at least **200 of them carrying a definitive verdict** (`valid` or
  `invalid`), and
- at least **30 observed hard bounces** in the joined set.

Below these thresholds, random noise dominates: with fewer than 30 bounces, a
single misclassified address moves recall by more than three percentage
points, so no per-class claim is defensible. If a partner's list is smaller,
run the pilot anyway, report raw counts, and label them "directional — below
minimum sample size"; never present a percentage from an under-sized sample
as an accuracy figure, internally or to the partner.

## What to report

Weekly, per partner, inside
[weekly-report-template.md](weekly-report-template.md):

- The 2×2 confusion matrix for `valid`/`invalid` (raw counts).
- Precision and recall on `invalid` — only once the minimum sample is met.
- The risky-confirmed / risky-unconfirmed counts.
- The unknown rate and the SMTP setting in effect.
- Every false positive the partner reported, with our reason code
  (for example `DOMAIN_NO_MX`, `MAILBOX_REJECTED`, `DISPOSABLE_DOMAIN`) and
  the resolution after investigation.

## What never to claim

- No accuracy number is quoted to anyone outside the pilot before the
  minimum sample size is met for at least three partners.
- Accuracy figures are always stated with their sample size, time window,
  partner count, and SMTP setting.
- Nothing in this process claims legal clearance, guaranteed deliverability,
  or a promise that mail "will arrive" — a check reports evidence at a point
  in time, and the product's own reason-code explanations are worded the
  same way.
