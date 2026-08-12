// ============================================================================
// JOB EMAIL CONFIG ROUTES (mounted at /api)
// ============================================================================
import { Router } from 'express';
import { getJobEmailConfigs, upsertJobEmailConfig } from '../controllers/jobEmailController.js';

const router = Router();

router.get('/job-email-configs', getJobEmailConfigs);
router.post('/job-email-configs', upsertJobEmailConfig);

export default router;
