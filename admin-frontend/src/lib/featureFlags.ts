// Default (unset/false) preserves current behavior exactly: direct
// browser -> n8n calls, matching dashboard.html/analytics.html today.
// Set VITE_USE_CANDIDATES_PROXY=true in admin-frontend/.env(.local) to route
// through the Phase 5 backend proxy instead - zero-risk, reversible by
// unsetting the var and rebuilding (plan section 19).
export const USE_CANDIDATES_PROXY = import.meta.env.VITE_USE_CANDIDATES_PROXY === 'true';
