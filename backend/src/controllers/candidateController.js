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
    sessionMetadataClient,
} from '../config/azure.js';
import { interviewSessions, deleteSessionFromAzure, loadSessionFromAzure } from '../services/sessionStore.js';
import { streamToString } from '../utils/stream.js';
import { generateReportPdf, generateFeedbackReportPdf } from '../services/reportPdf.js';
import { extractHighlights, matchSkillsAgainstText } from '../services/reportHighlights.js';

// candidatename/jobtitle live only in n8n's dataentry feed, which this
// backend never queries (see baseline/endpoint-contracts.md) - rather than
// adding a new server-side call to n8n just to look them up, the
// admin-frontend (which already has them from the feed it fetched) passes
// them as query params. Both are optional; the PDF falls back to "N/A"/the
// session id if absent, so the endpoint still works for any caller that
// doesn't have them.
function reportMetaFromQuery(req) {
    return {
        candidateName: typeof req.query.name === 'string' ? req.query.name : undefined,
        jobTitle: typeof req.query.role === 'string' ? req.query.role : undefined,
        candidateEmail: typeof req.query.email === 'string' ? req.query.email : undefined,
        interviewDate: typeof req.query.interviewDate === 'string' ? req.query.interviewDate : undefined,
    };
}

function safeFilenamePart(value, fallback) {
    const base = (value || fallback || '').trim();
    return (base.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || fallback).slice(0, 60);
}

// Download profile matching report - rendered as a branded PDF (see
// services/reportPdf.js) rather than the raw .txt blob, so recruiters get a
// clean, professional document instead of a plain-text file. The underlying
// blob storage/retrieval is unchanged - only the response format differs.
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
        const { candidateName, jobTitle } = reportMetaFromQuery(req);

        const pdfBuffer = await generateReportPdf({
            reportTitle: 'Profile Match Report',
            candidateName,
            jobTitle,
            sessionId,
            generatedOn: new Date().toLocaleString('en-US'),
            bodyText: downloaded,
        });

        const filename = `${safeFilenamePart(candidateName, sessionId.slice(0, 8))}_Profile_Match_Report.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(pdfBuffer);

        console.log(`✅ Profile match report (PDF) downloaded: ${blobName}`);
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

// Download interview feedback - rendered as a branded PDF, same treatment as
// downloadProfile above (blob storage/retrieval unchanged, only the response
// format differs).
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
        const { candidateName, jobTitle, candidateEmail, interviewDate } = reportMetaFromQuery(req);

        const pdfBuffer = await generateFeedbackReportPdf({
            candidateName,
            jobTitle,
            candidateEmail,
            interviewDate,
            sessionId,
            generatedOn: new Date().toLocaleString('en-US'),
            bodyText: downloaded,
        });

        const filename = `${safeFilenamePart(candidateName, sessionId.slice(0, 8))}_Interview_Feedback_Report.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(pdfBuffer);

        console.log(`✅ Interview feedback report (PDF) downloaded: ${blobName}`);
    } catch (error) {
        console.error('❌ Error downloading feedback:', error.message);
        res.status(500).json({ error: 'Failed to download feedback', details: error.message });
    }
}

// Existence + last-modified check only - never downloads the blob body.
// Used by getCandidateArtifactsMeta below so the recruiter UI's Timeline/
// Files sections can show real "generated on" dates without paying for a
// full download just to find out an artifact exists.
async function blobMeta(client, blobName) {
    if (!client) return null;
    try {
        const blobClient = client.getBlockBlobClient(blobName);
        const exists = await blobClient.exists();
        if (!exists) return { exists: false, generatedAt: null };
        const props = await blobClient.getProperties();
        return { exists: true, generatedAt: props.lastModified ? props.lastModified.toISOString() : null };
    } catch (error) {
        console.error(`⚠️ Error reading blob metadata for ${blobName}:`, error.message);
        return { exists: false, generatedAt: null };
    }
}

// GET /api/candidate-artifacts/:sessionId
// Lightweight, side-effect-free existence + lastModified check for the
// profile/feedback/video blobs. This exists specifically so the Timeline and
// Files sections don't have to either (a) download full report content just
// to know it exists, or (b) call GET /api/interview/:sessionId, which marks
// first-access and 410s a completed session - a real side effect unsafe for
// a recruiter just browsing (see Phase 4 report). Always 200s; per-artifact
// `exists`/`generatedAt` reflect the real blob state, or null if that
// storage bucket isn't configured at all.
export async function getCandidateArtifactsMeta(req, res) {
    const { sessionId } = req.params;
    const configured = Boolean(profileMatchingClient || feedbackContainerClient || videoContainerClient);

    const [profile, feedback, video] = await Promise.all([
        blobMeta(profileMatchingClient, `${sessionId}_profile.txt`),
        blobMeta(feedbackContainerClient, `interview_${sessionId}.txt`),
        blobMeta(videoContainerClient, `unified_video_${sessionId}.webm`),
    ]);

    res.json({ configured, profile, feedback, video });
}

// GET /api/candidate-session-timeline/:sessionId
// Side-effect-free read of the session metadata blob (session_<id>.json in
// the interview-sessions container) via loadSessionFromAzure - a plain
// download + JSON.parse, no write-back. Deliberately NOT calling
// GET /api/interview/:sessionId: that route mutates the session on every
// call (records firstAccessedAt on first access, flips status to 'expired'
// past the 48-hour window, and 410s once completed) - real side effects that
// would be wrong to trigger just because a recruiter opened this page. This
// endpoint only ever reads.
//
// Returns just the real timestamp fields the session object already
// carries (createdAt/firstAccessedAt/interviewStartedAt/completedAt/status)
// - never resumeText, transcript, audio/video URLs, or candidate emails.
// `found: false` (blob doesn't exist, e.g. deleted or never had a session
// created this way) and `configured: false` (no session storage in this
// environment) are both honest, distinct "nothing to show" states - never
// fabricated.
export async function getCandidateSessionTimeline(req, res) {
    const { sessionId } = req.params;

    if (!sessionMetadataClient) {
        return res.json({ configured: false, found: false });
    }

    const session = await loadSessionFromAzure(sessionId);
    if (!session) {
        return res.json({ configured: true, found: false });
    }

    res.json({
        configured: true,
        found: true,
        createdAt: session.createdAt || null,
        firstAccessedAt: session.firstAccessedAt || null,
        interviewStartedAt: session.interviewStartedAt || null,
        completedAt: session.completedAt || null,
        status: session.status || null,
    });
}

// GET /api/candidate-artifacts/:sessionId/highlights
// Extracts real Strengths/Gaps content from the profile match report text
// (see services/reportHighlights.js) instead of the frontend ever having to
// fetch/parse the raw report body. `configured`/`found` distinguish "no
// storage" from "report exists but has no recognizable Strengths/Gaps
// section" - both render as an honest not-available state client-side, but
// for different, correctly-labeled reasons.
// `?skills=a,b,c` (optional) - the required-skill list for whichever Job
// Library posting the frontend matched to this candidate's jobtitle
// (admin-frontend/src/lib/jobLibrary.ts; this backend doesn't own that
// list). When present, the response is grounded in those real, named
// skills (matched/missing against the actual report text - see
// services/reportHighlights.js's matchSkillsAgainstText) instead of the
// generic heading-based extraction, which is what renders when no skills
// are supplied (jobtitle didn't match a known posting).
export async function getProfileHighlights(req, res) {
    const { sessionId } = req.params;
    const requiredSkills = (typeof req.query.skills === 'string' ? req.query.skills : '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const mode = requiredSkills.length > 0 ? 'skills' : 'generic';

    const emptyResult = (found) => ({
        configured: true,
        found,
        mode,
        requiredSkills,
        matchedSkills: [],
        missingSkills: mode === 'skills' ? requiredSkills : [],
        strengths: [],
        gaps: [],
    });

    if (!profileMatchingClient) {
        return res.json({ ...emptyResult(false), configured: false });
    }

    try {
        const blobName = `${sessionId}_profile.txt`;
        const blobClient = profileMatchingClient.getBlockBlobClient(blobName);

        const exists = await blobClient.exists();
        if (!exists) {
            return res.json(emptyResult(false));
        }

        const downloadResponse = await blobClient.download(0);
        const text = await streamToString(downloadResponse.readableStreamBody);

        if (mode === 'skills') {
            const { matched, missing } = matchSkillsAgainstText(text, requiredSkills);
            return res.json({
                configured: true,
                found: true,
                mode,
                requiredSkills,
                matchedSkills: matched,
                missingSkills: missing,
                strengths: matched,
                gaps: missing,
            });
        }

        const { strengths, gaps } = extractHighlights(text);
        res.json({ configured: true, found: true, mode, requiredSkills: [], matchedSkills: [], missingSkills: [], strengths, gaps });
    } catch (error) {
        console.error('❌ Error extracting profile highlights:', error.message);
        res.status(500).json({ error: 'Failed to extract highlights', details: error.message });
    }
}

// POST /api/skills-gap-summary
// Body: { sessionIds: string[], skills: string[] }
//
// Real aggregate skill-gap data for one job title at a time: given a
// (capped) list of real candidate session ids the frontend already matched
// to one Job Library posting's jobtitle, and that posting's real required-
// skill tags, this checks each candidate's actual profile-match-report text
// (matchSkillsAgainstText - same negation-aware logic as the per-candidate
// endpoint above) and returns what fraction are missing each skill. Hard-
// capped server-side (independent of whatever cap the frontend applies) so
// a large sessionIds array can't trigger an unbounded number of blob
// downloads in a single request - `sampleSize` is always reported so the
// UI can disclose exactly how many candidates the percentages are based on
// rather than implying full-population coverage it doesn't have.
const MAX_SKILLS_GAP_SAMPLE = 40;

export async function getSkillsGapSummary(req, res) {
    const { sessionIds, skills } = req.body || {};

    if (!Array.isArray(sessionIds) || !Array.isArray(skills) || skills.length === 0) {
        return res.status(400).json({ error: 'sessionIds and skills arrays are required' });
    }

    const cappedIds = sessionIds.filter((id) => typeof id === 'string' && id).slice(0, MAX_SKILLS_GAP_SAMPLE);
    const cleanSkills = skills.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim());

    if (!profileMatchingClient) {
        return res.json({ configured: false, sampleSize: cappedIds.length, checkedCount: 0, missingPercentages: {} });
    }

    const missingCounts = Object.fromEntries(cleanSkills.map((s) => [s, 0]));
    let checkedCount = 0;

    await Promise.all(
        cappedIds.map(async (sessionId) => {
            try {
                const blobClient = profileMatchingClient.getBlockBlobClient(`${sessionId}_profile.txt`);
                const exists = await blobClient.exists();
                if (!exists) return;

                const downloadResponse = await blobClient.download(0);
                const text = await streamToString(downloadResponse.readableStreamBody);
                const { missing } = matchSkillsAgainstText(text, cleanSkills);
                checkedCount += 1;
                for (const skill of missing) missingCounts[skill] += 1;
            } catch (error) {
                console.error(`⚠️ Skipping ${sessionId} in skills-gap summary:`, error.message);
            }
        })
    );

    const missingPercentages = Object.fromEntries(
        cleanSkills.map((s) => [s, checkedCount > 0 ? Math.round((missingCounts[s] / checkedCount) * 100) : 0])
    );

    res.json({
        configured: true,
        sampleSize: cappedIds.length,
        checkedCount,
        missingPercentages,
    });
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
