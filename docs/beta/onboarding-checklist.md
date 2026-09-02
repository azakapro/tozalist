# Design-partner onboarding checklist

Copy this file once per partner (for example `onboarding-<partner-slug>.md` in
your private working folder — partner copies contain business details and are
**not** committed to this repository). Every box must be checked and every
field filled in before the partner's first real-list upload. An unchecked box
blocks onboarding; there are no verbal exceptions.

Related documents: [interview-script.md](interview-script.md) ·
[accuracy-measurement.md](accuracy-measurement.md) ·
[weekly-report-template.md](weekly-report-template.md) ·
[stop-criteria.md](stop-criteria.md) ·
[first-14-days-runbook.md](first-14-days-runbook.md)

> **Hard precondition for all partners:** the Uzbekistan legal review gate in
> `docs/PRE-PRODUCTION-GATES.md` must be closed before any partner uploads a
> real customer list. Until then, partners may only be onboarded
> administratively (this checklist, contract, account setup) and may exercise
> the product with synthetic data.

## Partner identity

| Field                                    | Value |
| ---------------------------------------- | ----- |
| Partner organization name                |       |
| Legal entity name (as on contract)       |       |
| Industry / vertical                      |       |
| Primary contact (name, role)             |       |
| Primary contact channel (phone/Telegram) |       |
| Onboarding owner on our side             |       |

## 1. Consent basis — confirmed and documented

- [ ] The partner has stated, in writing, the lawful basis on which every
      address on the pilot list was collected (for example: customer purchase
      relationship, explicit newsletter opt-in, signed service agreement).
- [ ] The stated basis covers **verification processing by a third party**
      (us), not only the partner's own sending.
- [ ] The written statement is stored in the partner's contract folder and its
      location is recorded here: `<folder/file reference>`
- [ ] Purchased, scraped, or rented lists were explicitly asked about and the
      partner confirmed in writing that the pilot list contains none.
      **Purchased/scraped lists are a hard rejection — end onboarding.**

## 2. List source declared

| Field                                                    | Value |
| -------------------------------------------------------- | ----- |
| Where the list lives (CRM, e-commerce platform, sheet)   |       |
| How addresses were originally collected                  |       |
| Date range of collection (oldest → newest entry)         |       |
| Has the list ever been merged with a third-party source? |       |
| If yes: which source, and is it excluded from the pilot? |       |

## 3. Sample size

- [ ] Pilot sample size agreed: `______` addresses.
- [ ] The sample meets the minimum for accuracy measurement
      (see [accuracy-measurement.md](accuracy-measurement.md) — at least
      1,000 addresses with observed send outcomes, of which at least 200
      receive a definitive `valid`/`invalid` verdict; below that the pilot can
      still run, but no accuracy claim may be made from it).
- [ ] Sample fits inside the partner's granted credit balance.

## 4. Agreed success metric

Pick exactly one primary metric and write the number down. "Cleaner list" is
not a metric.

- [ ] Primary metric chosen:
  - [ ] Hard-bounce rate on the next campaign below `____%` (baseline: `____%`)
  - [ ] At least `____` undeliverable addresses identified and removed
  - [ ] Sender-reputation recovery (state the measurable indicator): `______`
- [ ] Baseline value recorded before the first cleaned send.
- [ ] Review date on which the metric is judged: `____-__-__`

## 5. Retention setting chosen

- [ ] Partner has chosen a result-retention window and understands results are
      deleted after it (`organizations.retention_days`).
- [ ] Chosen value — exactly one of the three supported windows (the product
      accepts no other value, so 45, 60, 180, and similar cannot be set):
  - [ ] `7` days
  - [ ] `30` days (product default)
  - [ ] `90` days
- [ ] The partner knows deletion is automatic and unrecoverable, and that
      re-checking after expiry consumes new credits.

## 6. False-positive feedback contact

- [ ] Named person on the partner side who will report addresses we marked
      `invalid`/`risky` that they believe are deliverable:
      name `________`, role `________`, channel `________`.
- [ ] That person has read the short version of
      [accuracy-measurement.md](accuracy-measurement.md) (sections
      "Definitions" and "What to report").
- [ ] Agreed response time from us on false-positive reports: 2 business days.

## 7. Pilot dates

| Field                                             | Value        |
| ------------------------------------------------- | ------------ |
| Pilot start date                                  | `____-__-__` |
| Mid-pilot check-in (start + 2 weeks)              | `____-__-__` |
| Pilot review date (start + 30 days)               | `____-__-__` |
| Weekly report day (see weekly-report-template.md) | `________`   |

## 8. Pricing agreed in writing

- [ ] Pilot price and what it includes (credit volume, support level) is
      written in the signed pilot agreement or a confirmed written message —
      **never only verbal**.
- [ ] Amount and currency recorded: `________ UZS` for `________` checks.
- [ ] Payment method agreed (invoice-request billing only — the product has no
      online payment provider): `________`.
- [ ] Invoice issued / payment status: `________`.

## 9. Account setup (our side)

- [ ] Organization created; retention set to the value from section 5.
- [ ] Credits granted matching the agreed pilot volume (manual grant with a
      reference to the pilot agreement).
- [ ] One API key issued and delivered through a channel the partner controls;
      the plaintext key is never stored on our side or in any shared document.
- [ ] Partner has successfully run one **synthetic** batch (fixtures such as
      `test-address@example.invalid`) end to end before touching real data.
- [ ] Weekly report scheduled (copy
      [weekly-report-template.md](weekly-report-template.md) into the
      partner's folder).

## Sign-off

| Role                    | Name | Date | Confirmed |
| ----------------------- | ---- | ---- | --------- |
| Onboarding owner (us)   |      |      | [ ]       |
| Partner primary contact |      |      | [ ]       |

Onboarding is complete only when every section above is checked. If any item
cannot be completed, stop and record the blocker — do not work around it.
