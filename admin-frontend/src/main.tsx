import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { routes } from './App';
import './styles/index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The candidates feed is the shared fetch-once-per-session-tree source
      // (plan section 7/13) - a long staleTime avoids re-fetching per screen.
      staleTime: 60_000,
      retry: 1,
    },
  },
});

const router = createBrowserRouter(routes, { basename: '/admin' });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
