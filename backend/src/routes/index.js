// ============================================================================
// API ROUTER — aggregates all route modules (mounted at /api by the app).
// Order preserves the original registration order in server.js: page routes
// first, then the interview / candidate / job-email API endpoints.
// ============================================================================
import { Router } from 'express';
import pageRoutes from './pageRoutes.js';
import interviewRoutes from './interviewRoutes.js';
import candidateRoutes from './candidateRoutes.js';
import jobEmailRoutes from './jobEmailRoutes.js';

const router = Router();

router.use(pageRoutes);
router.use(interviewRoutes);
router.use(candidateRoutes);
router.use(jobEmailRoutes);

export default router;
