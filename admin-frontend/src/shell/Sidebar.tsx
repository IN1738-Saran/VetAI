import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import { NAV_ITEMS } from './navConfig';

export function Sidebar() {
  const mainItems = NAV_ITEMS.filter((i) => i.section === 'main');
  const settingsItems = NAV_ITEMS.filter((i) => i.section === 'settings');

  return (
    <aside className="flex h-screen w-[248px] shrink-0 flex-col bg-navy px-3 py-5">
      <div className="mb-8 flex items-center gap-2.5 px-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-sm font-bold text-navy">
          AI
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold text-white">VetAI</div>
          <div className="text-[10px] font-medium tracking-wide text-sidebar-muted">
            SYSTECH HIRING
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto">
        <NavSection title="Main" items={mainItems} />
        <NavSection title="Settings" items={settingsItems} />
      </nav>

      <div className="mt-4 rounded-card bg-navy-light p-3.5">
        <div className="text-[13px] font-semibold text-white">Phase 2 - scaffold</div>
        <div className="mt-1 text-[11px] leading-snug text-sidebar-muted">
          Shell and shared components are live. Real data lands starting Phase 3.
        </div>
      </div>
    </aside>
  );
}

function NavSection({ title, items }: { title: string; items: typeof NAV_ITEMS }) {
  return (
    <div className="mb-5">
      <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted">
        {title}
      </div>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.path}>
            {item.disabled ? (
              <div
                className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-sidebar-muted opacity-60"
                title="Coming soon - no reference design provided for this screen"
              >
                <span className="flex items-center gap-2.5">
                  <item.icon size={16} strokeWidth={2} />
                  {item.label}
                </span>
                <span className="rounded-full bg-navy-lighter px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide">
                  Soon
                </span>
              </div>
            ) : (
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-accent text-navy'
                      : 'text-sidebar-text hover:bg-navy-light hover:text-white'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="flex items-center gap-2.5">
                      <item.icon size={16} strokeWidth={2} />
                      {item.label}
                    </span>
                    {item.badge !== undefined && (
                      <span
                        className={clsx(
                          'rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                          isActive ? 'bg-navy/15 text-navy' : 'bg-navy-lighter text-sidebar-text'
                        )}
                      >
                        {item.badge}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
