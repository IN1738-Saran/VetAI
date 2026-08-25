// ============================================================================
// AI ASSISTANT ROUTES (mounted at /api)
// ============================================================================
import { Router } from 'express';
import { getAssistantOverview, postAssistantAsk } from '../controllers/assistantController.js';

const router = Router();

router.get('/assistant/overview', getAssistantOverview);
router.post('/assistant/ask', postAssistantAsk);

export default router;
