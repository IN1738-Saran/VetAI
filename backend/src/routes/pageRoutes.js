// ============================================================================
// PAGE ROUTES — admin / dashboard / analytics HTML pages (mounted at /api)
// ============================================================================
import { Router } from 'express';
import { serveDashboard, serveAnalytics, serveAdmin } from '../controllers/pageController.js';

const router = Router();

router.get('/dashboard', serveDashboard);
router.get('/analytics', serveAnalytics);
router.get('/', serveAdmin);

export default router;
