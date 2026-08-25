import { lazy, Suspense } from 'react';
import { Navigate, Route, createRoutesFromElements } from 'react-router-dom';
import { Shell } from '@/shell/Shell';
import { DashboardView } from '@/views/DashboardView';
import { InterviewsView } from '@/views/InterviewsView';
import { CandidatesView } from '@/views/CandidatesView';
import { CandidateProfileView } from '@/views/CandidateProfileView';
import { JobLibraryView } from '@/views/JobLibraryView';
import { AIAssistantView } from '@/views/AIAssistantView';
import { EmailCenterView } from '@/views/EmailCenterView';
import { ReportsView } from '@/views/ReportsView';
import { OrganizationView } from '@/views/OrganizationView';
import { ProfileView } from '@/views/ProfileView';
import { getDefaultLandingPage } from '@/lib/preferences';

// Reads the real, persisted per-browser preference (see Profile settings)
// at actual navigation time, not module-eval time - a plain <Navigate
// to="/dashboard" /> would only ever read the hardcoded default.
function IndexRedirect() {
  return <Navigate to={getDefaultLandingPage()} replace />;
}

// Recharts (via Donut/LineChartCard/HorizontalBarChart) is only pulled into
// its own chunk when Analytics is actually visited, per plan section 13
// ("chart libraries should be lazy-loaded on the Analytics view").
const AnalyticsView = lazy(() =>
  import('@/views/AnalyticsView').then((m) => ({ default: m.AnalyticsView }))
);

// Built with createRoutesFromElements (not the plain <Routes>/<Route> JSX
// API) because Shell.tsx reads the active route's title/subtitle via
// useMatches(), which only works inside a data router - see main.tsx's
// createBrowserRouter/RouterProvider.
export const routes = createRoutesFromElements(
  <Route element={<Shell />}>
    <Route index element={<IndexRedirect />} />

    <Route
      path="/dashboard"
      element={<DashboardView />}
      handle={{ title: 'Dashboard', subtitle: 'Overview of hiring activity' }}
    />
    <Route
      path="/interviews"
      element={<InterviewsView />}
      handle={{ title: 'New interview', subtitle: 'A job description and a resume are both required' }}
    />
    <Route
      path="/candidates"
      element={<CandidatesView />}
      handle={{ title: 'Candidates', subtitle: 'All candidates across every role' }}
    />
    <Route
      path="/candidates/:sessionId"
      element={<CandidateProfileView />}
      handle={{ title: 'Candidate profile' }}
    />
    <Route
      path="/job-library"
      element={<JobLibraryView />}
      handle={{ title: 'Job Library', subtitle: 'Reusable job postings' }}
    />
    <Route
      path="/analytics"
      element={
        <Suspense fallback={<div className="p-8 text-[13px] text-ink-muted">Loading analytics...</div>}>
          <AnalyticsView />
        </Suspense>
      }
      handle={{ title: 'Analytics', subtitle: 'Hiring performance' }}
    />

    <Route
      path="/ai-assistant"
      element={<AIAssistantView />}
      handle={{ title: 'AI Assistant', subtitle: 'Ask questions about candidates, jobs and interviews' }}
    />
    <Route
      path="/email-center"
      element={<EmailCenterView />}
      handle={{ title: 'Email Center', subtitle: 'Notification lists for interview invitations' }}
    />
    <Route
      path="/reports"
      element={<ReportsView />}
      handle={{ title: 'Reports', subtitle: 'Export and review hiring data' }}
    />
    <Route
      path="/organization"
      element={<OrganizationView />}
      handle={{ title: 'Organization', subtitle: 'Workspace and connected services' }}
    />
    <Route
      path="/profile"
      element={<ProfileView />}
      handle={{ title: 'Profile', subtitle: 'Access and preferences' }}
    />

    <Route path="*" element={<Navigate to="/dashboard" replace />} />
  </Route>
);
