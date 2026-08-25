// ============================================================================
// ASSISTANT CHAT SERVICE
// Plain fetch against an Azure OpenAI chat-completions deployment - a
// SEPARATE, smaller/cheaper model from AZURE_VOICELIVE_MODEL
// (gpt-realtime-2.1-mini), which stays reserved for the voice-to-voice
// interview and is never called from here. Mirrors the existing
// documentIntelligence.js pattern (plain fetch + api-key header, config
// values from env.js) rather than pulling in an SDK.
// ============================================================================
import {
    AZURE_OPENAI_CHAT_ENDPOINT,
    AZURE_OPENAI_CHAT_API_KEY,
    AZURE_OPENAI_CHAT_DEPLOYMENT,
    AZURE_OPENAI_CHAT_API_VERSION,
} from '../config/env.js';

export function isAssistantChatConfigured() {
    return Boolean(AZURE_OPENAI_CHAT_ENDPOINT && AZURE_OPENAI_CHAT_API_KEY);
}

// `messages` is a standard chat-completions array ([{role, content}, ...]).
// Throws on a non-2xx response or network failure - callers decide how to
// degrade (see assistantController.js).
export async function askAssistantChat(messages) {
    const endpoint = AZURE_OPENAI_CHAT_ENDPOINT.replace(/\/+$/, '');
    const url = `${endpoint}/openai/deployments/${AZURE_OPENAI_CHAT_DEPLOYMENT}/chat/completions?api-version=${AZURE_OPENAI_CHAT_API_VERSION}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'api-key': AZURE_OPENAI_CHAT_API_KEY,
        },
        body: JSON.stringify({
            messages,
            temperature: 0.2,
            max_tokens: 800,
        }),
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Azure OpenAI chat request failed (${response.status}): ${detail.slice(0, 300)}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content.trim() : '';
}
