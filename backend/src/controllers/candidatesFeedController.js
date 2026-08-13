// ============================================================================
// CANDIDATES FEED CONTROLLER (Phase 5 - optional, additive backend hardening)
// Server-side proxies for the three direct-from-browser n8n calls that power
// the recruiter panel (dataentry, createinterview, vetaiupdate). None of
// these routes are called unless the admin-frontend build is configured to
// use them (VITE_USE_CANDIDATES_PROXY=true) - the default, unconfigured
// behavior is the direct-from-browser call, exactly as dashboard.html/
// analytics.html do today. See baseline/endpoint-contracts.md for the exact
// contracts being proxied.
//
// These webhook URLs are intentionally NOT added to constants/index.js -
// that file is on the "do not modify" list (plan Strict Constraint #4).
// Keeping them local to this new file is the more conservative additive
// change.
// ============================================================================
import { resetSessionWindow } from './interviewController.js';

const DATAENTRY_URL = 'https://n8n.systechusa.com/webhook/dataentry';
const CREATEINTERVIEW_URL = 'https://n8n.systechusa.com/webhook/createinterview';
const VETAIUPDATE_URL = 'https://n8n.systechusa.com/webhook/vetaiupdate';

// A session id is always a uuidv4 in this codebase (see
// interviewController.createInterview's `uuidv4()`). Validating the shape
// before it's interpolated into a JSON body sent to n8n is cheap
// defense-in-depth (plan section 12).
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidSessionId(value) {
    return typeof value === 'string' && SESSION_ID_PATTERN.test(value);
}

// Ported verbatim (in behavior) from the unwrapping logic duplicated across
// dashboard.html/analytics.html - centralized here per plan section 4.2's
// stated rationale for this proxy. Kept independent from the admin-frontend
// TypeScript copy (lib/candidates.ts) since they run in different runtimes;
// the two must be kept in sync by hand if n8n's response shape ever changes.
function unwrapCandidates(data) {
    if (Array.isArray(data)) return data;

    if (data && typeof data === 'object') {
        if (data.candidatename || data.candidateemail) return [data];
        if (Array.isArray(data.data)) return data.data;
        if (data.data && typeof data.data === 'object') return [data.data];
        if (data.result) return Array.isArray(data.result) ? data.result : [data.result];
        if (data.candidates) return Array.isArray(data.candidates) ? data.candidates : [data.candidates];
        return [data];
    }

    return [];
}

// GET /api/candidates
export async function getCandidatesFeed(req, res) {
    try {
        const n8nRes = await fetch(`${DATAENTRY_URL}?ts=${Date.now()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timestamp: Date.now() }),
        });

        const data = await n8nRes.json();
        res.json({ candidates: unwrapCandidates(data) });
    } catch (error) {
        console.error('❌ candidates-feed proxy error:', error.message);
        res.status(502).json({ error: 'Failed to reach candidates feed', details: error.message });
    }
}

// POST /api/candidates/:sessionId/status  { status: string }
export async function updateCandidateStatus(req, res) {
    const { sessionId } = req.params;
    const { status } = req.body || {};

    if (!isValidSessionId(sessionId)) {
        return res.status(400).json({ error: 'Invalid session id' });
    }
    // n8n's vetaiupdate accepts any free-text status today (dashboard.html's
    // inline editor imposes no validation either) - this is basic
    // sanitization, not a new restriction on what values are allowed.
    if (typeof status !== 'string' || !status.trim() || status.length > 200) {
        return res.status(400).json({ error: 'status must be a non-empty string under 200 characters' });
    }

    try {
        const n8nRes = await fetch(VETAIUPDATE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionid: sessionId, status: status.trim() }),
        });

        if (!n8nRes.ok) {
            return res.status(502).json({ error: 'n8n rejected the status update' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('❌ candidates-feed status proxy error:', error.message);
        res.status(502).json({ error: 'Failed to reach n8n', details: error.message });
    }
}

// POST /api/candidates/:sessionId/create-interview
// { candidatename, candidateemail, jobtitle }
export async function createInterviewForCandidate(req, res) {
    const { sessionId } = req.params;
    const { candidatename, candidateemail, jobtitle } = req.body || {};

    if (!isValidSessionId(sessionId)) {
        return res.status(400).json({ error: 'Invalid session id' });
    }

    try {
        const n8nRes = await fetch(CREATEINTERVIEW_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionid: sessionId, candidatename, candidateemail, jobtitle }),
        });

        if (!n8nRes.ok) {
            return res.status(502).json({ error: 'n8n rejected the interview creation' });
        }

        // Reuses the exact same session-window reset as the existing
        // POST /api/update-session-dates/:sessionId route (plan section 5.3:
        // "internally calls the existing updateSessionDates logic - reuse
        // it, don't duplicate").
        const { createdAt, expiresAt } = await resetSessionWindow(sessionId);
        res.json({ success: true, createdAt, expiresAt });
    } catch (error) {
        if (error.statusCode === 404) {
            return res.status(404).json({ error: 'Session not found' });
        }
        console.error('❌ candidates-feed create-interview proxy error:', error.message);
        res.status(502).json({ error: 'Failed to reach n8n', details: error.message });
    }
}
