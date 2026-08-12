/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Centralized API layer. Owns the API base URL and all network request
 * construction for the interview backend and external webhooks. Each helper
 * returns the raw fetch Response promise (or the sendBeacon boolean) so callers
 * keep full control over response handling — behavior is identical to the
 * original inline fetch calls.
 */

export const API_BASE = (import.meta.env.VITE_API_BASE || '/api');

// NOTE: the Power Automate and n8n URLs used to live here as string literals.
//
// Vite bundles this file into the JavaScript served to every candidate, so the
// Power Automate URL — which authorises itself with a SAS signature in the query
// string (`&sig=...`) — was readable by anyone who opened DevTools or simply
// downloaded the bundle. That signature IS the credential: holding it is enough
// to trigger the workflow from anywhere, repeatedly, with no other secret.
//
// Both calls now go through the backend, which keeps the URLs in env vars
// (POWER_AUTOMATE_URL, N8N_RETRY_REASON_URL) and never returns them.

/**
 * POST /interview/:sessionId/token — obtain a short-lived ticket + relay path
 * for the secure voice WebSocket. Returns NO Azure key/endpoint; the key stays
 * server-side and the browser connects to the backend relay, not Azure.
 */
export function getVoiceToken(sessionId: string) {
  return fetch(`${API_BASE}/interview/${sessionId}/token`, { method: 'POST' });
}

/** GET /interview/:sessionId — load session data. */
export function fetchSession(sessionId: string) {
  return fetch(`${API_BASE}/interview/${sessionId}`);
}

/** POST /interview/:sessionId/transcript — append one transcript entry. */
export function postTranscript(sessionId: string, entry: unknown) {
  return fetch(`${API_BASE}/interview/${sessionId}/transcript`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript: entry })
  });
}

/** POST /upload-chunk — upload a single recorded video chunk. */
export function uploadChunk(sessionId: string, formData: FormData) {
  return fetch(`${API_BASE}/upload-chunk`, {
    method: 'POST',
    body: formData,
    headers: { 'x-session-id': sessionId }
  });
}

/** POST /interview/:sessionId/mark-started — mark the interview as started. */
export function markInterviewStarted(sessionId: string) {
  return fetch(`${API_BASE}/interview/${sessionId}/mark-started`, { method: 'POST' });
}

/** POST /interview/:sessionId/complete — mark complete and retrieve session data. */
export function completeInterview(sessionId: string) {
  return fetch(`${API_BASE}/interview/${sessionId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
}

/** POST /interview/:sessionId/violation — record a proctoring violation. */
export function postViolation(sessionId: string, violation: unknown) {
  return fetch(`${API_BASE}/interview/${sessionId}/violation`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(violation)
  });
}

/** Emergency transcript save on page unload via navigator.sendBeacon. */
export function sendEmergencySaveBeacon(sessionId: string, payload: unknown): boolean {
  return navigator.sendBeacon(`${API_BASE}/interview/${sessionId}/emergency-save`, JSON.stringify(payload));
}

/** Trigger the Power Automate completion flow with the finalized session data. */
export function triggerPowerAutomate(sessionData: unknown) {
  return fetch(`${API_BASE}/interview/notify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(sessionData)
  });
}

/** Submit a candidate reattempt request to the n8n webhook. */
export function submitReattemptRequest(payload: unknown) {
  return fetch(`${API_BASE}/interview/reattempt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload)
  });
}
