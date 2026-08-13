// ============================================================================
// CANDIDATES FEED ROUTES (Phase 5 - optional, additive) - mounted at /api
// Only reached if the admin-frontend is built with
// VITE_USE_CANDIDATES_PROXY=true; otherwise the browser continues calling
// n8n directly, exactly as today.
// ============================================================================
import { Router } from 'express';
import {
    getCandidatesFeed,
    updateCandidateStatus,
    createInterviewForCandidate,
} from '../controllers/candidatesFeedController.js';

const router = Router();

router.get('/candidates', getCandidatesFeed);
router.post('/candidates/:sessionId/status', updateCandidateStatus);
router.post('/candidates/:sessionId/create-interview', createInterviewForCandidate);

export default router;
