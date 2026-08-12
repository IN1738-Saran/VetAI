// ============================================================================
// PATH CONFIGURATION
// Resolves filesystem locations relative to the backend project root so that
// static assets and view files continue to resolve exactly as before, even
// though the source now lives under src/.
// ============================================================================
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename); // .../backend/src/config

// Backend project root (where server.js, images and public/ live).
// NOTE: never pass this to express.static — it would publish the entire source
// tree, including config and scripts. Use PUBLIC_DIR for web-served assets.
export const ROOT_DIR = path.resolve(__dirname, '..', '..');

// The only directory safe to expose over HTTP.
export const PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'public');

// Directory holding the served admin/dashboard/analytics HTML pages.
export const VIEWS_DIR = path.resolve(__dirname, '..', 'views');
