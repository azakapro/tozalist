# Buyer interview script (20 interviews)

The structured script for the 20-buyer discovery interviews. Run it the same
way every time so answers are comparable. Target length: 25–30 minutes.
Language: whichever the buyer prefers (uz / ru / en).

Related documents: [first-14-days-runbook.md](first-14-days-runbook.md)
(scheduling and daily targets) · [stop-criteria.md](stop-criteria.md) (what
the interview count feeds) ·
[onboarding-checklist.md](onboarding-checklist.md) (what a qualified buyer
goes through next).

## The one non-negotiable rule

> **Never request raw personal data at the interview stage.** No customer
> lists, no exported files, no screen-shares of mailboxes or CRMs, no "just
> send me a sample". Work only with **aggregate counts** ("about 12,000
> subscribers") and **anonymized examples** ("an address like
> `name@company.uz` that bounced"). If a buyer offers to send their list,
> decline explicitly and say why: "Not yet — we only accept lists under a
> signed pilot agreement with a documented consent basis." This protects the
> buyer, their customers, and us.

## Before the call (2 minutes)

- [ ] Record: date, buyer name, company, role, source of the lead.
- [ ] Confirm the buyer actually sends email to a list (screening question —
      if they do not, politely end early and do not count the interview).

## Opening (verbatim)

"Thanks for the time. We're building a tool that checks whether the email
addresses on a mailing list can actually receive mail, before you send. I'm
not selling anything today — I want to understand how you run your mailing
and where it hurts. Twenty-five minutes, ten questions. I'll take notes and
use them internally as research for what we build; and please don't share
any actual customer data with me — counts and rough numbers are all I
need."

## The ten core questions

Ask in order. Record the answer verbatim where marked ⏺.

### 1. Data source

"Where do the email addresses on your list come from?" ⏺
Probe: website signup? checkout? offline forms? events? imported from
somewhere? Listen for (do not suggest) purchased or scraped sources — if
mentioned, note it; that buyer cannot become a pilot partner until that
source is excluded.

### 2. Monthly email volume

"Roughly how many emails do you send per month, to how many unique
addresses?" ⏺
Record two numbers: sends/month `______`, list size `______`.

### 3. Hard-bounce cost

"What happens today when addresses bounce? What has it cost you?" ⏺
Probe for a concrete incident: a blocked sender domain, a provider warning, a
campaign that underperformed, hours spent cleaning manually. Record the cost
in their own units (money, hours, a lost campaign).

### 4. Current tool and spend

"Do you use anything today to clean or verify the list? What does it cost?" ⏺
Record: tool name (or "manual" / "nothing") `______`, spend/month `______`.
If a foreign tool: ask how they pay for it (this feeds question 9).

### 5. Consent basis

"When someone ends up on your list, what did they agree to?" ⏺
Probe: explicit opt-in checkbox? implied by purchase? nothing recorded? This
is a qualification question — partners without an articulable consent basis
cannot pilot with real data (see
[onboarding-checklist.md](onboarding-checklist.md) section 1).

### 6. Last cleanup date

"When did you last remove dead addresses from the list, and how?" ⏺
Record: date/never `______`, method `______`.

### 7. Decision maker

"If you decided to pay for list cleaning, who signs off on that spend?" ⏺
Record: role `______`; is the interviewee that person? yes / no.

### 8. Budget

"What monthly amount would be a no-brainer for this, and what amount would
need a serious discussion?" ⏺
Record both numbers in UZS: no-brainer `______`, needs-discussion `______`.

### 9. Preferred payment method

"How would you want to pay — bank transfer against an invoice, corporate
card, Click/Payme, something else?" ⏺
Record verbatim. Note for us: the pilot supports **invoice-request billing
only**; treat demand for other methods as roadmap evidence, not a promise.

### 10. Willingness to pay for a 30-day pilot

"We run 30-day paid pilots: you get a set number of checks, we measure the
result against your next campaign together. Would you commit to that in
writing if the price were inside your no-brainer number?" ⏺
Record: yes / no / conditional, and the condition.

## Closing (verbatim)

"That's everything. Two asks: first, may I contact you when the pilot program
opens? Second, is there anyone else you know who runs a mailing list and
feels this pain?" Record the referral if given (name and public contact only).

## After the call (5 minutes, same day)

- [ ] Score the interview in the tracker (one row per interview):

| Field               | Value                               |
| ------------------- | ----------------------------------- |
| Qualified beta lead | yes / no                            |
| Pilot commitment    | none / verbal / **written**         |
| List size band      | <1k / 1k–10k / 10k–50k / >50k       |
| Consent basis       | explicit / implied / unclear / none |
| Current spend/month | amount or 0                         |
| Follow-up owed      | what and by when                    |

A **qualified beta lead** = sends regularly, has an articulable consent
basis, has bounce pain they described unprompted, and the interviewee is (or
directly reaches) the decision maker.

A **written paid-pilot commitment** = a message or signed note from the buyer
stating they will pay the stated amount for the 30-day pilot. Verbal counts
as interest, not commitment, for
[stop-criteria.md](stop-criteria.md).
