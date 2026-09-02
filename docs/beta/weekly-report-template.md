# Weekly partner report — template

One report per partner per week, filled in on the partner's agreed report day
(see [onboarding-checklist.md](onboarding-checklist.md) section 7). Copy this
template into the partner's private folder — completed reports contain
business data and are **not** committed to this repository. Numbers come from
the dashboard and worker metrics; never paste customer addresses into a
report — counts, rates, and anonymized reason-code examples only.

Related documents: [accuracy-measurement.md](accuracy-measurement.md)
(definitions used below) · [stop-criteria.md](stop-criteria.md) (the gates
these reports feed).

## Header

| Field                   | Value                        |
| ----------------------- | ---------------------------- |
| Partner                 |                              |
| Week                    | `____-__-__` to `____-__-__` |
| Report author           |                              |
| Pilot week number (1–4) |                              |
| SMTP setting this week  | enabled / disabled           |

## 1. Checks run

| Metric                          | This week | Pilot to date |
| ------------------------------- | --------- | ------------- |
| Single checks (API + dashboard) |           |               |
| Batch uploads (count)           |           |               |
| Batch rows processed            |           |               |
| Credits consumed                |           |               |
| Credits remaining               |           |               |

## 2. Verdict distribution

| Verdict   | Count | % of week's checks |
| --------- | ----- | ------------------ |
| `valid`   |       |                    |
| `invalid` |       |                    |
| `risky`   |       |                    |
| `unknown` |       |                    |

Top three reason codes this week and their counts:

1. `________` — `____`
2. `________` — `____`
3. `________` — `____`

Unknown rate trend vs last week: up / down / flat — comment if it moved more
than five percentage points (see the unknown-rate guidance in
[accuracy-measurement.md](accuracy-measurement.md)).

## 3. Latency

| Metric                             | Value |
| ---------------------------------- | ----- |
| Single-check p50 (ms)              |       |
| Single-check p95 (ms)              |       |
| Largest batch this week (rows)     |       |
| That batch's wall-clock time       |       |
| Batches that failed / were retried |       |

## 4. Support tickets

| #   | Opened | Summary (no personal data) | Status | Time to first response |
| --- | ------ | -------------------------- | ------ | ---------------------- |
| 1   |        |                            |        |                        |
| 2   |        |                            |        |                        |

Open tickets carried into next week: `____`.

## 5. False positives reported

Per [accuracy-measurement.md](accuracy-measurement.md): a false positive is
an address we marked `invalid` that the partner shows is deliverable.

| #   | Reported | Our reason code | Investigation result | Resolved? |
| --- | -------- | --------------- | -------------------- | --------- |
| 1   |          |                 |                      |           |
| 2   |          |                 |                      |           |

Running totals: reported to date `____`, confirmed as our error `____`,
confirmed correct (not actually deliverable) `____`, still open `____`.

If the accuracy join has reached minimum sample size, attach this week's
confusion matrix and precision/recall on `invalid`; otherwise write
"below minimum sample — raw counts only".

## 6. Feature requests and product signals

| #   | Request (partner's words, summarized) | How often raised | Our disposition             |
| --- | ------------------------------------- | ---------------- | --------------------------- |
| 1   |                                       |                  | logged / planned / declined |

## 7. Health check against the pilot's success metric

- Agreed success metric (from
  [onboarding-checklist.md](onboarding-checklist.md) section 4): `________`
- Current reading vs baseline: `________`
- On track for the review date? yes / no / at risk — if not "yes", the next
  concrete action and owner: `________`

## 8. One-line summary for the stop-criteria tracker

Is this partner an **active weekly user** this week (ran real checks, engaged
with results)? yes / no. This feeds the week-10 gate in
[stop-criteria.md](stop-criteria.md).
