// ============================================================================
// JOB EMAIL CONFIG CONTROLLER
// CRUD for the per-job-title notification email lists.
// ============================================================================
import { pool } from '../config/db.js';

// ── GET /api/job-email-configs?q=<search> ────────────────────────────────────
// Returns all job-title configs whose title matches the optional search term.
export async function getJobEmailConfigs(req, res) {
    const q = (req.query.q || '').trim();
    try {
        let result;
        if (q) {
            result = await pool.query(
                `SELECT id, jobtitle, emails
                 FROM public.job_email_configs
                 WHERE LOWER(jobtitle) LIKE LOWER($1)
                 ORDER BY jobtitle
                 LIMIT 20`,
                [`%${q}%`]
            );
        } else {
            result = await pool.query(
                `SELECT id, jobtitle, emails
                 FROM public.job_email_configs
                 ORDER BY jobtitle
                 LIMIT 50`
            );
        }
        res.json({ success: true, configs: result.rows });
    } catch (err) {
        console.error('❌ job-email-configs GET error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
}

// ── POST /api/job-email-configs ──────────────────────────────────────────────
// Upserts the email list for a job title (called automatically on interview creation).
export async function upsertJobEmailConfig(req, res) {
    const { jobtitle, emails } = req.body;
    if (!jobtitle || !emails) {
        return res.status(400).json({ success: false, error: 'jobtitle and emails are required' });
    }
    try {
        const result = await pool.query(
            `INSERT INTO public.job_email_configs (jobtitle, emails)
             VALUES ($1, $2)
             ON CONFLICT (jobtitle)
             DO UPDATE SET emails = EXCLUDED.emails, updatedat = NOW()
             RETURNING *`,
            [jobtitle.trim().toLowerCase(), emails.trim()]
        );
        res.json({ success: true, config: result.rows[0] });
    } catch (err) {
        console.error('❌ job-email-configs POST error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
}
