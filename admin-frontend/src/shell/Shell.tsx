import { Outlet, useMatches } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

interface RouteHandle {
  title: string;
  subtitle?: string;
}

export function Shell() {
  const matches = useMatches();
  const last = matches[matches.length - 1];
  const handle = (last?.handle ?? { title: 'VetAI' }) as RouteHandle;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar title={handle.title} subtitle={handle.subtitle} />
        <main className="flex-1 overflow-y-auto p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
