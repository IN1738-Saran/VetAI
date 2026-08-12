// ============================================================================
// INTERVIEW ROUTES (mounted at /api)
// ============================================================================
import { Router } from 'express';
import { uploadFields, uploadChunk as uploadChunkMiddleware } from '../middleware/upload.js';
import {
    createInterview,
    getInterview,
    markStarted,
    saveTranscript,
    saveAudio,
    uploadChunk,
    recordViolation,
    completeInterview,
    updateSessionDates,
    getToken,
} from '../controllers/interviewController.js';
import { notifyPowerAutomate, notifyReattempt } from '../controllers/webhookController.js';

const router = Router();

router.post('/create-interview', uploadFields, createInterview);
router.get('/interview/:sessionId', getInterview);
router.post('/interview/:sessionId/mark-started', markStarted);
router.post('/interview/:sessionId/transcript', saveTranscript);
router.post('/interview/:sessionId/audio', saveAudio);
router.post('/upload-chunk', uploadChunkMiddleware.single('chunk'), uploadChunk);
router.post('/interview/:sessionId/violation', recordViolation);
router.post('/interview/:sessionId/complete', completeInterview);
router.post('/update-session-dates/:sessionId', updateSessionDates);
router.post('/interview/:sessionId/token', getToken);

// Webhook relays — keep third-party URLs (and their embedded signatures) off the client.
router.post('/interview/notify', notifyPowerAutomate);
router.post('/interview/reattempt', notifyReattempt);

export default router;
