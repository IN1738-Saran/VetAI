// ============================================================================
// STREAM UTILITIES
// ============================================================================

/**
 * Read a Node readable stream fully and decode it as UTF-8.
 *
 * Buffers are collected and concatenated BEFORE decoding. The previous version
 * called `data.toString()` on each chunk and joined the strings, which decodes
 * every chunk in isolation — so any multi-byte UTF-8 character that happened to
 * straddle a chunk boundary was turned into replacement characters (U+FFFD).
 * Chunk boundaries are decided by the network, so this corrupted session JSON
 * non-deterministically: the same blob could read back fine one time and fail
 * JSON.parse the next, surfacing as an interview link that "randomly" stops
 * working. (The write side had the mirror bug — see sessionStore.js.)
 */
export async function streamToString(readableStream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        readableStream.on('data', (data) => {
            chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
        });
        readableStream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        readableStream.on('error', reject);
    });
}
