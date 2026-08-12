// ============================================================================
// EXPRESS APPLICATION
// Wires middleware, static assets and the API router. Side-effect imports of
// the db and azure config modules preserve the original startup behavior
// (PostgreSQL connection test and Azure container initialization at boot).
// ============================================================================
import express from 'express';
import cors from 'cors';

import { PUBLIC_DIR } from './config/paths.js';
import './config/db.js';    // initialize PostgreSQL pool + connection test
import './config/azure.js'; // initialize Azure Blob container clients
import apiRoutes from './routes/index.js';

const app = express();

// Increase body size limits for chunked uploads
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));

app.use(cors());

// Serve ONLY backend/public.
//
// This used to be express.static(ROOT_DIR) — the backend PROJECT ROOT — which
// published the whole source tree over HTTP. Verified reachable: /api/server.js,
// /api/package.json, /api/Dockerfile, /api/src/config/env.js,
// /api/src/services/voiceProxy.js, /api/scripts/check-realtime.mjs. `.env` itself
// happened to 404 only because serve-static ignores dotfiles by DEFAULT — a
// single `dotfiles:'allow'` or a renamed env file would have leaked the Azure
// key, the Postgres password and the storage connection string.
//
// Nothing depended on it: the admin/dashboard/analytics pages are sent
// explicitly via res.sendFile from VIEWS_DIR, and the images they reference are
// root-relative (/Systech_Logo1.png), so they never resolved through this mount
// anyway.
app.use('/api', express.static(PUBLIC_DIR));

// API + admin/dashboard/analytics pages
app.use('/api', apiRoutes);

export default app;
