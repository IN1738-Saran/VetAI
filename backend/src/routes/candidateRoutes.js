// ============================================================================
// CANDIDATE ROUTES (mounted at /api)
// ============================================================================
import { Router } from 'express';
import {
    downloadProfile,
    downloadVideo,
    downloadFeedback,
    downloadQuestions,
    deleteCandidate,
} from '../controllers/candidateController.js';

const router = Router();

router.get('/download-profile/:sessionId', downloadProfile);
router.get('/download-video/:sessionId', downloadVideo);
router.get('/download-feedback/:sessionId', downloadFeedback);
router.get('/download-questions/:sessionId', downloadQuestions);
router.delete('/delete-candidate/:sessionId', deleteCandidate);

export default router;
