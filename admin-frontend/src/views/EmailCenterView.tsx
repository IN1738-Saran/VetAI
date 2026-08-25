import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useCandidates } from '@/lib/useCandidates';
import { candidatesMissingEmail } from '@/lib/candidateDerived';
import { fetchJobEmailConfigs, type JobEmailConfig } from '@/lib/jobEmailConfigs';
import { NotAvailable } from '@/components/NotAvailable';
import { FeedLoadingSkeleton, FeedErrorState } from '@/components/FeedStates';

// Real, existing backend data - the per-job-title notification email list
// (public.job_email_configs) that's already used automatically whenever an
// interview is created (see backend/src/controllers/jobEmailController.js),
// just never surfaced in the admin UI until now. This view is a real CRUD
// screen against that table, not a mock inbox - there is no real email
// inbox/thread data anywhere in this system to show instead.
type ConfigsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: JobEmailConfig[] };

function useJobEmailConfigs(query: string, refreshKey: number) {
  const [state, setState] = useState<ConfigsState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    fetchJobEmailConfigs(query)
      .then((configs) => {
        if (!cancelled) setState({ status: 'ready', data: configs });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({ status: 'error', message: err instanceof Error ? err.message : 'Network error' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [query, refreshKey]);

  return state;
}

export function EmailCenterView() {
  const { data, isLoading, isError, error, refetch } = useCandidates();
  const [search, setSearch] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const configs = useJobEmailConfigs(search, refreshKey);

  const [jobTitle, setJobTitle] = useState('');
  const [emails, setEmails] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!jobTitle.trim() || !emails.trim()) return;

    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/job-email-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobtitle: jobTitle.trim(), emails: emails.trim() }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        setSaveError(body?.error || `Could not save this list (${res.status}).`);
        return;
      }
      setJobTitle('');
      setEmails('');
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <FeedLoadingSkeleton />;
  if (isError) return <FeedErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const missingEmail = candidatesMissingEmail(data ?? []);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-1 text-[14px] font-semibold text-ink">Add or update a notification list</div>
          <p className="mb-4 text-[12px] text-ink-muted">
            These addresses are notified automatically whenever an interview is created for this job title.
          </p>
          <form onSubmit={handleSave} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="mb-1 block text-[12px] font-medium text-ink-muted">Job title</label>
              <input
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="e.g. Senior Data Engineer - Azure"
                className="w-full rounded-lg border border-border px-3 py-1.5 text-[13px]"
              />
            </div>
            <div className="flex-[2] min-w-[240px]">
              <label className="mb-1 block text-[12px] font-medium text-ink-muted">Notification emails</label>
              <input
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
                placeholder="comma-separated, e.g. a@company.com, b@company.com"
                className="w-full rounded-lg border border-border px-3 py-1.5 text-[13px]"
              />
            </div>
            <button
              type="submit"
              disabled={saving || !jobTitle.trim() || !emails.trim()}
              className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </form>
          {saveError && <p className="mt-2 text-[12px] text-status-red">{saveError}</p>}
        </div>

        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-[14px] font-semibold text-ink">Notification lists by job title</div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search job titles..."
              className="w-56 rounded-lg border border-border px-3 py-1.5 text-[13px]"
            />
          </div>

          {configs.status === 'loading' && <p className="text-[13px] text-ink-muted">Loading...</p>}
          {configs.status === 'error' && (
            <NotAvailable reason="Temporarily unavailable - please try again shortly." />
          )}
          {configs.status === 'ready' && configs.data.length === 0 && (
            <NotAvailable reason="No notification lists have been set up yet." />
          )}
          {configs.status === 'ready' && configs.data.length > 0 && (
            <ul className="divide-y divide-border">
              {configs.data.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-4 py-3 text-[13px]">
                  <span className="font-medium text-ink">{c.jobtitle}</span>
                  <span className="text-right text-ink-muted">{c.emails}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-1 text-[14px] font-semibold text-ink">Candidates missing an email</div>
          <p className="mb-3 text-[12px] text-ink-muted">Can't be invited to interview until this is fixed</p>
          {missingEmail.length === 0 ? (
            <NotAvailable reason="Every candidate currently in the system has an email on file." />
          ) : (
            <ul className="space-y-2">
              {missingEmail.slice(0, 20).map((c) => (
                <li key={c.sessionid}>
                  <Link
                    to={`/candidates/${c.sessionid}`}
                    className="flex items-center justify-between rounded-lg px-2 py-1.5 text-[13px] hover:bg-surface"
                  >
                    <span className="text-ink">{c.candidatename || 'Unnamed candidate'}</span>
                    <span className="text-ink-muted">{c.jobtitle || 'Unknown role'}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {missingEmail.length > 20 && (
            <p className="mt-2 text-[11px] text-ink-faint">
              Showing the first 20 of {missingEmail.length}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
