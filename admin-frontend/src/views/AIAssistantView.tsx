import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useCandidates } from '@/lib/useCandidates';
import { SAMPLE_JOBS, loadCustomJobs } from '@/lib/jobLibrary';
import { numericScore } from '@/lib/candidateDerived';
import { NotAvailable } from '@/components/NotAvailable';
import { FeedLoadingSkeleton, FeedErrorState } from '@/components/FeedStates';
import type { RawCandidate } from '@/lib/candidates';

// The recruiter question box only ever sends real, already-fetched
// candidate data (the same feed every other screen trusts) to the backend
// (POST /api/assistant/ask) - this view never invents a second copy of that
// data, and the model is instructed server-side to answer only from what it
// is given. Capped here independently of the server's own cap, sorted by
// most recently updated, so the context sent is both bounded and relevant.
const MAX_CANDIDATES_SENT = 50;

interface OverviewResponse {
  configured: boolean;
  transcriptCount: number | null;
  profileReportCount: number | null;
  feedbackReportCount: number | null;
}

type OverviewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: OverviewResponse };

function useAssistantOverview(): OverviewState {
  const [state, setState] = useState<OverviewState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/assistant/overview')
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: 'error' });
          return;
        }
        const data = (await res.json()) as OverviewResponse;
        setState({ status: 'ready', data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

const SUGGESTED_QUESTIONS = [
  'Who is ready to move forward?',
  'Compare the top 3 candidates for a role',
  'Why did this candidate score low?',
  'What skills are we short on?',
];

function formatCount(value: number | null): string {
  return value === null ? '-' : value.toLocaleString();
}

export function AIAssistantView() {
  const { data, isLoading, isError, error, refetch } = useCandidates();
  const overview = useAssistantOverview();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  const candidates = data ?? [];
  const jobCount = useMemo(() => new Set([...SAMPLE_JOBS, ...loadCustomJobs()].map((j) => j.title)).size, []);
  const scoredCount = candidates.filter((c) => numericScore(c) !== null).length;

  const contextSlice = useMemo(() => {
    return [...candidates]
      .sort(
        (a, b) => new Date(b.updatedat || b.createdat || 0).getTime() - new Date(a.updatedat || a.createdat || 0).getTime()
      )
      .slice(0, MAX_CANDIDATES_SENT)
      .map((c: RawCandidate) => ({
        candidatename: c.candidatename,
        jobtitle: c.jobtitle,
        overall_score: c.overall_score,
        verdict: c.verdict,
        status: c.status,
        sessionid: c.sessionid,
      }));
  }, [candidates]);

  async function sendQuestion(question: string) {
    const trimmed = question.trim();
    if (!trimmed || pending) return;

    setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);
    setDraft('');
    setPending(true);
    setAskError(null);

    try {
      const res = await fetch('/api/assistant/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed, candidates: contextSlice }),
      });
      const body = await res.json();

      if (!res.ok) {
        setAskError(body?.error || `The assistant couldn't answer that (${res.status}).`);
        return;
      }
      if (!body.configured) {
        setAskError('not-configured');
        return;
      }
      setMessages((prev) => [...prev, { role: 'assistant', text: body.answer as string }]);
    } catch (err) {
      setAskError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setPending(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    sendQuestion(draft);
  }

  if (isLoading) return <FeedLoadingSkeleton />;
  if (isError) return <FeedErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const chatDisabled = overview.status === 'ready' && !overview.data.configured;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-1 text-[14px] font-semibold text-ink">Ask about your pipeline</div>
          <p className="mb-4 text-[12px] text-ink-muted">
            Answers come from resumes, scores and reports already in VetAI.
          </p>

          {chatDisabled && (
            <NotAvailable reason="The assistant isn't connected to a language model in this environment yet. Ask your administrator to configure it." />
          )}

          {!chatDisabled && (
            <>
              <div className="mb-4 flex flex-wrap gap-2">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => sendQuestion(q)}
                    disabled={pending}
                    className="rounded-full border border-border px-3 py-1.5 text-[12px] text-ink hover:bg-surface disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>

              <div className="mb-4 max-h-[420px] space-y-3 overflow-y-auto">
                {messages.length === 0 && (
                  <p className="py-8 text-center text-[13px] text-ink-faint">
                    Ask a question about your candidates, or pick one above to get started.
                  </p>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={
                        'max-w-[85%] rounded-xl px-4 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap ' +
                        (m.role === 'user' ? 'bg-ink text-white' : 'bg-surface text-ink')
                      }
                    >
                      {m.text}
                    </div>
                  </div>
                ))}
                {pending && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-xl bg-surface px-4 py-2.5 text-[13px] text-ink-muted">
                      Thinking...
                    </div>
                  </div>
                )}
                {askError && askError !== 'not-configured' && (
                  <p className="text-[12px] text-status-red">{askError}</p>
                )}
              </div>

              <form onSubmit={handleSubmit} className="flex gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Ask about candidates, jobs or interviews..."
                  className="flex-1 rounded-lg border border-border px-3 py-2 text-[13px]"
                  disabled={pending}
                />
                <button
                  type="submit"
                  disabled={pending || !draft.trim()}
                  className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50"
                >
                  Ask
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-3 text-[14px] font-semibold text-ink">What it can see</div>
          <ul className="space-y-2.5 text-[13px]">
            <li className="flex items-baseline justify-between">
              <span className="text-ink-muted">Candidate resumes</span>
              <span className="font-medium text-ink">{candidates.length.toLocaleString()}</span>
            </li>
            <li className="flex items-baseline justify-between">
              <span className="text-ink-muted">Match scores and verdicts</span>
              <span className="font-medium text-ink">{scoredCount.toLocaleString()}</span>
            </li>
            <li className="flex items-baseline justify-between">
              <span className="text-ink-muted">Interview transcripts</span>
              <span className="font-medium text-ink">
                {overview.status === 'ready' ? formatCount(overview.data.transcriptCount) : '-'}
              </span>
            </li>
            <li className="flex items-baseline justify-between">
              <span className="text-ink-muted">Jobs in the Library</span>
              <span className="font-medium text-ink">{jobCount.toLocaleString()}</span>
            </li>
            <li className="flex items-baseline justify-between">
              <span className="text-ink-muted">Recruiter notes</span>
              <span className="font-medium text-ink-faint">Not tracked yet</span>
            </li>
          </ul>
        </div>

        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-3 text-[14px] font-semibold text-ink">Good questions to ask</div>
          <ul className="space-y-2 text-[13px] text-ink-muted">
            {SUGGESTED_QUESTIONS.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>

        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-3 text-[14px] font-semibold text-ink">What it will not do</div>
          <p className="text-[12px] leading-relaxed text-ink-muted">
            It answers from what's already in VetAI. It cannot shortlist or reject anyone, change a status, send
            an email, or see anything outside the system. Every recommendation still needs a person to act on it.
          </p>
        </div>
      </div>
    </div>
  );
}
