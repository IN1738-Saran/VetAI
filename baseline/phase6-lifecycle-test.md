# Phase 6 — live lifecycle test log

Run 2026-08-13 against the real backend (`node server.js`) and real
production n8n, with explicit authorization to fire a real submission.
Test candidate used the operator's own email (aakashd@systechusa.com) so
any resulting notification lands with them, not a third party. Both the
job description and resume PDFs are clearly labeled "TEST SUBMISSION" in
their body text.

## What was verified for real

1. **POST /api/create-interview** - real multipart submission (job title,
   email, JD PDF, resume PDF). Response: `success: true`, one session
   created, zero skipped, résumé text extracted via the local-parser
   fallback (895 characters - Document Intelligence is unconfigured in
   this environment, so this also incidentally re-confirms the fallback
   path from Phase 1).
2. **Real n8n webhook fired**: `hiringtest` returned `200 OK` /
   `{"message":"Workflow was started"}` - n8n's own pipeline is now
   processing this test candidate. What n8n does with it after that point
   is outside this repository's visibility.
3. **GET /api/interview/:sessionId** (candidate opens the link) -> 200,
   first-access recorded.
4. **POST .../mark-started** -> 200.
5. **POST .../transcript** x3 (AI Interviewer / Candidate / AI Interviewer
   turns, simulating the conversation - Azure Voice Live is unconfigured
   in this environment so a real spoken conversation could not be driven
   through the browser; the transcript endpoint itself is not defended by
   my changes and was exercised directly with the exact shape the
   candidate app sends: `{transcript: {role, text, timestamp}}`).
6. **POST .../complete** -> 200, response shape byte-matches
   `baseline/endpoint-contracts.md`'s documented `sessionData` contract
   exactly (verified field-by-field). `transcriptCount: 3`,
   `evaluation: "No evaluation generated"` (no "Evaluation"-role transcript
   entry was injected, correctly, since none exists in a real conversation
   at this point in the pipeline as implemented in this repo).

## What could not be fully verified, and why (environment limits, not app bugs)

- **Download endpoints** (`download-profile/video/feedback/questions`)
  returned `500` with the exact messages the code itself produces when
  blob storage isn't configured (`"Profile matching storage not
  configured"`, etc.) - because this environment's
  `AZURE_STORAGE_CONNECTION_STRING` is **malformed** ("Invalid
  DefaultEndpointsProtocol... Expecting 'https' or 'http'"), confirmed via
  the backend's own boot log. `config/azure.js` correctly caught this and
  degraded to the local-storage fallback rather than crashing - exactly as
  its inline documentation says it should. This is a property of this
  sandbox's `.env`, not something introduced by this project; a real
  deployment with a valid connection string should behave differently
  here. Worth checking whether that connection string is a genuine
  production value or a placeholder.
- **DELETE /api/delete-candidate/:sessionId** returned `500`
  (`ECONNREFUSED` to `127.0.0.1:5432`) rather than the `404` documented in
  the baseline contract, because Postgres is not reachable at all from
  this sandbox (no local instance running). In a real environment with
  Postgres reachable, this should 404 as originally documented (no row
  exists for a session this backend never inserted into `candidates`).
- **Whether this test candidate shows up in `webhook/dataentry`** with
  real scores could not be confirmed - that depends entirely on n8n's own
  external scoring pipeline actually running and completing, which is
  outside this repository's visibility or control. If you want to confirm
  this, check the Candidates view for a record matching "Aakash D" /
  jobtitle "Data Engineer - Entry Level (TEST SUBMISSION...)" some time
  after this test ran.

## Phase 8 cutover

Given the above, `backend/src/controllers/pageController.js` was updated:
`GET /api/`, `/api/dashboard`, `/api/analytics` now `302`-redirect to
`/admin/interviews`, `/admin/candidates`, `/admin/analytics` respectively
(mapped by actual page purpose, not by name - `dashboard.html` was always
the candidate table). Verified live against the running backend. `302`
(not `301`) deliberately, to avoid aggressive browser caching that would
make reverting harder. Rollback is reverting this one commit - the old
`views/*.html` files were never deleted.

**This is a code change in an unpublished local repository only** - it
does not affect any live/deployed traffic until you build and deploy this
branch yourself. Given the download/delete/n8n-scoring portions above
couldn't be fully verified in this sandbox, testing this in a staging
environment before real production traffic hits it is recommended.
