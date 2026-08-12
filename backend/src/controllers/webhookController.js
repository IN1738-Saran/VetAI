// ============================================================================
// WEBHOOK PROXY
//
// The browser used to call Power Automate and n8n DIRECTLY, with their URLs
// hardcoded in frontend/src/services/api.ts. The Power Automate URL carries its
// own authorisation in the query string:
//
//     ...triggers/manual/paths/invoke?api-version=1&sp=...&sv=1.0&sig=<SAS>
//
// Vite bundles that string into the JavaScript it serves, so the signature was
// readable by anyone who opened DevTools or fetched the bundle — and a SAS
// signature IS the credential: possession of it is enough to trigger that
// workflow, from anywhere, as many times as you like.
//
// Both calls now go through the backend, which holds the URLs in env vars and
// never sends them to the client.
// ============================================================================
import {
    POWER_AUTOMATE_URL,
    N8N_RETRY_REASON_URL,
} from '../config/env.js';

/** POST /interview/notify — relay interview-complete data to Power Automate. */
export async function notifyPowerAutomate(req, res) {
    if (!POWER_AUTOMATE_URL) {
        console.warn('⚠️ POWER_AUTOMATE_URL is not configured — skipping completion webhook.');
        // Not an error the candidate should ever see: the interview itself is
        // already saved. Report it as skipped so the UI does not show a failure.
        return res.json({ success: false, skipped: true, reason: 'not configured' });
    }

    try {
        const upstream = await fetch(POWER_AUTOMATE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(req.body ?? {}),
        });

        const text = await upstream.text();
        console.log(`📡 Power Automate responded ${upstream.status}`);
        // Pass through status for observability, but never the URL or its signature.
        return res.status(upstream.ok ? 200 : 502).json({
            success: upstream.ok,
            status: upstream.status,
            body: text.slice(0, 2000),
        });
    } catch (err) {
        console.error('❌ Power Automate relay failed:', err.message);
        return res.status(502).json({ success: false, error: 'Upstream webhook failed' });
    }
}

/** POST /interview/reattempt — relay a re-attempt request to n8n. */
export async function notifyReattempt(req, res) {
    if (!N8N_RETRY_REASON_URL) {
        console.warn('⚠️ N8N_RETRY_REASON_URL is not configured — skipping reattempt webhook.');
        return res.json({ success: false, skipped: true, reason: 'not configured' });
    }

    try {
        const upstream = await fetch(N8N_RETRY_REASON_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body ?? {}),
        });

        const text = await upstream.text();
        console.log(`📡 n8n reattempt webhook responded ${upstream.status}`);
        return res.status(upstream.ok ? 200 : 502).json({
            success: upstream.ok,
            status: upstream.status,
            body: text.slice(0, 2000),
        });
    } catch (err) {
        console.error('❌ n8n reattempt relay failed:', err.message);
        return res.status(502).json({ success: false, error: 'Upstream webhook failed' });
    }
}
