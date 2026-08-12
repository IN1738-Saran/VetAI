// ============================================================================
// ENVIRONMENT CONFIGURATION
// Centralizes all values derived from process.env. `dotenv/config` is imported
// by the entry point (server.js) before this module is evaluated; it is also
// imported here so the module remains safe to import in isolation.
// ============================================================================
import 'dotenv/config';

export const PORT = process.env.PORT || 3001;
export const HOST = process.env.HOST || '0.0.0.0';

// Public domain configuration for HTTPS URLs
export const PUBLIC_DOMAIN = process.env.PUBLIC_DOMAIN || 'localhost:3001';
export const PUBLIC_PROTOCOL = process.env.PUBLIC_PROTOCOL || 'https';

// Azure Blob Storage
export const AZURE_STORAGE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;

// Azure Voice Live API configuration
export const AZURE_VOICELIVE_ENDPOINT = process.env.AZURE_VOICELIVE_ENDPOINT;
export const AZURE_VOICELIVE_API_KEY = process.env.AZURE_VOICELIVE_API_KEY;
// Default must match the model this app is actually built and tested for.
// It used to fall back to 'gpt-realtime' — a DIFFERENT, older model. A missing
// or misspelled AZURE_VOICELIVE_MODEL therefore silently ran the wrong model
// with no warning, which is the same class of failure as the voice:'onyx'
// incident (settings valid for the old model, rejected or subtly wrong on this
// one). Fail towards the supported model instead.
export const AZURE_VOICELIVE_MODEL = process.env.AZURE_VOICELIVE_MODEL || 'gpt-realtime-2.1-mini';
// NOTE: gpt-realtime with azure_semantic_vad (semantic end-of-utterance detection +
// remove_filler_words) requires a recent Voice Live api-version — set
// AZURE_VOICELIVE_API_VERSION to 2025-05-01-preview or later (2026-01-01-preview
// recommended) in the environment. The default below is only used when unset.
export const AZURE_VOICELIVE_API_VERSION = process.env.AZURE_VOICELIVE_API_VERSION || '2026-01-01-preview';

// ---------------------------------------------------------------------------
// Azure AI Document Intelligence (OCR for résumé / job-description extraction)
// ---------------------------------------------------------------------------
// When the endpoint and key are BOTH set, uploaded documents are read with
// Document Intelligence; otherwise the backend silently keeps using the
// original local pdf-parse / mammoth extraction, so an environment without a
// Document Intelligence resource behaves exactly as it did before.
export const AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || '';
export const AZURE_DOCUMENT_INTELLIGENCE_KEY = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY || '';
// prebuilt-layout reads multi-column layouts and tables; prebuilt-read is
// cheaper but text-only. Layout is what this integration is built and tested for.
export const AZURE_DOCUMENT_INTELLIGENCE_MODEL = process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL || 'prebuilt-layout';
// GA API version of the Document Intelligence analyse endpoint.
export const AZURE_DOCUMENT_INTELLIGENCE_API_VERSION = process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION || '2024-11-30';
// Hard ceiling on one analyse+poll cycle. Uploads are capped at 10 MB, so 120s
// is generous; raise it if very long PDFs start timing out.
export const AZURE_DOCUMENT_INTELLIGENCE_TIMEOUT_MS =
    Number(process.env.AZURE_DOCUMENT_INTELLIGENCE_TIMEOUT_MS) || 120000;
// The keyValuePairs add-on (prebuilt-layout + PDF/images only). Costs nothing
// extra but adds a little latency; set to "false" to skip it.
export const AZURE_DOCUMENT_INTELLIGENCE_KEY_VALUE_PAIRS =
    String(process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY_VALUE_PAIRS ?? 'true').toLowerCase() !== 'false';

// PostgreSQL connection settings
export const POSTGRES_USER = process.env.POSTGRES_USER;
export const POSTGRES_HOST = process.env.POSTGRES_HOST;
export const POSTGRES_DB = process.env.POSTGRES_DB;
export const POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD;
export const POSTGRES_PORT = process.env.POSTGRES_PORT || 5432;

// External webhooks. These were hardcoded in the FRONTEND bundle; the Power
// Automate URL carries a SAS 'sig' that is itself the credential, so it must be
// held server-side only.
export const POWER_AUTOMATE_URL = process.env.POWER_AUTOMATE_URL || '';
export const N8N_RETRY_REASON_URL = process.env.N8N_RETRY_REASON_URL || '';
