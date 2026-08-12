// ============================================================================
// AZURE OPENAI SERVICE
// Candidate name/email extraction from resume text (regex-based, no model).
// ============================================================================

// NOTE: getAzureOpenAICompletionUrl() was removed. It built a /chat/completions
// URL for a deployment that defaulted to 'gpt-4o' — a THIRD model in a project
// that runs exactly two (gpt-realtime-2.1-mini for conversation,
// gpt-4o-mini-transcribe for speech-to-text). It had no callers anywhere: the
// only consumer, extractCandidateInfo(), became regex-only when the realtime
// model proved unable to serve chat-completions. Dead code naming an unused
// model is how a third model quietly creeps back in.

// Extract candidate name and email using Azure OpenAI
export async function extractCandidateInfo(resumeText) {
    // NO credential guard here any more.
    //
    // This function used to return {candidateName:'', candidateEmail:''} when the
    // Azure credentials were unset — a leftover from when it really did call
    // /chat/completions. It is now pure regex and makes no network call at all,
    // so that guard did nothing but suppress the ONLY working code path. With it
    // in place a misconfigured (or partially configured) deployment produced a
    // blank candidate name, and the interviewer greets and signs off by name:
    // the candidate would hear "Hello , welcome to your interview with Systech."
    if (!resumeText) {
        return { candidateName: '', candidateEmail: '' };
    }

    try {

        // NOTE: this used to POST to /chat/completions using AZURE_VOICELIVE_MODEL —
        // i.e. the REALTIME model (gpt-realtime-2.1-mini). Realtime models do not
        // serve the chat-completions endpoint, so that call failed on every résumé
        // and always fell through to the regex path below anyway. It was a second
        // model doing a job one already does, adding latency and a guaranteed error
        // on every upload. Résumé name/email extraction is now regex-only, so the
        // project uses exactly ONE model for conversation and ONE for transcription.
        let candidateName = '';
        let candidateEmail = '';

        // Apply local fallback if empty
        if (!candidateEmail) {
            const emailMatch = resumeText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            if (emailMatch) candidateEmail = emailMatch[0].trim();
        }
        if (!candidateName) {
            const lines = resumeText.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0 && !line.includes('-- page') && !line.includes('-- 1 of') && !line.includes('-- 2 of'));
            if (lines.length > 0) {
                const candidateLine = lines[0];
                if (candidateLine && candidateLine.length < 50 && !candidateLine.includes('@') && !candidateLine.includes('http') && !candidateLine.includes('|')) {
                    candidateName = candidateLine;
                }
            }
        }

        return {
            candidateName,
            candidateEmail
        };
    } catch (error) {
        console.error('Error parsing candidate info:', error);

        // Return regex fallback if API fails completely
        let fallbackEmail = '';
        let fallbackName = '';
        const emailMatch = resumeText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (emailMatch) fallbackEmail = emailMatch[0].trim();

        const lines = resumeText.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0 && !line.includes('-- page') && !line.includes('-- 1 of') && !line.includes('-- 2 of'));
        if (lines.length > 0) {
            const candidateLine = lines[0];
            if (candidateLine && candidateLine.length < 50 && !candidateLine.includes('@') && !candidateLine.includes('http') && !candidateLine.includes('|')) {
                fallbackName = candidateLine;
            }
        }
        return { candidateName: fallbackName, candidateEmail: fallbackEmail };
    }
}
