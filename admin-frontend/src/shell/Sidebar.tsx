import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import { NAV_ITEMS } from './navConfig';

// Collapses to an icon-only rail below the lg breakpoint (1024px), per plan
// section 10 ("Sidebar collapses to an icon-rail or off-canvas drawer below
// ~1024px"). Icons stay visible and reachable; labels are hidden, not the
// links themselves, so keyboard/screen-reader navigation is unaffected.
export function Sidebar() {
  const mainItems = NAV_ITEMS.filter((i) => i.section === 'main');
  const settingsItems = NAV_ITEMS.filter((i) => i.section === 'settings');

  return (
    <aside className="flex h-screen w-16 shrink-0 flex-col bg-navy px-2 py-5 lg:w-[248px] lg:px-3">
      <div className="mb-8 flex items-center gap-2.5 px-1 lg:px-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white">
          <img src="/Systech_Logo1.png" alt="Systech" className="h-full w-full object-cover" />
        </div>
        <div className="hidden leading-tight lg:block">
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
    </aside>
  );
}

function NavSection({ title, items }: { title: string; items: typeof NAV_ITEMS }) {
  return (
    <div className="mb-5">
      <div className="mb-1.5 hidden px-3 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted lg:block">
        {title}
      </div>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.path}>
            {item.disabled ? (
              <div
                className="flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm text-sidebar-muted opacity-60 lg:justify-between"
                title={`${item.label} - coming soon (no reference design provided for this screen)`}
              >
                <span className="flex items-center gap-2.5">
                  <item.icon size={16} strokeWidth={2} />
                  <span className="hidden lg:inline">{item.label}</span>
                </span>
                <span className="hidden rounded-full bg-navy-lighter px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide lg:inline">
                  Soon
                </span>
              </div>
            ) : (
              <NavLink
                to={item.path}
                title={item.label}
                aria-label={item.label}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors lg:justify-between',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
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
                      <span className="hidden lg:inline">{item.label}</span>
                    </span>
                    {item.badge !== undefined && (
                      <span
                        className={clsx(
                          'hidden rounded-full px-1.5 py-0.5 text-[11px] font-semibold lg:inline',
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
