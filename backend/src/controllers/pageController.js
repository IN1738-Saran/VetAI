// ============================================================================
// PAGE CONTROLLER
// Serves the static admin / dashboard / analytics HTML pages.
// ============================================================================
import path from 'path';
import { VIEWS_DIR } from '../config/paths.js';

// Dashboard page with candidate data table
export function serveDashboard(req, res) {
    res.sendFile(path.join(VIEWS_DIR, 'dashboard.html'));
}

// Analytics page
export function serveAnalytics(req, res) {
    res.sendFile(path.join(VIEWS_DIR, 'analytics.html'));
}

// Admin page with interview creation form
export function serveAdmin(req, res) {
    res.sendFile(path.join(VIEWS_DIR, 'admin.html'));
}
