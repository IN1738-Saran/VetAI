// ============================================================================
// PAGE CONTROLLER
// Phase 8 cutover: these routes now redirect to the new admin-frontend app
// instead of serving the old static HTML pages. Each mapping below goes to
// the equivalent screen by PURPOSE, not by name - dashboard.html was always
// the candidate list/table, which is the new app's Candidates view, not its
// Dashboard KPI view.
//
// 302 (temporary), not 301, deliberately: a 301 gets aggressively cached by
// browsers, which would make this harder to revert. Rollback is reverting
// this commit - the old views/*.html files were never deleted, so a plain
// res.sendFile from VIEWS_DIR (see git history) serves them again unchanged
// (plan section 19).
// ============================================================================

// Dashboard page with candidate data table -> new Candidates view (the true
// equivalent of what this page actually showed).
export function serveDashboard(req, res) {
    res.redirect(302, '/admin/candidates');
}

// Analytics page -> new Analytics view.
export function serveAnalytics(req, res) {
    res.redirect(302, '/admin/analytics');
}

// Admin page with interview creation form -> new New Interview view.
export function serveAdmin(req, res) {
    res.redirect(302, '/admin/interviews');
}
