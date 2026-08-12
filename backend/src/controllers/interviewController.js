// ============================================================================
// INTERVIEW CONTROLLER
// Core interview lifecycle endpoints: creation, retrieval, start/complete,
// transcript/audio/video persistence, violations, date updates and the
// ephemeral voice token.
// ============================================================================
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

import {
    PUBLIC_DOMAIN,
    PUBLIC_PROTOCOL,
    AZURE_VOICELIVE_ENDPOINT,
    AZURE_VOICELIVE_API_KEY,
    AZURE_VOICELIVE_MODEL,
    AZURE_VOICELIVE_API_VERSION,
} from '../config/env.js';
import { CREATION_WEBHOOK_URL } from '../constants/index.js';
import {
    containerClient,
    audioContainerClient,
    videoContainerClient,
} from '../config/azure.js';
import { pool } from '../config/db.js';
import {
    interviewSessions,
    saveSessionToAzure,
    loadSessionFromAzure,
    updateSessionInAzure,
} from '../services/sessionStore.js';
import { issueVoiceTicket } from '../services/voiceProxy.js';
// `extractDocument` runs the Azure AI Document Intelligence pipeline (with the
// original local parsers as a fallback) and optionally mines résumé fields.
import { extractDocument, isUnusableExtraction } from '../services/textExtraction.js';
import { extractCandidateInfo } from '../services/openaiService.js';

/**
 * CREATE INTERVIEW (UPDATED FOR JD PDF + MULTIPLE RESUMES)
 */
export async function createInterview(req, res) {
    try {
        const { jobTitle, toEmails } = req.body || {};

        // Auto-upsert the email config for this job title
        if (jobTitle && toEmails) {
            pool.query(
                `INSERT INTO public.job_email_configs (jobtitle, emails)
                 VALUES ($1, $2)
                 ON CONFLICT (jobtitle)
                 DO UPDATE SET emails = EXCLUDED.emails, updatedat = NOW()`,
                [jobTitle.trim(), toEmails.trim()]
            ).catch(err => console.warn('⚠️ Could not upsert job-email-config:', err.message));
        }

        // Handle Job Description PDF
        let jobDescriptionBuffer = null;
        let jobDescriptionMimeType = 'application/pdf';
        let jobDescriptionFileName = 'job-description.pdf';
        let jobDescriptionText = '';

        if (req.files && req.files['jobDescription'] && req.files['jobDescription'][0]) {
            const jdFile = req.files['jobDescription'][0];
            jobDescriptionBuffer = jdFile.buffer;
            jobDescriptionMimeType = jdFile.mimetype || 'application/pdf';
            jobDescriptionFileName = jdFile.originalname || 'job-description.pdf';

            const MAX_BYTES = 10 * 1024 * 1024;
            if (!jobDescriptionBuffer || jobDescriptionBuffer.length === 0) {
                return res.status(400).json({ error: 'Job Description PDF content is empty' });
            }
            if (jobDescriptionBuffer.length > MAX_BYTES) {
                return res.status(400).json({ error: 'Job Description PDF too large. Max 10MB.' });
            }

            const detectedHeader = jobDescriptionBuffer.slice(0, 4).toString('utf8');
            if (detectedHeader !== '%PDF') {
                return res.status(400).json({
                    error: 'Invalid Job Description file content. Please provide a PDF file only.'
                });
            }

            console.log(`📄 Extracting text from Job Description: ${jobDescriptionFileName}...`);
            // Same OCR pipeline as résumés; résumé field mining is skipped since
            // a job description has no résumé semantics to extract.
            const jdExtraction = await extractDocument(
                jobDescriptionBuffer,
                jobDescriptionMimeType,
                jobDescriptionFileName
            );
            jobDescriptionText = jdExtraction.text;
            console.log(
                `✅ Extracted ${jobDescriptionText.length} characters from Job Description ` +
                `(via ${jdExtraction.source})`
            );

            // Fail loudly rather than building an interview with no job
            // description. Extraction returns a placeholder string instead of
            // throwing, so without this check a scanned/image-only PDF sailed
            // through and the AI had nothing to derive questions from.
            if (isUnusableExtraction(jobDescriptionText)) {
                return res.status(400).json({
                    error: 'No readable text could be extracted from the Job Description PDF. It is most likely a scanned image. Please upload a text-based PDF (or run OCR on it first).',
                    fileName: jobDescriptionFileName
                });
            }
        } else {
            return res.status(400).json({ error: 'Job Description PDF is required' });
        }

        // Handle Multiple Resume PDFs
        if (!req.files || !req.files['resumes'] || req.files['resumes'].length === 0) {
            return res.status(400).json({ error: 'At least one resume PDF is required' });
        }

        const resumeFiles = req.files['resumes'];

        if (resumeFiles.length > 5) {
            return res.status(400).json({
                error: 'Maximum 5 resume files allowed',
                uploaded: resumeFiles.length,
                maximum: 5
            });
        }

        // ARRAY TO STORE ALL CREATED SESSIONS
        const createdSessions = [];
        // Résumés that were rejected mid-loop. Every `continue` below used to
        // only console.error, so the admin received `{success:true, count:2}`
        // for a 5-file upload with no indication that three were dropped or why.
        const skippedResumes = [];

        // LOOP THROUGH EACH RESUME AND CREATE SEPARATE SESSION
        for (let i = 0; i < resumeFiles.length; i++) {
            const resumeFile = resumeFiles[i];
            const resumeBuffer = resumeFile.buffer;
            const resumeMimeType = resumeFile.mimetype || 'application/pdf';
            const resumeFileName = resumeFile.originalname || `resume_${i + 1}.pdf`;

            // Validate resume file
            const MAX_BYTES = 10 * 1024 * 1024;
            if (!resumeBuffer || resumeBuffer.length === 0) {
                console.error(`Resume file ${resumeFileName} content is empty`);
                skippedResumes.push({ fileName: resumeFileName, reason: 'File is empty.' });
                continue;
            }
            if (resumeBuffer.length > MAX_BYTES) {
                console.error(`Resume file ${resumeFileName} too large`);
                skippedResumes.push({ fileName: resumeFileName, reason: 'File is larger than 10MB.' });
                continue;
            }

            const detectedHeader = resumeBuffer.slice(0, 4).toString('utf8');
            if (detectedHeader !== '%PDF') {
                console.error(`Invalid resume file ${resumeFileName}`);
                skippedResumes.push({ fileName: resumeFileName, reason: 'Not a PDF file.' });
                continue;
            }

            // Extract text from this resume via Azure AI Document Intelligence,
            // and mine the structured fields shown on the Generate Score page.
            console.log(`📄 Extracting text from Resume: ${resumeFileName}...`);
            const resumeExtraction = await extractDocument(
                resumeBuffer,
                resumeMimeType,
                resumeFileName,
                { extractFields: true }
            );
            const resumeText = resumeExtraction.text;
            console.log(
                `✅ Extracted ${resumeText.length} characters from ${resumeFileName} ` +
                `(via ${resumeExtraction.source})`
            );

            // Skip résumés we could not actually read, and tell the admin which
            // ones. Creating a session here produced an interview whose entire
            // technical phase had no source material.
            if (isUnusableExtraction(resumeText)) {
                console.error(`❌ No readable text in resume ${resumeFileName} — skipping (likely a scanned image).`);
                skippedResumes.push({
                    fileName: resumeFileName,
                    reason: 'No readable text could be extracted (likely a scanned image — run OCR first).'
                });
                continue;
            }

            // Extract candidate name and email (regex-based, no model call)
            const candidateInfo = await extractCandidateInfo(resumeText);

            // CREATE SEPARATE SESSION FOR THIS RESUME
            const sessionId = uuidv4();
            const createdAt = new Date();
            const expiresAt = new Date(createdAt);
            expiresAt.setDate(expiresAt.getDate() + 1);
            expiresAt.setHours(23, 59, 59, 999);

            // Upload resume PDF to Azure
            let resumePdfUrl = null;
            if (containerClient) {
                try {
                    const resumeBlobName = `resume_${sessionId}_${resumeFileName}`;
                    const resumeBlobClient = containerClient.getBlockBlobClient(resumeBlobName);

                    await resumeBlobClient.upload(resumeBuffer, resumeBuffer.length, {
                        blobHTTPHeaders: { blobContentType: resumeMimeType }
                    });

                    resumePdfUrl = resumeBlobClient.url;
                    console.log(`✅ Resume uploaded: ${resumeBlobName}`);
                } catch (error) {
                    console.error(`❌ Failed to upload resume ${resumeFileName}:`, error.message);
                }
            }

            const proto = req.headers['x-forwarded-proto'] || PUBLIC_PROTOCOL;
            const host = req.headers['x-forwarded-host'] || PUBLIC_DOMAIN;
            const interviewUrl = `${proto}://${host}/interview/${sessionId}`;

            const sessionData = {
                sessionId,
                jobTitle,
                toEmails: toEmails || '',
                jobDescription: jobDescriptionText.trim(),
                jobDescriptionFileName,
                jobDescriptionBuffer,
                resumeText: resumeText,
                resumeFileName: resumeFileName,
                resumeMimeType: resumeMimeType,
                resumePdfUrl: resumePdfUrl,
                candidateName: candidateInfo.candidateName,
                candidateEmail: candidateInfo.candidateEmail,
                status: 'pending',
                createdAt: createdAt.toISOString(),
                expiresAt: expiresAt.toISOString(),
                firstAccessedAt: null,
                interviewStartedAt: null,
                completedAt: null,
                transcript: [],
                candidateAudioUrl: null,
                aiAudioUrl: null,
                unifiedVideoUrl: null,
                audioDuration: 0,
                videoDuration: 0,
                videoFileSize: 0
            };

            interviewSessions.set(sessionId, sessionData);
            await saveSessionToAzure(sessionId, sessionData);

            console.log(`✅ Interview created for ${resumeFileName}: ${sessionId}`);

            // Send creation webhook for this session
           // Send creation webhook for this session
try {
    // Create FormData instead of JSON
    const webhookFormData = new FormData();

    // Add text fields
    webhookFormData.append('event', 'interview_created');
    webhookFormData.append('sessionId', sessionId);
    webhookFormData.append('jobTitle', jobTitle);
    webhookFormData.append('toEmails', toEmails || '');
    webhookFormData.append('jobDescription', jobDescriptionText);
    webhookFormData.append('jobDescriptionFileName', jobDescriptionFileName);
    webhookFormData.append('interviewUrl', interviewUrl);
    webhookFormData.append('expiresAt', expiresAt.toISOString());
    webhookFormData.append('timestamp', new Date().toISOString());
    webhookFormData.append('resumeText', resumeText);
    webhookFormData.append('candidateName', candidateInfo.candidateName);
    webhookFormData.append('candidateEmail', candidateInfo.candidateEmail);

    // // Add Job Description file
    // const jdBlob = new Blob([jobDescriptionBuffer], { type: jobDescriptionMimeType });
    // webhookFormData.append('jobDescriptionFile', jdBlob, jobDescriptionFileName);

    // Add Job Description base64 (if needed for backwards compatibility)
    const jobDescriptionBase64 = `data:${jobDescriptionMimeType};base64,${jobDescriptionBuffer.toString('base64')}`;
    webhookFormData.append('jobDescriptionBase64', jobDescriptionBase64);

    // Add Resume file (actual file)
    const resumeBlob = new Blob([resumeBuffer], { type: resumeMimeType });
    webhookFormData.append('resumeFile', resumeBlob, resumeFileName);

    // Add Resume metadata as JSON string
    const resumeMetadata = {
        fileName: resumeFileName,
        mimeType: resumeMimeType,
        textPreview: resumeText,
        base64: `data:${resumeMimeType};base64,${resumeBuffer.toString('base64')}`
    };
    webhookFormData.append('resumeMetadata', JSON.stringify(resumeMetadata));

    // Send as multipart/form-data (no Content-Type header needed - FormData sets it)
    console.log(`📡 Sending creation webhook for ${resumeFileName} to ${CREATION_WEBHOOK_URL}...`);
    const webhookRes = await fetch(CREATION_WEBHOOK_URL, {
        method: 'POST',
        body: webhookFormData
    });
    console.log(`📡 Webhook Response Status: ${webhookRes.status} ${webhookRes.statusText}`);
    const webhookBody = await webhookRes.text();
    console.log(`📡 Webhook Response Body:`, webhookBody);

    console.log(`✅ Creation webhook sent for ${resumeFileName}`);
} catch (webhookError) {
    console.error(`⚠️ Creation webhook error for ${resumeFileName}:`, webhookError.message);
    if (webhookError.cause) {
        console.error(`🔍 Webhook error cause details:`, webhookError.cause);
    }
}

            // Add to created sessions array
            createdSessions.push({
                sessionId,
                resumeFileName,
                interviewUrl,
                // --- OCR diagnostics (NEW) -------------------------------------
                // Consumed by the "Resume Information (OCR)" panel on the admin
                // page. Purely additive: existing consumers of this response read
                // sessionId / resumeFileName / interviewUrl and are unaffected.
                ocr: {
                    source: resumeExtraction.source,
                    charactersExtracted: resumeText.length,
                    documentInfo: resumeExtraction.documentInfo,
                    warnings: resumeExtraction.warnings,
                    error: resumeExtraction.error,
                    resumeInfo: resumeExtraction.resumeInfo,
                    stats: resumeExtraction.resumeStats,
                    // Raw text is capped: the full document is already stored on
                    // the session, and this is only a verification preview.
                    rawText: resumeText.slice(0, 20000),
                    rawTextTruncated: resumeText.length > 20000
                }
            });
        }

        console.log(`\n✅ Created ${createdSessions.length} interview sessions`);
        if (skippedResumes.length) {
            console.warn(`⚠️ Skipped ${skippedResumes.length} resume(s):`, skippedResumes);
        }

        // Every resume failed — that is not a success.
        if (createdSessions.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No interviews could be created — every resume was rejected.',
                skipped: skippedResumes,
                count: 0
            });
        }

        return res.json({
            success: true,
            sessions: createdSessions,
            count: createdSessions.length,
            // Report partial failures instead of silently returning a smaller
            // count than the number of files uploaded.
            skipped: skippedResumes,
            skippedCount: skippedResumes.length
        });

    } catch (error) {
        console.error('Error creating interview:', error);
        return res.status(500).json({ error: error.message });
    }
}

/**
 * GET INTERVIEW SESSION (WITH RETRY WINDOW LOGIC)
 */
export async function getInterview(req, res) {
    const { sessionId } = req.params;
    let session = await loadSessionFromAzure(sessionId);

    if (session) {
        interviewSessions.set(sessionId, session);
        console.log(`✅ Session ${sessionId} loaded from Azure (fresh data)`);
    } else {
        session = interviewSessions.get(sessionId);
        if (session) {
            console.log(`⚠️ Session ${sessionId} loaded from memory (Azure failed)`);
        }
    }

    if (!session) {
        return res.status(404).json({
            error: 'Interview not found',
            code: 'NOT_FOUND',
            message: 'This interview link is invalid or has been deleted.'
        });
    }

    const now = new Date();

        // Check if already completed
    if (session.status === 'completed' || session.completedAt) {
        return res.status(410).json({
            error: 'Interview already completed',
            code: 'ALREADY_COMPLETED',
            message: 'This interview has already been completed.',
            completedAt: session.completedAt
        });
    }


    // ORIGINAL 48-HOUR EXPIRY CHECK (for first-time access)
    if (now > new Date(session.expiresAt)) {
        session.status = 'expired';
        interviewSessions.set(sessionId, session);
        await updateSessionInAzure(sessionId, session);

        console.log(`⏰ Session ${sessionId} has EXPIRED (48-hour window)`);

        return res.status(410).json({
            error: 'Interview link has expired',
            code: 'EXPIRED',
            message: 'This interview link expired after 48 hours. Please contact the administrator for a new link.',
            expiresAt: session.expiresAt,
            currentTime: now.toISOString()
        });
    }

    // FIRST ACCESS TRACKING
    if (!session.firstAccessedAt) {
        session.firstAccessedAt = now.toISOString();
        interviewSessions.set(sessionId, session);
        await updateSessionInAzure(sessionId, session);
        console.log(`👁️ First access recorded for session ${sessionId}`);
    }

    console.log(`✅ Session ${sessionId} validation passed - expires at ${session.expiresAt}`);

    const { resumeBuffers, jobDescriptionBuffer, ...sessionData } = session;
    res.json(sessionData);
}

/**
 * MARK INTERVIEW AS STARTED
 */
export async function markStarted(req, res) {
    const { sessionId } = req.params;
    let session = interviewSessions.get(sessionId);

    if (!session) {
        session = await loadSessionFromAzure(sessionId);
        if (session) {
            interviewSessions.set(sessionId, session);
        }
    }

    if (!session) {
        return res.status(404).json({
            error: 'Session not found',
            code: 'NOT_FOUND'
        });
    }

    const now = new Date();

    session.interviewStartedAt = now.toISOString();
    session.status = 'active';

    interviewSessions.set(sessionId, session);
    await updateSessionInAzure(sessionId, session);

    console.log(`🔒 Interview ${sessionId} started`);

    res.json({
        success: true,
        message: 'Interview started successfully',
        startedAt: session.interviewStartedAt
    });
}

/**
 * SAVE TRANSCRIPT
 */
export async function saveTranscript(req, res) {
    const { sessionId } = req.params;
    const { transcript } = req.body;

    // Fall back to Azure like every other handler in this file. This one checked
    // ONLY the in-memory map, so after a backend restart or a redeploy mid-
    // interview every transcript POST 404'd and the rest of the interview was
    // never recorded — silently, because the frontend fires these off with a
    // .catch that only logs.
    let session = interviewSessions.get(sessionId);
    if (!session) {
        session = await loadSessionFromAzure(sessionId);
        if (session) interviewSessions.set(sessionId, session);
    }

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    if (!transcript) {
        return res.status(400).json({ error: 'Transcript entry required' });
    }

    // A session restored from a blob written before transcripts existed (or one
    // built by a path that never set the field) has no array here, and .push
    // threw an unhandled 500 on the very first turn.
    if (!Array.isArray(session.transcript)) session.transcript = [];
    session.transcript.push(transcript);

    // Asynchronously update in Azure to prevent block, with error logs
    updateSessionInAzure(sessionId, session).catch(err => {
        console.error(`❌ Failed to update session transcript in Azure for ${sessionId}:`, err.message);
    });

    res.json({ success: true });
}

/**
 * SAVE AUDIO (EXISTING SEPARATE AUDIO RECORDING)
 */
export async function saveAudio(req, res) {
    const { sessionId } = req.params;
    const { candidateAudio, aiAudio, duration } = req.body;

    const session = interviewSessions.get(sessionId);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    session.audioDuration = duration || 0;

    if (audioContainerClient) {
        try {
            const attemptSuffix = session.currentAttemptNumber > 0 ? `_attempt${session.currentAttemptNumber}` : '';

            const candidateBlobName = `audio_candidate_${sessionId}${attemptSuffix}_${Date.now()}.webm`;
            const candidateClient = audioContainerClient.getBlockBlobClient(candidateBlobName);
            const candidateData = candidateAudio.split(',')[1] || candidateAudio;
            const candidateBuffer = Buffer.from(candidateData, 'base64');

            await candidateClient.upload(candidateBuffer, candidateBuffer.length, {
                blobHTTPHeaders: { blobContentType: 'audio/webm' }
            });

            session.candidateAudioUrl = candidateClient.url;
            console.log(`✅ Candidate audio: ${candidateBlobName} (${(candidateBuffer.length / 1024).toFixed(1)} KB)`);

            const aiBlobName = `audio_ai_${sessionId}${attemptSuffix}_${Date.now()}.webm`;
            const aiClient = audioContainerClient.getBlockBlobClient(aiBlobName);
            const aiData = aiAudio.split(',')[1] || aiAudio;
            const aiBuffer = Buffer.from(aiData, 'base64');

            await aiClient.upload(aiBuffer, aiBuffer.length, {
                blobHTTPHeaders: { blobContentType: 'audio/webm' }
            });

            session.aiAudioUrl = aiClient.url;
            console.log(`✅ AI audio: ${aiBlobName} (${(aiBuffer.length / 1024).toFixed(1)} KB)`);

        } catch (error) {
            console.error('❌ Azure audio error:', error.message);
        }
    } else {
        const dir = './audio';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);

        const attemptSuffix = session.currentAttemptNumber > 0 ? `_attempt${session.currentAttemptNumber}` : '';
        const candidateFile = `${dir}/candidate_${sessionId}${attemptSuffix}.webm`;
        const aiFile = `${dir}/ai_${sessionId}${attemptSuffix}.webm`;

        const candidateData = candidateAudio.split(',')[1] || candidateAudio;
        const aiData = aiAudio.split(',')[1] || aiAudio;

        fs.writeFileSync(candidateFile, Buffer.from(candidateData, 'base64'));
        fs.writeFileSync(aiFile, Buffer.from(aiData, 'base64'));

        console.log(`✅ Audio saved locally: ${candidateFile}, ${aiFile}`);
    }

    res.json({ success: true });
}

/**
 * CHUNKED VIDEO UPLOAD ENDPOINT (NEW)
 * Receives video chunks and appends them to Azure Append Blob
 */
export async function uploadChunk(req, res) {
    const sessionId = req.headers['x-session-id'];
    const sequence = req.body.sequence || '0';

    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID required in headers' });
    }

    if (!req.file) {
        return res.status(400).json({ error: 'No chunk data provided' });
    }

    const chunkBuffer = req.file.buffer;
    const chunkSize = chunkBuffer.length;

    console.log(`📥 Received chunk ${sequence} for session ${sessionId} (${(chunkSize / 1024).toFixed(1)}KB)`);

    try {
        // Get current attempt number
        let session = interviewSessions.get(sessionId);
        if (!session) {
            session = await loadSessionFromAzure(sessionId);
            if (session) interviewSessions.set(sessionId, session);
        }

        const attemptNumber = session?.currentAttemptNumber || 1;
        const attemptSuffix = attemptNumber > 1 ? `_attempt${attemptNumber}` : '';

        if (videoContainerClient) {
            // Azure Append Blob Strategy
            const blobName = `unified_video_${sessionId}${attemptSuffix}.webm`;
            const appendBlobClient = videoContainerClient.getAppendBlobClient(blobName);

            // Create blob on first chunk
            const exists = await appendBlobClient.exists();
            if (!exists) {
                await appendBlobClient.create({
                    blobHTTPHeaders: { blobContentType: 'video/webm' }
                });
                console.log(`✅ Created new append blob: ${blobName}`);
            }

            // Append this chunk to the blob
            await appendBlobClient.appendBlock(chunkBuffer, chunkSize);
            console.log(`✅ Appended chunk ${sequence} to ${blobName}`);

        } else {
            // Local Fallback - Append to file
            const dir = './videos';
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            const videoFile = `${dir}/unified_video_${sessionId}${attemptSuffix}.webm`;
            fs.appendFileSync(videoFile, chunkBuffer);
            console.log(`✅ Appended chunk ${sequence} to local file`);
        }

        res.json({ success: true, sequence, chunkSize });

    } catch (error) {
        console.error('❌ Chunk upload error:', error.message);
        res.status(500).json({ error: 'Failed to save chunk', details: error.message });
    }
}

/**
 * VIOLATION TRACKING
 */
export async function recordViolation(req, res) {
    const { sessionId } = req.params;
    const violation = req.body;

    let session = interviewSessions.get(sessionId);
    if (!session) {
        session = await loadSessionFromAzure(sessionId);
        if (session) interviewSessions.set(sessionId, session);
    }

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    if (!session.violations) session.violations = [];
    session.violations.push(violation);

    interviewSessions.set(sessionId, session);
    await updateSessionInAzure(sessionId, session);

    console.log(`⚠️ Violation recorded for session ${sessionId} attempt #${session.currentAttemptNumber}: ${violation.type}`);

    res.json({ success: true });
}

/**
 * COMPLETE INTERVIEW (WITH RETRY WINDOW LOGIC)
 */
export async function completeInterview(req, res) {
    const { sessionId } = req.params;
    let session = interviewSessions.get(sessionId);

    if (!session) {
        session = await loadSessionFromAzure(sessionId);
        if (session) {
            interviewSessions.set(sessionId, session);
        }
    }

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    const now = new Date();

    // Get unified video URL for this attempt
    let unifiedVideoUrl = '';
    let videoFileSize = 0;
    let videoBlobName = '';

    if (videoContainerClient) {
        const blobName = `unified_video_${sessionId}.webm`;
        videoBlobName = blobName;
        const appendBlobClient = videoContainerClient.getAppendBlobClient(blobName);
        const exists = await appendBlobClient.exists();

        if (exists) {
            unifiedVideoUrl = appendBlobClient.url;
            const properties = await appendBlobClient.getProperties();
            videoFileSize = properties.contentLength || 0;
            console.log(`✅ Unified video ready: ${unifiedVideoUrl} (${(videoFileSize / (1024 * 1024)).toFixed(2)}MB)`);
        }
    } else {
        const videoFile = `./videos/unified_video_${sessionId}.webm`;
        if (fs.existsSync(videoFile)) {
            unifiedVideoUrl = videoFile;
            const stats = fs.statSync(videoFile);
            videoFileSize = stats.size;
            videoBlobName = `unified_video_${sessionId}.webm`;
            console.log(`✅ Unified video ready: ${videoFile} (${(videoFileSize / (1024 * 1024)).toFixed(2)}MB)`);
        }
    }

    // Update current session state
    session.status = 'completed';
    session.completedAt = now.toISOString();
    session.unifiedVideoUrl = unifiedVideoUrl;
    session.videoFileSize = videoFileSize;

    interviewSessions.set(sessionId, session);
    await updateSessionInAzure(sessionId, session);

    console.log(`✅ Interview ${sessionId} completed`);

    let transcriptBlobUrl = '';

    if (containerClient) {
        try {
            const transcriptBlobName = `transcript_${sessionId}.json`;
            const transcriptBlockBlobClient = containerClient.getBlockBlobClient(transcriptBlobName);

            const transcriptData = JSON.stringify({
                sessionId: session.sessionId,
                jobTitle: session.jobTitle,
                jobDescription: session.jobDescription,
                jobDescriptionFileName: session.jobDescriptionFileName,
                resumeText: session.resumeText,
                resumeFileName: session.resumeFileName,
                transcript: session.transcript,
                createdAt: session.createdAt,
                expiresAt: session.expiresAt,
                firstAccessedAt: session.firstAccessedAt,
                interviewStartedAt: session.interviewStartedAt,
                completedAt: session.completedAt,
                audioDuration: session.audioDuration,
                videoDuration: session.videoDuration || 0,
                videoFileSize: session.videoFileSize || 0,
                unifiedVideoUrl: session.unifiedVideoUrl,
                violations: session.violations || []
            }, null, 2);

            // Byte length, not String.length — see the long note in
            // sessionStore.saveSessionToAzure(). This blob is the DELIVERABLE
            // transcript handed to Power Automate, and it is certain to contain
            // multi-byte characters: the AI's own speech is full of em-dashes
            // ("You mentioned Kafka — how did you handle rebalancing?"), and
            // résumé text carries bullets and accented names. Declaring a short
            // length truncated the JSON, so the saved transcript did not parse.
            const transcriptPayload = Buffer.from(transcriptData, 'utf8');
            await transcriptBlockBlobClient.upload(transcriptPayload, transcriptPayload.byteLength, {
                blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' }
            });

            transcriptBlobUrl = transcriptBlockBlobClient.url;
            console.log(`✅ Transcript saved to Azure: ${transcriptBlobName}`);
        } catch (error) {
            console.error('❌ Azure transcript error:', error.message);
        }
    } else {
        const dir = './transcripts';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        const filename = `${dir}/transcript_${sessionId}.json`;
        fs.writeFileSync(filename, JSON.stringify(session.transcript, null, 2));
        console.log(`✅ Transcript saved locally: ${filename}`);
    }

    // Guard the array: every other read of session.transcript in this response
    // uses `(session.transcript || [])`, but this one did not — so a session
    // whose transcript was never initialised threw here and turned a completed
    // interview into a 500, losing the completion callback entirely.
    const evaluationEntry = (session.transcript || []).find(t => t.role === 'Evaluation');
    const evaluationText = evaluationEntry ? evaluationEntry.text : 'No evaluation generated';

    // Helper function to convert null to empty string
    const nullToEmpty = (value) => value === null || value === undefined ? '' : value;

    // Return all data needed for Power Automate - with null safety
    res.json({
        success: true,
        sessionData: {
            sessionId: session.sessionId || '',
            jobTitle: nullToEmpty(session.jobTitle),
            toEmails: nullToEmpty(session.toEmails),
            jobDescription: nullToEmpty(session.jobDescription),
            jobDescriptionFileName: nullToEmpty(session.jobDescriptionFileName),
            resumeText: nullToEmpty(session.resumeText),
            resumeFileName: nullToEmpty(session.resumeFileName),
            candidateAudioUrl: nullToEmpty(session.candidateAudioUrl),
            aiAudioUrl: nullToEmpty(session.aiAudioUrl),
            unifiedVideoUrl: nullToEmpty(unifiedVideoUrl),
            videoBlobName: nullToEmpty(videoBlobName),
            videoDuration: session.videoDuration || 0,
            videoFileSize: videoFileSize || 0,
            transcriptBlobUrl: nullToEmpty(transcriptBlobUrl),
            transcriptCount: (session.transcript || []).length,
            evaluation: nullToEmpty(evaluationText),
            audioDuration: session.audioDuration || 0,
            createdAt: nullToEmpty(session.createdAt),
            expiresAt: nullToEmpty(session.expiresAt),
            timestamp: new Date().toISOString(),
            transcript: JSON.stringify(session.transcript || []),
            violations: JSON.stringify(session.violations || []),
            resumePdfUrl: nullToEmpty(session.resumePdfUrl),
            resumeMetadata: JSON.stringify({
                fileName: nullToEmpty(session.resumeFileName),
                mimeType: nullToEmpty(session.resumeMimeType) || 'application/pdf',
                textPreview: session.resumeText ? session.resumeText.substring(0, 500) + '...' : ''
            })
        }
    });
}

/**
 * UPDATE SESSION DATES (FOR DASHBOARD CREATE INTERVIEW)
 */
export async function updateSessionDates(req, res) {
    const { sessionId } = req.params;

    try {
        let session = interviewSessions.get(sessionId);

        if (!session) {
            session = await loadSessionFromAzure(sessionId);
            if (session) {
                interviewSessions.set(sessionId, session);
            }
        }

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Set createdAt to now
        const now = new Date();
        session.createdAt = now.toISOString();

        // Set expiresAt to 1 day from now at 11:59:59 PM
        const expiryDate = new Date(now);
        expiryDate.setDate(expiryDate.getDate() + 1);
        expiryDate.setHours(23, 59, 59, 999);
        session.expiresAt = expiryDate.toISOString();

        // Update status if needed
        session.status = 'pending';

        // Save to both memory and Azure
        interviewSessions.set(sessionId, session);
        await updateSessionInAzure(sessionId, session);

        console.log(`✅ Session ${sessionId} dates updated: createdAt=${session.createdAt}, expiresAt=${session.expiresAt}`);

        res.json({
            success: true,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt
        });

    } catch (error) {
        console.error('❌ Error updating session dates:', error.message);
        res.status(500).json({ error: 'Failed to update session dates', details: error.message });
    }
}

// --------------------------------------------------------------------------------
// VOICE TICKET ENDPOINT
// Issues a short-lived, session-bound ticket the browser uses to open the secure
// voice WebSocket relay (see services/voiceProxy.js). The Azure endpoint and API
// key are NEVER sent to the browser — they stay server-side. The browser only
// receives the ticket, the relay path, and non-secret model info.
// --------------------------------------------------------------------------------
export async function getToken(req, res) {
    const { sessionId } = req.params;

    // Step 1 — Validate session exists and is active
    let session = await loadSessionFromAzure(sessionId);
    if (!session) {
        session = interviewSessions.get(sessionId);
    }

    if (!session) {
        return res.status(404).json({ message: 'Interview session not found.' });
    }

    if (session.status === 'completed' || session.completedAt) {
        return res.status(410).json({ message: 'This interview has already been completed.' });
    }

    // Step 2 — Issue a ticket for the relay (no secrets leave the server)
    try {
        if (!AZURE_VOICELIVE_ENDPOINT || !AZURE_VOICELIVE_API_KEY) {
            console.error('❌ AZURE_VOICELIVE credentials are not fully configured in .env');
            return res.status(500).json({ message: 'Server configuration error.' });
        }

        console.log(`✅ Voice ticket issued for session ${sessionId}`);
        res.json(issueVoiceTicket(sessionId));

    } catch (e) {
        console.error('❌ Voice ticket generation failed:', e.message);
        res.status(500).json({ message: 'Failed to authorize voice session. Please try again.' });
    }
}
