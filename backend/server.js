// ============================================================================
// SERVER ENTRY POINT
// Loads environment variables, builds the Express app and starts listening.
// The application logic lives under ./src (config, services, controllers,
// routes). Kept at the project root so `npm start` / Docker `node server.js`
// continue to work unchanged.
// ============================================================================
import 'dotenv/config';
import app from './src/app.js';
import { PORT, HOST, PUBLIC_DOMAIN, PUBLIC_PROTOCOL } from './src/config/env.js';
import { attachVoiceProxy } from './src/services/voiceProxy.js';

const host = HOST;

const server = app.listen(PORT, host, () => {
    console.log(`\n🚀 Server running on http://${host}:${PORT}`);
    console.log(`📋 Admin page: http://${host}:${PORT}/api`);
    console.log(`🌐 Public domain: ${PUBLIC_PROTOCOL}://${PUBLIC_DOMAIN}`);
    console.log(`⏰ Interview links expire after 1 day at 11:59:59 PM`);
    console.log(`🎥 Unified Video Recording: ENABLED (Chunked Upload)`);
    console.log(`📄 Job Description: PDF Upload`);
    console.log(`📂 Resume Upload: Multiple Files Supported`);
    console.log(`🎤 Ready!\n`);
});

// Attach the secure voice WebSocket relay (browser ⇄ backend ⇄ Azure).
// The Azure API key stays server-side and is never sent to the browser.
attachVoiceProxy(server);
