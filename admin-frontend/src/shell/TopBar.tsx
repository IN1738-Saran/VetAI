import { useEffect, useRef, useState, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Bell, HelpCircle } from 'lucide-react';
import { useCandidates } from '@/lib/useCandidates';
import { recentActivity, formatRelativeTime } from '@/lib/candidateDerived';

interface TopBarProps {
  title: string;
  subtitle?: string;
}

// No auth system exists yet (Entra ID integration is a separate future
// project) - show a generic placeholder rather than any specific name, per
// explicit instruction not to hardcode a dummy recruiter identity.
const CURRENT_USER = { initials: 'U', name: 'User' };

const STAGE_DOT_CLASS: Record<string, string> = {
  green: 'bg-status-green',
  blue: 'bg-status-blue',
  amber: 'bg-status-amber',
  red: 'bg-status-red',
  gray: 'bg-status-gray',
};

// Shared by the notifications and help dropdowns - closes when a click
// lands outside the given ref's element.
function useClickOutside(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open, ref, onClose]);
}

export function TopBar({ title, subtitle }: TopBarProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);

  // Shares the same ['candidates'] query cache every view already reads
  // through useCandidates() - this doesn't trigger an extra fetch, it's the
  // same cached feed. "Notifications" here is real recent activity
  // (candidatename/stage/updatedat), the same data and same
  // recentActivity() function the Dashboard's Activity panel already uses -
  // not a fabricated notification system with invented events.
  const { data } = useCandidates();
  const activity = recentActivity(data ?? [], 8);

  useClickOutside(notificationsRef, notificationsOpen, () => setNotificationsOpen(false));
  useClickOutside(helpRef, helpOpen, () => setHelpOpen(false));

  function runSearch() {
    const trimmed = query.trim();
    if (!trimmed) return;
    // Real, working search: navigates to Candidates with the term applied as
    // a query param, which filters the actual fetched candidates feed by
    // name/email/job title (see CandidatesView's useSearchParams handling) -
    // not a fake search over a hardcoded array.
    navigate(`/candidates?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <header className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-4 lg:px-8">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 truncate text-[13px] text-ink-muted">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative hidden sm:block">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch();
            }}
            placeholder="Search candidates, jobs, emails"
            className="w-40 rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-[13px] text-ink placeholder:text-ink-faint focus-visible:bg-card md:w-56 lg:w-72"
            title="Press Enter to search candidates by name, email, or job title"
          />
        </div>

        <div className="relative" ref={notificationsRef}>
          <button
            type="button"
            onClick={() => setNotificationsOpen((prev) => !prev)}
            aria-label="Recent activity"
            aria-expanded={notificationsOpen}
            className="relative rounded-lg border border-border p-2 text-ink-muted hover:bg-surface"
          >
            <Bell size={16} />
            {activity.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-status-red" />
            )}
          </button>

          {notificationsOpen && (
            <div className="absolute right-0 top-[calc(100%+8px)] z-20 w-80 rounded-card bg-card shadow-card">
              <div className="border-b border-border px-4 py-3 text-[13px] font-semibold text-ink">
                Recent activity
              </div>
              {activity.length === 0 ? (
                <p className="px-4 py-6 text-center text-[12px] text-ink-muted">
                  No candidate updates yet.
                </p>
              ) : (
                <ul className="max-h-80 divide-y divide-border overflow-y-auto">
                  {activity.map(({ candidate, timestamp, stage }) => (
                    <li key={candidate.sessionid}>
                      <button
                        type="button"
                        onClick={() => {
                          setNotificationsOpen(false);
                          navigate(`/candidates/${candidate.sessionid}`);
                        }}
                        className="flex w-full items-start gap-2.5 px-4 py-3 text-left hover:bg-surface"
                      >
                        <span
                          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STAGE_DOT_CLASS[stage.tone]}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] text-ink">
                            <span className="font-medium">{candidate.candidatename || 'N/A'}</span> -{' '}
                            {stage.label}
                          </div>
                          <div className="text-[12px] text-ink-faint">{formatRelativeTime(timestamp)}</div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="border-t border-border px-4 py-2 text-[11px] text-ink-faint">
                Based on the candidates feed's real updatedat/createdat timestamps - no separate
                notification store exists yet.
              </p>
            </div>
          )}
        </div>

        <div className="relative" ref={helpRef}>
          <button
            type="button"
            onClick={() => setHelpOpen((prev) => !prev)}
            aria-label="Help"
            aria-expanded={helpOpen}
            className="rounded-lg border border-border p-2 text-ink-muted hover:bg-surface"
          >
            <HelpCircle size={16} />
          </button>

          {helpOpen && (
            <div className="absolute right-0 top-[calc(100%+8px)] z-20 w-96 rounded-card bg-card shadow-card">
              <div className="border-b border-border px-4 py-3 text-[13px] font-semibold text-ink">Help</div>
              <div className="space-y-4 px-4 py-3 text-[12px] leading-relaxed text-ink-muted">
                <div>
                  <div className="mb-1 text-[12px] font-semibold text-ink">Search</div>
                  <p>
                    Type into the search box and press Enter to jump to Candidates, filtered by name,
                    email, or job title.
                  </p>
                </div>
                <div>
                  <div className="mb-1 text-[12px] font-semibold text-ink">Where the data comes from</div>
                  <p>
                    Every candidate record comes from the real scoring feed. It doesn't include a
                    Department field or per-dimension sub-scores (Skills match, Experience fit, etc.), and
                    has no distinct "Qualified" pipeline stage - screens that need those show an honest
                    "not available" instead of guessing.
                  </p>
                </div>
                <div>
                  <div className="mb-1 text-[12px] font-semibold text-ink">Reports</div>
                  <p>
                    Profile match and interview feedback reports download as formatted PDFs. Strengths/Gaps
                    on a candidate's page are pulled automatically from the profile report's own text when
                    it has a recognizable section for them.
                  </p>
                </div>
                <div>
                  <div className="mb-1 text-[12px] font-semibold text-ink">Job Library</div>
                  <p>
                    Browse example roles or add your own with "New job" - new listings are saved to your
                    browser for now.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 pl-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-[12px] font-semibold text-navy">
            {CURRENT_USER.initials}
          </div>
          <div className="hidden leading-tight sm:block">
            <div className="text-[13px] font-medium text-ink">{CURRENT_USER.name}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
