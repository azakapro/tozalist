# First 14 days — runbook

The day-by-day sequence that ties together the public landing page, the
buyer-interview script, and the pilot request form, ending at the day-14
gate. It assumes the marketing site is live in all three locales with the
contact page's pilot form (`/{locale}/contact`) accepting requests.

Related documents: [interview-script.md](interview-script.md) ·
[stop-criteria.md](stop-criteria.md) ·
[onboarding-checklist.md](onboarding-checklist.md).

## Standing daily loop (every weekday, days 1–14)

- Morning (30 min): review new pilot-form leads using the lead-review
  workflow below; reply to every new lead the same day; log each in the
  tracker as raw → contacted → scheduled.
- Midday: run the day's interviews (target below), scoring each the same day
  per the "After the call" section of the interview script.
- Evening (15 min): update the running totals against the day-14 gate —
  interviews done, qualified leads, written commitments — so the gap is
  visible daily, not discovered on day 14.

Weekly totals target to stay on pace: ≥ 10 interviews by end of day 7.

## Reviewing pilot-form leads (the only supported workflow)

The pilot form has no email notification, lead inbox, or dashboard view: a
submission is stored as a row in the production PostgreSQL `leads` table and
nothing else happens. Leads are therefore reviewed by querying that table
from a restricted server terminal on the production host, using the same
Compose v2 contract as every other operation in `deploy/README.md`.

> **This output is personal data.** Treat the terminal view as the system of
> record and read it in place. Never copy the output — or any email, phone,
> company, or message field from it — into chat, relay files, source control,
> analytics, spreadsheets, or this repository's tracker. The command prints
> no environment variables or credentials; keep it that way (no `echo` of
> connection strings, no `env`/`printenv`).

List the newest active, unexpired leads (soft-deleted and expired rows are
excluded; the result set is limited):

```bash
docker compose --env-file /secure/path/to/tozalist.production.env \
  -f docker-compose.prod.yml exec postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
    SELECT id, created_at, source, locale, email, company, phone, message
    FROM leads
    WHERE deleted_at IS NULL AND expires_at > now()
    ORDER BY created_at DESC
    LIMIT 50;"'
```

The variables expand inside the container (note the single quotes), so no
credential or environment value appears in shell history or on screen; the
database is reached over the container's local socket.

Updating the daily tracker without copying contact data: the tracker records
only the lead's `id` (the UUID from the first column), the date, the
`source`/`locale`, and the pipeline status (raw → contacted → scheduled →
interviewed). Contact details stay in the database; when you reply to a lead,
read the address from the terminal and write the reply in your mail or
messaging client directly — the tracker never holds the raw contact fields,
so it stays safe to keep alongside the repository and the decision log.

Do not build anything around this: no export scripts, no notification hooks,
no admin UI. If lead volume ever outgrows a 50-row terminal view, that is a
product decision for the PM, not a runbook workaround.

## Day-by-day

### Day 1 — arm the funnel

- Verify the landing page and pilot form work end to end in `uz`, `ru`, and
  `en`: submit one synthetic test request yourself and confirm a matching row
  is stored, using the lead-review workflow below. Mark that row's `id` as a
  test entry in the tracker so it is never counted as a lead; it will be
  removed automatically by the retention sweep.
- Create the interview tracker (one row per interview, fields from the
  script's scoring table) and the decision log.
- Write the outreach long-list: 60+ named organizations that visibly send
  mailings (e-commerce, education, services, media), each with a named human
  and a channel (phone, Telegram, LinkedIn, mutual contact).

### Day 2 — first outreach wave

- Send 20 personalized outreach messages from the long-list. The ask is the
  interview, not a sale: 25 minutes about how they run their mailing.
- Post the landing page once in each relevant community channel you already
  belong to (no spam, no mass posting).

### Day 3 — first interviews

- Target: 2 interviews. Follow the script exactly; same-day scoring.
- Send wave 2 of outreach (20 more) adjusted for what got replies in wave 1.

### Day 4 — interviews continue

- Target: 2 interviews (running total 4).
- Reply to pilot-form requests; schedule the qualified ones as interviews —
  form leads and outreach leads run through the **same script**.

### Day 5 — interviews + first synthesis

- Target: 2 interviews (running total 6).
- First synthesis pass over the scored interviews: which pain phrasing
  recurs? Update the landing-page headline **copy only** if the market's
  words are clearly better than ours. No feature work.

### Day 6–7 — catch-up and referrals

- Use these days to hit ≥ 10 total interviews by end of day 7.
- Mine completed interviews for referrals (the closing ask in the script);
  referrals convert to scheduled interviews faster than cold outreach.
- Week-1 checkpoint (written, in the decision log): interviews `__/10+`,
  qualified `__`, written commitments `__`. If interviews < 6, the
  bottleneck is outreach volume — double wave size in week 2.

### Day 8 — pilot offers to the warm

- Every interviewee scored "qualified" with pilot interest gets the written
  pilot offer: scope, 30-day duration, the agreed-metric idea from
  [onboarding-checklist.md](onboarding-checklist.md) section 4, and the
  price. Ask for the commitment **in writing**.
- Target: 2 interviews (running total 12).

### Day 9 — interviews + follow-ups

- Target: 2 interviews (running total 14).
- Follow up every unanswered pilot offer once, politely, with a deadline:
  "we're filling the first pilot group this week".

### Day 10 — interviews

- Target: 2 interviews (running total 16).
- Log every written commitment the moment it is received; a screenshot of
  the message goes into the partner's folder.

### Day 11 — interviews + pipeline hygiene

- Target: 2 interviews (running total 18).
- Reconcile the tracker: every row has a score, every qualified lead has a
  next action, every commitment is in writing or is not counted.

### Day 12 — final interviews

- Target: 2 interviews (running total 20).
- Anyone still unscheduled moves to a post-gate list — do not let interview
  chasing slip past the gate date.

### Day 13 — pre-gate audit

- Freeze the numbers: interviews completed per the script, qualified beta
  requests per the script's definition, written commitments with evidence.
- Audit each qualified lead and commitment against the definitions in
  [interview-script.md](interview-script.md) — remove anything that only
  almost qualifies. The gate is judged on defensible numbers.

### Day 14 — the gate

- Judge Gate 1 from [stop-criteria.md](stop-criteria.md): ≥ 20 interviews,
  ≥ 10 qualified beta requests, ≥ 3 written paid-pilot commitments.
- Write PASS or FAIL, the numbers, and the decision in the decision log the
  same day.
- **PASS:** begin onboarding committed partners through
  [onboarding-checklist.md](onboarding-checklist.md) — administratively and
  with synthetic data until the legal gate closes.
- **FAIL:** pause the build and run the reassessment exactly as
  [stop-criteria.md](stop-criteria.md) prescribes. No feature work.

## What is out of scope in these 14 days

- No new product features, no schema changes, no deployment changes — the
  build is feature-frozen while demand is being tested.
- No real customer data: interviews use aggregate counts and anonymized
  examples only; any early partner exercises the product with synthetic
  fixtures until the legal gate in `docs/PRE-PRODUCTION-GATES.md` closes.
- No public accuracy claims — see
  [accuracy-measurement.md](accuracy-measurement.md).
