// ============================================================================
// SYSTEM STATUS CONTROLLER
// Real, boolean-only "is this integration connected" flags for the
// Organization settings page - never leaks endpoint URLs, keys, or
// connection strings, only whether each one is present/initialized.
// ============================================================================
import { containerClient, profileMatchingClient, feedbackContainerClient, videoContainerClient, sessionMetadataClient } from '../config/azure.js';
import {
    AZURE_VOICELIVE_ENDPOINT,
    AZURE_VOICELIVE_API_KEY,
    AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
    AZURE_DOCUMENT_INTELLIGENCE_KEY,
    POSTGRES_HOST,
    POSTGRES_USER,
    POSTGRES_DB,
} from '../config/env.js';
import { isAssistantChatConfigured } from '../services/assistantChat.js';

// GET /api/system-status
export function getSystemStatus(req, res) {
    res.json({
        blobStorage: Boolean(
            containerClient || profileMatchingClient || feedbackContainerClient || videoContainerClient || sessionMetadataClient
        ),
        voiceInterview: Boolean(AZURE_VOICELIVE_ENDPOINT && AZURE_VOICELIVE_API_KEY),
        documentIntelligence: Boolean(AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT && AZURE_DOCUMENT_INTELLIGENCE_KEY),
        database: Boolean(POSTGRES_HOST && POSTGRES_USER && POSTGRES_DB),
        aiAssistant: isAssistantChatConfigured(),
    });
}
