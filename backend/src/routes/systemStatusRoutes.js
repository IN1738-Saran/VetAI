// ============================================================================
// SYSTEM STATUS ROUTES (mounted at /api)
// ============================================================================
import { Router } from 'express';
import { getSystemStatus } from '../controllers/systemStatusController.js';

const router = Router();

router.get('/system-status', getSystemStatus);

export default router;
