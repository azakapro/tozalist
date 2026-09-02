# Stop criteria — the written gates

These are **hard pass/fail gates, not aspirations**. Each gate has a date, a
numeric threshold, and a mandatory action on failure. The action on failure
is always a version of the same thing: **pause and reassess — never "build
more features and hope"**. Building past a failed gate is explicitly
prohibited; it converts market evidence we already paid for into wasted
engineering.

Related documents: [interview-script.md](interview-script.md) (what counts as
qualified / committed) ·
[weekly-report-template.md](weekly-report-template.md) (the weekly evidence
feed) · [first-14-days-runbook.md](first-14-days-runbook.md) (the day-by-day
path to gate 1).

## How gates are judged

- Each gate is judged on its date, using written evidence only: the
  interview tracker, written commitments, weekly reports, and the ledger.
  Verbal enthusiasm counts for nothing at a gate.
- A gate is either **PASS** (every threshold met) or **FAIL** (any threshold
  missed). There is no "almost".
- The judgment, the numbers, and the decision are written down the same day,
  in the decision log kept alongside the private partner folders.

## Gate 1 — Day 14 (demand)

Judged 14 calendar days after the first-14-days runbook starts.

| #   | Threshold                                                   | Pass requires |
| --- | ----------------------------------------------------------- | ------------- |
| 1   | Structured buyer interviews completed (per the script)      | ≥ 20          |
| 2   | Qualified beta requests (definition in interview-script.md) | ≥ 10          |
| 3   | **Written** paid-pilot commitments (message or signed note) | ≥ 3           |

**On FAIL: pause the build.** No new feature work, no Phase-10 planning, no
"one more integration". The only permitted work is: finish obligations to
anyone already committed, and run the reassessment below. Re-entering build
mode requires a new written decision recording what changed.

Reassessment questions (answered in writing): Which threshold failed and by
how much? Is the wedge wrong (product), the segment wrong (audience), or the
channel wrong (how we reached them)? What is the cheapest next test that
does not involve writing code?

## Gate 2 — Week 10 (usage)

Judged at the end of week 10 of the plan.

| #   | Threshold                                                                                                   | Pass requires |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------- |
| 1   | Partners onboarded via the full checklist, using **real, consented** lists (requires the legal gate closed) | 3–5           |
| 2   | Partners active in ≥ 2 distinct weeks (per weekly-report line 8)                                            | ≥ 2           |

**On FAIL: pause and reassess.** If the legal gate is what blocked real-list
usage, the reassessment is about sequencing and legal timeline, not product.
If partners signed but did not upload, the reassessment is about activation
friction: interview the non-active partners with the same discipline as the
original script before changing anything in the product.

## Gate 3 — Week 13 (business)

Judged at the end of week 13. This is the continue / narrow / stop decision.

| #   | Threshold                                                                                                                      | Pass requires |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| 1   | Paying customers (money received, not promised)                                                                                | ≥ 3           |
| 2   | Contribution margin (revenue minus hosting and direct service costs, before our own time)                                      | positive      |
| 3   | Repeatable acquisition message: the same written pitch produced at least two of the paying customers without bespoke rewriting | demonstrated  |

**On FAIL: pause and write the decision memo — continue, narrow, or stop —
before any further building.** A fail here does not automatically mean stop;
it means the default of "keep building" is revoked and continuing requires
an explicit, written case.

## Standing rule

Failing any gate means **pausing and reassessing, not building more
features**. The instinct at a failed gate is always "the next feature will
fix it" — that instinct is the reason this file exists. The reassessment is
done with the same rigor as the interviews: written questions, written
answers, and a written decision before any code is touched.
