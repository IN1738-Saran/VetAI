import { Search, Bell, HelpCircle } from 'lucide-react';

interface TopBarProps {
  title: string;
  subtitle?: string;
}

// Static placeholder identity, matching the current admin.html's "User"
// placeholder pattern - no auth system exists (plan Strict Constraint #6).
const CURRENT_USER = { initials: 'PR', name: 'Priya R', role: 'Recruiter' };

export function TopBar({ title, subtitle }: TopBarProps) {
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
            placeholder="Search candidates, jobs, emails"
            disabled
            className="w-40 rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-[13px] text-ink placeholder:text-ink-faint disabled:cursor-not-allowed md:w-56 lg:w-72"
            title="Global search lands in a later phase"
          />
        </div>

        <button
          type="button"
          disabled
          className="relative rounded-lg border border-border p-2 text-ink-muted disabled:cursor-not-allowed"
          title="Notifications land in a later phase"
        >
          <Bell size={16} />
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-status-red" />
        </button>

        <button
          type="button"
          disabled
          className="rounded-lg border border-border p-2 text-ink-muted disabled:cursor-not-allowed"
          title="Help"
        >
          <HelpCircle size={16} />
        </button>

        <div className="flex items-center gap-2 pl-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-[12px] font-semibold text-navy">
            {CURRENT_USER.initials}
          </div>
          <div className="hidden leading-tight sm:block">
            <div className="text-[13px] font-medium text-ink">{CURRENT_USER.name}</div>
            <div className="text-[11px] text-ink-muted">{CURRENT_USER.role}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
