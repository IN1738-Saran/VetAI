import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { NotAvailable } from '@/components/NotAvailable';

// There is no multi-tenant/organization model in this app (single company
// deployment, no departments/seats/billing anywhere in the data) - building
// an org-management UI on top of that would be fabricating a feature that
// doesn't exist. What IS real and useful here: which backend integrations
// are actually connected right now (GET /api/system-status - booleans only,
// never a URL or key), which is exactly what a recruiter/admin needs to
// know when something on another screen shows "not available".
interface SystemStatus {
  blobStorage: boolean;
  voiceInterview: boolean;
  documentIntelligence: boolean;
  database: boolean;
  aiAssistant: boolean;
}

type StatusState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: SystemStatus };

function useSystemStatus(): StatusState {
  const [state, setState] = useState<StatusState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/system-status')
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: 'error' });
          return;
        }
        const data = (await res.json()) as SystemStatus;
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

const SERVICES: Array<{ key: keyof SystemStatus; label: string; hint: string }> = [
  { key: 'blobStorage', label: 'Resume, recording and report storage', hint: 'Azure Blob Storage' },
  { key: 'voiceInterview', label: 'Voice-to-voice interview', hint: 'The AI interviewer candidates speak with' },
  { key: 'documentIntelligence', label: 'Résumé and job description reading', hint: 'Document text extraction' },
  { key: 'database', label: 'Candidate record database', hint: 'PostgreSQL' },
  { key: 'aiAssistant', label: 'AI Assistant chat', hint: 'The Q&A panel under AI Assistant' },
];

export function OrganizationView() {
  const status = useSystemStatus();

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div className="rounded-card bg-card p-5 shadow-card">
        <div className="mb-1 text-[14px] font-semibold text-ink">Workspace</div>
        <p className="mb-4 text-[12px] text-ink-muted">This deployment of VetAI</p>
        <ul className="space-y-2.5 text-[13px]">
          <li className="flex items-baseline justify-between">
            <span className="text-ink-muted">Company</span>
            <span className="font-medium text-ink">Systech Hiring</span>
          </li>
          <li className="flex items-baseline justify-between">
            <span className="text-ink-muted">Product</span>
            <span className="font-medium text-ink">VetAI</span>
          </li>
        </ul>
        <p className="mt-4 text-[11px] text-ink-faint">
          There's a single shared workspace in this environment - no separate teams, departments, or
          per-seat billing to manage yet.
        </p>
      </div>

      <div className="rounded-card bg-card p-5 shadow-card">
        <div className="mb-1 text-[14px] font-semibold text-ink">Connected services</div>
        <p className="mb-4 text-[12px] text-ink-muted">
          Whether each backend integration is currently configured - contact your administrator to change
          these.
        </p>

        {status.status === 'loading' && <p className="text-[13px] text-ink-muted">Loading...</p>}
        {status.status === 'error' && (
          <NotAvailable reason="Temporarily unavailable - please try again shortly." />
        )}
        {status.status === 'ready' && (
          <ul className="space-y-3">
            {SERVICES.map((service) => {
              const connected = status.data[service.key];
              return (
                <li key={service.key} className="flex items-center justify-between gap-3 text-[13px]">
                  <div>
                    <div className="text-ink">{service.label}</div>
                    <div className="text-[11px] text-ink-faint">{service.hint}</div>
                  </div>
                  {connected ? (
                    <span className="flex items-center gap-1 rounded-full bg-status-green-bg px-2 py-0.5 text-[11px] font-medium text-status-green-text">
                      <Check size={12} /> Connected
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-faint">
                      <X size={12} /> Not configured
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
