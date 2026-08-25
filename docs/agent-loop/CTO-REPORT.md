# CTO Report — Step 8.1 correction (Node runtime contract)

## Step and outcome

Step `8.1`, focused runtime-contract correction per `PM-DECISION.md`. The repository's Node declarations are now aligned with the locked direct dependency `undici@8.10.0` (requires Node ≥ 22.19.0), which is what made GitHub Actions run `32857086592` fail after MinIO started: `.nvmrc` selected Node 20.20.2, below undici's floor, so no quality gate ran. `.nvmrc`, the root engine, and the two docs version statements now state a supported Node. Only the four authorized files and the relay records changed; `ci.yml`, dependencies, and the lockfile are untouched. Local-only — **no commit, push, PR, or other Git write** (none authorized this cycle).

## Changes made

- **`.nvmrc`**: `20` → `22.22.0` (the exact supported CI/runtime version; the workflow selects the runtime from this file).
- **root `package.json`** `engines.node`: `>=20` → `>=22.19.0` — matching the installed `undici@8.10.0` floor. This is the only change to `package.json`; no dependency, version, script, package-manager version, or lockfile change.
- **`README.md`**: the single Node-version row `Node.js | 20 or newer` → `Node.js | 22.19.0 or newer` (the `.nvmrc` link is preserved). No other README change.
- **`docs/architecture.md`**: the two existing Node-version statements `Fastify 4 (Node 20+)` → `(Node 22.19.0+)` and `Node 20+ / BullMQ` → `Node 22.19.0+ / BullMQ`. No other architecture change.

The non-version Node mentions (README's "Node.js and Python" webhook-sample line; architecture's "Node processes run on the host" operational lines) are not version statements and were deliberately left unchanged.

## Verification (local, to the extent available)

- **Workflow still reads `.nvmrc`**: `.github/workflows/ci.yml` line 69 still declares `node-version-file: .nvmrc` and was not modified (confirmed by `git diff --name-only`), so aligning `.nvmrc` alone selects the corrected CI runtime.
- **Frozen install on Node 22.22.0**: in an isolated clean copy (a `git archive` of HEAD overlaid with the corrected `.nvmrc`/`package.json` and the unchanged lockfile, no pre-existing `node_modules`), `node --version` was `v22.22.0`, `engines.node` resolved to `>=22.19.0`, and `pnpm install --frozen-lockfile` completed successfully (**exit 0**) under the repository's `engine-strict=true`. The frozen install left `pnpm-lock.yaml` byte-identical to the committed lockfile, confirming no lockfile drift.
- **`git diff --check`**: clean.
- **Scope confirmed**: changed set is `.nvmrc`, `package.json`, `README.md`, `docs/architecture.md` (the four authorized files) plus the relay records; `ci.yml`, `pnpm-lock.yaml`, dependencies, scripts, product code, tests, benchmarks, and all other docs are unchanged.

Stated honestly: this proves the corrected runtime contract installs cleanly under a frozen lockfile on Node 22.22.0. It does not run the GitHub Actions runner locally and is not a claim that the remote CI run passed — the authoritative confirmation is a green GitHub Actions run after a later, explicitly authorized correction push, which is not authorized this cycle.

## Files changed

`.nvmrc` · `package.json` (engines only) · `README.md` (one version row) · `docs/architecture.md` (two version statements) · `docs/agent-loop/CTO-REPORT.md` · `docs/agent-loop/STATE.md`. `docs/agent-loop/PM-DECISION.md` is the PM's correction decision and was left untouched.

## Carry-forward pre-production gates (unchanged, still blocking)

- The supported Next.js/React upgrade in `docs/PRE-PRODUCTION-GATES.md` remains blocking before Phase 9 deployment or public beta; no framework upgrade was performed here.
- Lighthouse remains a Phase 9 deployment gate. A subsequent GitHub Actions run must pass before Step 8.2.

## Git status

`feat/phase-8-hardening`, this runtime-contract correction local and uncommitted on top of the synced commit `18ab3c3`. No PR exists. Awaiting PM review; a Git sync (to re-trigger remote CI) happens only on an explicit later authorization.
