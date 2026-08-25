# PM–CTO Relay Protocol

`ROADMAP.md` is the approved source of scope, order, step prompts, required verification, and acceptance criteria. `STATE.md` is the single current-state record. `CTO-REPORT.md` and `PM-DECISION.md` are overwritten with a completed report and decision for the active step on each relay cycle; Git history may retain earlier versions when commits are explicitly permitted.

## Mandatory rules

1. Claude Code executes exactly one roadmap step at a time.
2. Claude must run the step’s required verification, write `CTO-REPORT.md`, then set `STATE.md` to `awaiting_pm_review`.
3. Claude must stop after reporting. It must not begin another step.
4. PM reviews the actual diff and CTO report, then writes `APPROVED`, `CORRECTION_REQUIRED`, `BLOCKED`, or `STOP` into `PM-DECISION.md`.
5. Only `APPROVED` may move `STATE.md` to `ready_for_cto` with the next step ID.
6. Never commit, push, deploy, delete material data, enable production SMTP, process real customer data, add payment providers, or change legal/privacy policy unless `PM-DECISION.md` explicitly permits it.
7. Never put API keys, passwords, full customer emails, Redis URLs with credentials, or other secrets in relay files.
8. Keep the existing roadmap order unless `PM-DECISION.md` explicitly changes it.

## Relay workflow

### 1. CTO takes one step

Claude Code may begin only when `STATE.md` assigns the current step to Claude Code with status `ready_for_cto`, or when the PM has recorded `CORRECTION_REQUIRED` for that same step and the state is `correction_required`. Claude must read all five relay files before acting and must stay within the current step.

Claude may set the status to `in_progress` while working. It must not change the step ID. Pre-existing working-tree changes belong to earlier work unless the current step deliberately and necessarily changes the same files; the CTO report must distinguish them from current-step work.

### 2. CTO verifies, reports, and stops

Claude must run every verification required by the current roadmap step and the roadmap’s universal review checks. If a check cannot run, Claude records it as `NOT_RUN` with the exact blocker; it must not claim the step passed.

Claude then fully completes `CTO-REPORT.md`, updates `STATE.md` as follows, and stops:

- Status: `awaiting_pm_review`
- Current step: unchanged
- Owner: PM
- Last verified test total: the latest passing total and its scope
- Next action: PM reviews the actual diff and CTO report

No implementation, cleanup, refactor, or next-step preparation may continue after the report.

### 3. PM decides from evidence

The PM reviews the actual repository diff, the CTO report, the step acceptance criteria, and verification results. The PM completes `PM-DECISION.md` with exactly one decision and updates `STATE.md`:

| Decision | Required state transition |
|---|---|
| `APPROVED` | Advance to the next ordered step, set `ready_for_cto`, assign Claude Code, and state that next step as the only action. After final Step 9.2, set `complete` instead. |
| `CORRECTION_REQUIRED` | Keep the same step ID, set `correction_required`, assign Claude Code, and list only the required corrections as the next action. |
| `BLOCKED` | Keep the same step ID, set `blocked`, assign the owner who must resolve it, and state the unblock action. |
| `STOP` | Keep the same step ID, set `stopped`, assign PM ownership, and do no further roadmap work. |

Approval applies only to the reported step. It does not authorize commits, pushes, deployments, destructive operations, production SMTP, real customer data, payment-provider work, or legal/privacy-policy changes unless the exceptional-permissions section explicitly authorizes the exact action and scope.

### 4. Corrections remain one-step work

After `CORRECTION_REQUIRED`, Claude modifies only the same step as directed, re-runs the required verification, rewrites `CTO-REPORT.md`, sets `STATE.md` back to `awaiting_pm_review`, and stops again. A correction never advances the roadmap.

## State values

Use only these statuses: `ready_for_cto`, `in_progress`, `awaiting_pm_review`, `correction_required`, `blocked`, `stopped`, and `complete`.
