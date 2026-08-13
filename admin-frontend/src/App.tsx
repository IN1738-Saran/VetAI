import { lazy, Suspense } from 'react';
import { Navigate, Route, createRoutesFromElements } from 'react-router-dom';
import { Sparkles, Mail, FileText, Building2, UserCircle } from 'lucide-react';
import { Shell } from '@/shell/Shell';
import { DashboardView } from '@/views/DashboardView';
import { InterviewsView } from '@/views/InterviewsView';
import { CandidatesView } from '@/views/CandidatesView';
import { CandidateProfileView } from '@/views/CandidateProfileView';
import { JobLibraryView } from '@/views/JobLibraryView';
import { ComingSoonView } from '@/views/ComingSoonView';

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
    <Route index element={<Navigate to="/dashboard" replace />} />

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
      element={<ComingSoonView icon={Sparkles} label="AI Assistant" />}
      handle={{ title: 'AI Assistant' }}
    />
    <Route
      path="/email-center"
      element={<ComingSoonView icon={Mail} label="Email Center" />}
      handle={{ title: 'Email Center' }}
    />
    <Route
      path="/reports"
      element={<ComingSoonView icon={FileText} label="Reports" />}
      handle={{ title: 'Reports' }}
    />
    <Route
      path="/organization"
      element={<ComingSoonView icon={Building2} label="Organization" />}
      handle={{ title: 'Organization' }}
    />
    <Route
      path="/profile"
      element={<ComingSoonView icon={UserCircle} label="Profile" />}
      handle={{ title: 'Profile' }}
    />

    <Route path="*" element={<Navigate to="/dashboard" replace />} />
  </Route>
);
