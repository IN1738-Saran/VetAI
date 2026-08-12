// ============================================================================
// AZURE AI DOCUMENT INTELLIGENCE SERVICE  (NEW — OCR integration)
// ----------------------------------------------------------------------------
// Reusable wrapper around Azure AI Document Intelligence (prebuilt-layout).
// It is the single place in the backend that talks to the OCR service; every
// caller (résumé extraction, job-description extraction, anything added later)
// goes through `analyzeDocument()`.
//
// Why the REST API instead of an SDK:
//   The backend runs on Node 20, where `fetch` is built in. Calling the REST
//   endpoint directly keeps the integration dependency-free — no new package to
//   install, audit or ship in the Docker image — and the analyse/poll protocol
//   is only a few dozen lines.
//
// Protocol (api-version 2024-11-30, the current GA):
//   1. POST   {endpoint}/documentintelligence/documentModels/{model}:analyze
//             with the raw file bytes as the body        -> 202 + Operation-Location
//   2. GET    {Operation-Location}                        -> { status, analyzeResult }
//      poll until status is "succeeded" / "failed", or the timeout expires.
//
// This module NEVER throws for reasons the caller cannot act on: every Azure or
// transport failure is translated into a `DocumentIntelligenceError` carrying a
// human-readable message, so callers can log it and fall back cleanly.
// ============================================================================
import {
    AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
    AZURE_DOCUMENT_INTELLIGENCE_KEY,
    AZURE_DOCUMENT_INTELLIGENCE_MODEL,
    AZURE_DOCUMENT_INTELLIGENCE_API_VERSION,
    AZURE_DOCUMENT_INTELLIGENCE_TIMEOUT_MS,
    AZURE_DOCUMENT_INTELLIGENCE_KEY_VALUE_PAIRS,
} from '../config/env.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// How often the long-running operation is polled, in milliseconds.
const POLL_INTERVAL_MS = 1000;

// Paragraph roles that are page furniture rather than document body text.
// They are dropped when text is rebuilt from `paragraphs` (the DOCX path).
const STRUCTURAL_PARAGRAPH_ROLES = new Set(['pageHeader', 'pageFooter', 'pageNumber']);

// Content types Azure recognises. Anything else is submitted as a raw byte
// stream and Azure sniffs the format from the bytes themselves.
const SUPPORTED_MIME_TYPES = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/msword',                                                      // .doc (legacy)
    'image/jpeg',
    'image/png',
    'image/bmp',
    'image/tiff',
    'image/heif',
]);

// The `keyValuePairs` add-on is a prebuilt-layout feature and is only available
// for PDF and image inputs — Azure rejects it outright for Office documents.
const ADDON_CAPABLE_MIME_TYPES = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/bmp',
    'image/tiff',
    'image/heif',
]);

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Every failure raised by this module. `message` is always safe to show to an
 * operator; `details` carries the underlying Azure explanation when there is
 * one, and `statusCode` mirrors the HTTP status Azure returned (or a sensible
 * equivalent for local failures).
 */
export class DocumentIntelligenceError extends Error {
    constructor(message, { details = '', statusCode = 502, azureCode = null } = {}) {
        super(message);
        this.name = 'DocumentIntelligenceError';
        this.details = details;
        this.statusCode = statusCode;
        this.azureCode = azureCode;
    }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * True when the endpoint and key are both present. Callers use this to decide
 * whether to attempt OCR at all, so a deployment with no Document Intelligence
 * resource configured keeps working exactly as it did before this integration.
 */
export function isDocumentIntelligenceConfigured() {
    return Boolean(AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT && AZURE_DOCUMENT_INTELLIGENCE_KEY);
}

/** Normalised endpoint with no trailing slash. */
function baseEndpoint() {
    return String(AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || '').replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Best-effort extraction of Azure's own error message from a failed response.
 * Azure returns `{ error: { code, message, innererror } }`; anything else falls
 * back to the raw body text.
 */
async function readAzureError(response) {
    let body = '';
    try {
        body = await response.text();
    } catch {
        return { code: null, message: '' };
    }

    try {
        const parsed = JSON.parse(body);
        const error = parsed?.error || parsed;
        return {
            code: error?.code || null,
            message: error?.message || error?.innererror?.message || body.slice(0, 400),
        };
    } catch {
        return { code: null, message: body.slice(0, 400) };
    }
}

/**
 * Map an Azure HTTP status onto a `DocumentIntelligenceError` with an
 * actionable message. Mirrors the mapping used by the standalone OCR app.
 */
function translateHttpError(status, { code, message }) {
    if (status === 400) {
        return new DocumentIntelligenceError(
            'Azure Document Intelligence could not process this document.',
            {
                details: message || 'The file may be corrupt, password-protected, or in an unexpected format.',
                statusCode: 400,
                azureCode: code,
            }
        );
    }
    if (status === 401 || status === 403) {
        return new DocumentIntelligenceError(
            'Azure Document Intelligence rejected the credentials.',
            {
                details: 'Check AZURE_DOCUMENT_INTELLIGENCE_KEY and that the key belongs to the configured endpoint.',
                statusCode: status,
                azureCode: code,
            }
        );
    }
    if (status === 404) {
        return new DocumentIntelligenceError(
            `Azure could not find model '${AZURE_DOCUMENT_INTELLIGENCE_MODEL}' at the configured endpoint.`,
            {
                details: 'Verify AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_MODEL.',
                statusCode: 404,
                azureCode: code,
            }
        );
    }
    if (status === 413) {
        return new DocumentIntelligenceError('Azure rejected the document because it is too large.', {
            details: message || 'The Azure service size limit applies in addition to this app\'s 10 MB cap.',
            statusCode: 413,
            azureCode: code,
        });
    }
    if (status === 429) {
        return new DocumentIntelligenceError('Azure Document Intelligence rate limit reached.', {
            details: message || 'Too many requests for the current pricing tier — retry shortly.',
            statusCode: 429,
            azureCode: code,
        });
    }
    if (status >= 500) {
        return new DocumentIntelligenceError('Azure Document Intelligence reported a server-side error.', {
            details: message || 'This is usually transient — retry shortly.',
            statusCode: 502,
            azureCode: code,
        });
    }

    return new DocumentIntelligenceError('Azure Document Intelligence returned an unexpected error.', {
        details: message,
        statusCode: 502,
        azureCode: code,
    });
}

/**
 * True when a 400 was caused only by the requested add-on feature, meaning a
 * retry WITHOUT the add-on is worth one attempt: cheap, and it turns a hard
 * failure into a usable (if slightly reduced) result.
 */
function isAddonRejection(status, message) {
    if (status !== 400 || !message) return false;
    const lowered = message.toLowerCase();
    return ['feature', 'addon', 'add-on'].some((token) => lowered.includes(token));
}

// ---------------------------------------------------------------------------
// Analyse + poll
// ---------------------------------------------------------------------------

/**
 * Submit the document and return the `Operation-Location` URL to poll.
 * Throws `DocumentIntelligenceError` on any non-202 response.
 */
async function submitAnalysis(buffer, mimetype, features, timeoutMs) {
    const model = AZURE_DOCUMENT_INTELLIGENCE_MODEL;
    const params = new URLSearchParams({ 'api-version': AZURE_DOCUMENT_INTELLIGENCE_API_VERSION });
    if (features.length) params.set('features', features.join(','));

    const url = `${baseEndpoint()}/documentintelligence/documentModels/${encodeURIComponent(model)}:analyze?${params}`;

    // Azure sniffs the real format from the bytes, so an unknown MIME type is
    // safely submitted as a generic byte stream rather than rejected here.
    const contentType = SUPPORTED_MIME_TYPES.has(mimetype) ? mimetype : 'application/octet-stream';

    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                'Ocp-Apim-Subscription-Key': AZURE_DOCUMENT_INTELLIGENCE_KEY,
                'Content-Type': contentType,
            },
            body: buffer,
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch (error) {
        throw new DocumentIntelligenceError('Could not reach the Azure Document Intelligence endpoint.', {
            details: `${error.name}: ${error.message}. Check network connectivity, proxy settings and the endpoint URL.`,
            statusCode: 503,
            azureCode: 'NetworkError',
        });
    }

    if (response.status !== 202) {
        const azureError = await readAzureError(response);
        const error = translateHttpError(response.status, azureError);
        // Tag add-on rejections so the caller can retry without the feature.
        error.addonRejected = isAddonRejection(response.status, azureError.message);
        throw error;
    }

    const operationLocation = response.headers.get('operation-location');
    if (!operationLocation) {
        throw new DocumentIntelligenceError('Azure accepted the document but returned no operation URL.', {
            details: 'The Operation-Location response header was missing.',
            statusCode: 502,
        });
    }

    return operationLocation;
}

/**
 * Poll the long-running operation until it succeeds, fails, or the deadline
 * passes. Returns the raw `analyzeResult` object.
 */
async function pollAnalysis(operationLocation, timeoutMs) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);

        let response;
        try {
            response = await fetch(operationLocation, {
                headers: { 'Ocp-Apim-Subscription-Key': AZURE_DOCUMENT_INTELLIGENCE_KEY },
                signal: AbortSignal.timeout(Math.max(5000, deadline - Date.now())),
            });
        } catch (error) {
            throw new DocumentIntelligenceError('Lost the connection to Azure while waiting for the analysis.', {
                details: `${error.name}: ${error.message}`,
                statusCode: 503,
                azureCode: 'NetworkError',
            });
        }

        if (!response.ok) {
            throw translateHttpError(response.status, await readAzureError(response));
        }

        const payload = await response.json();
        const status = String(payload?.status || '').toLowerCase();

        if (status === 'succeeded') {
            return payload.analyzeResult || {};
        }
        if (status === 'failed') {
            const azureError = payload?.error || {};
            throw new DocumentIntelligenceError('Azure Document Intelligence failed to analyse the document.', {
                details: azureError.message || 'The service reported the operation as failed.',
                statusCode: 400,
                azureCode: azureError.code || null,
            });
        }
        // "notStarted" / "running" — keep polling.
    }

    throw new DocumentIntelligenceError(
        `Azure did not finish analysing the document within ${Math.round(timeoutMs / 1000)} seconds.`,
        {
            details: 'Try a smaller document, or raise AZURE_DOCUMENT_INTELLIGENCE_TIMEOUT_MS.',
            statusCode: 504,
            azureCode: 'Timeout',
        }
    );
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/**
 * Rebuild the document text, preserving reading order and line structure.
 *
 * Preference order:
 *   1. per-page `lines` — best line fidelity, which the résumé field parser
 *      depends on (bullet lists, one-per-line contact blocks);
 *   2. `paragraphs` — the only text container populated for Office inputs such
 *      as DOCX, where pages carry no lines;
 *   3. `content` — the service's own concatenation, as a last resort.
 */
export function extractTextFromAnalyzeResult(result) {
    const pageChunks = [];

    for (const page of result?.pages || []) {
        const lines = page?.lines || [];
        if (!lines.length) continue;
        pageChunks.push(lines.map((line) => String(line?.content || '').trimEnd()).join('\n'));
    }
    if (pageChunks.length) return pageChunks.join('\n\n').trim();

    const paragraphs = result?.paragraphs || [];
    if (paragraphs.length) {
        return paragraphs
            .filter((p) => String(p?.content || '').trim() && !STRUCTURAL_PARAGRAPH_ROLES.has(p?.role))
            .map((p) => String(p.content).trimEnd())
            .join('\n')
            .trim();
    }

    return String(result?.content || '').trim();
}

/**
 * Convert detected tables into a plain rectangular grid plus metadata.
 * Cell values are mirrored across every slot a merged cell spans.
 */
function extractTables(result) {
    return (result?.tables || []).map((table, index) => {
        const rowCount = Number(table?.rowCount || 0);
        const columnCount = Number(table?.columnCount || 0);
        const grid = Array.from({ length: rowCount }, () => Array(columnCount).fill(''));
        let headerRowCount = 0;

        for (const cell of table?.cells || []) {
            const rowIndex = Number(cell?.rowIndex || 0);
            const columnIndex = Number(cell?.columnIndex || 0);
            const rowSpan = Number(cell?.rowSpan || 1);
            const columnSpan = Number(cell?.columnSpan || 1);
            const content = String(cell?.content || '').trim();

            if (cell?.kind === 'columnHeader') {
                headerRowCount = Math.max(headerRowCount, rowIndex + rowSpan);
            }

            for (let r = rowIndex; r < Math.min(rowIndex + rowSpan, rowCount); r++) {
                for (let c = columnIndex; c < Math.min(columnIndex + columnSpan, columnCount); c++) {
                    grid[r][c] = content;
                }
            }
        }

        return {
            index,
            rowCount,
            columnCount,
            headerRowCount,
            pageNumber: table?.boundingRegions?.[0]?.pageNumber ?? null,
            caption: String(table?.caption?.content || '').trim() || null,
            rows: grid,
        };
    });
}

/** Flatten detected key/value pairs, skipping entries with an empty key. */
function extractKeyValuePairs(result) {
    const pairs = [];

    for (const pair of result?.keyValuePairs || []) {
        const key = String(pair?.key?.content || '').trim();
        if (!key) continue;

        pairs.push({
            key: key.replace(/:+$/, '').trim() || key,
            value: String(pair?.value?.content || '').trim(),
            confidence: typeof pair?.confidence === 'number' ? Math.round(pair.confidence * 1000) / 1000 : null,
        });
    }

    return pairs;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Run one document through Azure AI Document Intelligence.
 *
 * @param {Buffer} buffer     Raw file bytes.
 * @param {string} mimetype   MIME type reported by the uploader.
 * @param {string} filename   Original file name (logging / diagnostics only).
 * @returns {Promise<{
 *   text: string,
 *   tables: Array<object>,
 *   keyValuePairs: Array<object>,
 *   documentInfo: object,
 *   warnings: string[]
 * }>}
 * @throws {DocumentIntelligenceError} on any configuration, transport or
 *         service failure. Callers are expected to catch and fall back.
 */
export async function analyzeDocument(buffer, mimetype, filename = 'document') {
    if (!isDocumentIntelligenceConfigured()) {
        throw new DocumentIntelligenceError('Azure AI Document Intelligence is not configured.', {
            details: 'Set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY in the backend environment.',
            statusCode: 500,
            azureCode: 'NotConfigured',
        });
    }
    if (!buffer || !buffer.length) {
        throw new DocumentIntelligenceError('Cannot analyse an empty file.', {
            details: `'${filename}' contained no bytes.`,
            statusCode: 400,
        });
    }

    const timeoutMs = AZURE_DOCUMENT_INTELLIGENCE_TIMEOUT_MS;
    const warnings = [];

    // Ask for key/value pairs only where Azure actually supports the add-on.
    let features = [];
    if (AZURE_DOCUMENT_INTELLIGENCE_KEY_VALUE_PAIRS && AZURE_DOCUMENT_INTELLIGENCE_MODEL === 'prebuilt-layout') {
        if (ADDON_CAPABLE_MIME_TYPES.has(mimetype)) {
            features = ['keyValuePairs'];
        } else {
            warnings.push(`Key/value pairs are not available for ${mimetype} inputs (Azure supports PDF and images only).`);
        }
    }

    const startedAt = Date.now();
    console.log(`🔍 [DocIntel] Analysing "${filename}" (${mimetype}, ${buffer.length} bytes) with ${AZURE_DOCUMENT_INTELLIGENCE_MODEL}...`);

    let operationLocation;
    try {
        operationLocation = await submitAnalysis(buffer, mimetype, features, timeoutMs);
    } catch (error) {
        // One automatic retry without the add-on when that was the only problem.
        if (error.addonRejected && features.length) {
            console.warn(`⚠️ [DocIntel] Add-on feature rejected for "${filename}" — retrying without it.`);
            warnings.push('Key/value pair extraction was rejected by Azure for this document and was skipped.');
            features = [];
            operationLocation = await submitAnalysis(buffer, mimetype, features, timeoutMs);
        } else {
            throw error;
        }
    }

    const result = await pollAnalysis(operationLocation, timeoutMs);

    const text = extractTextFromAnalyzeResult(result);
    const tables = extractTables(result);
    const keyValuePairs = extractKeyValuePairs(result);
    const elapsedMs = Date.now() - startedAt;

    if (!text) warnings.push('Azure returned no readable text for this document.');

    console.log(
        `✅ [DocIntel] "${filename}" analysed in ${(elapsedMs / 1000).toFixed(2)}s — ` +
        `${text.length} chars, ${result?.pages?.length || 0} page(s), ${tables.length} table(s), ${keyValuePairs.length} key/value pair(s)`
    );

    return {
        text,
        tables,
        keyValuePairs,
        documentInfo: {
            fileName: filename,
            mimeType: mimetype,
            fileSizeBytes: buffer.length,
            pages: result?.pages?.length || 0,
            model: AZURE_DOCUMENT_INTELLIGENCE_MODEL,
            apiVersion: result?.apiVersion || AZURE_DOCUMENT_INTELLIGENCE_API_VERSION,
            features,
            processingTimeSeconds: Math.round(elapsedMs) / 1000,
        },
        warnings,
    };
}
