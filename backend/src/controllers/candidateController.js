// ============================================================================
// CANDIDATE CONTROLLER
// Candidate deletion and downloadable artifact endpoints
// (profile-matching text, interview video, feedback).
// ============================================================================
import { pool } from '../config/db.js';
import {
    containerClient,
    audioContainerClient,
    videoContainerClient,
    profileMatchingClient,
    feedbackContainerClient,
} from '../config/azure.js';
import { interviewSessions, deleteSessionFromAzure } from '../services/sessionStore.js';
import { streamToString } from '../utils/stream.js';

// Download profile matching text file
export async function downloadProfile(req, res) {
    const { sessionId } = req.params;

    if (!profileMatchingClient) {
        return res.status(500).json({ error: 'Profile matching storage not configured' });
    }

    try {
        const blobName = `${sessionId}_profile.txt`;
        const blobClient = profileMatchingClient.getBlockBlobClient(blobName);

        const exists = await blobClient.exists();
        if (!exists) {
            return res.status(404).json({ error: 'Profile file not found' });
        }

        const downloadResponse = await blobClient.download(0);
        const downloaded = await streamToString(downloadResponse.readableStreamBody);

        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename="${blobName}"`);
        res.send(downloaded);

        console.log(`✅ Profile downloaded: ${blobName}`);
    } catch (error) {
        console.error('❌ Error downloading profile:', error.message);
        res.status(500).json({ error: 'Failed to download profile', details: error.message });
    }
}

// Download interview video
export async function downloadVideo(req, res) {
    const { sessionId } = req.params;

    if (!videoContainerClient) {
        return res.status(500).json({ error: 'Video storage not configured' });
    }

    try {
        const blobName = `unified_video_${sessionId}.webm`;
        const blobClient = videoContainerClient.getBlockBlobClient(blobName);

        const exists = await blobClient.exists();
        if (!exists) {
            return res.status(404).json({ error: 'Video file not found' });
        }

        const downloadResponse = await blobClient.download(0);

        res.setHeader('Content-Type', 'video/webm');
        res.setHeader('Content-Disposition', `attachment; filename="interview_${sessionId}.webm"`);

        downloadResponse.readableStreamBody.pipe(res);

        console.log(`✅ Video downloaded: ${blobName}`);
    } catch (error) {
        console.error('❌ Error downloading video:', error.message);
        res.status(500).json({ error: 'Failed to download video', details: error.message });
    }
}

// Download interview feedback
export async function downloadFeedback(req, res) {
    const { sessionId } = req.params;

    if (!feedbackContainerClient) {
        return res.status(500).json({ error: 'Feedback storage not configured' });
    }

    try {
        const blobName = `interview_${sessionId}.txt`;
        const blobClient = feedbackContainerClient.getBlockBlobClient(blobName);

        const exists = await blobClient.exists();
        if (!exists) {
            return res.status(404).json({ error: 'Feedback file not found' });
        }

        const downloadResponse = await blobClient.download(0);
        const downloaded = await streamToString(downloadResponse.readableStreamBody);

        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename="interview_${sessionId}_feedback.txt"`);
        res.send(downloaded);

        console.log(`✅ Feedback downloaded: ${blobName}`);
    } catch (error) {
        console.error('❌ Error downloading feedback:', error.message);
        res.status(500).json({ error: 'Failed to download feedback', details: error.message });
    }
}

// Download the list of questions the AI asked (extracted from the saved transcript).
export async function downloadQuestions(req, res) {
    const { sessionId } = req.params;

    if (!containerClient) {
        return res.status(500).json({ error: 'Transcript storage not configured' });
    }

    try {
        const blobName = `transcript_${sessionId}.json`;
        const blobClient = containerClient.getBlockBlobClient(blobName);

        const exists = await blobClient.exists();
        if (!exists) {
            return res.status(404).json({ error: 'Transcript not found for this session' });
        }

        const downloadResponse = await blobClient.download(0);
        const downloaded = await streamToString(downloadResponse.readableStreamBody);

        let data;
        try { data = JSON.parse(downloaded); } catch { data = {}; }
        const entries = Array.isArray(data.transcript) ? data.transcript : [];

        // Keep only the AI interviewer's turns, dropping the greeting and closing
        // statement, so the file contains just the questions that were asked.
        const isGreetingOrClosing = (t) => {
            const s = (t || '').toLowerCase();
            return s.includes('welcome to your interview')
                || s.includes('pleasure speaking with you')
                || s.includes('wish you the very best')
                || s.includes('the team will review your interview');
        };

        const questions = entries
            .filter(e => e && e.role === 'AI Interviewer' && e.text && !isGreetingOrClosing(e.text))
            .map(e => e.text.trim())
            .filter(Boolean);

        const header =
            `Interview Questions\n` +
            `Role    : ${data.jobTitle || 'N/A'}\n` +
            `Session : ${sessionId}\n` +
            `Total   : ${questions.length} questions\n` +
            `----------------------------------------\n\n`;

        const body = questions.length
            ? questions.map((q, i) => `${i + 1}. ${q}`).join('\n\n')
            : 'No questions were recorded for this interview.';

        // Build a readable filename: "<role>_questions_<short-ref>.txt"
        // e.g. "data_engineer_questions_4d6653b0.txt" instead of the raw session UUID.
        const rolePart = (data.jobTitle || 'interview')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '') || 'interview';
        const refId = (sessionId || '').replace(/-/g, '').slice(-6) || sessionId || 'ref';
        const fileName = `${rolePart}_questions_${refId}.txt`;

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(header + body + '\n');

        console.log(`✅ Questions downloaded: ${fileName} (${questions.length} questions)`);
    } catch (error) {
        console.error('❌ Error downloading questions:', error.message);
        res.status(500).json({ error: 'Failed to download questions', details: error.message });
    }
}

/**
 * DELETE CANDIDATE ENDPOINT
 */
export async function deleteCandidate(req, res) {
    const { sessionId } = req.params;

    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
    }

    try {
        // Delete from PostgreSQL
        const deleteQuery = 'DELETE FROM candidates WHERE sessionid = $1 RETURNING *';
        const result = await pool.query(deleteQuery, [sessionId]);

        if (result.rowCount === 0) {
            return res.status(404).json({
                error: 'Candidate not found',
                sessionId
            });
        }

        console.log(`✅ Deleted candidate from PostgreSQL: ${sessionId}`);

        // Delete from in-memory session store
        if (interviewSessions.has(sessionId)) {
            interviewSessions.delete(sessionId);
            console.log(`✅ Deleted session from memory: ${sessionId}`);
        }

        // Delete from Azure Blob Storage (optional but recommended)
        try {
            // Delete session metadata
            await deleteSessionFromAzure(sessionId);

            // Delete transcript
            if (containerClient) {
                const transcriptBlobName = `transcript_${sessionId}.json`;
                const transcriptClient = containerClient.getBlockBlobClient(transcriptBlobName);
                await transcriptClient.deleteIfExists();
                console.log(`✅ Deleted transcript: ${transcriptBlobName}`);
            }

            // Delete resume PDF
            if (containerClient) {
                const blobs = containerClient.listBlobsFlat({ prefix: `resume_${sessionId}_` });
                for await (const blob of blobs) {
                    await containerClient.deleteBlob(blob.name);
                    console.log(`✅ Deleted resume: ${blob.name}`);
                }
            }

            // Delete audio files
            if (audioContainerClient) {
                const audioBlobs = audioContainerClient.listBlobsFlat({ prefix: `audio_` });
                for await (const blob of audioBlobs) {
                    if (blob.name.includes(sessionId)) {
                        await audioContainerClient.deleteBlob(blob.name);
                        console.log(`✅ Deleted audio: ${blob.name}`);
                    }
                }
            }

            // Delete video
            if (videoContainerClient) {
                const videoBlobName = `unified_video_${sessionId}.webm`;
                const videoClient = videoContainerClient.getBlockBlobClient(videoBlobName);
                await videoClient.deleteIfExists();
                console.log(`✅ Deleted video: ${videoBlobName}`);
            }

            // Delete profile matching file
            if (profileMatchingClient) {
                const profileBlobName = `${sessionId}_profile.txt`;
                const profileClient = profileMatchingClient.getBlockBlobClient(profileBlobName);
                await profileClient.deleteIfExists();
                console.log(`✅ Deleted profile: ${profileBlobName}`);
            }

            // Delete feedback file
            if (feedbackContainerClient) {
                const feedbackBlobName = `interview_${sessionId}.txt`;
                const feedbackClient = feedbackContainerClient.getBlockBlobClient(feedbackBlobName);
                await feedbackClient.deleteIfExists();
                console.log(`✅ Deleted feedback: ${feedbackBlobName}`);
            }

        } catch (azureError) {
            console.warn(`⚠️ Azure cleanup warning for ${sessionId}:`, azureError.message);
            // Continue even if Azure cleanup fails
        }

        res.json({
            success: true,
            message: 'Candidate deleted successfully',
            sessionId,
            deletedRecord: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Error deleting candidate:', error);
        res.status(500).json({
            error: 'Failed to delete candidate',
            details: error.message
        });
    }
}
