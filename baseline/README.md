# Baseline — captured 2026-08-12, before any UI overhaul work

## Why this exists
Regression-testing reference point for the recruiter-panel UI overhaul. Every
phase must be diffable against this snapshot; any *behavior* difference (not
visual difference) against what's recorded here is a regression.

## How this was captured
**Static/source-only capture — no live requests were made against production
n8n or Power Automate.** Live end-to-end capture (create a real interview
through `admin.html`, watch it land in the dashboard, download artifacts,
delete it) was considered and explicitly declined for this baseline: this
environment's `.env` has real `POWER_AUTOMATE_URL` / `N8N_RETRY_REASON_URL`
values and `CREATION_WEBHOOK_URL` is hardcoded (not env-gated), so exercising
those flows here would submit live data to production systems. Nothing in
this repo's local environment can safely stand in for them (Postgres host is
unset, Document Intelligence/Voice Live endpoints are unset).

Consequences of this choice:
- `recruiter-pages-snapshot/` holds the exact byte-for-byte `admin.html` /
  `dashboard.html` / `analytics.html` as they exist at this commit — also
  fully recoverable from git history, but kept as a plain-file copy so it
  survives the Phase 8 cutover even after the originals are archived/deleted.
- `endpoint-contracts.md` documents the current request/response shape of
  every backend endpoint and every direct-to-n8n browser call, extracted from
  source rather than from one live sample. This is the fixture Phase 3–5
  component tests should be written against.
- No real `webhook/dataentry` response was captured (none was available, and
  the user chose not to inspect the live n8n instance for this pass — see the
  implementation plan's §4.3 "Explicitly flagged assumption"). **Every field
  in `endpoint-contracts.md` beyond the 9 proven `dataentry` fields is
  unverified and must be treated as absent** until a real payload is
  inspected. All UI built against those fields renders "not scored yet" /
  placeholder states per the plan's own instruction.

## What "zero regression" means for this project
At the end of every phase, `git diff <this-commit>..HEAD` must show **no
changes** inside:
- `frontend/src/**` (entire candidate-facing interview app)
- `backend/src/controllers/interviewController.js`
- `backend/src/controllers/webhookController.js`
- `backend/src/services/*`
- `backend/src/constants/index.js`
- `backend/src/config/*`
- `reverse-proxy/nginx.conf`'s existing `location /` and `location /api/`
  blocks (new, additive locations are fine)

Everything else (`backend/src/views/*.html` staying in place through Phase 7,
a new admin frontend app, small additive backend routes in Phase 5, nginx
additions) is expected to change.
