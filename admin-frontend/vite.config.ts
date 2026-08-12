import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served at /admin/ by the reverse proxy, which strips the prefix before
// forwarding (proxy_pass http://admin-frontend/;), so this app is built as
// if it lived at the root. React Router's `basename="/admin"` (see
// src/main.tsx) is what keeps the browser's address bar correct.
export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    port: 5174,
    host: '0.0.0.0',
    proxy: {
      // Only relevant once the Phase 5 candidates proxy routes exist; harmless
      // until then. Does not touch the candidate-facing frontend's dev proxy.
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
