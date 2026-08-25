import { useState } from 'react';
import { LANDING_PAGE_OPTIONS, getDefaultLandingPage, setDefaultLandingPage } from '@/lib/preferences';

// No sign-in system exists in this app yet (see TopBar.tsx's CURRENT_USER
// comment - deliberately generic, not a fabricated named account), so this
// page doesn't pretend to manage a personal account. What it does offer is
// real: a per-browser preference (where VetAI opens to), persisted the same
// way Job Library's custom jobs already are (localStorage) - this actually
// changes app behavior, it isn't a static mockup.
export function ProfileView() {
  const [landingPage, setLandingPage] = useState(getDefaultLandingPage);
  const [saved, setSaved] = useState(false);

  function handleChange(path: string) {
    setLandingPage(path);
    setDefaultLandingPage(path);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div className="rounded-card bg-card p-5 shadow-card">
        <div className="mb-1 text-[14px] font-semibold text-ink">Access</div>
        <p className="mb-4 text-[12px] text-ink-muted">
          Sign-in isn't set up in this environment yet - everyone currently shares this workspace, so there's
          no personal account to manage here.
        </p>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-[13px] font-semibold text-navy">
            U
          </div>
          <div>
            <div className="text-[13px] font-medium text-ink">User</div>
            <div className="text-[11px] text-ink-faint">Shared workspace access</div>
          </div>
        </div>
      </div>

      <div className="rounded-card bg-card p-5 shadow-card">
        <div className="mb-1 text-[14px] font-semibold text-ink">Preferences</div>
        <p className="mb-4 text-[12px] text-ink-muted">Saved to this browser</p>
        <label className="mb-1 block text-[12px] font-medium text-ink-muted">When VetAI opens, go to</label>
        <select
          value={landingPage}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full rounded-lg border border-border px-3 py-1.5 text-[13px]"
        >
          {LANDING_PAGE_OPTIONS.map((opt) => (
            <option key={opt.path} value={opt.path}>
              {opt.label}
            </option>
          ))}
        </select>
        {saved && <p className="mt-2 text-[12px] text-status-green-text">Saved.</p>}
      </div>
    </div>
  );
}
