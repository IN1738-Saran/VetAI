// ============================================================================
// gpt-realtime connection / audio diagnostic (Azure Voice Live, flat schema)
//
// Verifies the exact path the app uses:
//   1. the model/deployment is reachable (WebSocket opens),
//   2. the flat-schema session.update is accepted (azure_semantic_vad, then a
//      server_vad fallback if that specific VAD is rejected), and
//   3. the model actually PRODUCES audio — reporting the exact event name so we
//      know the app's audio handler matches.
//
// Run from the backend/ folder (reads backend/.env):   node scripts/check-realtime.mjs
// Uses your real credentials locally; masks the api-key in output.
// ============================================================================
import 'dotenv/config';

const ENDPOINT    = process.env.AZURE_VOICELIVE_ENDPOINT;
const API_KEY     = process.env.AZURE_VOICELIVE_API_KEY;
// Must match the default in src/config/env.js, or the diagnostic tests a
// different model than the app actually runs — and would report a pass for a
// configuration the interview never uses.
const MODEL       = process.env.AZURE_VOICELIVE_MODEL || 'gpt-realtime-2.1-mini';
const API_VERSION = process.env.AZURE_VOICELIVE_API_VERSION || '2026-01-01-preview';

const line = (s = '') => console.log(s);
const fail = (m) => { line(`\n❌ ${m}`); process.exit(1); };

line('──────────────────────────────────────────────');
line(' gpt-realtime diagnostic (flat schema + audio)');
line('──────────────────────────────────────────────');
if (!ENDPOINT) fail('AZURE_VOICELIVE_ENDPOINT is not set in .env');
if (!API_KEY)  fail('AZURE_VOICELIVE_API_KEY is not set in .env');

let host = ENDPOINT;
if (host.startsWith('https://')) host = host.slice(8);
else if (host.startsWith('http://')) host = host.slice(7);
else if (host.startsWith('wss://')) host = host.slice(6);
else if (host.startsWith('ws://')) host = host.slice(5);
if (host.endsWith('/')) host = host.slice(0, -1);
if (!host.includes('.')) host = `${host}.services.ai.azure.com`;

const isFoundry = host.includes('services.ai.azure.com');
const wsUrl = isFoundry
  ? `wss://${host}/voice-live/realtime?api-version=${API_VERSION}&model=${MODEL}&api-key=${API_KEY}`
  : `wss://${host}/openai/realtime?api-version=${API_VERSION}&deployment=${MODEL}&api-key=${API_KEY}`;

const semanticVad = isFoundry
  ? { type: 'azure_semantic_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 1200,
      remove_filler_words: true,
      create_response: true, interrupt_response: true }
  : { type: 'semantic_vad', eagerness: 'low', create_response: true, interrupt_response: true };
const serverVad = { type: 'server_vad', threshold: 0.5, silence_duration_ms: 2000 };

// GA models (gpt-realtime-2.1-mini @ api-version 2026-04-10) use the NESTED
// schema: session.type='realtime', output_modalities, audio.input/output.
// Older PREVIEW models use the FLAT schema (top-level modalities/voice/
// turn_detection). Try GA first, fall back to flat — same order as the app.
const gaSessionWith = (td) => ({ type: 'session.update', session: {
  type: 'realtime',
  output_modalities: ['audio'],
  instructions: 'You are a test assistant.',
  audio: {
    input: { format: { type: 'audio/pcm', rate: 24000 }, turn_detection: td },
    output: { format: { type: 'audio/pcm', rate: 24000 }, voice: 'echo' },
  },
} });
const sessionWith = (td) => ({ type: 'session.update', session: {
  modalities: ['text', 'audio'], instructions: 'You are a test assistant.', turn_detection: td } });
// NOTE: modalities MUST include 'text'. The Realtime API accepts only ['text']
// or ['text','audio'] — audio-only ['audio'] is rejected, which silently kills
// every response.create (the "AI never speaks" bug).
const greeting = { type: 'response.create', response: { modalities: ['text', 'audio'], instructions: 'Say the single word: hello.' } };

line(` Endpoint  : ${isFoundry ? 'Azure AI Foundry (Voice Live) — flat schema' : 'Azure OpenAI / other'}`);
line(` Model     : ${MODEL}`);
line(` API ver.  : ${API_VERSION}`);
line(` URL       : ${wsUrl.replace(/api-key=[^&]+/, 'api-key=***')}`);
line('──────────────────────────────────────────────\n Connecting...\n');

const ws = new WebSocket(wsUrl);
let vadAccepted = null;      // 'azure_semantic_vad' | 'server_vad'
let triedFlat = false;       // GA schema rejected → retried with legacy flat schema
let triedServerVad = false;
let greeted = false;
let audioEvent = null;
let sawText = false;
let lastError = null;
const seen = new Set();

const finish = () => {
  line('\n──────────────────────────────────────────────');
  line(' RESULT');
  line(`   Connection ............ opened ✅`);
  line(`   Turn detection accepted ${vadAccepted ? vadAccepted + ' ✅' : 'NONE ❌  (' + (lastError || '') + ')'}`);
  line(`   Model produced audio .. ${audioEvent ? 'YES ✅  (event: ' + audioEvent + ')' : (sawText ? 'text only ⚠️' : 'NO ❌')}`);
  line(`   All events observed ... ${[...seen].join(', ') || '(none)'}`);
  line('──────────────────────────────────────────────');
  if (audioEvent) { line(` PASS ✅  The AI speaks. App handles "${audioEvent}". Deploy the frontend and test.`); process.exit(0); }
  if (vadAccepted) { line(' PARTIAL ⚠️  Session OK but no audio. Paste this whole output.'); process.exit(2); }
  line(' FAIL ❌  session.update rejected. Paste the error above.'); process.exit(1);
};
const timeout = setTimeout(finish, 12000);

ws.addEventListener('open', () => {
  line('✅ WebSocket OPEN — deployment reachable.\n📤 Sending GA session.update (nested audio.*, azure_semantic_vad)...');
  ws.send(JSON.stringify(gaSessionWith(semanticVad)));
});

ws.addEventListener('message', (ev) => {
  let m; try { m = JSON.parse(ev.data); } catch { return; }
  if (!seen.has(m.type)) { seen.add(m.type); line(`   « ${m.type}`); }

  // Catch ANY audio-delta event regardless of exact name.
  if (!audioEvent && /audio.*\.delta$/i.test(m.type) && (m.delta || m.audio)) {
    audioEvent = m.type; line(`🔊 audio received via "${m.type}"`); clearTimeout(timeout); setTimeout(finish, 400); return;
  }
  if (/text.*\.delta$/i.test(m.type)) sawText = true;

  // session.created = initial connection handshake (NOT confirmation of our update).
  if (m.type === 'session.updated') {
    if (!vadAccepted) vadAccepted = triedServerVad ? 'server_vad' : (isFoundry ? 'azure_semantic_vad' : 'semantic_vad');
    line(`✅ session.update accepted (${vadAccepted}, schema: ${triedFlat ? 'LEGACY FLAT' : 'GA nested'}).`);
    if (!greeted) { greeted = true; line('📤 Requesting a one-word greeting...'); ws.send(JSON.stringify(greeting)); }
    return;
  }
  if (m.type === 'error') {
    lastError = (m.error && (m.error.message || JSON.stringify(m.error))) || 'unknown error';
    line(`⚠️  error: ${lastError}`);
    // Step 1: GA schema rejected → this is an older preview model, try FLAT.
    if (!triedFlat && !vadAccepted) {
      triedFlat = true;
      line('📤 GA schema rejected — retrying with LEGACY FLAT schema...');
      ws.send(JSON.stringify(sessionWith(semanticVad)));
      return;
    }
    // Step 2: flat also rejected → maybe it is the VAD field, try plain server_vad.
    if (!triedServerVad && !vadAccepted) {
      triedServerVad = true;
      line('📤 Retrying with plain server_vad (in case azure_semantic_vad is the rejected field)...');
      ws.send(JSON.stringify(sessionWith(serverVad)));
    }
    return;
  }
});

ws.addEventListener('close', (e) => { if (!audioEvent) { clearTimeout(timeout); line(`\n🔴 closed (code ${e.code}) ${e.reason || ''}`); finish(); } });
ws.addEventListener('error', () => { clearTimeout(timeout); fail(`WebSocket failed — check '${MODEL}' is deployed and endpoint/key/api-version are correct.`); });
