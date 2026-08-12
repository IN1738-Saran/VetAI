# Endpoint & webhook contracts — baseline snapshot

Extracted directly from source at the baseline commit. Field names are
verbatim. This is the regression fixture for Phase 3–7: any new UI must
consume/produce these exact shapes.

## Backend HTTP endpoints (mounted at `/api`)

### Pages (`routes/pageRoutes.js` → `controllers/pageController.js`)
| Method | Path | Behavior |
|---|---|---|
| GET | `/api/` | Sends `views/admin.html` |
| GET | `/api/dashboard` | Sends `views/dashboard.html` |
| GET | `/api/analytics` | Sends `views/analytics.html` |

### Interview lifecycle (`routes/interviewRoutes.js` → `controllers/interviewController.js`)
| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/api/create-interview` | multipart: `jobTitle`, `toEmails`, `jobDescription` (1 PDF), `resumes` (1–5 PDFs) | `{ success, sessions: [{ sessionId, resumeFileName, interviewUrl, ocr: { source, charactersExtracted, documentInfo, warnings, error, resumeInfo, stats, rawText, rawTextTruncated } }], count, skipped: [{fileName, reason}], skippedCount }`. All-rejected case: `{ success:false, error, skipped, count:0 }` (400). |
| GET | `/api/interview/:sessionId` | — | Full session object minus `resumeBuffers`/`jobDescriptionBuffer`, i.e. `{ sessionId, jobTitle, toEmails, jobDescription, jobDescriptionFileName, resumeText, resumeFileName, resumeMimeType, resumePdfUrl, candidateName, candidateEmail, status, createdAt, expiresAt, firstAccessedAt, interviewStartedAt, completedAt, transcript, candidateAudioUrl, aiAudioUrl, unifiedVideoUrl, audioDuration, videoDuration, videoFileSize }`. 404 `NOT_FOUND` / 410 `ALREADY_COMPLETED` / 410 `EXPIRED` on failure. |
| POST | `/api/interview/:sessionId/mark-started` | — | sets `status:'active'`, `interviewStartedAt` |
| POST | `/api/interview/:sessionId/transcript` | per-turn transcript entry | — |
| POST | `/api/interview/:sessionId/audio` | — | — |
| POST | `/api/upload-chunk` | multipart `chunk`, header `x-session-id` | `{ success, sequence, chunkSize }` |
| POST | `/api/interview/:sessionId/violation` | proctoring event | `{ success:true }` |
| POST | `/api/interview/:sessionId/complete` | — | `{ success:true, sessionData: { sessionId, jobTitle, toEmails, jobDescription, jobDescriptionFileName, resumeText, resumeFileName, candidateAudioUrl, aiAudioUrl, unifiedVideoUrl, videoBlobName, videoDuration, videoFileSize, transcriptBlobUrl, transcriptCount, evaluation, audioDuration, createdAt, ... } }` — **field names here must never change; likely consumed downstream by Power Automate/n8n.** |
| POST | `/api/update-session-dates/:sessionId` | — | resets 48h expiry window |
| POST | `/api/interview/:sessionId/token` | — | `{ ticket, expiresIn: 60 }`-shaped voice ticket (`issueVoiceTicket`) |
| POST | `/api/interview/notify` | arbitrary JSON body, forwarded verbatim | proxies to `POWER_AUTOMATE_URL` (server-side env var); `{success:false, skipped:true}` if unconfigured |
| POST | `/api/interview/reattempt` | arbitrary JSON body, forwarded verbatim | proxies to `N8N_RETRY_REASON_URL` (server-side env var); same skip behavior |
| WS | `/api/interview/:sessionId/voice-stream` | ticket-authenticated | bridges to Azure Voice Live |

### Candidate artifacts (`routes/candidateRoutes.js` → `controllers/candidateController.js`)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/download-profile/:sessionId` | streams `{sessionId}_profile.txt` from `interview-profile-matching` container |
| GET | `/api/download-video/:sessionId` | streams `unified_video_{sessionId}.webm` |
| GET | `/api/download-feedback/:sessionId` | streams `interview_{sessionId}.txt` from `interview-final-feedback` |
| GET | `/api/download-questions/:sessionId` | derives question list from transcript blob, filters AI greeting/closing lines |
| DELETE | `/api/delete-candidate/:sessionId` | **Requires a matching row in Postgres `candidates` table** (`DELETE ... WHERE sessionid = $1 RETURNING *`) — 404 if no row, even if the session exists in Azure/memory or appears in the n8n `dataentry` feed. Cascades to session (memory+Azure), transcript, resume, audio, video, profile, feedback blobs. |

### Job email configs (`routes/jobEmailRoutes.js` → `controllers/jobEmailController.js`)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/job-email-configs?q=` | `{ success, configs: [{id, jobtitle, emails}] }` |
| POST | `/api/job-email-configs` | upserts `{jobtitle, emails}` into `public.job_email_configs` |

## Direct browser → n8n calls (not proxied — called from `dashboard.html`/`analytics.html` JS)
| Call site | URL | Notes |
|---|---|---|
| `dashboard.html`, `analytics.html` on load | `POST https://n8n.systechusa.com/webhook/dataentry?ts=<timestamp>` | **Sole source of candidate list data.** Response is defensively unwrapped (`data`/`data.data`/`data.result`/`data.candidates`/bare object). Proven fields on each candidate object: `candidatename`, `candidateemail`, `jobtitle`, `overall_score`, `verdict`, `summary`, `status`, `createdat`, `sessionid`. No other field is proven to exist — treat as absent until a real payload is inspected. |
| `dashboard.html` row action | `POST https://n8n.systechusa.com/webhook/createinterview` | body includes `sessionid`, `candidatename`, `candidateemail`, `jobtitle`; followed by `POST /api/update-session-dates/:sessionId` |
| `dashboard.html` inline status edit | `POST https://n8n.systechusa.com/webhook/vetaiupdate` | body: `{ sessionid, status }` |

## Server → n8n call (not client-visible)
| Call site | URL | Notes |
|---|---|---|
| `interviewController.createInterview`, once per résumé | `POST https://n8n.systechusa.com/webhook/hiringtest` (`CREATION_WEBHOOK_URL`, hardcoded constant) | multipart: `event`, `sessionId`, `jobTitle`, `toEmails`, `jobDescription`, `jobDescriptionFileName`, `interviewUrl`, `expiresAt`, `timestamp`, `resumeText`, `candidateName`, `candidateEmail`, `jobDescriptionBase64`, `resumeFile` (blob), `resumeMetadata` (JSON string) |

## Badge/threshold logic to port verbatim (from `dashboard.html`)
- `getScoreBadgeClass(overall_score)`
- `getVerdictBadgeClass(verdict)` — lowercase match on verdict string
- `getStatusBadgeClass(status)` — lowercase match on status string

Port these exact thresholds into the new app's shared components rather than
re-deriving them — see plan §14/Strict-Constraint #10.

## Confirmed-inert code (do not treat as live surface area)
- `backend/legacy/**`, `frontend/legacy/**` — old `server.js` variants and
  `interview_*.tsx` variants, not imported by `app.js` or `main.ts`.
- `backend/public/admin.html` — stale duplicate; `GET /api/` actually serves
  `backend/src/views/admin.html` via `pageController.js`. The stale copy is
  technically reachable at `/api/admin.html` through the static mount but is
  not what any current flow uses.
