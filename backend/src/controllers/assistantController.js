// ============================================================================
// AI ASSISTANT CONTROLLER
// A recruiter-facing Q&A panel over data already in VetAI (candidates, match
// scores/verdicts, profile-match reports). Uses a separate, small Azure
// OpenAI chat-completions deployment (services/assistantChat.js) - never the
// realtime voice model used for interviews.
// ============================================================================
import { containerClient, profileMatchingClient, feedbackContainerClient } from '../config/azure.js';
import { streamToString } from '../utils/stream.js';
import { isAssistantChatConfigured, askAssistantChat } from '../services/assistantChat.js';

// Defensive re-cap independent of whatever the frontend already capped -
// keeps one slow/misbehaving client from sending an unbounded context.
const MAX_CANDIDATES_IN_CONTEXT = 60;
// How many of those candidates (the ones the question appears to actually
// name) get their real profile-match report text pulled in as grounding.
const MAX_REPORT_LOOKUPS = 4;
const REPORT_EXCERPT_CHARS = 1800;
const MAX_QUESTION_LENGTH = 600;

async function countBlobs(client, prefix) {
    if (!client) return null;
    try {
        let count = 0;
        for await (const _blob of client.listBlobsFlat({ prefix })) {
            count += 1;
            if (count >= 20000) break; // safety cap, not a realistic ceiling
        }
        return count;
    } catch (error) {
        console.error(`⚠️ Error counting blobs for prefix "${prefix}":`, error.message);
        return null;
    }
}

// GET /api/assistant/overview
// Real, backend-owned counts only (transcripts/profile reports/feedback
// reports - all blob storage this backend directly owns). Candidate counts,
// Job Library size, etc. live client-side and are merged in by the frontend,
// which already has that real data loaded - this endpoint doesn't guess at
// it. `configured` reflects the chat model, not blob storage - the two are
// independent and both are surfaced to the UI.
export async function getAssistantOverview(req, res) {
    const [transcriptCount, profileReportCount, feedbackReportCount] = await Promise.all([
        countBlobs(containerClient, 'transcript_'),
        countBlobs(profileMatchingClient, ''),
        countBlobs(feedbackContainerClient, ''),
    ]);

    res.json({
        configured: isAssistantChatConfigured(),
        transcriptCount,
        profileReportCount,
        feedbackReportCount,
    });
}

function formatCandidateRow(c) {
    const ref = (c.sessionid || '').replace(/-/g, '').slice(-6) || 'unknown';
    const score = c.overall_score ?? 'not scored';
    const verdict = c.verdict || 'no verdict';
    const status = c.status || 'unknown status';
    return `- ${c.candidatename || 'Unnamed'} | role: ${c.jobtitle || 'unknown'} | score: ${score} | verdict: ${verdict} | status: ${status} | ref:${ref}`;
}

// Cheap, local relevance check - does the question appear to name this
// candidate? Used only to decide which (small, capped) subset of profile
// reports are worth the extra blob download, not as a general search index.
function questionMentionsCandidate(question, candidateName) {
    if (!candidateName) return false;
    const first = candidateName.trim().split(/\s+/)[0];
    return first.length > 2 && question.toLowerCase().includes(first.toLowerCase());
}

async function fetchReportExcerpt(sessionId) {
    if (!profileMatchingClient) return null;
    try {
        const blobClient = profileMatchingClient.getBlockBlobClient(`${sessionId}_profile.txt`);
        const exists = await blobClient.exists();
        if (!exists) return null;
        const downloadResponse = await blobClient.download(0);
        const text = await streamToString(downloadResponse.readableStreamBody);
        return text.slice(0, REPORT_EXCERPT_CHARS);
    } catch (error) {
        console.error(`⚠️ Error fetching profile report excerpt for ${sessionId}:`, error.message);
        return null;
    }
}

// POST /api/assistant/ask
// Body: { question: string, candidates: Array<{candidatename, jobtitle,
// overall_score, verdict, status, sessionid, ...}> }
//
// `candidates` is the real, already-fetched candidates feed the frontend
// already trusts (same source as every other view) - this endpoint never
// queries n8n or a second copy of that data itself, so there is only ever
// one source of truth for candidate facts. The model is instructed to
// answer only from what's provided and to say so when it can't - it cannot
// fetch anything on its own and this endpoint never lets it invent a score,
// skill, or candidate not present in the real data below.
export async function postAssistantAsk(req, res) {
    if (!isAssistantChatConfigured()) {
        return res.json({ configured: false });
    }

    const { question, candidates } = req.body || {};

    if (typeof question !== 'string' || !question.trim()) {
        return res.status(400).json({ error: 'question is required' });
    }
    if (question.length > MAX_QUESTION_LENGTH) {
        return res.status(400).json({ error: `question must be under ${MAX_QUESTION_LENGTH} characters` });
    }

    const cappedCandidates = Array.isArray(candidates) ? candidates.slice(0, MAX_CANDIDATES_IN_CONTEXT) : [];
    const trimmedQuestion = question.trim();

    const namedMatches = cappedCandidates
        .filter((c) => questionMentionsCandidate(trimmedQuestion, c.candidatename))
        .slice(0, MAX_REPORT_LOOKUPS);

    const excerpts = (
        await Promise.all(
            namedMatches.map(async (c) => {
                const text = await fetchReportExcerpt(c.sessionid);
                return text ? { name: c.candidatename, text } : null;
            })
        )
    ).filter(Boolean);

    const candidateTable = cappedCandidates.length
        ? cappedCandidates.map(formatCandidateRow).join('\n')
        : '(no candidate data was provided for this question)';

    const excerptBlock = excerpts.length
        ? excerpts.map((e) => `--- Profile match report excerpt for ${e.name} ---\n${e.text}`).join('\n\n')
        : '';

    const systemPrompt =
        'You are the VetAI recruiting assistant, used by a company recruiter. Answer ONLY using the candidate ' +
        'data and report excerpts given to you in this conversation. If the data needed to answer isn\'t present, ' +
        'say so plainly instead of guessing or inventing a number, skill, or name. Be concise and professional - ' +
        'this is an internal company tool, not a casual chat. When you reference a candidate, use their real name ' +
        'from the data provided.';

    const userMessage =
        `Recruiter question: ${trimmedQuestion}\n\n` +
        `Candidate data (${cappedCandidates.length} record${cappedCandidates.length === 1 ? '' : 's'}):\n${candidateTable}` +
        (excerptBlock ? `\n\n${excerptBlock}` : '');

    try {
        const answer = await askAssistantChat([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
        ]);

        res.json({
            configured: true,
            answer: answer || 'No answer was returned - please try rephrasing your question.',
            basedOnCount: cappedCandidates.length,
        });
    } catch (error) {
        console.error('❌ Assistant ask error:', error.message);
        res.status(502).json({ error: 'Failed to reach the assistant model', details: error.message });
    }
}
