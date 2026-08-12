// ============================================================================
// SESSION STORE
// In-memory session registry plus Azure Blob persistence helpers for session
// metadata.
// ============================================================================
import { sessionMetadataClient } from '../config/azure.js';
import { streamToString } from '../utils/stream.js';

// In-memory session registry (mirrors Azure blob metadata).
export const interviewSessions = new Map();

/**
 * Save session metadata to Azure Blob Storage
 */
export async function saveSessionToAzure(sessionId, sessionData) {
    if (!sessionMetadataClient) {
        console.warn('⚠️ Azure Blob not configured - session not persisted');
        return;
    }

    try {
        const blobName = `session_${sessionId}.json`;
        const blobClient = sessionMetadataClient.getBlockBlobClient(blobName);

        // Remove buffers before saving (not JSON serializable)
        const { resumeBuffers, jobDescriptionBuffer, ...dataToSave } = sessionData;
        const jsonData = JSON.stringify(dataToSave, null, 2);

        // Upload BYTES, not UTF-16 code units.
        //
        // This was `blobClient.upload(jsonData, jsonData.length, ...)`. The
        // second argument is a CONTENT LENGTH IN BYTES, but String.length counts
        // UTF-16 code units — so every non-ASCII character made the declared
        // length smaller than the real payload and Azure stored a TRUNCATED
        // blob. The result is invalid JSON: loadSessionFromAzure()'s JSON.parse
        // then throws, the catch returns null, and the interview surfaces as
        // "Interview not found / this link is invalid".
        //
        // This is not an edge case. Résumés and job descriptions routinely
        // contain em-dashes, bullets (•), curly quotes and accented names, and
        // the growing transcript is re-saved into this same blob after every
        // turn — so a session could load fine at first and become corrupt
        // mid-interview, as soon as one such character was transcribed.
        const payload = Buffer.from(jsonData, 'utf8');
        await blobClient.upload(payload, payload.byteLength, {
            blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' }
        });

        console.log(`✅ Session ${sessionId} saved to Azure Blob`);
    } catch (error) {
        console.error(`❌ Failed to save session ${sessionId} to Azure:`, error.message);
    }
}

/**
 * Load session metadata from Azure Blob Storage
 */
export async function loadSessionFromAzure(sessionId) {
    if (!sessionMetadataClient) {
        return null;
    }

    try {
        const blobName = `session_${sessionId}.json`;
        const blobClient = sessionMetadataClient.getBlockBlobClient(blobName);

        const downloadResponse = await blobClient.download(0);
        const downloaded = await streamToString(downloadResponse.readableStreamBody);

        const sessionData = JSON.parse(downloaded);
        console.log(`✅ Session ${sessionId} loaded from Azure Blob`);
        return sessionData;
    } catch (error) {
        if (error.statusCode === 404) {
            return null; // Session not found
        }
        console.error(`❌ Failed to load session ${sessionId} from Azure:`, error.message);
        return null;
    }
}

/**
 * Update session metadata in Azure Blob Storage
 */
export async function updateSessionInAzure(sessionId, sessionData) {
    // Same as save - overwrites the blob
    await saveSessionToAzure(sessionId, sessionData);
}

/**
 * Delete session metadata from Azure Blob Storage (optional cleanup)
 */
export async function deleteSessionFromAzure(sessionId) {
    if (!sessionMetadataClient) return;

    try {
        const blobName = `session_${sessionId}.json`;
        const blobClient = sessionMetadataClient.getBlockBlobClient(blobName);
        await blobClient.deleteIfExists();
        console.log(`✅ Session ${sessionId} deleted from Azure Blob`);
    } catch (error) {
        console.error(`❌ Failed to delete session ${sessionId}:`, error.message);
    }
}
