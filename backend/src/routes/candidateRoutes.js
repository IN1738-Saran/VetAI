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
    getCandidateArtifactsMeta,
    getProfileHighlights,
    getSkillsGapSummary,
    getCandidateSessionTimeline,
} from '../controllers/candidateController.js';

const router = Router();

router.get('/download-profile/:sessionId', downloadProfile);
router.get('/download-video/:sessionId', downloadVideo);
router.get('/download-feedback/:sessionId', downloadFeedback);
router.get('/download-questions/:sessionId', downloadQuestions);
router.get('/candidate-artifacts/:sessionId', getCandidateArtifactsMeta);
router.get('/candidate-artifacts/:sessionId/highlights', getProfileHighlights);
router.get('/candidate-session-timeline/:sessionId', getCandidateSessionTimeline);
router.post('/skills-gap-summary', getSkillsGapSummary);
router.delete('/delete-candidate/:sessionId', deleteCandidate);

export default router;
