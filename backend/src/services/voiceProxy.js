// ============================================================================
// VOICE PROXY (secure WebSocket relay)
// The browser NEVER receives the Azure Voice Live API key. Instead it opens a
// WebSocket to this backend, and the backend opens its own upstream WebSocket
// to Azure with the key injected server-side. Messages are piped verbatim in
// both directions, so the client speaks the exact same Azure realtime protocol
// as before — only the transport hop changed:
//
//   Browser  ⇄  /api/interview/:sessionId/voice-stream  ⇄  Backend  ⇄  Azure
//                         (ticket, no key)                    (api-key header)
//
// Access control: the browser must present a short-lived, session-bound JWT
// "ticket" (issued by POST /interview/:sessionId/token). Guessing a sessionId
// is not enough — the ticket is signed, expires in seconds, and its embedded
// sessionId must match the URL path.
// ============================================================================
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';

import {
    AZURE_VOICELIVE_ENDPOINT,
    AZURE_VOICELIVE_API_KEY,
    AZURE_VOICELIVE_MODEL,
    AZURE_VOICELIVE_API_VERSION,
} from '../config/env.js';
import { interviewSessions, loadSessionFromAzure } from './sessionStore.js';

// Path the browser connects to (must live under /api so nginx/Vite proxy it).
const VOICE_STREAM_PATH = /^\/api\/interview\/([^/]+)\/voice-stream$/;

// Ticket lifetime — long enough to issue then immediately connect, short enough
// that a leaked ticket is useless within seconds.
const TICKET_TTL_SECONDS = 60;

// Per-boot signing secret. A dedicated env var is preferred in multi-instance
// deployments; otherwise a random secret is generated at startup (tickets are
// only valid for TICKET_TTL_SECONDS, well within a single process lifetime).
const TICKET_SECRET =
    process.env.VOICE_PROXY_SECRET || crypto.randomBytes(48).toString('hex');

/** Normalize the configured endpoint down to a bare host. */
function normalizedHost() {
    let host = (AZURE_VOICELIVE_ENDPOINT || '')
        .replace(/^wss?:\/\//, '')
        .replace(/^https?:\/\//, '')
        .replace(/\/+$/, '');
    if (host && !host.includes('.')) host = `${host}.services.ai.azure.com`;
    return host;
}

/** True for Azure AI Foundry Voice Live endpoints (drives the VAD choice). */
function isVoiceLiveFoundry() {
    return normalizedHost().includes('services.ai.azure.com');
}

/**
 * Issue a short-lived, session-bound ticket for the browser to authenticate its
 * voice WebSocket. Returns the connection details WITHOUT any Azure secret.
 * `isVoiceLiveFoundry` lets the client pick the correct turn-detection config
 * (that endpoint-type detection used to happen client-side).
 */
export function issueVoiceTicket(sessionId) {
    const ticket = jwt.sign({ sid: sessionId }, TICKET_SECRET, {
        expiresIn: TICKET_TTL_SECONDS,
    });
    return {
        ticket,
        wsPath: `/api/interview/${sessionId}/voice-stream`,
        model: AZURE_VOICELIVE_MODEL,
        apiVersion: AZURE_VOICELIVE_API_VERSION,
        isVoiceLiveFoundry: isVoiceLiveFoundry(),
    };
}

/** Verify a ticket and confirm it was issued for this exact sessionId. */
function ticketIsValid(ticket, sessionId) {
    if (!ticket) return false;
    try {
        const payload = jwt.verify(ticket, TICKET_SECRET);
        return payload.sid === sessionId;
    } catch {
        return false; // expired, tampered, or wrong signature
    }
}

/** Confirm the interview session exists and has not already been completed. */
async function sessionIsActive(sessionId) {
    let session = await loadSessionFromAzure(sessionId);
    if (!session) session = interviewSessions.get(sessionId);
    if (!session) return false;
    if (session.status === 'completed' || session.completedAt) return false;
    return true;
}

/**
 * Build the upstream Azure realtime URL (model + api-version only). The API key
 * is sent as a header, never in the URL — so it stays out of any logs too.
 * Mirrors the endpoint-type detection the browser used to do client-side.
 */
function buildAzureUrl() {
    const host = normalizedHost();
    const model = encodeURIComponent(AZURE_VOICELIVE_MODEL);
    const apiVersion = encodeURIComponent(AZURE_VOICELIVE_API_VERSION);

    if (isVoiceLiveFoundry()) {
        return `wss://${host}/voice-live/realtime?api-version=${apiVersion}&model=${model}`;
    }
    // Standard Azure OpenAI / Cognitive Services (and unknown → OpenAI path).
    return `wss://${host}/openai/realtime?api-version=${apiVersion}&deployment=${model}`;
}

/**
 * Attach the voice relay to an existing HTTP server. Handles the WebSocket
 * upgrade handshake, authenticates the ticket, then bridges browser ⇄ Azure.
 */
export function attachVoiceProxy(server) {
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', async (req, socket, head) => {
        let pathname;
        let ticket;
        try {
            const url = new URL(req.url, 'http://localhost');
            pathname = url.pathname;
            ticket = url.searchParams.get('ticket');
        } catch {
            socket.destroy();
            return;
        }

        const match = pathname.match(VOICE_STREAM_PATH);
        if (!match) {
            // Not our path — leave it alone (destroy so nothing else hangs).
            socket.destroy();
            return;
        }

        const sessionId = decodeURIComponent(match[1]);

        // ── Access control ─────────────────────────────────────────────────
        if (!ticketIsValid(ticket, sessionId)) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }
        if (!(await sessionIsActive(sessionId))) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
        }
        if (!AZURE_VOICELIVE_ENDPOINT || !AZURE_VOICELIVE_API_KEY) {
            console.error('❌ AZURE_VOICELIVE credentials are not configured in .env');
            socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
            socket.destroy();
            return;
        }

        wss.handleUpgrade(req, socket, head, (clientWs) => {
            bridge(clientWs, sessionId);
        });
    });

    console.log('🔒 Secure voice proxy attached at /api/interview/:sessionId/voice-stream');
}

/** Bridge one authenticated browser socket to a fresh upstream Azure socket. */
function bridge(clientWs, sessionId) {
    const azureUrl = buildAzureUrl();
    const upstream = new WebSocket(azureUrl, {
        headers: { 'api-key': AZURE_VOICELIVE_API_KEY },
    });

    // Buffer any client frames that arrive before Azure finishes connecting.
    //
    // CRITICAL: buffer the FRAME TYPE alongside the payload. `ws` decides text vs
    // binary from the `{binary}` option, and with it omitted a Buffer is sent as a
    // BINARY frame. This queue previously stored only the payload and replayed it
    // with a bare `upstream.send(data)`, so every buffered frame reached Azure as
    // binary and was rejected:
    //     "Invalid message type: binary is not supported, expected text message."
    // The browser connects to this backend over localhost almost instantly, so the
    // very first frame — session.update — is ALWAYS buffered while the upstream
    // Azure socket is still opening. It was therefore always corrupted, the session
    // was never configured, and Azure closed the socket (1008) after 5 rejected
    // attempts. That is the root cause of the "AI never speaks" bug: the realtime
    // protocol is 100% JSON TEXT, and the relay was silently converting it.
    const pending = [];
    let upstreamOpen = false;

    upstream.on('open', () => {
        upstreamOpen = true;
        const buffered = pending.length;
        for (const { data, isBinary } of pending) {
            upstream.send(data, { binary: isBinary });
        }
        pending.length = 0;
        console.log(`✅ Voice relay open for session ${sessionId} (flushed ${buffered} buffered frame(s))`);
    });

    // Browser → Azure
    clientWs.on('message', (data, isBinary) => {
        if (upstreamOpen && upstream.readyState === WebSocket.OPEN) {
            upstream.send(data, { binary: isBinary });
        } else {
            // Preserve isBinary — dropping it is what corrupted the handshake.
            pending.push({ data, isBinary });
        }
    });

    // Azure → Browser
    upstream.on('message', (data, isBinary) => {
        // Surface Azure error frames in the SERVER log. Without this, a rejected
        // session.update / response.create is only visible in the browser console,
        // which made "the AI never speaks" nearly impossible to diagnose.
        if (!isBinary) {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'error') {
                    console.error(`❌ Azure error frame (session ${sessionId}):`, JSON.stringify(msg.error));
                }
            } catch { /* not JSON — ignore */ }
        }
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(data, { binary: isBinary });
        }
    });

    // Teardown — closing either side tears down the other.
    const closeBoth = (code, reason) => {
        try { if (clientWs.readyState === WebSocket.OPEN) clientWs.close(code, reason); } catch { /* noop */ }
        try { if (upstream.readyState === WebSocket.OPEN) upstream.close(code, reason); } catch { /* noop */ }
    };

    upstream.on('close', (code, reason) => {
        // Azure closing without an error frame is the hardest failure to diagnose
        // from the browser (it only sees a generic 1011). Log the real code/reason.
        console.error(`🔴 Azure upstream CLOSED (session ${sessionId}) code=${code} reason="${reason?.toString?.() || ''}"`);
        // 1015/no-status and abnormal codes are not always forwardable; normalize.
        const safeCode = code >= 1000 && code <= 4999 && code !== 1005 && code !== 1006 ? code : 1011;
        try { if (clientWs.readyState === WebSocket.OPEN) clientWs.close(safeCode, reason?.toString?.().slice(0, 120) || ''); } catch { /* noop */ }
    });
    upstream.on('error', (err) => {
        console.error(`❌ Azure upstream error (session ${sessionId}):`, err.message);
        closeBoth(1011, 'upstream error');
    });
    clientWs.on('close', () => closeBoth(1000, 'client closed'));
    clientWs.on('error', () => closeBoth(1011, 'client error'));
}
