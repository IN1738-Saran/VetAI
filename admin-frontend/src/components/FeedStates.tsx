import { RefreshCw, AlertTriangle, Inbox } from 'lucide-react';

// Error/empty copy patterns match dashboard.html's existing
// "Failed to Load Data" treatment (plan section 8: carry existing error
// copy through rather than replacing it with something generic).

export function FeedLoadingSkeleton() {
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-5 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[92px] animate-pulse rounded-card bg-card shadow-card" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-card bg-card shadow-card" />
    </div>
  );
}

export function FeedErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-card bg-card p-12 text-center shadow-card">
      <AlertTriangle className="text-status-red" size={28} />
      <div className="text-[15px] font-semibold text-ink">Failed to load data</div>
      <p className="max-w-md text-[13px] text-ink-muted">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-navy hover:bg-accent-hover"
      >
        <RefreshCw size={14} /> Retry
      </button>
    </div>
  );
}

export function FeedEmptyState({ message = 'No candidates yet.' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-card bg-card p-12 text-center shadow-card">
      <Inbox className="text-ink-faint" size={28} />
      <div className="text-[13px] text-ink-muted">{message}</div>
    </div>
  );
}
