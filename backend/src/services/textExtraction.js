// ============================================================================
// TEXT EXTRACTION SERVICE
// Extracts plain text from uploaded resume / job-description files.
//
// EXTRACTION PIPELINE (updated — Azure AI Document Intelligence integration):
//
//   Upload
//     ↓
//   Azure AI Document Intelligence (prebuilt-layout)   ← primary
//     ↓  (on failure, or when not configured)
//   Local pdf-parse / mammoth extraction               ← fallback, unchanged
//     ↓
//   Plain text  →  existing Generate Score logic (untouched)
//
// Document Intelligence handles the cases the local parsers miss: multi-column
// résumés, tables, scanned/image-only PDFs and complex templates. The local
// parsers are kept as a fallback so a Document Intelligence outage, quota limit
// or missing configuration can never take résumé uploads down with it.
// ============================================================================
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

// --- NEW: Azure AI Document Intelligence OCR ---------------------------------
import {
    analyzeDocument,
    isDocumentIntelligenceConfigured,
} from './documentIntelligence.js';
import { extractResumeFields, resumeStats, emptyResumeInfo } from './resumeFields.js';

/**
 * True when extraction produced no usable content.
 *
 * extractTextFromFile never throws — on failure it returns a human-readable
 * PLACEHOLDER like "[No text found in PDF: cv.pdf]". Callers were treating that
 * placeholder as if it were the document, so a scanned / image-only PDF (very
 * common for résumés) silently produced an interview with no résumé at all: the
 * whole technical phase is derived from résumé content, and the experience-level
 * classifier saw no employment signal and labelled the candidate a FRESHER. The
 * admin got a normal success response and only found out when the interview went
 * badly.
 *
 * The length floor catches PDFs that yield a few stray ligatures rather than a
 * clean failure.
 */
export function isUnusableExtraction(text) {
    if (!text) return true;
    const trimmed = String(text).trim();
    if (/^\[(No text found|Could not extract|Unsupported file format|Error extracting)/i.test(trimmed)) return true;
    return trimmed.length < 100;
}

// ============================================================================
// LOCAL EXTRACTION (original implementation — unchanged behaviour)
// Used as the fallback whenever Document Intelligence is unavailable.
// ============================================================================
async function extractTextLocally(buffer, mimetype, filename) {
    try {
        // PDF extraction using pdf-parse
        if (mimetype === 'application/pdf') {
            try {
                const parser = new PDFParse({ data: buffer });
                const textResult = await parser.getText();
                await parser.destroy();
                return textResult.text.trim() || `[No text found in PDF: ${filename}]`;
            } catch (err) {
                console.error(`PDF parse error for ${filename}:`, err.message);
                return `[Could not extract text from PDF: ${filename}]`;
            }
        }

        // DOCX extraction
        if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            const result = await mammoth.extractRawText({ buffer });
            return result.value;
        }

        // DOC files (older format)
        if (mimetype === 'application/msword') {
            try {
                const result = await mammoth.extractRawText({ buffer });
                return result.value;
            } catch (e) {
                return `[Could not extract text from DOC file: ${filename}]`;
            }
        }

        // Plain text
        if (mimetype === 'text/plain') {
            return buffer.toString('utf-8');
        }

        // Fallback
        return `[Unsupported file format: ${mimetype}]`;

    } catch (error) {
        console.error('Error extracting text:', error);
        return `[Error extracting text from ${filename}: ${error.message}]`;
    }
}

// ============================================================================
// NEW: UNIFIED EXTRACTION ENTRY POINT
// One pipeline for BOTH résumés and job descriptions.
// ============================================================================

/**
 * Extract a document's text — and, for résumés, its structured fields.
 *
 * Never throws. When Document Intelligence fails, the error is logged, recorded
 * in `warnings`, and the local parsers produce the text instead, so the caller's
 * downstream logic (scoring, matching, interview generation) is unaffected.
 *
 * @param {Buffer} buffer            Raw file bytes.
 * @param {string} mimetype          MIME type reported by the uploader.
 * @param {string} filename          Original file name.
 * @param {object} [options]
 * @param {boolean} [options.extractFields=false]
 *        Also mine the text for résumé fields (name, email, skills, …).
 *        Left off for job descriptions, which have no résumé semantics.
 * @returns {Promise<{
 *   text: string,
 *   source: 'azure-document-intelligence' | 'local-parser',
 *   ocrAttempted: boolean,
 *   ocrSucceeded: boolean,
 *   warnings: string[],
 *   error: string|null,
 *   documentInfo: object|null,
 *   tables: Array<object>,
 *   keyValuePairs: Array<object>,
 *   resumeInfo: object|null,
 *   resumeStats: object|null
 * }>}
 */
export async function extractDocument(buffer, mimetype, filename, { extractFields = false } = {}) {
    const outcome = {
        text: '',
        source: 'local-parser',
        ocrAttempted: false,
        ocrSucceeded: false,
        warnings: [],
        error: null,
        documentInfo: null,
        tables: [],
        keyValuePairs: [],
        resumeInfo: null,
        resumeStats: null,
    };

    // --- 1. Primary path: Azure AI Document Intelligence ---------------------
    if (isDocumentIntelligenceConfigured()) {
        outcome.ocrAttempted = true;
        try {
            const analysis = await analyzeDocument(buffer, mimetype, filename);
            outcome.text = analysis.text;
            outcome.tables = analysis.tables;
            outcome.keyValuePairs = analysis.keyValuePairs;
            outcome.documentInfo = analysis.documentInfo;
            outcome.warnings.push(...analysis.warnings);
            outcome.source = 'azure-document-intelligence';
            outcome.ocrSucceeded = true;
        } catch (error) {
            // Requirement: log the error, surface a meaningful message, never crash.
            const detail = error.details ? ` — ${error.details}` : '';
            console.error(`❌ [DocIntel] OCR failed for "${filename}": ${error.message}${detail}`);
            outcome.error = `${error.message}${detail}`;
            outcome.warnings.push(`Azure OCR failed: ${error.message} Falling back to local text extraction.`);
        }
    } else {
        outcome.warnings.push('Azure Document Intelligence is not configured; using local text extraction.');
    }

    // --- 2. Fallback path: original local parsers ----------------------------
    // Also used when OCR "succeeded" but returned nothing usable, so a blank
    // Azure result can never be worse than the previous behaviour.
    if (!outcome.ocrSucceeded || isUnusableExtraction(outcome.text)) {
        if (outcome.ocrSucceeded) {
            console.warn(`⚠️ [DocIntel] OCR returned unusable text for "${filename}" — retrying with the local parser.`);
            outcome.warnings.push('Azure OCR returned no usable text; the local parser was used instead.');
        }
        const localText = await extractTextLocally(buffer, mimetype, filename);
        // Keep whichever result is actually usable; prefer the OCR text only if
        // the local parser did no better.
        if (!isUnusableExtraction(localText) || isUnusableExtraction(outcome.text)) {
            outcome.text = localText;
            outcome.source = 'local-parser';
        }
    }

    // --- 3. Optional résumé field mining -------------------------------------
    if (extractFields) {
        outcome.resumeInfo = isUnusableExtraction(outcome.text)
            ? emptyResumeInfo()
            : extractResumeFields(outcome.text);
        outcome.resumeStats = resumeStats(outcome.resumeInfo);
    }

    return outcome;
}

// ============================================================================
// BACKWARD-COMPATIBLE WRAPPER
// Existing callers that only need the text keep working unchanged: same
// signature, same "never throws, returns a placeholder string" contract.
// ============================================================================
export async function extractTextFromFile(buffer, mimetype, filename) {
    const { text } = await extractDocument(buffer, mimetype, filename);
    return text;
}
