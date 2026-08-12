/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FINAL COMPLETE VERSION WITH UNIFIED VIDEO RECORDING + SILENCE DETECTION
 * - Features: Azure Voice Live Audio, Proctoring, Session Resumption, Resume/JD Context
 * - Recording: Native Stream Mixing (Camera + Mic + AI) + Chunked Uploading
 * - Performance: Optimized for Main Thread (No Canvas, No Memory Bloat)
 * - Auto-Greeting: Automatic greeting on session start
 * - Time Warning: 25-minute warning notification
 * - Retry Window: 20-minute retry window after completion
 * - Silence Detection: FIXED - No longer merges with AI questions
 */

import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { encode, decode, decodeAudioData } from '../utils/audio';
import { interviewStyles } from '../styles/interview.styles';
import {
  determineExperienceLevel,
  isRepeatRequest,
  isHesitationOrIDontKnow,
  isFillerSpeech,
} from '../utils/speech';
import { formatDuration } from '../utils/format';
import {
  getVoiceToken,
  fetchSession,
  postTranscript,
  uploadChunk,
  markInterviewStarted,
  completeInterview,
  postViolation,
  sendEmergencySaveBeacon,
  triggerPowerAutomate,
  submitReattemptRequest,
} from '../services/api';
import './visual-3d';

// Single source of truth for candidate speech-to-text. One model is used
// everywhere transcription is configured (primary + fallback session config)
// so the interview never mixes transcribers.
const TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';

@customElement('interview-component')
export class InterviewComponent extends LitElement {
  // -----------------------------------------------------------------------
  // UI & STATE
  // -----------------------------------------------------------------------
  @state() status = '';
  @state() error = '';
  @state() diagLog: string[] = []; // Diagnostic log (no API keys) — see showDiagnostics
  // Diagnostics overlay is HIDDEN for candidates (requested 2026-08-03) — it was
  // forced on only while the voice pipeline was being debugged.
  //
  // The log itself still runs: this.diag() keeps recording, and everything still
  // goes to the browser console. Only the on-screen panel is gated. Append
  // ?debug=1 to the interview URL to bring it back without a rebuild — worth
  // keeping, because the Azure error line it surfaces is what made the voice
  // failures diagnosable at all.
  private showDiagnostics = new URLSearchParams(window.location.search).has('debug');
  @state() sessionId = '';
  @state() sessionData: any = null;
  @state() transcript: Array<{ role: 'AI Interviewer' | 'Candidate'; text: string; timestamp: string }> = [];
  @state() showWelcome = true;
  @state() inSession = false;
  @state() showFullscreenPrompt = false;


  // Proctoring State
  @state() violations: Array<{ type: string; timestamp: string; description: string }> = [];
  @state() warningMessage = '';
  @state() isFullscreen = false;
  private violationCount = 0;
  private maxViolations = 4;
  private blurViolationTimer: ReturnType<typeof setTimeout> | null = null;
  private proctoringActive = false;
  private proctoringCleanupFunctions: Array<() => void> = [];

  // Session Management (Reconnection & Health)
  // True between a reconnect's ws.onopen and its session.updated, so the handler
  // replays conversation context instead of firing the opening greeting.
  private pendingResumeReplay = false;
  private isReconnecting = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private sessionStartedSuccessfully = false;
  private sessionHealthMonitorInterval: number | undefined = undefined;
  private progressMonitorInterval: number | undefined = undefined;
  private progressChecksFired = 0; // tracks which checkpoints have fired
  private lastProgressMinutesFired = 0; // tracks the last minute progress update sent

  // Timer
  @state() interviewDuration = 0;
  private interviewTimerInterval: number | undefined = undefined;
  private interviewStartTime = 0;
  private warningGiven = false; // Flag to prevent multiple warnings
  private maxDurationReached = false; // Flag for the hard 60-minute stop




  // Azure Voice Live API configuration
  private ws: WebSocket | null = null;
  private voiceConfig: { wsPath: string; ticket: string; model: string; apiVersion: string; isVoiceLiveFoundry: boolean } | null = null;
  private wsOpen = false;
  private stopCalled = false;
  // Mic gate — prevents echo feeding back into VAD while AI is speaking
  private isModelSpeaking = false;
  private micGateTimer: ReturnType<typeof setTimeout> | null = null;
  // Absolute cutoff for the playback-drain wait; 0 = no wait in progress.
  private micUngateDeadline = 0;
  // Greeting flag — true once first AI audio chunk arrives
  private greetingReceived = false;

  // Dynamic turn control & state machine
  private currentResponseId: string | null = null;
  private currentResponseStartedAt = 0; // When currentResponseId was set — detects stale in-flight state
  private currentResponseMsgId: string | null = null;
  private cancelledResponseId: string | null = null;
  private currentAITranscriptBuffer = ''; // Real-time buffer for coaching phrase detection
  private lastBannedPhraseLogged = '';    // de-dupes the per-delta warning
  private earlyClosingToCorrect = false;  // AI tried to close before the 30-min minimum
  private silenceTriggerTimer: ReturnType<typeof setTimeout> | null = null;
  // DEAD — retained only so old diagnostics/telemetry references still compile.
  // These three drove the client-side turn machine that existed when
  // create_response was false. Azure now creates every response itself, so there
  // is no fallback timer to arm and no per-utterance dedup to enforce. Do not
  // reintroduce them without reading the turn-taking note above initSession().
  private fallbackTurnTimer: ReturnType<typeof setTimeout> | null = null;
  private turnAlreadyAdvancedForUtterance = false;
  private sawSpeechStartedThisUtterance = false;
  private isUserSpeaking = false;
  private playAudioImmediately = false;
  private bufferedAudioDeltas: Array<string> = [];
  
  // Explicit Turn State Machine & Interruption Guard Variables
  private hasCandidateAnsweredSinceLastAIQuestion = true; // True initially so greeting can fire
  private greetingSent = false; // Flag to prevent multiple greeting response.create calls
  private greetingRetryCount = 0; // Bounded retries if the greeting was sent but produced no audio
  // Which session schema Azure accepted. GA models (gpt-realtime-2.1-mini) use the
  // nested `session.audio.*` shape; older preview models use the flat shape.
  private activeSessionSchema: 'ga' | 'legacy' = 'ga';
  private sessionConfirmed = false;  // True once Azure accepts a session.update — after this, errors are NOT fatal
  private enhancementSent = false;   // Stage-2 optional config sent exactly once
  private greetingFailsafeTimer: ReturnType<typeof setTimeout> | null = null;
  // Session-config degradation ladder: richest → simplest, last rung known-good.
  private sessionAttempts: Array<{ label: string; msg: any }> = [];
  private sessionAttemptIndex = 0;
  // The EXACT session.update Azure accepted. Phase steering re-sends this same
  // message with fresh `instructions`, so a mid-interview update can never drop
  // a field (turn_detection, transcription, voice) that the session depends on.
  private acceptedSessionMsg: any = null;
  // Static part of the system prompt (role, rules, résumé, JD). The dynamic
  // per-phase state is appended by refreshPhaseInstructions().
  private baseInstructions = '';
  // Which rung to start from when initSession is re-entered after Azure closed the
  // socket without sending an error frame.
  private pendingSessionAttemptIndex = 0;
  private askedQuestionsList: Array<string> = [];
  // Distinct topics already opened, so a finished subject is never reopened.
  private coveredTopics = new Set<string>();
  private repeatedQuestionCount = 0;   // surfaced in diagnostics
  private candidateExperienceLevel: 'FRESHER' | 'EXPERIENCED' = 'EXPERIENCED';

  /**
   * Language the interview is CONDUCTED in. English today, but driven by session
   * data so a future deployment can change it per interview without a code
   * change. Note this is only the OUTPUT language: candidate speech is already
   * transcribed multilingually, because no `language` is pinned on the
   * transcription config — the model auto-detects. So a candidate can answer in
   * another language right now and be understood; this setting controls what the
   * interviewer speaks back.
   */
  /** Set when the candidate asks to be interviewed in another language. */
  private requestedLanguage = '';

  private get defaultLanguage(): string {
    return (this.sessionData?.interviewLanguage || '').trim() || 'English';
  }

  /** Language currently being spoken — the default until the candidate asks to change. */
  private get interviewLanguage(): string {
    return this.requestedLanguage || this.defaultLanguage;
  }

  /**
   * Detect an explicit request to change language.
   *
   * Prompt wording alone is NOT enough here. The phase instructions are
   * re-sent after every single turn, so an instruction that names the default
   * language would drag the interview straight back to it on the next turn —
   * the switch would last exactly one question. The chosen language has to be
   * held in client state so every subsequent refresh carries it.
   */
  private detectLanguageRequest(text: string): string | null {
    const index = InterviewComponent.languageIndex();
    const t = ` ${text.toLowerCase()} `;

    // An intent verb must appear WITHIN a short window before the language name.
    // Merely MENTIONING one ("I built an NLP model for Tamil text", "I am fluent
    // in English and Tamil") must never switch the interview.
    //
    // Intent verbs are listed for several languages, not just English, because a
    // candidate who wants to switch will often ask in the language they want.
    const INTENT = '(speak|speaking|talk|switch|change|continue|conduct|ask|reply|respond|answer|say|use|prefer|hablar|habla|parler|parle|sprechen|sprich|falar|parlare|話し|말해|बोल|बात|पेस|பேச|పలక|ಮಾತ|സംസാ|কথা|تحدث|تكلم|говор|konuş|berbicara|nói|พูด)';

    let best: { label: string; at: number } | null = null;
    for (const [needle, label] of index) {
      const at = t.indexOf(needle);
      if (at === -1) continue;
      // Require the intent verb close in front of the language name.
      const window = t.slice(Math.max(0, at - 60), at);
      if (!new RegExp(INTENT, 'i').test(window)) continue;
      // Prefer the LONGEST matching name so "chinese" beats a substring, and a
      // native script name beats a partial.
      if (!best || needle.length > best.label.length) best = { label, at };
    }
    return best ? best.label : null;
  }

  /**
   * Every language the platform knows, indexed by both its English name and its
   * own native name (autonym) — "tamil" and "தமிழ்", "spanish" and "español".
   *
   * Built from Intl.DisplayNames over the ISO 639-1 set rather than a hardcoded
   * list: a fixed list of twenty is not multilingual support, and it silently
   * fails for anything omitted. Built once and cached — this runs on every
   * candidate utterance.
   */
  private static _langIndex: Array<[string, string]> | null = null;
  /** English language name → ISO 639-1 code, for the STT `language` hint. */
  private static _langCodes = new Map<string, string>();

  /**
   * ISO code to pin speech-to-text to.
   *
   * English by default and deliberately PINNED rather than auto-detected.
   * Auto-detect regularly misidentifies accented English as a nearby language
   * and returns transliterated nonsense, which corrupts both the saved interview
   * record and the follow-up questions built from it. Pinning the language is
   * the single biggest accuracy win available here.
   *
   * It follows a language switch, because pinning 'en' while the candidate
   * answers in Tamil would be worse than not pinning at all.
   */
  private transcriptionLanguage(): string {
    if (!this.requestedLanguage) return 'en';
    InterviewComponent.languageIndex();   // ensure the code map is populated
    return InterviewComponent._langCodes.get(this.requestedLanguage) || 'en';
  }
  private static languageIndex(): Array<[string, string]> {
    if (InterviewComponent._langIndex) return InterviewComponent._langIndex;

    // ISO 639-1 two-letter codes.
    const codes = ('aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi wa wo xh yi yo za zh zu').split(' ');

    const seen = new Map<string, string>();
    const add = (name: string | undefined, label: string) => {
      if (!name) return;
      const key = name.toLowerCase().trim();
      // Two letters or fewer would match far too much ordinary text.
      if (key.length < 3) return;
      if (!seen.has(key)) seen.set(key, label);
    };

    let english: Intl.DisplayNames | null = null;
    try { english = new Intl.DisplayNames(['en'], { type: 'language' }); } catch { /* unsupported */ }

    for (const code of codes) {
      let en: string | undefined;
      try { en = english?.of(code); } catch { /* skip */ }
      if (!en || en === code) continue;           // no name available
      if (!InterviewComponent._langCodes.has(en)) InterviewComponent._langCodes.set(en, code);
      add(en, en);
      // The autonym, so a request written in the target language also matches.
      try {
        const native = new Intl.DisplayNames([code], { type: 'language' }).of(code);
        if (native && native !== code) add(native, en);
      } catch { /* locale not available — English name still works */ }
    }

    // A few common names Intl does not surface as distinct entries.
    add('mandarin', 'Chinese');
    add('bengali', 'Bangla');
    add('farsi', 'Persian');
    add('castellano', 'Spanish');

    // Longest names first so "chinese" is not shadowed by a shorter match.
    InterviewComponent._langIndex = [...seen.entries()].sort((a, b) => b[0].length - a[0].length);
    return InterviewComponent._langIndex;
  }
  private watchdogInterval: number | undefined = undefined;
  
  private currentPhase: 1 | 2 | 3 | 4 = 1;
  private phase1QuestionIndex = 0;
  // How many of the 2 mandatory introduction questions the AI has actually asked.
  private phase1Asked = 0;
  // Position within the current topic: 0 = the primary question has not been
  // asked yet, 1..target = which follow-up comes next.
  private topicTurnIndex = 0;
  // Last phase block pushed to Azure — skips redundant session.update traffic.
  private lastSentStateBlock = '';
  // True once the AI has actually SPOKEN the mandatory "What do you know about
  // Systech?" question. Detected from the AI transcript, so a truncated greeting
  // can never silently skip it.
  private introQuestion1Asked = false;
  private primaryQuestionCount = 0; // Tracks primary questions (0 to 20+)
  private followupCountForCurrentTopic = 0; // Follow-ups asked so far on the current topic
  // Follow-ups per technical topic are NOT fixed — each new topic gets a target
  // in the 2–4 range (set in pickFollowupTarget) so the interview feels natural
  // and covers MORE distinct skills instead of over-drilling a single one.
  private followupTargetForCurrentTopic = 4;
  private behavioralCount = 0;
  private activeTopicName = 'Introduction';
  // When the current technical topic was opened — bounds time spent on one skill.
  private currentTopicStartedAt = 0;
  // When Phase 2 began — used to measure the real pace and budget follow-ups.
  private technicalPhaseStartedAt = 0;
  // Bounded retry for the mandatory Systech question — see advancePhasePointer.
  private introQ1RetryCount = 0;
  // AI turns actually spent in the technical phase. Drives the behavioural
  // follow-up target so the 85/15 split holds whatever the technical phase did.
  private technicalTurnCount = 0;
  private behavioralFollowupTarget = 3;
  // Set when the candidate hesitated, asked for a repeat, or skipped, so the
  // next response.done does not consume a question slot.
  private suppressNextPointerAdvance = false;
  // True when the AI's last completed turn actually posed a question.
  private lastAiTurnAskedQuestion = false;
  // Consecutive AI turns where no question was detected. Bounds the heuristic
  // above so it can never stall the interview permanently.
  private noQuestionTurnStreak = 0;
  // True for exactly one turn after a skip / "I don't know", so the phase block
  // can tell the model to accept it and move on instead of re-asking.
  private candidateWantsToSkip = false;
  private speechStartedGuardTimestamp = 0; // Prevents micro-interruptions during initial AI speech
  private lastTurnTriggerTimestamp = 0;
  // Stall detection: last time the interview genuinely progressed (AI audio,
  // candidate speech, or a turn). Drives mid-interview freeze recovery.
  private lastInterviewActivityAt = 0;
  private stallRecoveryCount = 0;

  // Bound résumé / JD text embedded in the system prompt. These were injected
  // unbounded, so a long résumé plus the full rule set could push session.update
  // large enough for Azure to drop the socket outright (close 1011, no error
  // frame). Truncation keeps the most relevant top of the document.
  // Clamps lowered from 12000/8000 to 7000/4500 on 2026-08-03.
  //
  // These instructions are re-sent on EVERY turn, and the payload had grown to
  // ~36KB once the conversation digest and the no-repeat list were added. The
  // reported symptoms — the AI repeating questions it had already asked and
  // drifting off the phase rules — are what instruction dilution looks like:
  // the rules are all present, just competing with 20KB of document text.
  // 7000 chars still covers a full two-page résumé and 4500 a normal JD.
  private clampForPrompt(text: string | undefined | null, maxChars: number): string {
    if (!text) return '';
    const clean = String(text).replace(/\r/g, '');
    if (clean.length <= maxChars) return clean;
    return clean.slice(0, maxChars) + '\n[...truncated for length...]';
  }

  /**
   * Name to address the candidate by, never empty.
   *
   * The backend derives candidateName with a heuristic (first non-empty résumé
   * line, under 50 chars, no '@'/'|') that legitimately misses — plenty of CVs
   * open with "CURRICULUM VITAE", a phone number, or a header image. Every
   * greeting and the verbatim closing statement interpolate this value, so an
   * empty one made the AI say "Hello , welcome to your interview with Systech."
   * and "Thank you, ." Falling back to a neutral address is always better than
   * a visible blank.
   */
  private get candidateDisplayName(): string {
    const raw = (this.sessionData?.candidateName || '').trim();
    return raw || 'there';
  }

  private diag(msg: string) {
    const t = new Date().toLocaleTimeString('en-IN', { hour12: false });
    const entry = `[${t}] ${msg}`;
    console.log('🔍 DIAG:', entry);
    this.diagLog = [...this.diagLog.slice(-14), entry]; // Keep last 15 lines
  }

  /** How much AI speech is still queued in the output graph, in ms. */
  private pendingPlaybackMs(): number {
    return Math.max(0, (this.nextStartTime - this.outputAudioContext.currentTime) * 1000);
  }

  /**
   * Reopen the microphone once the AI has ACTUALLY stopped being audible.
   *
   * The old version was a flat 300ms timer fired from `response.done`. But
   * response.done only means Azure finished GENERATING the turn — the model
   * generates faster than realtime, so several seconds of audio are typically
   * still scheduled in the output graph at that moment. Reopening the mic then
   * fed the AI's own voice straight back into the server VAD: it detected
   * "speech", ended the turn, and started another response. That is the
   * self-interruption / "AI answers its own question" failure.
   *
   * Now the ungate is scheduled for when the audio actually drains, and re-arms
   * itself if more audio is scheduled while it waits.
   */
  private scheduleMicUngate(tailMs = 250) {
    if (this.micGateTimer) {
      clearTimeout(this.micGateTimer);
      this.micGateTimer = null;
    }
    // Hard deadline for the re-arm loop below. pendingPlaybackMs() is derived
    // from outputAudioContext.currentTime, and a SUSPENDED AudioContext stops
    // advancing currentTime — so the "is playback still draining?" test would
    // stay true forever and the microphone would never reopen, leaving the
    // candidate inaudible for the rest of the interview. Contexts do get
    // suspended (backgrounding, autoplay policy, OS audio changes), and the mic
    // gate is now on the critical path, so this loop must be bounded.
    if (this.micUngateDeadline === 0) {
      this.micUngateDeadline = Date.now() + 30000;
    }

    this.micGateTimer = setTimeout(() => {
      this.micGateTimer = null;
      // More audio arrived while we were waiting — wait for that too, unless we
      // have been waiting unreasonably long, which means the clock is stuck.
      if (this.pendingPlaybackMs() > 50 && Date.now() < this.micUngateDeadline) {
        this.scheduleMicUngate(tailMs);
        return;
      }
      if (this.pendingPlaybackMs() > 50) {
        this.diag('⚠️ Playback clock stalled — opening the mic anyway.');
      }
      this.micUngateDeadline = 0;
      this.isModelSpeaking = false;
      if (this.workletNode) {
        this.workletNode.port.postMessage({ type: 'gate', value: false });
      }
      this.diag('🎤 Mic open — your turn');
    }, Math.min(this.pendingPlaybackMs(), 30000) + tailMs);
  }

  /**
   * Reopen the microphone RIGHT NOW, without waiting for playback. Only for
   * teardown paths and barge-in, where the queued audio has just been stopped.
   */
  private forceUngateMic() {
    if (this.micGateTimer) {
      clearTimeout(this.micGateTimer);
      this.micGateTimer = null;
    }
    this.micUngateDeadline = 0;
    this.isModelSpeaking = false;
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'gate', value: false });
    }
  }

  private cancelActiveResponse() {
    if (this.currentResponseId) {
      this.cancelledResponseId = this.currentResponseId;
    }
    // CRITICAL: clear currentResponseId here. It used to be cleared ONLY in the
    // response.done handler, so if a cancelled response never produced a
    // response.done, currentResponseId stayed set FOREVER. That deadlocked the
    // interview two ways: (1) the VAD fallback is skipped while a response is
    // "in flight", and (2) sendRealtimeText cancels before creating, so every
    // later turn fired response.cancel that raced/killed the response it had just
    // requested. Result: the AI asked one question and then never spoke again.
    this.currentResponseId = null;
    this.currentResponseMsgId = null;
    // Stop the queued audio BEFORE reopening the mic. forceUngateMic is the
    // immediate (non-playback-aware) ungate, so anything still scheduled would
    // otherwise be picked up by the microphone as if the candidate had spoken.
    this.cleanupAudioPlayback();
    this.forceUngateMic();
    if (this.ws && this.wsOpen && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'response.cancel' }));
    }
  }

  /**
   * Queue one incoming audio delta.
   *
   * WHY THIS BATCHES — the "voice goes muffled after ~15 minutes" fault.
   *
   * This used to build a complete AudioBuffer and a fresh AudioBufferSourceNode
   * for EVERY delta Azure sent. Deltas are small (tens of milliseconds), so a
   * long interview produced tens of thousands of source nodes, each with an
   * 'ended' listener that was never removed, each requiring a main-thread
   * Int16→Float32 conversion loop, and each logging to the console on
   * completion. Three compounding costs:
   *
   *   • node + closure churn the GC has to keep up with,
   *   • per-chunk sample conversion competing with a three.js render loop and a
   *     MediaRecorder on the same main thread,
   *   • console.log per chunk — which RETAINS the logged objects whenever
   *     DevTools is open, exactly what a candidate reporting this bug does.
   *
   * As pressure builds, buffers get scheduled late and playback smears — heard
   * as progressively muffled, unclear speech. It degrades with time, which is
   * why it appeared around the 15-minute mark rather than immediately.
   *
   * Batching into ~240ms buffers cuts node and listener count by roughly an
   * order of magnitude and does the conversion once per batch.
   */
  private playAudioChunk(chunkData: string) {
    const bytes = decode(chunkData);
    // decode() allocates its own Uint8Array at offset 0, so this view is aligned.
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
    this.pcmQueue.push(pcm);
    this.pcmQueuedSamples += pcm.length;

    this.isModelSpeaking = true;
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'gate', value: true });
    }

    // START OF A TURN: flush immediately, do not wait to fill a batch.
    //
    // Batching is for sustained playback; holding the FIRST fragment back adds
    // its full window to the silence the candidate perceives after answering.
    // Releasing it at once removes up to 240ms from the gap before the AI starts
    // speaking, with none of the node-churn cost (it happens once per turn).
    if (this.sources.size === 0 && this.pendingPlaybackMs() < 20) {
      if (this.pcmFlushTimer) { clearTimeout(this.pcmFlushTimer); this.pcmFlushTimer = null; }
      this.flushPcmQueue();
      return;
    }

    if (this.pcmQueuedSamples >= InterviewComponent.PCM_BATCH_SAMPLES) {
      if (this.pcmFlushTimer) { clearTimeout(this.pcmFlushTimer); this.pcmFlushTimer = null; }
      this.flushPcmQueue();
      return;
    }
    // Short idle flush so the TAIL of a turn is never left sitting in the queue
    // (the last batch is almost always under the threshold).
    if (!this.pcmFlushTimer) {
      this.pcmFlushTimer = setTimeout(() => {
        this.pcmFlushTimer = null;
        this.flushPcmQueue();
      }, 60);
    }
  }

  /** Concatenate queued PCM into ONE buffer and schedule it. */
  private flushPcmQueue() {
    if (this.pcmQueuedSamples === 0) return;
    const chunks = this.pcmQueue;
    const total = this.pcmQueuedSamples;
    this.pcmQueue = [];
    this.pcmQueuedSamples = 0;

    this.audioQueue = this.audioQueue.then(async () => {
      if (this.outputAudioContext.state === 'suspended') {
        await this.outputAudioContext.resume();
      }
      this.outputNode.connect(this.outputAudioContext.destination);

      const audioBuffer = this.outputAudioContext.createBuffer(1, total, 24000);
      const out = audioBuffer.getChannelData(0);
      let o = 0;
      for (const c of chunks) {
        for (let i = 0; i < c.length; i++) out[o++] = c[i] / 32768;
      }

      this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
      const src = this.outputAudioContext.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(this.outputNode);
      this.sources.add(src);

      // `once` so the listener and its closure are released after firing. Without
      // it these accumulated for the whole interview.
      src.addEventListener('ended', () => {
        this.sources.delete(src);
        // No console.log here on purpose — it fired per chunk and, with DevTools
        // open, held every logged object alive.
        if (this.sources.size === 0) this.scheduleMicUngate();
      }, { once: true });

      src.start(this.nextStartTime);
      this.nextStartTime += audioBuffer.duration;
    })
    // CRITICAL: without this catch, ONE bad chunk leaves `audioQueue` in a
    // rejected state and every later .then() is skipped — the AI goes silent for
    // the rest of the interview with no error shown. Swallow the bad chunk and
    // reset the chain so the next chunk still plays.
    .catch((err) => {
      console.error('❌ Audio chunk playback failed (skipping this chunk):', err);
      this.diag(`⚠️ Audio chunk failed: ${err?.message || err}`);
    });
  }

  private flushBufferedAudio() {
    if (this.bufferedAudioDeltas.length === 0) return;
    console.log(`🔊 Releasing audio buffer queue: playing ${this.bufferedAudioDeltas.length} chunks.`);
    this.playAudioImmediately = true;
    for (const chunk of this.bufferedAudioDeltas) {
      this.playAudioChunk(chunk);
    }
    this.bufferedAudioDeltas = [];
  }


  // -----------------------------------------------------------------------
  // AUDIO ENGINE
  // -----------------------------------------------------------------------
  // Input: 24kHz (Azure OpenAI Realtime standard)
  private inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  // Output: 24kHz (Azure OpenAI Realtime standard)
  private outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();

  private nextStartTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  // Serialises audio scheduling — prevents concurrent async onmessage calls
  // from racing on nextStartTime and causing drift/muffling over time
  private audioQueue: Promise<void> = Promise.resolve();

  // Incoming AI audio is batched before being turned into AudioBuffers — see
  // playAudioChunk() for why (the "muffled after 15 minutes" fault).
  private pcmQueue: Int16Array[] = [];
  private pcmQueuedSamples = 0;
  private pcmFlushTimer: ReturnType<typeof setTimeout> | null = null;
  /** 240ms at 24kHz. Long enough to cut node churn, short enough to be inaudible. */
  private static readonly PCM_BATCH_SAMPLES = 5760;

  private mediaStream!: MediaStream; // Mic Stream
  private sourceNode!: MediaStreamAudioSourceNode;
  private workletNode!: AudioWorkletNode;

  // -----------------------------------------------------------------------
  // VIDEO & UNIFIED RECORDING (NATIVE STREAMING ARCHITECTURE)
  // -----------------------------------------------------------------------
  private videoStream: MediaStream | null = null; // Camera Stream
  private unifiedRecorder: MediaRecorder | null = null; // The Chunked Recorder
  private chunkSequence = 0; // Track chunk order

  // Sequential upload queue — prevents out-of-order writes caused by fire-and-forget.
  // Each upload awaits the previous one so chunks always land on the server in order.
  private chunkUploadQueue: Promise<void> = Promise.resolve();

  @state() showPermissionCheck = false;
@state() micPermissionGranted = false;
@state() cameraPermissionGranted = false;
@state() showCompletionPopup = false;

@state() showStartPrompt = false;

private tabSwitchCount = 0;
private lastVisibilityChange = 0;
private setupComplete = false;

// NEW: Conversation Continuity State
private lastAIMessage = '';
private lastAIMessageTime = 0;
private aiWasSpeaking = false;
private lastUserMessage = '';
private lastUserMessageTime = 0;
private reconnectionInProgress = false;
private conversationStateBeforeDisconnect: {
  lastAIMessage: string;
  lastUserMessage: string;
  aiWasSpeaking: boolean;
  timestamp: number;
} | null = null;

@state() headphonesConnected = false;
@state() aloneRoomConfirmed = false;
@state() headphoneNoiseConfirmed = false;

@state() showThankYouPopup = false;
@state() showReattemptForm = false;
@state() reattemptReason = '';
@state() submittingReattempt = false;
@state() isAlreadyCompleted = false;

  static styles = interviewStyles;

  constructor() {
    super();
    this.bootstrap();
    window.addEventListener('beforeunload', (e) => this.handleBeforeUnload(e));
  }

  // --------------------------------------------------------------------------------
  // BOOTSTRAP & DATA LOADING
  // --------------------------------------------------------------------------------

  

  private async bootstrap() {
    const qs = new URLSearchParams(window.location.search).get('sessionId');
    if (qs) {
      this.sessionId = qs;
    } else {
      const parts = window.location.pathname.split('/').filter(Boolean);
      this.sessionId = parts[parts.length - 1] || '';
    }

    await this.loadSessionData();

    // Token is NOT fetched here. It is fetched by refreshClient() immediately before
    // initSession() is called in start(). Fetching here would waste one use of the token
    // (uses: 3) and the newSessionExpireTime (5 min) might expire while the user is going
    // through permission screens.
    this.outputNode.connect(this.outputAudioContext.destination);
    this.status = 'Ready to start your interview';
  }

  // Fetch fresh ephemeral voice configuration right before connecting.
  private async refreshClient(): Promise<boolean> {
    try {
      const res = await getVoiceToken(this.sessionId);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        this.updateError(err.message || 'Failed to refresh interview config.');
        return false;
      }
      const config = await res.json();
      this.voiceConfig = config;
      console.log('✅ Fresh Azure voice configuration obtained');
      return true;
    } catch (e: any) {
      this.updateError('Voice config refresh failed: ' + e.message);
      return false;
    }
  }

  // Inject system/progress text notes into Azure Voice Live WebSocket session
  private sendRealtimeText(text: string, triggerResponse: boolean = true) {
    if (this.ws && this.wsOpen && this.ws.readyState === WebSocket.OPEN) {
      try {
        const itemCreate = {
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: text
              }
            ]
          }
        };
        this.ws.send(JSON.stringify(itemCreate));

        // CENTRAL INTERRUPTION GUARD — never start the AI talking while the
        // candidate is still speaking.
        //
        // Several callers are TIMER-driven (the 55-minute notes fire from
        // setInterval, and two of them omitted the second argument entirely so
        // they defaulted to triggerResponse=true). A timer has no idea whether
        // the candidate is mid-sentence, so on an unlucky tick the AI would cut
        // straight across them. Guarding every call site individually is
        // fragile — the default value already caught two out — so the guard
        // lives here, where every path must pass through it.
        //
        // Dropping the response.create is safe: the item is already in the
        // conversation, and with create_response:true the server will produce a
        // reply as soon as the candidate genuinely finishes. The note is not
        // lost, it just does not jump the queue.
        if (triggerResponse && this.isUserSpeaking) {
          this.diag('🔇 Note queued — candidate is speaking, not interrupting them.');
          return;
        }

        if (triggerResponse) {
          // NEVER cancel a response in order to start another one.
          //
          // This used to call cancelActiveResponse() + cleanupAudioPlayback()
          // whenever a response was in flight, on the theory that it prevented
          // two overlapping AI voices. In practice it cut the AI off mid-word —
          // the candidate heard half a question and then nothing. Now that Azure
          // drives responses itself, a note that arrives mid-turn simply waits:
          // the item is queued into the conversation and the model will act on it
          // on its next turn, which it takes on its own.
          if (this.currentResponseId) {
            const ageMs = Date.now() - this.currentResponseStartedAt;
            if (ageMs < 30000) {
              this.diag('ℹ️ Note queued — AI is mid-turn, not interrupting it.');
              return;   // item is already in the conversation; no response.create
            }
            // Older than 30s with no response.done = stale bookkeeping, not a
            // real in-flight response. Clear it and proceed.
            this.diag('⚠️ Clearing stale in-flight response (no response.done).');
            this.currentResponseId = null;
            this.currentResponseMsgId = null;
          }
          // No modalities here on purpose: response.create INHERITS the session's
          // output config. Naming modalities again is what made every response
          // schema-specific (and rejected when it disagreed with the session).
          this.ws.send(JSON.stringify({ type: 'response.create', response: {} }));
        }
        console.log('🗣️ Sent system/progress note to Azure (triggerResponse=' + triggerResponse + '):', text.substring(0, 50) + '...');
      } catch (e) {
        console.warn('Failed to send text note to Azure session:', e);
      }
    }
  }

private async loadSessionData() {
  try {
    const r = await fetchSession(this.sessionId);
    if (!r.ok) {
      const contentType = r.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const d = await r.json();
        if (d.code === 'EXPIRED') throw new Error('Interview Expired - Original 48-hour window has passed.');
        else if (d.code === 'ALREADY_COMPLETED') throw new Error('Interview Already Completed - This interview has already been submitted.');
        else throw new Error(d.message || 'Failed to load');
      } else {
        throw new Error(`Backend unreachable (HTTP ${r.status}). Ensure the interview server is running.`);
      }
    }
    this.sessionData = await r.json();
    
    // Check if interview is already completed
    if (this.sessionData.status === 'completed' || this.sessionData.completedAt) {
      this.isAlreadyCompleted = true;
    }
  } catch (e: any) {
    this.updateError(e.message);
  }
}

  // --------------------------------------------------------------------------------
  // CORE FUNCTIONS
  // --------------------------------------------------------------------------------

  private updateStatus(s: string) { this.status = s; }
  private updateError(e: string) { this.error = e; console.error(e); }
  private now() { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

  private addToTranscript(role: any, text: string) {
    const entry = { role, text, timestamp: this.now() } as any;
    this.transcript = [...this.transcript, entry];
  }

  // --------------------------------------------------------------------------------
  // AZURE VOICE LIVE SESSION MANAGEMENT
  // --------------------------------------------------------------------------------

  private async initSession(resumeHandle: string | null = null) {
    if (!this.voiceConfig) {
      throw new Error('Azure voice configurations not loaded.');
    }

    // Reset the interview state machine — but ONLY for a genuinely new session.
    // initSession() is also re-entered on reconnect and when walking down the
    // session-config ladder; resetting here unconditionally threw away the phase,
    // the question count and the elapsed progress, so a single dropped socket
    // silently restarted the interview from "What do you know about Systech?".
    if (!resumeHandle && !this.sessionConfirmed) {
      this.currentPhase = 1;
      this.phase1QuestionIndex = 0;
      this.phase1Asked = 0;
      this.introQuestion1Asked = false;
      this.primaryQuestionCount = 0;
      this.topicTurnIndex = 0;
      this.followupCountForCurrentTopic = 0;
      this.followupTargetForCurrentTopic = this.pickFollowupTarget();
      this.behavioralCount = 0;
      this.lastSentStateBlock = '';
    }

    // Determine Candidate Experience Level from Resume
    this.candidateExperienceLevel = determineExperienceLevel(this.sessionData?.resumeText || '');
    console.log(`👤 Candidate Experience Level Classified: [${this.candidateExperienceLevel}]`);

    this.baseInstructions = this.buildBaseInstructions();

    try {
      // ── Connect to the SECURE BACKEND RELAY, not Azure directly ────────────
      // The browser never sees the Azure endpoint or API key. It opens a
      // WebSocket to our own backend (wsPath) authenticated by a short-lived
      // ticket; the backend relays to Azure with the key injected server-side.
      // Use wss:// on HTTPS pages, ws:// on local HTTP dev.
      const wsScheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const wsUrl = `${wsScheme}://${window.location.host}${this.voiceConfig.wsPath}?ticket=${encodeURIComponent(this.voiceConfig.ticket)}`;

      // Endpoint-type detection now comes from the backend (it knows the real
      // endpoint) and only drives the turn-detection choice below.
      const isVoiceLiveFoundry = this.voiceConfig.isVoiceLiveFoundry;

      // ── gpt-realtime turn detection (semantic VAD) ─────────────────────────
      // gpt-realtime supports semantic voice-activity detection, which decides the
      // candidate has finished based on the meaning of what they said rather than a
      // fixed silence timer. This is the core of the migration off server_vad and
      // directly addresses: waiting for the candidate to finish, not interrupting,
      // and not treating filler words ("umm/hmm") as a completed answer.
      //   • Azure AI Foundry Voice Live → azure_semantic_vad (remove_filler_words +
      //     semantic end-of-utterance detection).
      //   • Standard Azure OpenAI       → OpenAI semantic_vad with low eagerness.
      // Requires a recent api-version (see AZURE_VOICELIVE_API_VERSION). If the
      // endpoint/version rejects it, the onmessage error handler falls back to
      // server_vad automatically.
      // NOTE: end_of_utterance_detection (semantic_detection_v1) is NOT supported on
      // gpt-realtime — it requires a "cascaded" pipeline; Azure rejects it on this
      // native model. azure_semantic_vad WITH remove_filler_words is attempted (it
      // handles "umm/uhh/hmm"); if the endpoint rejects azure_semantic_vad entirely,
      // the onmessage error handler falls back to server_vad (confirmed to work).
      // THE VAD TYPE IS IMMUTABLE ONCE THE SESSION STARTS. Proven 2026-07-31:
      // Azure returns "Cannot change turn detection type during session (from
      // server_vad to azure_semantic_vad)". So the detector we actually want has
      // to be in the FIRST session.update — a "send something safe now, upgrade
      // later" approach silently strands the interview on plain server_vad with
      // no filler-word handling. Degradation is handled by the attempt ladder
      // below (a fresh session per rung), never by patching a live session.
      // ── create_response MUST be true ───────────────────────────────────────
      // This used to be false, with the client driving every AI turn: wait for
      // the STT transcript, decide the next question, inject it as a fake user
      // message, then response.create. That design caused most of the reported
      // failures:
      //   • a single dropped/slow transcript = the AI never speaks again
      //     (three separate watchdog timers existed purely to paper over it),
      //   • 3–5s of dead air per turn (VAD silence + STT round-trip + create),
      //   • and the conversation history filled up with bracketed
      //     "[SYSTEM NOTE: Ask Follow-up #2 of 4]" messages attributed to the
      //     CANDIDATE — which is why the AI read questions off a list instead of
      //     conversing. That is the "feels like Q&A, not an interview" symptom.
      //
      // The server now decides when the candidate has finished and responds on
      // its own, exactly as the realtime API is designed to work. Phase control
      // did not go away — it moved to session.update instructions, refreshed
      // between turns (see refreshPhaseInstructions), where it steers the model
      // without polluting the transcript.
      const baseTurnDetection = isVoiceLiveFoundry
        ? {
            type: 'azure_semantic_vad',
            // 0.6, not 0.5. A low threshold makes the detector treat room noise,
            // a cough or a breath as speech — which ends the candidate's turn on
            // silence that was never really silence, and can start a whole turn
            // when nobody spoke at all (the AI "asking and answering itself").
            threshold: 0.6,
            // More lead-in so the first syllable of an answer is never clipped.
            prefix_padding_ms: 500,
            // "Respond fast" and "never cut me off" pull in opposite directions,
            // and a fixed silence window cannot satisfy both — that is exactly
            // why this endpoint's SEMANTIC detector matters. It judges
            // end-of-turn by MEANING, so it can close quickly on a complete
            // sentence while staying patient through an unfinished one, and
            // remove_filler_words below keeps "hmm / uh / one second" from
            // counting as completion at all.
            //
            // With that semantic layer doing the real work, this timer only has
            // to cover the tail. 600ms is responsive without clipping; the
            // protection against interrupting comes from semantics, not from
            // padding this number (1600ms merely added dead air to every turn).
            //
            // Do NOT add end_of_utterance_detection (semantic_detection_v1)
            // here. It was tried on 2026-07-31 and Azure rejects it on this
            // native model (it needs a cascaded pipeline) — see the note above.
            // Because it would sit in the FIRST session.update, a rejection does
            // not merely lose that feature: it costs a socket + reconnect and
            // drops the interview to plain server_vad, which has NO
            // remove_filler_words. That would break the very requirement it
            // looks like it should help.
            //
            // 600ms was WRONG and I set it — lowered in response to a
            // "latency is too high" report. The result was the failure the
            // candidate actually feels: answering "It is a data engineering…",
            // pausing to think for half a second, and being cut off. People
            // routinely pause longer than 600ms mid-sentence, especially when
            // speaking a second language or recalling detail.
            //
            // Being interrupted makes candidates abandon the interview. A
            // slightly slower reply does not. When these two goals conflict, the
            // interruption wins — so this is now deliberately patient.
            silence_duration_ms: 2000,
            // Treat "umm / uh / hmm / wait a minute" as hesitation, NOT a
            // finished answer.
            remove_filler_words: true,
            create_response: true,            // server drives turns — see above
            interrupt_response: false,        // never let the model barge in on the candidate
          }
        : {
            type: 'semantic_vad',
            eagerness: 'low',                 // wait longer before ending the turn
            create_response: true,
            interrupt_response: false,
          };

      // NOTE: there is no longer a "stage 2 turn detection". The detector type is
      // immutable after session start, so the real detector is set above in
      // baseTurnDetection and stage 2 now carries the voice only.
      const turnDetection = baseTurnDetection;

      // The ticket carries no secret and expires in seconds, but there is no
      // reason to print it — mask it in diagnostics.
      const maskedUrl = wsUrl.replace(/ticket=[^&]+/, 'ticket=***');
      this.diag(`Endpoint type: ${isVoiceLiveFoundry ? 'Azure AI Foundry' : 'Azure OpenAI'} (via secure relay)`);
      this.diag(`Model: ${this.voiceConfig.model} | API Version: ${this.voiceConfig.apiVersion}`);
      this.diag(`Connecting to relay: ${maskedUrl.substring(0, 80)}...`);
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = async () => {
        this.wsOpen = true;
        this.inSession = true;
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.sessionStartedSuccessfully = true;
        this.interviewStartTime = Date.now();
        await this.inputAudioContext.resume();
        await this.outputAudioContext.resume();

        this.updateStatus('Connected to AI Interviewer');
        this.diag('✅ WebSocket OPEN — Azure accepted connection');

        // ── SESSION SCHEMA: chosen by ENDPOINT TYPE, not model generation ───────
        // PROVEN BY AZURE'S OWN ERROR (2026-07-31):
        //     "'session.type' unexpected (extra fields not permitted)"
        // Azure AI Foundry **Voice Live** uses the FLAT schema (top-level
        // `modalities`, `voice`, `input_audio_transcription`, `turn_detection`) and
        // REJECTS the GA nested shape (`session.type:'realtime'`,
        // `output_modalities`, `session.audio.*`) — even for a GA-generation model
        // like gpt-realtime-2.1-mini. The schema is a property of the ENDPOINT, not
        // of the model version; picking it by model generation was the mistake.
        //
        // Standard Azure OpenAI /openai/realtime endpoints use the GA nested shape.
        // So: Voice Live → FLAT, everything else → GA. The other shape is kept as a
        // best-effort fallback, but note Azure CLOSES the socket after a rejected
        // session.update (observed: code 1011 right after the retry), so the FIRST
        // attempt must be correct — the fallback cannot be relied on.
        // ── DEGRADATION LADDER ─────────────────────────────────────────────────
        // A rejected session.update leaves the session with NO turn detection and
        // NO transcription, so the AI cannot hear the candidate at all. The greeting
        // still plays (its instructions are inline in response.create), which
        // disguises total failure as "spoke the intro, then froze" — exactly the
        // reported symptom. Any UNVERIFIED field is therefore fatal if sent alone.
        //
        // So we try richest→simplest and stop at the first one Azure accepts. The
        // last rung is the EXACT config Azure confirmed on 2026-07-31 14:24
        // ("✅ session.updated confirmed"), so there is always a known-good floor.
        const flatBase = {
          // Must contain BOTH. Audio-only (['audio']) is rejected outright and
          // silently kills every response.create. This exact value is what the
          // known-working reference sends.
          modalities: ['audio', 'text'],
          instructions: this.composeInstructions(),
          // MALE interviewer voice. Must be a plain STRING in the flat schema and
          // must be in the FIRST session.update — sending it as an object
          // ({type:'openai',name:'echo'}) in a later "stage 2" update silently
          // failed, so the session kept Azure's DEFAULT (female) voice.
          //
          // 'echo', NOT 'onyx'. Settled by Azure itself on 2026-08-03:
          //   'session.voice' should be 'alloy', 'ash', 'ballad', 'coral',
          //   'echo', 'sage', 'shimmer', 'verse', 'marin' or 'cedar',
          //   got 'onyx'
          //
          // The old reference implementation (…/Documents/interview.tsx:1574)
          // does use 'onyx' — but it targets the PREVIOUS model
          // (gpt-realtime-mini, with whisper-1 and server_vad).
          // gpt-realtime-2.1-mini rejects that voice. This is exactly the class
          // of setting that did not get carried across the model change.
          //
          // Because voice lives in the FIRST session.update, a bad name does not
          // merely lose the voice — it fails the ENTIRE config, so the session
          // ends up with no VAD and no transcription and the AI never speaks.
          // The ladder below therefore also carries a no-voice rung.
          voice: 'echo',
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          // Candidate speech-to-text MUST stay enabled — the interview state machine
          // (phases, follow-ups, no-repeats) is driven by the resulting
          // input_audio_transcription.completed events.
          // language pinned — see transcriptionLanguage(). Auto-detect mangles
          // accented English into transliterated nonsense.
          input_audio_transcription: { model: TRANSCRIPTION_MODEL, language: this.transcriptionLanguage() },
          // NOTE: max_response_output_tokens is deliberately NOT set. Capping it at
          // 200 truncated the model mid-sentence — it cut the greeting off after
          // "Welcome to Systech" (losing the mandatory "What do you know about
          // Systech?" question) and left later questions broken halfway. Questions
          // must always be spoken in full.
        };

        // KNOWN-GOOD floor: this exact turn_detection was accepted by Azure.
        const knownGoodTurnDetection = {
          type: 'server_vad',
          threshold: 0.6,
          prefix_padding_ms: 500,
          // Plain server_vad has no semantic layer, so this window IS the only
          // protection against cutting the candidate off mid-thought. 2000ms is
          // the value the known-working reference implementation uses, chosen
          // there for "patient candidate waiting" — do not shorten it.
          silence_duration_ms: 2000,
          create_response: true,
          interrupt_response: false,
        };


        const gaSessionUpdate = {
          type: 'session.update',
          session: {
            type: 'realtime',
            output_modalities: ['audio'],
            instructions: this.composeInstructions(),
            audio: {
              input: {
                format: { type: 'audio/pcm', rate: 24000 },
                // Candidate speech-to-text MUST stay enabled — the interview state
                // machine (phases, follow-ups, no-repeats) is driven by the
                // resulting input_audio_transcription.completed events.
                transcription: { model: TRANSCRIPTION_MODEL, language: this.transcriptionLanguage() },
                turn_detection: turnDetection,
              },
              output: {
                format: { type: 'audio/pcm', rate: 24000 },
                // MALE interviewer voice. The old comment here said this was
                // "applied in stage 2" — but stage 2 was deleted when the turn
                // detector moved into the first update, and nobody moved the
                // voice back. So the GA path silently ran on Azure's DEFAULT
                // (female) voice for every interview.
                voice: 'echo',
              },
            },
          },
        };
        // Every rung spreads flatBase, so ANY bad field in flatBase fails ALL of
        // them. That is not hypothetical — it is what the 2026-08-03 log shows:
        // rung 1 was rejected for voice:'onyx', rung 2 carried the identical
        // voice, and Azure killed the socket (1011) with no rungs left. A ladder
        // that only varies turn_detection cannot survive a bad voice.
        //
        // So the floor rung now drops `voice` entirely (Azure falls back to its
        // default) — losing the male voice is a cosmetic regression, whereas
        // losing the session means the AI never speaks at all.
        const flatNoVoice = { ...flatBase };
        delete (flatNoVoice as any).voice;

        // Safety floor. This rung used to swap the transcription model to
        // 'whisper-1' — which introduced a THIRD model into a project that is
        // deliberately limited to two (gpt-realtime-2.1-mini for conversation,
        // gpt-4o-mini-transcribe for STT). That was unjustified: interviews are
        // now running end to end, which proves this endpoint accepts
        // gpt-4o-mini-transcribe, so the risk it hedged does not exist.
        //
        // What DOES still need hedging is the `language` field added later — it
        // is genuinely unverified on this endpoint. So the floor rung keeps the
        // same model and simply drops the language pin, falling back to
        // auto-detect. Same recovery, no extra model.
        //
        // Transcription must stay enabled on every rung: the interview record
        // and the answer-grounded follow-ups both depend on it.
        const flatSafest = {
          ...flatNoVoice,
          input_audio_transcription: { model: TRANSCRIPTION_MODEL },
        };

        // Richest → simplest. The last rung is the config Azure has already
        // confirmed, so the session can always be configured.
        this.activeSessionSchema = isVoiceLiveFoundry ? 'legacy' : 'ga';
        this.sessionAttempts = isVoiceLiveFoundry
          ? [
              // 1. Best: semantic VAD (filler-word handling, semantic end-of-turn).
              { label: 'FLAT + semanticVAD',
                msg: { type: 'session.update', session: { ...flatBase, turn_detection: turnDetection } } },
              // 2. Known-good turn detection, voice retained.
              { label: 'FLAT + serverVAD (known-good)',
                msg: { type: 'session.update', session: { ...flatBase, turn_detection: knownGoodTurnDetection } } },
              // 3. Last resort: no voice at all, so a voice-name rejection can
              //    never again cost the whole session.
              { label: 'FLAT + serverVAD, default voice',
                msg: { type: 'session.update', session: { ...flatNoVoice, turn_detection: knownGoodTurnDetection } } },
              // 4. Safety floor: drops the two fields this endpoint has not
              //    verified — the voice name and the STT language pin. Same
              //    transcription model; no third model is introduced.
              { label: 'FLAT safest (no voice, auto-detect STT)',
                msg: { type: 'session.update', session: { ...flatSafest, turn_detection: knownGoodTurnDetection } } },
            ]
          : [
              { label: 'GA nested', msg: gaSessionUpdate },
              { label: 'FLAT + serverVAD (known-good)',
                msg: { type: 'session.update', session: { ...flatBase, turn_detection: knownGoodTurnDetection } } },
              { label: 'FLAT + serverVAD, default voice',
                msg: { type: 'session.update', session: { ...flatNoVoice, turn_detection: knownGoodTurnDetection } } },
              // 4. Safety floor: drops the two fields this endpoint has not
              //    verified — the voice name and the STT language pin. Same
              //    transcription model; no third model is introduced.
              { label: 'FLAT safest (no voice, auto-detect STT)',
                msg: { type: 'session.update', session: { ...flatSafest, turn_detection: knownGoodTurnDetection } } },
            ];
        this.sessionAttemptIndex = 0;

        // Resume the ladder where a previous connection left off. When Azure kills
        // the socket instead of replying with an error frame, initSession is
        // re-entered and must continue with the NEXT rung, not restart at rung 1.
        const attemptIdx = Math.min(this.pendingSessionAttemptIndex, this.sessionAttempts.length - 1);
        this.sessionAttemptIndex = attemptIdx;
        const firstPayload = JSON.stringify(this.sessionAttempts[attemptIdx].msg);
        this.ws!.send(firstPayload);
        this.diag(`📤 session.update attempt ${attemptIdx + 1}/${this.sessionAttempts.length}: ${this.sessionAttempts[attemptIdx].label} (${Math.round(firstPayload.length / 1024)}KB)`);

        // FAILSAFE: the greeting is triggered by session.updated. If Azure never
        // emits that event (and never errors either), the greeting would never
        // fire and the interview would sit in total silence — with nothing in the
        // logs to explain it. After 4s, send the greeting anyway: a session that
        // is actually working will speak, and one that is not will return an error
        // we can finally see. Silence is never an acceptable outcome.
        if (!resumeHandle) {
          if (this.greetingFailsafeTimer) clearTimeout(this.greetingFailsafeTimer);
          this.greetingFailsafeTimer = setTimeout(() => {
            this.greetingFailsafeTimer = null;
            if (this.stopCalled || !this.wsOpen) return;
            if (this.greetingSent || this.greetingReceived) return;
            // Do NOT greet on an unconfigured session. The greeting carries its own
            // inline instructions, so it plays even when session.update was rejected
            // — which made a totally broken session (no VAD, no transcription, AI
            // deaf) look like "spoke the intro, then froze". Better to fail loudly.
            if (!this.sessionConfirmed) {
              this.diag('❌ No session.updated after 4s and config NOT confirmed — not greeting; the AI could not hear you anyway.');
              this.updateError('Voice session could not be configured. Please restart the interview.');
              return;
            }
            this.greetingSent = true;
            this.diag('⏱️ No greeting yet — sending greeting (failsafe).');
            const greetingInstruction = `Speak your opening greeting now out loud to candidate ${this.candidateDisplayName}: "Hello ${this.candidateDisplayName}, welcome to your interview with Systech. I'm your AI interviewer for today. Let's get started. My first question is — what do you know about Systech?"`;
            this.ws?.send(JSON.stringify({ type: 'response.create', response: { instructions: greetingInstruction } }));
          }, 4000);
        }

        if (!resumeHandle) {
          this.greetingReceived = false;
          this.greetingSent = false;
          this.hasCandidateAnsweredSinceLastAIQuestion = false;
          this.turnAlreadyAdvancedForUtterance = false;
          if (this.fallbackTurnTimer) { clearTimeout(this.fallbackTurnTimer); this.fallbackTurnTimer = null; }
          this.speechStartedGuardTimestamp = Date.now();
        } else {
          // Resume: keep greetingSent/greetingReceived TRUE so the session.updated
          // handler does not fire the opening greeting again. The conversation
          // replay happens there instead, once Azure confirms the config — this
          // flag is what routes it.
          this.pendingResumeReplay = true;
          this.diag('🔄 Session resumed — config re-applied');
        }
      };

      this.ws.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);

          // Handle WebSocket Error Events & Apply Fallback Config if Parameter Rejected
          if (message.type === 'error') {
            const errMsg = message.error?.message || JSON.stringify(message.error);
            this.diag(`❌ Azure ERROR: ${errMsg}`);
            console.error('❌ Azure realtime error frame:', message.error);
            this.forceUngateMic();

            // Once Azure has ACCEPTED a session, later errors are non-fatal — they
            // are almost always the optional stage-2 enhancement being rejected,
            // which we deliberately tolerate. Never tear down a working session or
            // alarm the candidate over those.
            if (this.sessionConfirmed) {
              // Non-fatal, but do NOT hide what it was. Phase steering re-sends
              // instructions via session.update after every turn; if Azure starts
              // rejecting those, the interview keeps talking but stops following
              // the phase rules — which is impossible to diagnose from a generic
              // "ignoring" line. Surface the actual message.
              this.diag(`ℹ️ Non-fatal Azure error (session still valid): ${errMsg}`);
              return;
            }

            // Before any session is confirmed, a setup-level error IS fatal to the
            // interview — surface it visibly instead of failing silently. (Silent
            // failure is why "the AI just never spoke" was so hard to diagnose.)
            this.updateError(`Voice setup error from Azure: ${errMsg}`);

            // If the GA session.update is rejected, this endpoint/model is the older
            // PREVIEW generation — retry once with the legacy FLAT schema.
            //
            // Two bugs fixed here:
            //  1) The old fallback also sent the flat schema (same as the primary),
            //     so a GA model rejected both and nothing was ever configured.
            //  2) It set greetingSent=true and fired the greeting IMMEDIATELY,
            //     before the retry was confirmed — so the greeting raced an
            //     unconfigured session AND permanently blocked the proper greeting
            //     in the session.updated handler. Now the fallback only re-sends the
            //     config; session.updated fires the greeting exactly as normal.
            // Walk DOWN the degradation ladder. Each rejection drops one unverified
            // feature; the final rung is a config Azure has already accepted. This
            // guarantees the session ends up configured — without it, a single bad
            // field left the session with no VAD and no transcription, so the AI
            // could not hear the candidate at all ("intro, then frozen").
            if (message.error?.message && !this.sessionConfirmed && this.sessionAttempts.length > 0) {
              // Azure names the offending field ("'session.voice' should be
              // 'alloy', … got 'onyx'"). Use it. Stepping blindly to the next
              // rung wasted the retry on 2026-08-03: rung 2 carried the very
              // same rejected voice, so it was guaranteed to fail, and Azure
              // closed the socket before any further rung could be tried.
              //
              // If the rejected field is `voice`, jump straight to the first
              // rung that does not send one.
              const jumpTo = (idx: number, why: string) => {
                this.sessionAttemptIndex = idx;
                const next = this.sessionAttempts[idx];
                this.diag(`⚠️ ${why} — skipping to attempt ${idx + 1}/${this.sessionAttempts.length}: ${next.label}`);
                if (this.ws && this.wsOpen) this.ws.send(JSON.stringify(next.msg));
              };

              if (/voice/i.test(errMsg)) {
                const noVoiceIdx = this.sessionAttempts.findIndex(
                  (a, i) => i > this.sessionAttemptIndex && !('voice' in (a.msg?.session || {})),
                );
                if (noVoiceIdx !== -1) { jumpTo(noVoiceIdx, 'voice rejected'); return; }
              }

              // Same treatment for a rejected transcription model — otherwise
              // every rung carrying it fails identically and the socket dies
              // before the safe rung is ever reached.
              if (/transcri/i.test(errMsg)) {
                // Jump to the first rung that sends NO language pin. The pin is
                // the unverified part; the model is not (interviews run on it).
                const safeIdx = this.sessionAttempts.findIndex(
                  (a, i) => i > this.sessionAttemptIndex &&
                    !a.msg?.session?.input_audio_transcription?.language &&
                    !a.msg?.session?.audio?.input?.transcription?.language,
                );
                if (safeIdx !== -1) { jumpTo(safeIdx, 'transcription model rejected'); return; }
              }

              this.sessionAttemptIndex++;
              if (this.sessionAttemptIndex < this.sessionAttempts.length) {
                const next = this.sessionAttempts[this.sessionAttemptIndex];
                this.diag(`⚠️ config rejected — attempt ${this.sessionAttemptIndex + 1}/${this.sessionAttempts.length}: ${next.label}`);
                if (this.ws && this.wsOpen) this.ws.send(JSON.stringify(next.msg));
                return;
              }
              this.diag('❌ ALL session configs rejected — the AI will not be able to hear you.');
              this.updateError(`Voice setup failed: ${errMsg}`);
              return;
            }
            return;
          }

          // Handle session.updated confirmation from Azure -> Trigger opening greeting exactly ONCE
          if (message.type === 'session.updated') {
            this.diag(`✅ session.updated confirmed by Azure! (schema: ${this.activeSessionSchema.toUpperCase()})`);
            this.sessionConfirmed = true;
            // Remember the EXACT payload Azure accepted. Phase steering re-sends
            // this message with fresh instructions, so a mid-interview refresh
            // can never accidentally drop turn_detection / transcription / voice.
            if (!this.acceptedSessionMsg && this.sessionAttempts[this.sessionAttemptIndex]) {
              this.acceptedSessionMsg = this.sessionAttempts[this.sessionAttemptIndex].msg;
              this.diag(`🧭 Phase steering will reuse config: ${this.sessionAttempts[this.sessionAttemptIndex].label}`);
            }
            if (this.greetingFailsafeTimer) { clearTimeout(this.greetingFailsafeTimer); this.greetingFailsafeTimer = null; }
            // Config succeeded, so any earlier schema-probe error was expected and
            // is no longer a failure — clear the banner it raised.
            if (this.error.startsWith('Voice setup error from Azure:')) this.error = '';

            // There is no "stage 2" session.update. Everything it used to carry
            // is in the FIRST config, where it actually applies: the male voice
            // (a plain string) and the turn detector (whose type is immutable
            // once the session starts). Sending them later never worked.
            //
            // Note this handler also fires for every phase-steering refresh, so
            // the greeting guard below must stay — otherwise the AI would
            // re-greet the candidate on each phase change.
            // Reconnected mid-interview: replay context instead of greeting, and
            // push the phase guidance the new session knows nothing about.
            if (this.pendingResumeReplay) {
              this.pendingResumeReplay = false;
              this.lastSentStateBlock = '';   // force the refresh onto the new session
              this.refreshPhaseInstructions();
              this.restoreConversationContinuity();
              return;
            }

            if (!this.greetingSent && !this.greetingReceived) {
              this.greetingSent = true;
              this.diag('🎤 Sending single response.create for opening greeting...');
              const greetingInstruction = `Speak your opening greeting now out loud to candidate ${this.candidateDisplayName}: "Hello ${this.candidateDisplayName}, welcome to your interview with Systech. I'm your AI interviewer for today. Let's get started. My first question is — what do you know about Systech?"`;
              this.ws?.send(JSON.stringify({
                type: 'response.create',
                response: { instructions: greetingInstruction }
              }));
            }
          }

          // Track response creation & user speech protection
          if (message.type === 'response.created' && message.response) {
            this.diag(`📨 response.created: id=${message.response.id}`);
            this.currentAITranscriptBuffer = ''; // Reset for fresh phrase detection
            this.currentResponseId = message.response.id;
            this.currentResponseStartedAt = Date.now();
            const outputItem = message.response.output?.[0];
            if (outputItem && outputItem.type === 'message') {
              this.currentResponseMsgId = outputItem.id;
            } else {
              this.currentResponseMsgId = null;
            }

            this.isUserSpeaking = false;
            this.isModelSpeaking = true;
            this.speechStartedGuardTimestamp = Date.now(); // Record AI speech start time
            if (this.workletNode) this.workletNode.port.postMessage({ type: 'gate', value: true });
            console.log('🤖 AI Response created:', this.currentResponseId, 'Msg:', this.currentResponseMsgId);
          }

          // 1a. REAL-TIME AI transcript monitoring — OBSERVATION ONLY. Nothing
          //     here cancels or interrupts the AI mid-sentence any more; see the
          //     note at the detection site below for why.
          //     GA gpt-realtime uses `response.output_audio_transcript.delta`; preview uses `response.audio_transcript.delta`.
          if ((message.type === 'response.output_audio_transcript.delta' || message.type === 'response.audio_transcript.delta') && message.delta) {
            if (message.response_id === this.cancelledResponseId) return;

            // Accumulate transcript delta for this response
            if (!this.currentAITranscriptBuffer) this.currentAITranscriptBuffer = '';
            this.currentAITranscriptBuffer += message.delta;
            const bufLower = this.currentAITranscriptBuffer.toLowerCase();

            // Phrases the prompt tells the model to avoid. Matching one is
            // logged so it stays visible in diagnostics — it no longer changes
            // the AI's behaviour mid-turn. Several entries are ordinary English
            // ('phase 2', 'start with the basics') that appear in legitimate
            // questions, which is precisely why acting on them was destructive.
            const bannedPhrases = [
              'take your time', 'whenever you are ready', 'whenever you\'re ready',
              'i\'m here to listen', 'i am here to listen',
              'feel free to take a moment',
              'please let me know when you are ready', 'let me know when you are ready',
              'i\'ll wait', 'i will wait', 'i\'m waiting', 'i am waiting',
              'i\'m ready to listen', 'i am ready to listen',
              'i\'ll give you a moment', 'i will give you a moment',
              'i\'m here whenever', 'please take your time',
              'moving to the technical', 'moving to the behavioral',
              'next phase', 'phase 2', 'phase 3', 'technical evaluation',
              'behavioral evaluation', 'behavioral round',
              'i\'ll ask an easier', 'let me ask something easier',
              'start with the basics', 'ask a simpler'
            ];

            // DETECTION ONLY — NEVER cancel mid-sentence.
            //
            // This used to call cancelActiveResponse() + cleanupAudioPlayback()
            // the instant a phrase matched, which killed the AI's audio mid-word.
            // The list is matched as plain SUBSTRINGS against a partial
            // transcript, and it contains ordinary English: 'phase 2',
            // 'next phase', 'technical evaluation', 'start with the basics',
            // 'i will wait'. So a perfectly good question — "walk me through
            // phase 2 of that deployment" — was chopped in half. Worse, nothing
            // re-drove the turn afterwards, so the interview went silent until a
            // watchdog fired ~25s later. That is exactly the reported
            // "half question is asked, then the voice is broken".
            //
            // Cutting a question in half is always worse than letting a stray
            // phrase through: the candidate cannot answer a question they never
            // heard. Prevention belongs in the prompt (it is covered there); here
            // we only log, so the behaviour stays visible in diagnostics.
            const detected = bannedPhrases.find(phrase => bufLower.includes(phrase));
            if (detected && detected !== this.lastBannedPhraseLogged) {
              this.lastBannedPhraseLogged = detected;
              console.warn(`⚠️ Discouraged phrase in AI speech: "${detected}" (letting the question finish)`);
              this.diag(`⚠️ AI used a discouraged phrase: "${detected}"`);
            }
          }

          // 1. AI Speech Transcription & Early Closing Prevention
          //    GA gpt-realtime uses `response.output_audio_transcript.done`; preview uses `response.audio_transcript.done`.
          if ((message.type === 'response.output_audio_transcript.done' || message.type === 'response.audio_transcript.done') && message.transcript) {
            this.currentAITranscriptBuffer = ''; // Reset buffer for next response
            if (message.response_id === this.cancelledResponseId) {
              console.log('🗑️ Discarding transcript of cancelled response:', message.response_id);
              return;
            }
            const text = message.transcript.trim();
            this.lastAIMessage = text;
            this.lastAIMessageTime = Date.now();
            this.lastInterviewActivityAt = Date.now();
            this.aiWasSpeaking = true;

            // Did the AI actually SPEAK the mandatory intro question? Detected from
            // its own transcript so a truncated greeting cannot skip it silently.
            // Tolerant detection. The old test was /know about systech/i, which
            // missed every natural paraphrase the model actually produces —
            // "Tell me about Systech", "what have you heard about Systech",
            // "how familiar are you with Systech". A miss livelocked Phase 1
            // (see advancePhasePointer), so this must err towards matching.
            if (!this.introQuestion1Asked && this.currentPhase === 1 && /systech/i.test(text)) {
              this.introQuestion1Asked = true;
              this.diag('✅ Intro Q1 (asked about Systech) detected');
            }

            // Remember the topic of a primary technical question so follow-ups
            // can be told to stay on it. activeTopicName was declared and
            // initialised to 'Introduction' but never once updated, so the
            // "stay on the current topic" steering had nothing behind it.
            // Did this turn actually pose a question? Drives whether the phase
            // pointer consumes a slot (see response.done).
            this.lastAiTurnAskedQuestion = /\?/.test(text) ||
              /\b(tell me|walk me through|describe|explain|how would you|what would you|can you)\b/i.test(text);

            if (this.currentPhase === 2 && this.topicTurnIndex === 0) {
              this.activeTopicName = this.guessTopic(text) || this.activeTopicName;
              if (this.activeTopicName) {
                this.coveredTopics.add(this.activeTopicName);
                this.diag(`📌 Topic: ${this.activeTopicName}`);
              }
            }

            // Catch a repeat the moment it happens. Telling the model "do not
            // repeat" is necessary but clearly not sufficient — it kept asking
            // the same questions. When a near-duplicate slips through, correct
            // it on the spot so the interview does not sit on the same ground:
            // the wording is banned explicitly and the next turn is redirected.
            const dup = this.findSimilarAskedQuestion(text);
            if (dup) {
              this.diag(`♻️ Repeat detected — steering to a new question`);
              console.warn('♻️ Near-duplicate question detected:\n  now:  ' + text + '\n  past: ' + dup);
              this.repeatedQuestionCount++;
              this.sendRealtimeText(
                `[You have already asked this earlier: "${dup.slice(0, 140)}". Do not ask it again or reword it. Move to a genuinely different, uncovered skill or project from the résumé or job description for your next question, and do not mention this note.]`,
                false,
              );
            }

            // EARLY CLOSING INTERCEPTION (< 30 mins / 1800s)
            // Flag it, but do NOT cancel — cancelling here cut the AI off
            // mid-sentence and left the candidate listening to dead air. The
            // correction is applied in the response.done handler, once the turn
            // has finished speaking and no response is in flight (creating one
            // while a response is active is rejected as "active response").
            const isClosingPhrase = text.includes('Do you have any questions for me') || text.includes('Thank you,') || text.includes('pleasure speaking with you today');
            if (this.interviewDuration < this.minimumMinutes() * 60 && isClosingPhrase && this.currentPhase < 4) {
              console.warn('🛑 Early closing detected at ' + Math.floor(this.interviewDuration / 60) + ' min (minimum is 30) — will correct after this turn.');
              this.earlyClosingToCorrect = true;
            }

            // Reset flag: candidate has not answered this newly delivered AI question yet
            this.hasCandidateAnsweredSinceLastAIQuestion = false;

            if (text && !this.askedQuestionsList.includes(text)) {
              this.askedQuestionsList.push(text);
            }

            // Sync AI transcription turn in real-time
            if (text) {
              const entry = { role: 'AI Interviewer' as const, text: text, timestamp: new Date().toISOString() };
              this.transcript = [...this.transcript, entry];
              postTranscript(this.sessionId, entry).catch(err => console.error('Error posting transcript:', err));
            }
          }

          // 2. Turn completion
          if (message.type === 'response.done') {
            this.aiWasSpeaking = false;
            this.currentResponseId = null;  // response finished — no longer "in flight"
            this.currentResponseMsgId = null;
            this.currentAITranscriptBuffer = '';
            this.lastBannedPhraseLogged = '';
            this.lastInterviewActivityAt = Date.now();

            // NOTE: isModelSpeaking is deliberately NOT cleared here, and the mic
            // is NOT reopened immediately. response.done means Azure finished
            // GENERATING — the model generates faster than realtime, so several
            // seconds of speech are still queued in the output graph. The old code
            // reopened the mic 300ms after this event, straight into the AI's own
            // voice: the echo tripped the VAD, which fired a new turn, which is
            // why the AI talked over itself and answered its own questions.
            // scheduleMicUngate() waits for playback to actually drain.
            this.scheduleMicUngate();

            // The turn that just finished is now consumed: move the phase pointer
            // on and push the next turn's guidance. Doing this HERE — while the
            // candidate is still thinking/answering — means the model already has
            // fresh instructions by the time the server auto-creates its next
            // response, with no round-trip in the critical path.
            if (this.greetingReceived) {
              // A filler, a repeat request, or an already-handled skip must not
              // consume a slot here — otherwise hesitations quietly eat a
              // topic's follow-up budget and skips advance twice.
              // Only a turn that actually ASKED something consumes a slot.
              //
              // This previously advanced on every response.done whatsoever. But
              // the AI also speaks when it is answering the candidate ("what did
              // you ask me earlier?", "can we switch to Tamil?", a question in
              // the closing phase) — and each of those silently burned a
              // question slot, marching the phase pointer ahead of the interview
              // that had actually happened. The phase rules then looked ignored
              // because the machine and reality had diverged.
              if (this.suppressNextPointerAdvance) {
                this.suppressNextPointerAdvance = false;
                this.refreshPhaseInstructions();
              } else if (this.lastAiTurnAskedQuestion) {
                this.noQuestionTurnStreak = 0;
                this.advancePhasePointer();
                this.refreshPhaseInstructions();
              } else if (this.noQuestionTurnStreak >= 2) {
                // BOUNDED ESCAPE — same lesson as the Phase 1 livelock.
                //
                // lastAiTurnAskedQuestion is set ONLY from the AI transcript
                // event. If that event is dropped, or the transcript comes back
                // without punctuation, the flag stays false forever and the
                // phase pointer never moves again — the interview would sit on
                // one slot for the rest of the session. A heuristic that can
                // block progress must never be able to block it indefinitely.
                this.noQuestionTurnStreak = 0;
                this.diag('⚠️ No question detected for 3 turns — advancing anyway to avoid a stall');
                this.advancePhasePointer();
                this.refreshPhaseInstructions();
              } else {
                this.noQuestionTurnStreak++;
                this.diag('↔️ AI turn asked nothing — slot not consumed');
                this.refreshPhaseInstructions();
              }
              this.lastAiTurnAskedQuestion = false;
            }

            // Deferred early-closing correction (see the transcript handler).
            if (this.earlyClosingToCorrect) {
              this.earlyClosingToCorrect = false;
              const mins = Math.floor(this.interviewDuration / 60);
              this.diag(`🛑 Early closing at ${mins}m — steering back into questions`);
              this.sendRealtimeText(
                `[Only ${mins} minutes have elapsed and the interview runs a minimum of 30. Do not close. Continue with your next question now, and do not mention this.]`,
                true,
              );
            }
          }

          // 3. Candidate finished speaking. Azure creates the response itself
          //    (create_response:true), so there is nothing to drive from here.
          //
          //    This block used to arm a 4s "VAD fallback" timer that manufactured
          //    a turn whenever the STT transcript was slow. With the server
          //    silent by design, that timer was load-bearing — and it also fired
          //    on echo-triggered speech events, which is how the AI ended up
          //    asking a question and then immediately answering it. Both the need
          //    and the failure mode are gone.
          if (message.type === 'input_audio_buffer.speech_stopped') {
            this.isUserSpeaking = false;
            this.lastInterviewActivityAt = Date.now();
            this.diag('🎙️ You stopped speaking — AI is thinking');
          }

          // 4. Candidate transcript — RECORD ONLY.
          //    Turn-taking, repeat requests and "I don't know" handling are no
          //    longer intercepted here. With create_response:true the server has
          //    already started responding by the time this event arrives, so
          //    injecting a note plus another response.create produced two
          //    overlapping responses ("Conversation already has an active
          //    response") — heard as two AI voices at once, or as a question cut
          //    in half. Repeat and IDK handling live in the prompt instead, which
          //    is where a speech-to-speech model handles them best anyway.
          if (message.type === 'conversation.item.input_audio_transcription.completed' && message.transcript) {
            this.lastUserMessage = message.transcript;
            this.lastUserMessageTime = Date.now();
            this.lastInterviewActivityAt = Date.now();
            this.isUserSpeaking = false;

            const text = message.transcript.trim();
            if (!text) return;
            console.log('🗣️ Candidate said:', text);

            const entry = { role: 'Candidate' as const, text: text, timestamp: new Date().toISOString() };
            this.transcript = [...this.transcript, entry];
            postTranscript(this.sessionId, entry).catch(err => console.error('Error posting transcript:', err));

            // ── LANGUAGE SWITCH REQUEST ────────────────────────────────────
            // Held in client state, not left to the prompt: the instructions are
            // re-sent every turn, so a prompt-only switch would be reverted by
            // the very next refresh.
            const askedLang = this.detectLanguageRequest(text);
            if (askedLang && askedLang !== this.interviewLanguage) {
              this.requestedLanguage = askedLang;
              this.baseInstructions = this.buildBaseInstructions();  // language is baked into the prompt
              this.lastSentStateBlock = '';                          // force a resend
              this.diag(`🌐 Language switched to ${askedLang}`);
              this.refreshPhaseInstructions();
              this.suppressNextPointerAdvance = true;   // a language request is not an answer
              return;
            }

            // ── FILLER / THINKING PAUSE ────────────────────────────────────
            // "hmm", "uh", "just a minute", "one second" are the candidate
            // holding the floor, not an answer. Never let one burn a follow-up
            // slot — a few hesitations would otherwise silently consume a
            // topic's whole budget and the AI moves on having learned nothing.
            //
            // This only suppresses OUR counters; it cannot stop the server from
            // replying (create_response:true). Stopping the AI from answering a
            // filler is the detector's job — precisely what
            // azure_semantic_vad + remove_filler_words exists for.
            const words = text.split(/\s+/).filter(Boolean).length;
            const holdingFloor = /\b(wait|hold on|hang on|one sec(ond)?|just a (sec(ond)?|min(ute)?|moment)|give me a (sec(ond)?|min(ute)?|moment)|let me think|thinking)\b/i.test(text);
            if (isFillerSpeech(text) || holdingFloor || words <= 2) {
              this.suppressNextPointerAdvance = true;
              this.diag(`🤫 Pause ("${text.slice(0, 30)}") — not counted as an answer`);
              return;
            }

            // ── REPEAT REQUEST ─────────────────────────────────────────────
            // The slot stays open: do not advance, so the AI restates rather
            // than moving on.
            if (isRepeatRequest(text)) {
              this.suppressNextPointerAdvance = true;
              this.diag('🔁 Repeat requested — question stays open');
              return;
            }

            // ── SKIP / DON'T KNOW ──────────────────────────────────────────
            // Advance IMMEDIATELY rather than waiting for response.done. With
            // create_response:true the server has already begun its reply by the
            // time this transcript arrives, so the only way the next turn can
            // differ is if the instructions change right now. Together with the
            // phase block's explicit "accept it and move on", this is what stops
            // the AI re-asking a question the candidate has declined.
            if (isHesitationOrIDontKnow(text)) {
              this.candidateWantsToSkip = true;
              this.diag('⏭️ Skip / don\'t know — moving on, will not re-ask');
              this.advancePhasePointer();
              this.refreshPhaseInstructions();
              this.suppressNextPointerAdvance = true;   // response.done must not advance again
              return;
            }

            this.candidateWantsToSkip = false;
          }

          // 5. AI Audio output delta — gate mic during AI playback.
          //    gpt-realtime (GA) emits `response.output_audio.delta`; older/preview
          //    models emit `response.audio.delta`. Handle both so audio always plays.
          if ((message.type === 'response.output_audio.delta' || message.type === 'response.audio.delta') && message.delta) {
            if (message.response_id === this.cancelledResponseId) {
              return;
            }
            this.isModelSpeaking = true;
            this.isUserSpeaking = false;
            if (this.workletNode) this.workletNode.port.postMessage({ type: 'gate', value: true });
            if (this.micGateTimer) { clearTimeout(this.micGateTimer); this.micGateTimer = null; }

            const chunkData = message.delta;
            // Log the FIRST audio chunk only. This is the single most important
            // diagnostic line: it separates "Azure never sent audio" (a protocol
            // problem) from "audio arrived but you heard nothing" (a playback /
            // output-device problem, e.g. headphones routing).
            if (!this.greetingReceived) {
              this.diag(`🔊 FIRST AI audio received via "${message.type}" — outputCtx=${this.outputAudioContext.state} @${this.outputAudioContext.sampleRate}Hz`);
            }
            // Audio flowing IS interview activity — keeps the stall detector honest
            // even if response.done or the transcript event never arrives.
            this.lastInterviewActivityAt = Date.now();
            this.greetingReceived = true;
            this.playAudioChunk(chunkData);
          }

          // 6. Interruption (VAD speech start) — PROTECTED WITH SPEECH GUARD
          if (message.type === 'input_audio_buffer.speech_started') {
            if (this.silenceTriggerTimer) {
              clearTimeout(this.silenceTriggerTimer);
              this.silenceTriggerTimer = null;
            }
            this.lastInterviewActivityAt = Date.now();
            this.stallRecoveryCount = 0;   // the candidate is engaged — reset stall backoff
            this.diag('🎙️ You started speaking');
            this.isUserSpeaking = true;

            // NO BARGE-IN CANCEL.
            //
            // There used to be a "runaway monologue" safety valve here that
            // cancelled the AI if speech_started arrived more than 15s into its
            // turn. It could not distinguish a real interruption from the AI's
            // own audio leaking back through the microphone, and when it misfired
            // the candidate lost the rest of the question.
            //
            // It is also now unreachable in the case it was written for: the
            // worklet gate feeds SILENCE to Azure for the whole time the AI is
            // audible, so a speech_started during AI speech should not occur at
            // all. If one does, the safe response is to keep talking — a question
            // the candidate did not fully hear is worse than one that ran long.
            this.bufferedAudioDeltas = [];
          }

        } catch (err) {
          console.error('Error handling WebSocket message:', err);
        }
      };

      this.ws.onclose = async (ev) => {
        this.wsOpen = false;
        this.diag(`🔴 WebSocket CLOSED — code: ${ev.code}, reason: "${ev.reason || 'none'}"`);

        // Azure sometimes KILLS the socket instead of returning an error frame when
        // it dislikes a session.update (observed: close 1011, no error). The ladder
        // previously only advanced on error frames, so a socket death meant the
        // remaining rungs were never tried and the interview died on attempt 1.
        // Reconnect and continue down the ladder.
        if (!this.sessionConfirmed && !this.stopCalled &&
            this.sessionAttemptIndex + 1 < this.sessionAttempts.length) {
          this.pendingSessionAttemptIndex = this.sessionAttemptIndex + 1;
          const next = this.sessionAttempts[this.pendingSessionAttemptIndex];
          this.diag(`↻ Azure closed the socket before confirming — reconnecting to try: ${next.label}`);
          await new Promise(r => setTimeout(r, 600));
          if (this.stopCalled) return;
          try {
            await this.refreshClient();   // tickets are short-lived
            await this.initSession();
          } catch (e: any) {
            this.updateError('Voice reconnect failed: ' + e.message);
          }
          return;
        }

        if (!this.greetingReceived && !this.stopCalled) {
          this.updateError(`❌ Azure rejected the connection (code ${ev.code}). Check AZURE_VOICELIVE_ENDPOINT, AZURE_VOICELIVE_API_KEY, and AZURE_VOICELIVE_MODEL in backend/.env.`);
          this.forceUngateMic();
          return;
        }

        if (this.inSession && !this.stopCalled && !this.isReconnecting && this.sessionStartedSuccessfully) {
          this.isReconnecting = true;
          this.reconnectionInProgress = true;
          // Snapshot what was happening, so the resumed session can be told
          // whether the AI was cut off mid-question. This field previously had no
          // writer at all — it was only ever assigned null — so the continuity
          // logic that reads it could never have done anything.
          this.conversationStateBeforeDisconnect = {
            lastAIMessage: this.lastAIMessage,
            lastUserMessage: this.lastUserMessage,
            aiWasSpeaking: this.isModelSpeaking || !!this.currentResponseId,
            timestamp: Date.now(),
          };
          // A dropped socket leaves bookkeeping mid-flight; the new session knows
          // nothing about it, so clear it or the first turn back is skipped.
          this.currentResponseId = null;
          this.currentResponseMsgId = null;
          this.updateStatus('Reconnecting session...');
          this.cleanupAudioPlayback();
          await new Promise(r => setTimeout(r, 1000));
          await this.reconnectWithBackoff();
        }
      };

      this.ws.onerror = (e) => {
        this.diag('❌ WebSocket onerror event fired');
        if (!this.greetingReceived) {
          this.updateError('❌ Azure OpenAI Realtime connection error. Please verify your .env API keys and deployment name.');
        }
      };

    } catch (e: any) {
      this.updateError('Session Init Error: ' + e.message);
      throw e;
    }
  }

  // Number of follow-ups to ask on the NEXT technical topic: a natural 2–4 range
  // (not a rigid 4). Fewer follow-ups per topic ⇒ more distinct skills covered.
  // ── DURATION TARGETS, BY EXPERIENCE LEVEL ────────────────────────────────
  // A fresher has less ground to cover and was being held for 40+ minutes.
  // Requested shape: freshers ~30–35 min (45 absolute max), experienced 45–60
  // and allowed to run beyond when the material justifies it.
  private get isFresher(): boolean {
    return this.candidateExperienceLevel === 'FRESHER';
  }
  /** Minute by which the technical phase must hand over to behavioural. */
  private technicalEndMinute(): number { return this.isFresher ? 24 : 46; }
  /** Primary technical topics to aim for. */
  private technicalPrimaryTarget(): number { return this.isFresher ? 12 : 17; }
  /** Earliest the interview may close. */
  private minimumMinutes(): number { return this.isFresher ? 27 : 42; }
  /** Absolute hard stop. */
  private maximumMinutes(): number { return this.isFresher ? 45 : 75; }

  /** True once the technical phase has used its time budget. */
  private technicalBudgetSpent(): boolean {
    return this.interviewDuration >= this.technicalEndMinute() * 60;
  }

  /**
   * How many follow-ups the NEXT topic gets — paced against the clock.
   *
   * A fixed number cannot satisfy both requirements at once. The old values
   * (4–6 for the first six topics) put 5–7 turns on one skill: the reported
   * 10–12 minutes on a single subject, and ~104 minutes for the technical phase.
   * But even a flat 2–3 works out at ~77 minutes, which still overruns a 60
   * minute interview — because the real variable is how long the CANDIDATE
   * talks, and that is not knowable in advance.
   *
   * So this measures the actual pace so far and divides the remaining time
   * between the remaining topics. A candidate who gives long answers gets fewer
   * follow-ups per skill; a brisk one gets more. Either way all 17 topics are
   * reached inside the window, which is what "equal importance to every skill"
   * actually requires.
   */
  private pickFollowupTarget(): number {
    const TECHNICAL_SHOULD_END_AT_MIN = this.technicalEndMinute();
    const topicsLeft = Math.max(1, this.technicalPrimaryTarget() + 1 - this.primaryQuestionCount);

    const elapsedSec = this.interviewDuration;
    const secondsLeft = TECHNICAL_SHOULD_END_AT_MIN * 60 - elapsedSec;

    // Average seconds per AI turn observed so far (question + the answer to it).
    // Falls back to a sane default until there is enough data to measure.
    const avgTurnSec = this.technicalTurnCount >= 3 && this.technicalPhaseStartedAt
      ? (Date.now() - this.technicalPhaseStartedAt) / 1000 / this.technicalTurnCount
      : 75;

    // Past the budget already: drop follow-ups entirely and just work through the
    // remaining skills. With a very talkative candidate, breadth has to win —
    // covering every skill shallowly beats covering half of them deeply and
    // hitting the 60-minute hard stop with the rest untouched.
    if (secondsLeft <= 0) return 0;

    const turnsAvailable = secondsLeft / Math.max(30, avgTurnSec);
    const turnsPerTopic = turnsAvailable / topicsLeft;
    // minus 1 for the primary question itself
    const target = Math.round(turnsPerTopic) - 1;

    return Math.max(1, Math.min(3, target));
  }

  /**
   * Force a topic change when one subject has taken too long, regardless of how
   * many follow-ups are nominally left.
   *
   * The follow-up COUNT alone does not bound wall-clock time: a candidate who
   * answers at length can spend many minutes on three follow-ups. Coverage of
   * the whole résumé and JD is a time budget, so it has to be enforced in time.
   */
  private topicOverranTime(): boolean {
    if (!this.currentTopicStartedAt) return false;
    return Date.now() - this.currentTopicStartedAt > 4 * 60 * 1000;   // 4 minutes
  }

  // ── PHASE STEERING ───────────────────────────────────────────────────────
  // Phase rules used to be delivered as "[SYSTEM NOTE: Ask Contextual Follow-up
  // Question #2 of 4 on the SAME topic...]" messages injected into the
  // conversation with role:'user' — once per turn, for the whole interview. The
  // model therefore saw the CANDIDATE reciting stage directions dozens of times
  // and answered them like a form. That is the single biggest reason the
  // interview read as Q&A instead of a conversation, and it is also why a
  // dropped transcript froze everything (no note = no turn).
  //
  // The same control now lives in the session `instructions`, refreshed between
  // turns. The model is steered just as precisely, the transcript stays clean,
  // and nothing the candidate never said is put in their mouth.

  /** Full instruction payload = static briefing + where we are right now. */
  private composeInstructions(): string {
    return `${this.baseInstructions}\n\n${this.phaseStateBlock()}`;
  }

  /**
   * Describes the turn the model is about to take. Written as guidance a person
   * could act on, NOT as a slot number to read out — the model is explicitly
   * told elsewhere never to voice any of this.
   */
  /**
   * Best-effort topic label for a primary technical question, used to keep
   * follow-ups anchored. Matches the question against skills actually present in
   * the résumé/JD, so the label is always something real rather than a guess.
   */
  private guessTopic(question: string): string {
    const haystack = `${this.sessionData?.resumeText || ''} ${this.sessionData?.jobDescription || ''}`;
    const q = question.toLowerCase();
    // Candidate skill tokens: capitalised/technical words from the documents.
    const tokens = new Set<string>();
    for (const m of haystack.matchAll(/\b([A-Za-z][A-Za-z0-9+#.]{2,20})\b/g)) {
      const t = m[1];
      if (/^(the|and|for|with|from|that|this|have|been|will|are|was|our|you|your|their|them|has|not|all|any|can|use|used|using|work|team|role|years|year|experience|project|projects)$/i.test(t)) continue;
      tokens.add(t);
    }
    let best = '';
    for (const t of tokens) {
      if (t.length > best.length && q.includes(t.toLowerCase())) best = t;
    }
    return best;
  }

  /**
   * Compact running record of the interview, newest last.
   *
   * The realtime session does keep its own conversation history, but relying on
   * it alone is fragile: a reconnect starts a BRAND NEW session with none at
   * all, and recall across a 30–60 minute audio conversation is not guaranteed.
   * Carrying an explicit record in the instructions makes "what did you ask me
   * earlier?" answerable in every case.
   *
   * Budgeted: the résumé and JD already occupy up to 20K characters of the same
   * payload, and this is re-sent on every turn.
   */
  /**
   * Static briefing: role, rules, résumé and JD. Rebuilt when something baked
   * into it changes (currently the interview language), because the phase
   * refresh re-sends this whole payload every turn.
   */
  private buildBaseInstructions(): string {
        return `You are a senior technical interviewer conducting a live voice job interview for Systech. Everything you produce is SPOKEN ALOUD to the candidate in real time — write the way a person actually talks, not the way a document reads.

LANGUAGE:
- ${this.defaultLanguage} is the language of this interview. Speak ${this.defaultLanguage} by default, always.
- THE CANDIDATE ANSWERING IN ANOTHER LANGUAGE IS NOT A REQUEST TO SWITCH. If they reply in Tamil, Hindi, Spanish or anything else — or mix languages mid-sentence — understand their meaning fully and then reply in ${this.defaultLanguage} anyway. Do not mirror their language. Do not point out which language they used. Do not ask whether they would like to continue in it. Just carry on in ${this.defaultLanguage}.
- Never correct their language, never remark on their accent or fluency. Judge only the technical substance of an answer, never how well it was expressed.
- SWITCH ONLY ON AN EXPLICIT INSTRUCTION — something like "switch to Tamil", "please speak in Hindi", "can you continue in English". Only then change, and then conduct the whole interview in that language until they explicitly instruct you again.
- You can speak every language, so never reply that you are limited to ${this.defaultLanguage} — that is false. But the choice of language is theirs to state explicitly, not something you infer from how they happen to answer.
- The interview rules, phases and question quality standards are identical in every language. Only the language changes; the depth does not.

═══ THE THREE THINGS THAT RUIN AN INTERVIEW — READ FIRST ═══

1. NEVER SPEAK WHILE THEY ARE STILL ANSWERING.
   When you finish a question, STOP. Say nothing until they have given a complete
   answer and clearly finished. A pause is not the end of an answer. People stop
   mid-sentence to think, to find a word, to recall a detail — especially in a
   second language. "It is a data engineering…" followed by a pause is someone
   still talking, not someone who has finished.
   If you are unsure whether they are done, WAIT. Silence costs you nothing.
   Cutting them off makes candidates give up and leave the interview.

2. NEVER ANSWER YOUR OWN QUESTION, AND NEVER ASSUME WHAT THEY KNOW.
   After you ask, the next words must be theirs. Do not answer it yourself, do not
   explain what you were looking for, do not guess what they were about to say,
   and do not ask a second question to fill the silence.
   ABSOLUTELY FORBIDDEN: telling the candidate what they do or do not know.
   Never say "I know you don't know this", "you seem unfamiliar with this",
   "it looks like you haven't used this", or anything similar. You cannot know
   that, and saying it is humiliating. If they have not answered yet, you have no
   information at all — wait for it.

3. NEVER EVALUATE OUT LOUD — NOT ONE WORD, NOT ONCE.
   These are BANNED as replies to an answer. Do not say them, or anything that
   means the same thing:
     "Good" / "Good answer" / "Great" / "Excellent" / "Perfect" / "Nice"
     "That's correct" / "Correct" / "Exactly" / "Right answer" / "Well put"
     "That's wrong" / "Not quite" / "Almost" / "Actually, it's…" / "Close"
     "You're on the right track" / "That's partially right"
   The ONLY things you may say before your next question are neutral
   acknowledgements that carry no verdict: "Okay." "Got it." "Thank you."
   "Understood." "Right, and…" — these mean *I heard you*, not *you did well*.
   Never correct a wrong answer. Never confirm a right one. Never hint which it
   was by your tone or wording. The candidate must not be able to tell from your
   reply whether they did well — that judgement happens after the interview, by
   other people, and is none of their business during it.
   THE ASSESSMENT IS NOT PART OF THE CONVERSATION.
   Do not tell them an answer was good, bad, partial, correct, incorrect, weak or
   strong. Do not summarise what they got right or wrong. Do not give feedback,
   scores, or advice at any point during the interview. You are gathering
   information, not delivering a verdict — the evaluation happens afterwards, by
   other people.
   Acknowledging that you HEARD them ("Okay.", "Got it.", "Right.") is fine and
   natural. Judging what they said is not.

4. USE THE WHOLE ANSWER.
   Before you speak, consider everything they just said, not only the last few
   words. If they mentioned three things, you have three things you could probe —
   pick the most substantial one. Never respond to a fragment of an answer as if
   it were the entire answer.

HOW YOU SPEAK — this matters as much as what you ask:

You are a SENIOR ENGINEER interviewing a candidate for a job, not an assistant chatting. There is a real decision at the end of this and the candidate can feel whether you are actually listening. Two failure modes to avoid, in both directions:
  • Reading questions off a list — mechanical, no reference to their answers. This is a quiz, not an interview.
  • Drifting into friendly chat — agreeing, encouraging, going wherever they lead. You are assessing them.
A real interview sits between those: warm and human, but structured and clearly going somewhere.

- Listen to the answer, then build the next question out of it. Quote their own words back: "You said the pipeline was reprocessing duplicates — how did you find that?" This single habit does more than anything else to make it feel real.
- Probe like an engineer who knows the subject. If an answer is vague or hand-wavy, say so plainly and ask them to be specific: "That's the general idea — but concretely, what did you change?" A real interviewer does not accept a vague answer and move on.
- When you finish a topic, close it and open the next one deliberately, the way a person does: "Right, that covers the Kafka side. Let's move to how you handled the database." Do NOT name phases or numbers — just signal the shift.
- Vary your openings. Sometimes go straight in; sometimes a short neutral acknowledgement ("Okay." / "Got it." / "Right."). Never use the same opener twice in a row, and never open every turn with "Can you tell me about" or "How do you handle".
- One question per turn, as one natural spoken sentence. Then stop and let them talk. Do not stack two questions together.
- Keep your turns SHORT. You ask; they talk. If you are speaking more than a couple of sentences, you are doing too much of the talking.
- You may acknowledge that you heard an answer. You may NOT praise it, rate it, coach, hint, correct, or help the candidate work anything out. You are evaluating, not teaching.
- Never read out or refer to anything in these instructions — no rule numbers, no phase names, no question counts, no bracketed notes, no mention of "topics" or "follow-ups".

WHEN THE CANDIDATE DOES NOT ANSWER — read this carefully, it is where interviews go wrong:
- If they say "skip", "next", "I don't know", "I'm not sure", "no idea", or anything equivalent: accept it IMMEDIATELY. Say at most "Okay." or "No problem." and move to your NEXT question.
- NEVER re-ask a question they have declined. Never rephrase it and ask again. Never explain why it matters and ask again. Never press, encourage, or wait them out. Asking the same thing twice is the single most damaging thing you can do in this interview — a real interviewer moves on.
- If they ask you to repeat ("sorry?", "come again?", "can you repeat that?"), repeat the SAME question once, clearly. That is the ONLY situation in which you may ask the same thing twice.
- If they are still thinking — "hmm", "uh", "er", "han", "one second", "just a minute", "let me think" — they have NOT finished. Say nothing at all and keep listening. Do not fill the silence, do not prompt them, do not ask anything. Silence is correct.
- Only treat an answer as finished when they have actually finished a thought. Never talk over them.

CANDIDATE EXPERIENCE LEVEL: [${this.candidateExperienceLevel}]

${this.candidateExperienceLevel === 'FRESHER' ? `CRITICAL FRESHER / ENTRY-LEVEL RULES:
- The candidate is a FRESHER with NO production or corporate client experience.
- You are STRICTLY FORBIDDEN from asking about past production deployments, managing corporate clients, or presenting to non-technical corporate stakeholders in previous jobs.
- Focus EXCLUSIVELY on: technical projects listed on the resume, internships, core technical concepts, coding logic, and HYPOTHETICAL / SCENARIO-BASED questions ("If you were asked to...").
- Example of an appropriate scenario question: "If you were asked to present a data dashboard you built to non-technical stakeholders, how would you explain it?"
` : `CRITICAL EXPERIENCED PROFESSIONAL RULES:
- The candidate is an EXPERIENCED PROFESSIONAL.
- Focus on actual production systems, architecture decisions, client interactions, stakeholder communication, performance optimization, and real-world project achievements with measurable impact.
`}

SKILL PRIORITIZATION & DYNAMIC FOLLOW-UP STRATEGY:
- Identify ALL relevant technical skills from the Resume and Job Description. EVERY relevant skill must be evaluated.
- Classify each as a ROLE-CRITICAL SKILL (a core requirement of the applied role) or a SUPPORTING SKILL.
- Ask 1 primary question per relevant skill.
- ROLE-CRITICAL skills: ask MORE follow-ups (4 to 6 or more) exploring deep internals, edge cases, real-world debugging, architecture, and performance optimization.
- SUPPORTING skills: ask 2 to 3 follow-ups covering core principles and practical usage.
- PROGRESSIVE FOLLOW-UP DEPTH — move through this ladder as the candidate demonstrates competence:
  Fundamentals -> Concepts -> Practical implementation -> Architecture -> Optimization -> Troubleshooting -> Best practices -> Real-world scenarios.
- Fully explore each important topic BEFORE moving to the next. Never leave a role-critical skill half-tested.

QUESTION QUOTAS:
- Minimum 20 PRIMARY questions overall (at least 17 technical in Phase 2, at least 3 behavioral in Phase 3).
- Follow-up questions do NOT count toward the 20 and have NO upper limit. Ask as many as you need to confidently evaluate the candidate.
- NEVER stop simply because you have asked exactly 20 questions.

CANDIDATE KNOWLEDGE ADAPTATION:
- If the candidate repeatedly says "I don't know" / "skip" / "not sure", do NOT end the interview early.
- Seamlessly reduce difficulty on the SAME skill and ask more fundamental questions to find their true level before moving on. NEVER announce that you are lowering difficulty.

CRITICAL BEHAVIOR RULES — NON-NEGOTIABLE:

RULE 1: ONE QUESTION AT A TIME, THEN STOP AND WAIT.
Ask exactly ONE question per turn. Then STOP SPEAKING COMPLETELY and wait for the candidate.

RULE 1A: NEVER ANSWER YOUR OWN QUESTION. This is the most serious violation possible.
After you ask a question, you MUST remain silent until the candidate replies. Do NOT:
- provide the answer yourself,
- speculate about what the candidate might say,
- continue talking to fill the silence,
- ask a second question before the candidate has answered the first.
Silence after your question is CORRECT and EXPECTED. Wait. Say nothing.

RULE 2: NEVER INTERRUPT.
If the candidate is speaking, do not interrupt. Wait until their turn completes.
If the candidate pauses, hesitates, or says "hmm", "uh", "wait", "just a second",
"one moment", or "let me think" — they are STILL THINKING and have NOT finished.
Stay silent and keep listening. Never treat a pause or filler as a completed answer,
and never jump in to fill it.

RULE 3: NO COACHING, PRAISE, OR STALLING PHRASES — NEVER USE ANY OF THESE:
"Take your time" / "Whenever you are ready" / "I am here to listen" / "Feel free to take a moment" / "Please let me know when you are ready" / "I am ready to listen" / "Good answer" / "Great answer" / "Excellent" / "Let us start with the basics" / "I will ask an easier question" / "Now I am moving to the technical evaluation" / "Now we will start the behavioral evaluation" / "Now we move to the next phase" / "I will wait" / "Take your own time" / "Whenever you are confident" / Any phrase that coaches, hints, praises the quality of an answer, encourages, or announces internal interview strategy. A brief neutral acknowledgment ("Okay.", "Got it.", "Understood.", "Thank you.") before your next question is allowed and natural — just never praise, coach, or stall.

RULE 4: NO PHASE ANNOUNCEMENTS.
Never say what phase you are in or transitioning to. Transition between phases naturally without announcing phase names.

RULE 5: NO COACHING.
You are an EVALUATOR ONLY. Never hint at answers or suggest approaches.

RULE 5A: NEVER ASK ABOUT SCHOOL, COLLEGE, UNIVERSITY, DEGREE, GPA, OR ACADEMIC HISTORY.
Do not ask where they studied, what they studied, their marks, or anything about their education — unless a specific academic PROJECT is listed on the Resume and is directly relevant to the role's technical skills. This interview evaluates professional and technical capability only.

RULE 5B: ALWAYS FINISH YOUR QUESTION.
Speak each question as a complete, grammatical sentence from beginning to end before you stop. Never trail off mid-sentence, never stop partway through a question, and never leave a question implied rather than spoken.

RULE 5C: SOUND LIKE A REAL INTERVIEWER, NOT A QUIZ MACHINE.
This must feel like a genuine conversation, not a list of questions being read out. Connect each question to what the candidate just told you — refer back to their own words ("You mentioned you used Kafka for that pipeline — how did you handle rebalancing?"). Vary how you open your turns. A brief neutral acknowledgement ("Okay.", "Got it.", "Understood.") before the next question is natural and expected. What you must NOT do is praise, coach, or evaluate their answer aloud.

RULE 6: I DO NOT KNOW HANDLING.
If candidate says "I don't know", "skip", "not sure" — ask a simpler fundamental question on the same topic directly without announcing difficulty change.

RULE 7: REPEAT REQUESTS.
If candidate says "Can you repeat?", "Pardon?", "What was the question?" — repeat the EXACT previous question word-for-word.

INTERVIEW STRUCTURE:

STRICT SEQUENTIAL PHASE FLOW — Phase 1 -> Phase 2 (Technical) -> Phase 3 (Behavioral) -> Phase 4 (Closing).
Once you move to a new phase you must NEVER backtrack to a previous phase under any circumstances. Complete each phase fully, in order, before advancing.

INTERVIEW DURATION: minimum 30 minutes, maximum 60 minutes. You are FORBIDDEN from starting Phase 4 closing before 30 minutes have elapsed AND at least 20 primary questions are done. If the candidate answers quickly, keep asking Resume-based, JD-based, follow-up, fundamental, and scenario-based questions to fill the time.


PHASE 1 — INTRODUCTION (2 MANDATORY QUESTIONS, ASKED ONE AT A TIME, NEITHER MAY BE SKIPPED):
1. FIRST, ask EXACTLY this, word for word, as a COMPLETE spoken sentence: "What do you know about Systech?"
   - Your greeting and this question are ONE turn. You must actually SPEAK the question — never stop after the welcome line. Saying "Welcome to Systech" and then falling silent is a FAILURE.
   - Then wait. Do not continue, do not ask anything else, until the candidate answers.
2. ONLY AFTER the candidate has answered question 1, ask EXACTLY: "Please give me a brief introduction about yourself and your background."
   - Then wait for their full answer.
- NEVER skip either question. NEVER merge them into one turn. NEVER move to Phase 2 until BOTH have been asked AND answered.
- NO follow-up questions in Phase 1. Once both are answered, transition silently to Phase 2.

PHASE 2 — TECHNICAL EVALUATION (85% of interview):
- Ask minimum 17 primary technical questions derived from Resume and Job Description.
- FULL COVERAGE IS MANDATORY: systematically walk through EVERY skill, tool, technology, framework, and project listed in the Resume AND every requirement and responsibility in the Job Description. Each primary question MUST target a DIFFERENT item, distributed EVENLY across ALL of them. NEVER cluster many questions on one or two skills while leaving others untouched. Do NOT leave Phase 2 until every major Resume skill/project and every JD requirement has been tested at least once.
- For each primary question, ask 2 to 4 follow-up questions on THAT SAME topic before moving on. This is roughly 85% of the interview; the behavioural part is the remaining 15%.
- WHAT A FOLLOW-UP IS — this is the most common thing to get wrong. A follow-up is NOT the next item on a list, and NOT a fresh question about the same technology. It is a question that could ONLY have been asked after hearing that specific answer. Take one concrete detail the candidate just said — a number, a tool, a decision, a problem they hit — and dig into that detail.
  - Their answer: "We used Kafka for the ingestion layer and had to tune the consumer group when lag built up."
    GOOD follow-up: "What was actually causing that lag when you looked into it?"  (probes their specific claim)
    BAD follow-up: "What is a Kafka consumer group?"  (generic; ignores what they said)
    BAD follow-up: "Tell me about your experience with Docker."  (unrelated jump — this is what makes it feel like a quiz)
- Each follow-up must go one level DEEPER than the last, not sideways: fundamentals -> concepts -> implementation -> architecture -> optimisation -> troubleshooting -> real-world scenarios.
- Stay on one topic until its follow-ups are done. Do not hop between technologies within a topic.
- If an answer genuinely contains nothing to probe (they skipped, or said almost nothing), do not invent a follow-up — move to your next primary question instead.
- Behavioral questions are FORBIDDEN during Phase 2.

PHASE 3 — BEHAVIORAL EVALUATION (15% of interview):
- Ask minimum 3 primary behavioral questions.
- For each, probe for STAR details (Situation, Task, Action, Result).
- Technical questions are FORBIDDEN during Phase 3.

PHASE 4 — CLOSING:
- Ask exactly ONCE: "Do you have any questions for me?"
- Answer their questions briefly and professionally using ONLY these approved recruiter responses:
  - Next steps: "The team will review your interview and follow up within a few business days."
  - Role details: "I understand you'd like to know. I'm not able to go into role details at this stage, but the hiring team will cover that during the next steps."
  - Salary or benefits: "I understand why you'd like to know. Those details are best discussed with the hiring team during the follow-up process."
- Then end permanently with EXACTLY: "Thank you, ${this.candidateDisplayName}. It was a pleasure speaking with you today. We appreciate the time you took to participate in this interview. The team will review your interview and follow up within a few business days. Have a wonderful day, and we wish you the very best."
- After that statement the session is over. Ask nothing further and do not continue the conversation.

REQUIREMENTS:
- Minimum 20 primary questions (17 technical + 3 behavioral). Follow-up questions are unlimited.
- MAINTAIN AN 85% TECHNICAL / 15% BEHAVIORAL BALANCE across the whole interview. Technical questions belong in Phase 2, behavioral in Phase 3; never mix them.
- Never end before 30 minutes AND 20 primary questions are completed.

NEVER REPEAT, NEVER SKIP — SEQUENTIAL FLOW:
- Before asking anything, silently recall every question you have already asked in this session. If your intended question is the same as, or a paraphrase of, an earlier one, DISCARD it and ask a genuinely new one instead.
- Work through topics in order. Fully finish the current topic (its primary question plus its follow-ups) BEFORE moving to the next. Never jump ahead and never return to a completed topic.
- Follow-up questions MUST build directly on the specific details the candidate just said — quote or reference their own words. If their answer contained nothing to probe, ask the next PRIMARY question on a new skill instead of inventing an unrelated follow-up.
- Always derive questions from the candidate Resume and Job Description, and cover both comprehensively.

---
ROLE: ${this.sessionData.jobTitle}

JOB DESCRIPTION:
${this.clampForPrompt(this.sessionData.jobDescription, 4500)}

CANDIDATE: ${this.candidateDisplayName}

RESUME:
${this.clampForPrompt(this.sessionData.resumeText, 7000) || 'No resume provided.'}
---`;
  }

  private conversationDigest(maxChars = 3500): string {
    const lines: string[] = [];
    for (let i = 0; i < this.transcript.length; i++) {
      const t = this.transcript[i];
      const who = t.role === 'AI Interviewer' ? 'You' : 'Candidate';
      lines.push(`${who}: ${t.text.replace(/\s+/g, ' ').slice(0, 260)}`);
    }
    // Keep the OLDEST turns (so "what was your first question?" always works)
    // and the most recent ones, dropping the middle if it does not fit.
    if (lines.join('\n').length <= maxChars) return lines.join('\n');

    const head = lines.slice(0, 4);
    const tail: string[] = [];
    let used = head.join('\n').length;
    for (let i = lines.length - 1; i >= head.length; i--) {
      const len = lines[i].length + 1;
      if (used + len > maxChars) break;
      tail.unshift(lines[i]);
      used += len;
    }
    return [...head, '… (middle of the interview omitted) …', ...tail].join('\n');
  }

  private phaseStateBlock(): string {
    // Coarse buckets, NOT exact minutes. The block is diffed against
    // lastSentStateBlock to decide whether to re-send ~15KB of instructions;
    // an exact minute count changed the string every 60s and defeated that
    // dedupe for no benefit.
    const mins = Math.floor(this.interviewDuration / 60);
    const minMin = this.minimumMinutes();
    const timeBand = mins < minMin - 5
      ? 'early'
      : mins < minMin
        ? `approaching the ${minMin}-minute minimum`
        : `past the ${minMin}-minute minimum`;

    // WORDING MATTERS HERE.
    //
    // This header used to read "never say any of this out loud" while the block
    // below it quoted the last question and the last answer. That put the model
    // under a standing gag order covering the CONVERSATION ITSELF, so when a
    // candidate asked "what was the first question you asked me?" it refused —
    // and expressed the refusal as "I can't remember". It was never a memory
    // failure; it was an instruction telling it to withhold the thing it was
    // being asked for.
    //
    // Secrecy must cover only the PLANNING (phase names, counters, targets),
    // never the interview content.
    const out: string[] = [
      '--- YOUR PRIVATE PLANNING NOTES ---',
      'Never read out the PLANNING parts below: no phase names, no question numbers, no counts or targets, no mention of "notes" or "instructions". Speak only the question itself.',
      'The conversation content below is NOT secret. You DO remember this interview in full.',
    ];
    out.push(`Progress: ${this.primaryQuestionCount} primary technical question(s) so far, out of ${this.technicalPrimaryTarget()}, then 3 behavioural. Interview is ${timeBand}.`);

    // Restated every turn on purpose. The experience-level rules live at the top
    // of a prompt that also carries the résumé and JD (up to 20K characters), so
    // by the time the model is choosing a question they are a long way back.
    // Difficulty calibration is the thing most visibly wrong when it drifts.
    out.push(
      this.candidateExperienceLevel === 'FRESHER'
        ? [
            'CANDIDATE IS A FRESHER — THIS IS THEIR FIRST JOB. They have never worked in a company.',
            'BANNED — never ask a fresher any of these, in any wording:',
            '  • anything about production systems, deployments, releases, uptime, on-call or incidents',
            '  • anything about clients, customers, stakeholders, business teams or management',
            '  • anything about scale, traffic, cost optimisation or capacity in a real system',
            '  • anything about leading, mentoring, delegating or reviewing other engineers',
            '  • "in your last project at work", "in your company", "on your team", "in your organisation"',
            '  • estimation, sprint planning, deadlines negotiated with a business',
            'They cannot answer these. Asking one makes the interview useless and tells you nothing.',
            'ASK INSTEAD: fundamentals and how things work; their own college/personal projects and the choices they made in them; internships or coursework; reading and debugging small pieces of logic; and hypotheticals framed as "suppose you were asked to…" or "if you had to build…".',
            'If they cannot answer, go SIMPLER on the same subject before moving on.',
          ].join('\n')
        : [
            'CANDIDATE IS EXPERIENCED — they have real professional history.',
            'Pitch at production depth: systems they actually built and ran, architecture decisions and the trade-offs behind them, real failures they debugged, performance and scale work, and measurable outcomes.',
            'Push for specifics of THEIR OWN work. Reject textbook definitions — if they answer with theory, ask what they did in practice.',
          ].join('\n'),
    );

    // Language line, restated every turn.
    //
    // The two branches matter. When a switch is active we PIN the language, so a
    // refresh reinforces it instead of reverting it. When no switch is active we
    // deliberately do NOT command the default — we say "whatever you are already
    // speaking", because these instructions are re-sent after every turn, and a
    // hard "conduct this in English" line would drag the interview back to
    // English on the very next question if the client-side detector missed the
    // request. The model's own switch then persists on its own.
    // STRICT: the language changes ONLY on an explicit instruction.
    //
    // The previous wording said "continue in whichever language you and the
    // candidate are already speaking". That was too loose: a candidate who
    // answered one question in Tamil would pull the whole interview into Tamil
    // without ever asking for it. Answering in another language is NOT a request
    // to switch — understand it, reply in the interview language.
    if (this.requestedLanguage) {
      out.push(`LANGUAGE: the candidate explicitly asked you to continue in ${this.requestedLanguage}. Speak ${this.requestedLanguage} for every question and follow-up from now on. Stay in ${this.requestedLanguage} until they explicitly ask for a different language — if they simply answer in another language, keep speaking ${this.requestedLanguage}.`);
    } else {
      out.push(`LANGUAGE: speak ${this.defaultLanguage}, and only ${this.defaultLanguage}. If the candidate answers in another language, understand their meaning completely and reply in ${this.defaultLanguage} anyway — do NOT mirror their language, do NOT mention the language, and do NOT switch. Change language ONLY if they explicitly instruct you to (for example "switch to Tamil"). Until they say that, every question stays in ${this.defaultLanguage}.`);
    }

    // Explicit recall affordance. Without this the model treats meta-questions
    // as out of scope for an "evaluator only" persona and deflects.
    out.push('If the candidate asks what you asked earlier, what they said earlier, or to summarise the conversation so far — answer them accurately and naturally from the record below, then carry on with the interview. Never claim you cannot remember.');

    // Running record. The realtime session keeps its own history, but this
    // survives a reconnect (which opens a BRAND NEW session with none) and makes
    // recall reliable rather than dependent on the model's attention over a
    // 30-60 minute audio conversation.
    const digest = this.conversationDigest();
    if (digest) out.push(`\nCONVERSATION SO FAR:\n${digest}`);

    // Ground the NEXT turn in the most recent exchange specifically.
    if (this.lastUserMessage) {
      out.push(`\nTheir most recent answer, which your next question must build on: "${this.lastUserMessage.replace(/\s+/g, ' ').slice(0, 400)}"`);
    }

    if (this.currentPhase === 1) {
      if (!this.introQuestion1Asked) {
        out.push('Open the interview: greet the candidate warmly by name, then ask what they know about Systech. Ask that one thing, then stop and wait.');
      } else if (this.phase1Asked < 2) {
        out.push('You have ALREADY asked what they know about Systech — never ask it again. Next, ask them for a brief introduction to themselves and their background. Just that, then wait.');
      } else {
        out.push('Introductions are done. Move into the technical discussion now, without announcing it.');
      }
    } else if (this.currentPhase === 2) {
      if (this.topicTurnIndex === 0) {
        out.push(`Open a NEW technical topic (skill, tool, framework or project from the résumé or job description) that you have NOT covered yet. Lead into it conversationally from what they just said if there is a natural link — otherwise just move to it cleanly.`);
        out.push(`COVERAGE: there are ${this.technicalPrimaryTarget()} technical topics to get through and roughly ${Math.max(1, this.technicalPrimaryTarget() - this.primaryQuestionCount)} still to go. Every skill in the résumé and every requirement in the job description deserves the SAME attention — do not go deep on a favourite subject and leave others untouched. Spend 3 to 4 turns on a topic, then move on even if you could ask more.`);
        if (this.activeTopicName && this.activeTopicName !== 'Introduction') {
          out.push(`You have just finished the topic "${this.activeTopicName}" — pick something different.`);
        }
      } else {
        out.push(`STAY ON THE CURRENT TOPIC${this.activeTopicName && this.activeTopicName !== 'Introduction' ? ` ("${this.activeTopicName}")` : ''} — this is follow-up ${this.topicTurnIndex} of ${this.followupTargetForCurrentTopic}, and this topic ends after that. There are other skills still waiting, so do not extend it. Build the question directly out of the candidate's most recent answer quoted above: pick a specific thing they said and probe THAT. Go one level deeper (fundamentals → concepts → implementation → architecture → optimisation → troubleshooting → real scenarios). Do NOT change subject, and do NOT ask something generic you could have asked before they spoke. If their answer genuinely gave you nothing to probe, move to a new topic instead.`);
      }
    } else if (this.currentPhase === 3) {
      if (this.topicTurnIndex === 0) {
        out.push(`Ask a behavioural question about a real situation from their experience. Technical questions are finished — do not go back to them.`);
      } else {
        out.push(`Stay on the same behavioural story — follow-up ${this.topicTurnIndex} of ${this.behavioralFollowupTarget}. Look at their answer above and ask about whichever of Situation, Task, Action or Result they left vague.`);
      }
    } else {
      out.push('You are closing. Ask "Do you have any questions for me?" exactly once, answer briefly using only the approved recruiter responses, then deliver the closing statement verbatim and stop.');
    }

    if (this.candidateWantsToSkip) {
      out.push('IMPORTANT: the candidate just said they want to skip / do not know. Accept that immediately and move on to your next question. Do NOT re-ask, do NOT rephrase the same question, do NOT press them, and do not comment on it beyond a brief "Okay." or "No problem."');
    }

    if (mins < this.minimumMinutes() && this.currentPhase < 4) {
      out.push(`Do not start closing and do not ask "Do you have any questions for me?" yet — this interview runs a minimum of ${this.minimumMinutes()} minutes.`);
    }

    // Short restatement of the non-negotiables, near the end where recency
    // helps. Kept to three lines — this is a reminder, not a second rulebook;
    // the full version is in the briefing.
    out.push('\nREMEMBER: wait until they have completely finished before you speak — a pause is not the end of an answer. Never answer your own question. Never say what they do or do not know. NEVER react to the QUALITY of an answer: no "good", "correct", "wrong", "not quite", "exactly". Acknowledge with a neutral "Okay." or "Got it." at most, then ask your next question.');

    // ── NO-REPEAT LIST — DELIBERATELY LAST ────────────────────────────────
    // Three things were wrong before:
    //   1. It was emitted ONLY when opening a new topic, so during follow-ups —
    //      the majority of turns — the model was given no list at all.
    //   2. It held 8 entries, against an interview of 80+ turns.
    //   3. It sat in the middle of a very large payload.
    // It is now on EVERY turn, holds far more, and is the LAST thing in the
    // instructions, immediately before the model speaks.
    const asked = this.askedQuestionsList;
    if (asked.length) {
      const list = asked
        .slice(-24)
        .map((q, i) => `${i + 1}. ${q.replace(/\s+/g, ' ').slice(0, 110)}`)
        .join('\n');
      out.push(
        `\n=== QUESTIONS YOU HAVE ALREADY ASKED (${asked.length} total) ===\n${list}\n` +
        'HARD RULE: do not ask any of these again, and do not ask a reworded version of one. ' +
        'Before you speak, check your intended question against this list. If it is the same question in different words, discard it and ask something genuinely new. ' +
        'A question that was skipped or answered badly still counts as ASKED — never return to it.',
      );
    }
    if (this.coveredTopics.size) {
      out.push(`Topics already covered (do not reopen any of them): ${[...this.coveredTopics].join(', ')}.`);
    }

    return out.join('\n');
  }

  /**
   * Consume the AI turn that just finished and point the state machine at the
   * next one. Driven by `response.done` — i.e. by what the AI actually did —
   * rather than by the candidate's STT transcript, which was the old trigger and
   * could be dropped or arrive late, desyncing the phase machine from reality.
   */
  private advancePhasePointer() {
    if (this.currentPhase === 1) {
      // Guard: if the greeting never actually spoke the Systech question, do NOT
      // consume the slot — the state block will ask for it again.
      //
      // BUT THIS MUST BE BOUNDED. It previously depended on a strict
      // /know about systech/i match, so when the model paraphrased — "Tell me
      // about Systech" — the flag never set, this returned early on EVERY turn,
      // and the state block kept commanding the same question forever. The AI
      // re-asked it until the candidate happened to answer, and the interview
      // could never leave Phase 1. That is the "repeats the question like a
      // teacher" report, and it also starved Phases 2–4 entirely.
      //
      // Now: detection is tolerant (see the transcript handler), and the retry
      // is capped at one. A guard against skipping a question must never be able
      // to livelock the interview.
      if (this.phase1Asked === 0 && !this.introQuestion1Asked && this.introQ1RetryCount < 1) {
        this.introQ1RetryCount++;
        this.diag('⚠️ Intro Q1 not detected — asking once more, then moving on regardless.');
        return;
      }
      this.phase1Asked++;
      this.introQuestion1Asked = true;   // whatever was asked, that slot is spent
      if (this.phase1Asked >= 2) {
        this.currentPhase = 2;
        this.technicalPhaseStartedAt = Date.now();
        this.primaryQuestionCount = 1;
        this.topicTurnIndex = 0;
        this.followupTargetForCurrentTopic = this.pickFollowupTarget();
      }
      return;
    }

    if (this.currentPhase === 2) {
      this.technicalTurnCount++;
      this.topicTurnIndex++;
      // Time cap as well as a count cap — a long-winded answer can burn minutes
      // on a single follow-up, and coverage of the whole résumé/JD is a time
      // budget, not just a question budget.
      if (this.topicOverranTime() && this.topicTurnIndex > 1) {
        this.diag(`⏱️ Topic "${this.activeTopicName}" ran long — moving to a new skill`);
        this.topicTurnIndex = this.followupTargetForCurrentTopic + 1;
      }
      if (this.topicTurnIndex > this.followupTargetForCurrentTopic) {
        this.topicTurnIndex = 0;
        this.currentTopicStartedAt = Date.now();
        this.followupTargetForCurrentTopic = this.pickFollowupTarget();
        this.primaryQuestionCount++;
        // Enter the behavioural phase on EITHER the topic target OR the time
        // budget.
        //
        // This used to require primaryQuestionCount > 17 and nothing else. A
        // fresher interview that wrapped up around 40 minutes never reached 17
        // technical primaries, so Phase 3 was never entered and **not a single
        // behavioural question was ever asked** — the interview simply ended in
        // the middle of the technical phase. Behavioural coverage cannot be
        // gated behind finishing every technical topic.
        if (this.primaryQuestionCount > this.technicalPrimaryTarget() || this.technicalBudgetSpent()) {
          if (this.technicalBudgetSpent() && this.primaryQuestionCount <= this.technicalPrimaryTarget()) {
            this.diag(`⏭️ Technical time budget spent at ${this.primaryQuestionCount} topics — moving to behavioural`);
          }
          this.currentPhase = 3;
          this.behavioralCount = 1;
          this.topicTurnIndex = 0;
          // Size the behavioural phase to hit the required 85/15 split.
          //
          // A hardcoded 3 follow-ups gave 3x(1+3)=12 behavioural turns against
          // ~85 technical ones — 88/12, not 85/15. And the technical total is
          // not fixed either: pickFollowupTarget() returns 4–6 for role-critical
          // skills and 2–3 afterwards, so the denominator varies per interview.
          // Derive the target from what actually happened instead of guessing:
          //   behaviouralTurns = technical x 15/85, spread over 3 primaries.
          const wantBehaviouralTurns = this.technicalTurnCount * (15 / 85);
          const perPrimary = Math.round(wantBehaviouralTurns / 3) - 1;  // minus the primary itself
          this.behavioralFollowupTarget = Math.max(2, Math.min(6, perPrimary));
          this.diag(`📊 Technical turns: ${this.technicalTurnCount} → behavioural follow-ups: ${this.behavioralFollowupTarget}`);
        }
      }
      return;
    }

    if (this.currentPhase === 3) {
      this.topicTurnIndex++;
      if (this.topicTurnIndex > this.behavioralFollowupTarget) {
        this.topicTurnIndex = 0;
        this.behavioralCount++;
        if (this.behavioralCount > 3) this.currentPhase = 4;
      }
    }
  }

  /**
   * Push the current phase guidance to Azure as a session update.
   *
   * Sends ONLY `instructions`. session.update is a partial merge — fields that
   * are absent are left untouched — so this cannot disturb turn_detection,
   * transcription, the voice or the audio formats. Re-sending the whole accepted
   * config instead would be the risky option: several of those fields are
   * immutable once the session is running (Azure rejects a turn_detection TYPE
   * change outright), and a rejected refresh is swallowed as non-fatal, so
   * steering would silently stop working with nothing in the log.
   *
   * The GA schema needs `session.type` as its discriminator; the flat schema has
   * no such field.
   */
  private refreshPhaseInstructions() {
    if (!this.sessionConfirmed) return;
    if (!this.ws || !this.wsOpen || this.ws.readyState !== WebSocket.OPEN) return;

    const block = this.phaseStateBlock();
    if (block === this.lastSentStateBlock) return;   // nothing changed — don't spam
    this.lastSentStateBlock = block;

    const session: any = { instructions: this.composeInstructions() };
    if (this.activeSessionSchema === 'ga') session.type = 'realtime';

    // Follow a language switch with speech-to-text as well. Updating only the
    // prompt would leave STT pinned to English while the candidate answers in
    // another language — returning transliterated garbage that corrupts both the
    // saved transcript and every follow-up derived from it.
    //
    // Only sent when a switch is active: the steady-state English case is
    // already correct from the initial session.update, and re-sending this on
    // every turn is needless risk. The model name is read from the rung Azure
    // actually accepted, so a rung that deliberately omits the language pin is
    // not clobbered by re-adding it.
    if (this.requestedLanguage) {
      const accepted = this.acceptedSessionMsg?.session;
      const flatT = accepted?.input_audio_transcription;
      const gaT = accepted?.audio?.input?.transcription;
      const model = flatT?.model || gaT?.model;
      // If the accepted rung sent no transcription language at all (the safest
      // floor rung), leave it alone — that rung exists precisely because this
      // endpoint rejected something here.
      if (model && (flatT?.language || gaT?.language)) {
        const t = { model, language: this.transcriptionLanguage() };
        if (this.activeSessionSchema === 'ga') session.audio = { input: { transcription: t } };
        else session.input_audio_transcription = t;
        this.diag(`🎧 STT language → ${t.language}`);
      }
    }

    try {
      this.ws.send(JSON.stringify({ type: 'session.update', session }));
      this.diag(`🧭 Phase → ${this.currentPhase}, primary ${this.primaryQuestionCount}, topic turn ${this.topicTurnIndex}`);
    } catch (e: any) {
      console.warn('Phase instruction refresh failed:', e?.message || e);
    }
  }

  // Explicit no-repeat list injected into primary-question directives (issue #3).
  // askedQuestionsList was being collected but never USED — so the model had no
  // reliable reminder of what it had already covered and repeated questions.
  // Kept short (last 8, truncated) so it steers without bloating the directive.
  /**
   * Find a previously asked question that is substantially the same as this one.
   *
   * Compares content words (stopwords and short tokens dropped) by Jaccard
   * overlap, so "How do you handle indexing in MongoDB?" matches "Can you
   * explain how indexing works in MongoDB?" — a reworded repeat, which is the
   * form the model actually produces. Exact-string matching never caught these.
   */
  private findSimilarAskedQuestion(question: string): string | null {
    const STOP = new Set(['what','when','where','which','that','this','these','those','with','from','your','you','can','could','would','how','why','the','and','for','are','was','were','have','has','had','did','does','do','tell','about','into','they','them','their','there','been','being','some','any','also','just','like','more','most','than','then','one','two','use','used','using','make','made','give','given','say','said','ask','asked','me','my','in','on','of','to','a','an','is','it','as','at','by','or','if','so','be','we','us','our']);
    const toks = (s: string) => new Set(
      s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
        .filter(w => w.length > 2 && !STOP.has(w)),
    );

    // Minimum 2 content words, not 3. Perfectly normal questions reduce to two
    // once stopwords go — "What do you know about Systech?" is {know, systech},
    // and "Tell me about indexing in MongoDB" is {indexing, mongodb}. Requiring
    // 3 silently skipped exactly the repeats being complained about.
    const now = toks(question);
    if (now.size < 2) return null;

    for (let i = this.askedQuestionsList.length - 1; i >= 0; i--) {
      const prev = this.askedQuestionsList[i];
      if (prev === question) continue;               // the just-pushed entry
      const old = toks(prev);
      if (old.size < 2) continue;
      let shared = 0;
      for (const w of now) if (old.has(w)) shared++;
      const overlap = shared / Math.min(now.size, old.size);
      // 0.6, not 0.7. A real reword — "How do you handle indexing in MongoDB?"
      // vs "Can you explain how indexing works in MongoDB?" — scores 0.67, so
      // 0.7 missed it. At two content words 0.6 still demands BOTH match, so
      // this does not get loose on short questions.
      if (overlap >= 0.6) return prev;
    }
    return null;
  }

  private recentlyAskedSummary(): string {
    if (this.askedQuestionsList.length === 0) return '';
    const recent = this.askedQuestionsList
      .slice(-8)
      .map(q => `"${q.replace(/\s+/g, ' ').slice(0, 90)}"`)
      .join(' | ');
    return ` ALREADY ASKED — do NOT repeat or paraphrase any of these: ${recent}`;
  }

  // NOTE: advanceInterviewTurn() lived here. It was the client-side turn
  // driver: build a [SYSTEM NOTE: ...] directive, inject it into the
  // conversation as a user message, then response.create. It is gone — Azure
  // now creates each response itself, and the phase guidance it used to carry
  // is delivered through session instructions (see phaseStateBlock /
  // refreshPhaseInstructions above), which keeps it out of the transcript.


/**
 * Re-seed a freshly reconnected session with what has already happened.
 *
 * A reconnect opens a BRAND NEW Azure session — the model remembers nothing, so
 * without this it would greet the candidate again and restart the interview from
 * "What do you know about Systech?". The phase counters survive on our side
 * (initSession only resets them for a genuinely new session), and
 * refreshPhaseInstructions re-sends the current phase guidance, but the model
 * still needs the conversation itself.
 *
 * We replay it as ONE user-role item. Replaying each turn under its true role
 * would be closer to the original, but assistant-role items use a different
 * content type between the GA and flat schemas ('output_text' vs 'text'), and
 * guessing wrong throws errors that are non-fatal and therefore silent. A single
 * input_text item uses the exact shape already proven elsewhere in this file.
 */
private restoreConversationContinuity() {
  if (!this.ws || !this.wsOpen) return;

  const state = this.conversationStateBeforeDisconnect;
  this.conversationStateBeforeDisconnect = null;
  this.reconnectionInProgress = false;

  // Last few exchanges, trimmed so a long answer cannot crowd out the rest.
  const digest = this.transcript
    .slice(-10)
    .map(t => `${t.role === 'AI Interviewer' ? 'You asked' : 'Candidate answered'}: "${t.text.replace(/\s+/g, ' ').slice(0, 220)}"`)
    .join('\n');

  const midQuestion = state?.aiWasSpeaking
    ? ' You were part-way through a question when the connection dropped — if the candidate seems unsure what you asked, repeat your last question before moving on.'
    : '';

  const note = digest
    ? `[The connection dropped and has been restored. Do NOT greet the candidate again and do NOT restart the interview. Here is what has already happened, so you do not repeat any of it:\n${digest}\n\nContinue from exactly this point, following your current instructions.${midQuestion} Never mention this note or the reconnection.]`
    : `[The connection dropped and has been restored. Do NOT greet the candidate again and do NOT restart the interview. Continue from where you left off, and never mention this note.]`;

  this.diag(`🔄 Resumed — replayed ${Math.min(this.transcript.length, 10)} turn(s) of context`);
  // triggerResponse:false — the candidate has not said anything new, and with
  // create_response:true the server will respond on its own as soon as they do.
  // Forcing a response here would make the AI talk to itself on reconnect.
  this.sendRealtimeText(note, false);
}

private async reconnectWithBackoff() {
  if (this.reconnectAttempts >= this.maxReconnectAttempts) {
    this.updateError('Connection lost. Please refresh the page.');
    this.isReconnecting = false;
    this.reconnectionInProgress = false;
    return;
  }

  this.reconnectAttempts++;
  const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 10000);
  this.updateStatus(`Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

  await new Promise(r => setTimeout(r, delay));

  // Reset mic gate before reconnecting — the worklet may still be gated
  // from when the connection dropped mid-AI-response, causing permanent silence.
  this.forceUngateMic();

  try {
    // This used to begin with `if (!this.sessionHandle) throw ...`, but
    // sessionHandle was declared, read in three places, and NEVER ASSIGNED
    // anywhere in the component. So this method threw on its very first line
    // every single time, and because the catch below ALSO tested sessionHandle
    // it skipped the retry branch and gave up immediately with "Failed to
    // reconnect" — despite maxReconnectAttempts being 5. Mid-interview
    // reconnection has therefore never worked at all.
    //
    // initSession() only uses its argument as a "this is a resume" flag; it is
    // never sent to Azure. So a plain marker is all that was ever needed.
    await this.refreshClient();   // tickets are short-lived
    await this.initSession('resume');
  } catch (e: any) {
    if (this.reconnectAttempts < this.maxReconnectAttempts && this.inSession && !this.stopCalled) {
      await this.reconnectWithBackoff();
    } else {
      this.isReconnecting = false;
      this.reconnectionInProgress = false;
      this.updateError('Failed to reconnect.');
    }
  }
}

  private startSessionHealthMonitor() {
    this.sessionHealthMonitorInterval = window.setInterval(() => {
      if (this.inSession) {
        console.log('📊 Session Active | Duration:', formatDuration(this.interviewDuration));
      }
    }, 30000);
  }

  private stopSessionHealthMonitor() {
    if (this.sessionHealthMonitorInterval) {
      clearInterval(this.sessionHealthMonitorInterval);
      this.sessionHealthMonitorInterval = undefined;
    }
  }

  // -----------------------------------------------------------------------
  // SESSION UNFREEZE WATCHDOG — Prevents frozen/unresponsive turns
  // Checks every 5s if session is stuck >12s after candidate spoke.
  // -----------------------------------------------------------------------
  private startWatchdogTimer() {
    if (this.watchdogInterval) clearInterval(this.watchdogInterval);
    this.watchdogInterval = window.setInterval(() => {
      if (!this.inSession || !this.ws || !this.wsOpen || this.stopCalled) return;

      // WATCHDOG: Only re-trigger greeting if session just started and AI never spoke
      // Do NOT force-trigger mid-interview — that causes AI self-conversation
      const now = Date.now();
      const timeSinceAISpeech = now - (this.lastAIMessageTime || 0);
      const sessionAge = now - (this.interviewStartTime || now);

      // Retry on greetingRECEIVED (did audio actually arrive?), NOT on
      // greetingSENT (did we merely attempt it?). The old condition required
      // !greetingSent, but greetingSent is set the instant we send the greeting —
      // so the watchdog could never rescue a greeting that was sent and then
      // FAILED, which is exactly the case it exists for. Bounded to 2 retries so
      // it can never loop or talk over a working session.
      if (
        !this.greetingReceived &&
        this.greetingRetryCount < 2 &&
        sessionAge > 8000 &&
        !this.isModelSpeaking &&
        !this.currentResponseId &&
        timeSinceAISpeech > 8000
      ) {
        this.greetingRetryCount++;
        console.warn(`⚠️ Watchdog: no AI audio after ${Math.round(sessionAge / 1000)}s — re-triggering greeting (retry ${this.greetingRetryCount}/2)`);
        this.diag(`⚠️ Watchdog retry ${this.greetingRetryCount}/2 — no AI audio yet`);
        this.greetingSent = true;
        this.lastTurnTriggerTimestamp = now;
        const greetingInstruction = `Say immediately: "Hello ${this.candidateDisplayName}, welcome to your interview with Systech. I am your AI interviewer for today. Let us get started. My first question is — what do you know about Systech?"`;
        this.ws.send(JSON.stringify({
          type: 'response.create',
          response: { instructions: greetingInstruction }
        }));
      }
      // ── MID-INTERVIEW STALL RECOVERY ───────────────────────────────────────
      // This is now a LAST RESORT, not part of normal flow. Azure creates each
      // response itself, so silence here almost always means the candidate is
      // still thinking — not that anything is broken.
      //
      // The old threshold was 25s, which is well within normal thinking time for
      // a hard technical question. It fired on people who were mid-thought and
      // injected "Ask your next question now", so the AI abandoned the question
      // it had just asked and moved on. That is the "it interrupts me" and "it
      // skips ahead" behaviour. 75s is long enough that a genuine pause never
      // trips it, while a real deadlock still recovers.
      //
      // NOTE: all timestamps start at 0. Math.max over unset values yields 0,
      // making idleMs ≈ Date.now() and firing a false stall immediately. The
      // session start time is included so idle is always measured from a real
      // moment.
      const lastActivity = Math.max(
        this.lastInterviewActivityAt,
        this.lastAIMessageTime || 0,
        this.lastUserMessageTime || 0,
        this.interviewStartTime || 0,
      );
      // ── STUCK MIC GATE RESCUE ──────────────────────────────────────────────
      // isModelSpeaking is cleared by scheduleMicUngate(), which is armed from
      // response.done. If response.done never arrives — an upstream error, a
      // dropped frame — the flag stays true, the worklet keeps feeding silence,
      // and the candidate is inaudible for the rest of the interview. The stall
      // recovery below could not save it either, because it requires
      // !isModelSpeaking to run: the deadlock guarded itself.
      //
      // So: if the AI is nominally "speaking" but nothing has actually been
      // scheduled for playback for 5s and no response is in flight, the flag is
      // stale. Open the microphone.
      if (this.isModelSpeaking && !this.currentResponseId && this.pendingPlaybackMs() < 100) {
        if (now - lastActivity > 5000) {
          this.diag('⚠️ Mic gate looked stuck (no playback, no response) — reopening.');
          this.forceUngateMic();
        }
      }

      const STALL_MS = 75000;
      const quiet =
        !this.isModelSpeaking &&
        !this.currentResponseId &&
        !this.isUserSpeaking &&
        this.pendingPlaybackMs() < 100;   // nothing still coming out of the speakers

      if (this.greetingReceived && quiet && lastActivity > 0) {
        const idleMs = now - lastActivity;
        if (idleMs > STALL_MS && this.stallRecoveryCount < 3) {
          this.stallRecoveryCount++;
          this.lastInterviewActivityAt = now;
          this.diag(`⚠️ STALL (${Math.round(idleMs / 1000)}s idle) — recovering (${this.stallRecoveryCount}/3)`);
          console.warn('⚠️ Interview stalled — forcing recovery.');

          // 1. Clear any stuck in-flight response bookkeeping.
          this.currentResponseId = null;
          this.currentResponseMsgId = null;
          // 2. Force the microphone open — a stuck gate makes the candidate
          //    inaudible, which looks exactly like a frozen AI.
          this.forceUngateMic();
          // 3. Re-assert the current phase guidance, then nudge once. Phrased as
          //    something a real interviewer would say, because the model may well
          //    speak in response to it.
          this.lastSentStateBlock = '';           // force the refresh through
          this.refreshPhaseInstructions();
          this.sendRealtimeText(
            '[The candidate has gone quiet for a while. Check in with them naturally — for example ask if they would like you to repeat the question — then continue. Do not mention this note.]',
            true,
          );
        }
      }
    }, 3000);
  }

  private stopWatchdogTimer() {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = undefined;
    }
  }

  // -----------------------------------------------------------------------
  // PROGRESS MONITOR — Silent supervisor time updates
  // Sends hidden [SYSTEM NOTE] updates every 3 minutes so the AI knows the
  // elapsed time for pacing without confusing instructions to backtrack phases.
  // -----------------------------------------------------------------------
  private startProgressMonitor() {
    this.progressChecksFired = 0;
    this.lastProgressMinutesFired = 0;
    // Poll every 30 seconds
    this.progressMonitorInterval = window.setInterval(() => {
      if (!this.inSession || !this.ws || !this.wsOpen || this.stopCalled) return;

      const elapsedMinutes = Math.floor(this.interviewDuration / 60);

      // The every-3-minutes "[SYSTEM NOTE: Elapsed time is N minutes...]"
      // injections that used to live here are gone. Each one put a paragraph of
      // stage directions into the conversation as if the CANDIDATE had said it —
      // roughly eighteen of them over a full interview, on top of one per turn
      // from the old turn driver. The model was reading more instructions than
      // conversation, which is a large part of why it stopped sounding like an
      // interviewer.
      //
      // Elapsed time and the "do not close before 30 minutes" rule now travel in
      // the phase block (see phaseStateBlock), which is refreshed after every
      // turn and never appears in the transcript.

      // Hard closing warning at 55 minutes
      if (elapsedMinutes >= 55 && this.progressChecksFired === 0) {
        this.progressChecksFired = 1;
        try {
          this.sendRealtimeText(`[SYSTEM NOTE: 55 minutes have elapsed. We are close to the 60-minute maximum duration limit. You must conclude the interview now. Move to Phase 4 closing, ask 'Do you have any questions for me?' exactly once, answer their questions using only the approved recruiter responses, and end the interview politely. This is the final phase; do not return to any previous questions.]`, false);
          console.log('📊 55-minute closing progress note injected');
        } catch (e) {
          console.warn('Progress note injection failed (55min):', e);
        }
      }
    }, 30000); // check every 30 seconds
  }

  private stopProgressMonitor() {
    if (this.progressMonitorInterval) {
      clearInterval(this.progressMonitorInterval);
      this.progressMonitorInterval = undefined;
    }
    this.progressChecksFired = 0;
    this.lastProgressMinutesFired = 0;
  }

  // --------------------------------------------------------------------------------
  // VIDEO & UNIFIED RECORDING (NATIVE STREAMING ARCHITECTURE)
  // --------------------------------------------------------------------------------

  private async startVideoCapture() {
    try {
      console.log('🎥 Starting Camera...');
      this.videoStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }
      });

      // Preview on UI
// Preview on UI
await this.updateComplete;
await new Promise(resolve => setTimeout(resolve, 100)); // Small delay to ensure DOM is ready
const preview = this.shadowRoot?.querySelector('#candidateVideo') as HTMLVideoElement;
if (preview) {
  preview.srcObject = this.videoStream;
  preview.muted = true;
  await preview.play().catch(() => {});
  console.log('✅ Video preview connected');
} else {
  console.warn('⚠️ Video preview element not found');
}
      console.log('✅ Camera started successfully');
    } catch (e) {
      console.error('❌ Camera Failed:', e);
      this.updateError('Camera permission denied or camera not found.');
    }
  }

  private async startUnifiedRecording() {
    if (!this.videoStream || !this.mediaStream) {
        console.warn('⚠️ Cannot start recording: streams not ready');
        return;
    }

    try {
        console.log('🎙️ Initializing Native Audio Graph Mixing...');

        // STEP 1: Ensure AI Audio (outputNode) is connected to physical computer speakers
        try {
          this.outputNode.connect(this.outputAudioContext.destination);
        } catch (e) {}

        // STEP 2: Create a virtual "Destination" node in Output Context (24kHz) for video recording
        const audioDestination = this.outputAudioContext.createMediaStreamDestination();

        // STEP 3: Connect AI Audio (OutputNode) to virtual video recording destination as well
        this.outputNode.connect(audioDestination);

        // STEP 4: Connect Microphone to virtual video recording destination
        const micSourceInOutputCtx = this.outputAudioContext.createMediaStreamSource(this.mediaStream);
        micSourceInOutputCtx.connect(audioDestination);

        console.log('✅ Audio Mixing Graph Created (Hardware Speakers + Video Recording)');

        // STEP 4: Combine Camera Video + Mixed Audio into a final stream
        const finalStream = new MediaStream([
            ...this.videoStream.getVideoTracks(),
            ...audioDestination.stream.getAudioTracks()
        ]);

        // STEP 5: Initialize MediaRecorder with Chunking
        // Using 4 second timeslices to keep RAM usage extremely low
        this.unifiedRecorder = new MediaRecorder(finalStream, {
            mimeType: 'video/webm;codecs=vp8,opus'
        });

        // STEP 6: Handle Data Available (The "Fire and Forget" Logic)
        this.unifiedRecorder.ondataavailable = async (e) => {
            if (e.data.size > 0) {
                this.chunkSequence++;
                const formData = new FormData();
                formData.append('chunk', e.data);
                formData.append('sequence', this.chunkSequence.toString());

                // Queue this upload so chunks are sent strictly one-at-a-time in order.
                // Each enqueue captures its own formData/seq snapshot via closure.
                const seq = this.chunkSequence;
                const chunkSize = (e.data.size / 1024).toFixed(1);
                this.chunkUploadQueue = this.chunkUploadQueue.then(() =>
                    this.uploadChunkWithRetry(formData, seq, chunkSize)
                );
                console.log(`📤 Queued chunk ${seq} (${chunkSize}KB)`);
            }
        };

        // STEP 7: Start recording with 4-second slices
        this.unifiedRecorder.start(4000);
        console.log('🔴 Crash-Proof Unified Recording Started');

    } catch (e: any) {
        console.error('❌ Failed to start unified recording:', e);
        // We do not stop the interview, we just log the error
        // The interview can proceed audio-only if recording fails
    }
  }

  // Uploads a single chunk with up to 3 retries and exponential backoff.
  // Never throws — a permanently failed chunk logs a warning but does not crash recording.
  private async uploadChunkWithRetry(formData: FormData, seq: number, sizeKB: string): Promise<void> {
    const MAX_RETRIES = 3;
    let attempt = 0;
    while (attempt < MAX_RETRIES) {
      try {
        const res = await uploadChunk(this.sessionId, formData);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        console.log(`✅ Chunk ${seq} uploaded (${sizeKB}KB)`);
        return;
      } catch (err: any) {
        attempt++;
        if (attempt >= MAX_RETRIES) {
          console.warn(`⚠️ Chunk ${seq} permanently failed after ${MAX_RETRIES} attempts:`, err.message);
          return;
        }
        const delay = 500 * Math.pow(2, attempt - 1); // 500ms, 1000ms, 2000ms
        console.warn(`⚠️ Chunk ${seq} attempt ${attempt} failed, retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  // --------------------------------------------------------------------------------
  // START / STOP LOGIC
  // --------------------------------------------------------------------------------


  private async checkPermissions() {
  this.showPermissionCheck = true;
  this.requestUpdate();
  
  await this.requestMicrophonePermission();
  await this.requestCameraPermission();
}

private async recheckHeadphones() {
  try {
    console.log('🔄 Rechecking headphone connection...');
    
    // Request microphone again to get fresh device info
    const stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        channelCount: 1,
        sampleRate: 24000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    
    // Store stream temporarily to check active device
    this.mediaStream = stream;
    
    // Check for headphones based on INPUT device
    await this.checkAudioOutputDevice();
    
    // Stop the temporary stream
    stream.getTracks().forEach(track => track.stop());
    this.mediaStream = null as any;
    
    console.log('✅ Headphone check completed');
    this.requestUpdate();
  } catch (error) {
    console.error('❌ Recheck failed:', error);
  }
}

private async requestMicrophonePermission() {
  try {
    console.log('🎤 Requesting microphone permission...');
    const stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        channelCount: 1,
        sampleRate: 24000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    
    this.micPermissionGranted = true;
    
    // Store stream temporarily to check active device
    this.mediaStream = stream;
    
    // Check for headphones based on INPUT device
    await this.checkAudioOutputDevice();
    
    // Stop the temporary stream
    stream.getTracks().forEach(track => track.stop());
    this.mediaStream = null as any; // Clear temporary stream
    
    console.log('✅ Microphone permission granted');
    this.requestUpdate();
  } catch (error: any) {
    console.error('❌ Microphone permission denied:', error);
    this.micPermissionGranted = false;
    this.requestUpdate();
  }
}

private async requestCameraPermission() {
  try {
    console.log('🎥 Requesting camera permission...');
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: {
        width: { ideal: 768 },
        height: { ideal: 768 },
        frameRate: { ideal: 30 }
      }
    });
    
    this.cameraPermissionGranted = true;
    
    // Immediately stop the stream - we just needed to check permission
    stream.getTracks().forEach(track => track.stop());
    
    console.log('✅ Camera permission granted');
    this.requestUpdate();
  } catch (error: any) {
    console.error('❌ Camera permission denied:', error);
    this.cameraPermissionGranted = false;
    this.requestUpdate();
  }
}

private cleanupPermissionTest() {
  this.showPermissionCheck = false;
  this.requestUpdate();
}

private async proceedWithInterview() {
  this.cleanupPermissionTest();
  await this.start();
}

private async checkAudioOutputDevice() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === 'audioinput');

    console.log('🎤 Audio inputs:', audioInputs.map(d => d.label || '(no label)'));

    // Get the currently active microphone from the media stream
    let activeMicLabel = '';
    if (this.mediaStream) {
      const audioTrack = this.mediaStream.getAudioTracks()[0];
      activeMicLabel = audioTrack?.label?.toLowerCase() || '';
      console.log('🎤 Active microphone:', audioTrack?.label || 'Unknown');
    }

    // Built-in microphone keywords (these indicate NO headphones)
    const builtInKeywords = [
      'built-in',
      'internal',
      'default',
      'array',
      'webcam',
      'laptop',
      'notebook',
      'integrated'
    ];

    // External microphone keywords (these indicate headphones/headsets)
    const externalKeywords = [
      'jack',
      'headset',
      'headphone',
      'airpod',
      'earbud',
      'bluetooth',
      'wireless',
      'usb',
      'hands-free',
      'handsfree',
      'sennheiser',
      'bose',
      'sony',
      'jabra',
      'logitech',
      'plantronics',
      'hyperx',
      'razer',
      'corsair',
      'steelseries'
    ];

    // Check active microphone first (most reliable)
    if (activeMicLabel) {
      const isBuiltIn = builtInKeywords.some(k => activeMicLabel.includes(k));
      const isExternal = externalKeywords.some(k => activeMicLabel.includes(k));

      if (isExternal) {
        this.headphonesConnected = true;
        console.log('✅ External microphone detected (headphones likely):', activeMicLabel);
        this.requestUpdate();
        return;
      }

      if (isBuiltIn) {
        this.headphonesConnected = false;
        console.log('❌ Built-in microphone detected (no headphones):', activeMicLabel);
        this.requestUpdate();
        return;
      }
    }

    // Fallback: Check all available input devices
    this.headphonesConnected = audioInputs.some(device => {
      const label = (device.label || '').toLowerCase();

      // Skip if no label (browser privacy)
      if (!label) return false;

      const isBuiltIn = builtInKeywords.some(k => label.includes(k));
      const isExternal = externalKeywords.some(k => label.includes(k));

      if (isBuiltIn) {
        console.log('❌ Built-in mic found:', device.label);
        return false;
      }

      if (isExternal) {
        console.log('✅ External mic detected:', device.label);
        return true;
      }

      // If label exists but doesn't match built-in keywords, assume external
      // (USB/Bluetooth devices often have custom labels)
      if (label && !isBuiltIn) {
        console.log('✅ Non-built-in mic detected (assuming external):', device.label);
        return true;
      }

      return false;
    });

    console.log('🎧 Headphones connected:', this.headphonesConnected);
    this.requestUpdate();
  } catch (e) {
    console.error('Audio device check failed:', e);
    this.headphonesConnected = false;
  }
}


private handleAloneRoomChange(e: Event) {
  this.aloneRoomConfirmed = (e.target as HTMLInputElement).checked;
  this.requestUpdate();
}

private handleHeadphoneNoiseChange(e: Event) {
  this.headphoneNoiseConfirmed = (e.target as HTMLInputElement).checked;
  this.requestUpdate();
}

  private createDummyAudioStream(): MediaStream {
    console.warn('⚠️ No physical microphone detected. Initializing synthetic silent audio stream...');
    const osc = this.inputAudioContext.createOscillator();
    const gain = this.inputAudioContext.createGain();
    gain.gain.value = 0;
    const dst = this.inputAudioContext.createMediaStreamDestination();
    osc.connect(gain);
    gain.connect(dst);
    osc.start();
    return dst.stream;
  }

  private async start() {
    try {
      // Permanently unlock Web Audio API in browser user gesture stack
      await this.inputAudioContext.resume();
      await this.outputAudioContext.resume();
      try {
        const silentBuf = this.outputAudioContext.createBuffer(1, 1, 24000);
        const silentSrc = this.outputAudioContext.createBufferSource();
        silentSrc.buffer = silentBuf;
        silentSrc.connect(this.outputAudioContext.destination);
        silentSrc.start(0);
        console.log('🔊 Web Audio API output context unlocked successfully');
      } catch (e) {}

      await this.enterFullscreen();
      this.setupProctoringListeners();

    // this.showStartPrompt = true;
       this.setupComplete = true;
    setTimeout(() => {
      this.proctoringActive = true;
      console.log('🔒 Proctoring is now ACTIVE');
    }, 3000);
    this.requestUpdate();

      this.updateStatus('Initializing Interview...');

      // Mark started in DB
      markInterviewStarted(this.sessionId).catch(() => {});

      // ── MICROPHONE FIRST, THEN CONNECT ─────────────────────────────────────
      // The order here used to be reversed: initSession() was awaited, and only
      // then was the microphone opened and the worklet loaded. But the greeting
      // fires as soon as Azure confirms the session — roughly 200ms after
      // connect — while getUserMedia + audioWorklet.addModule routinely take one
      // to three seconds. So the AI reliably delivered its welcome and its first
      // question into a dead microphone, and the candidate's answer to it was
      // lost. Every interview started one question in the hole.
      //
      // Now the capture chain is fully live before the socket is opened.

      // Get Microphone (Fallback to synthetic silent stream if no hardware mic connected)
      try {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, sampleRate: 24000, echoCancellation: true, noiseSuppression: true }
        });
        this.diag(`🎤 Mic: "${this.mediaStream.getAudioTracks()[0]?.label || 'unknown'}" | inputCtx=${this.inputAudioContext.state} @${this.inputAudioContext.sampleRate}Hz`);
      } catch (micError: any) {
        console.warn('⚠️ Physical microphone not accessible or missing:', micError.message);
        // A synthetic silent stream means Azure receives pure silence, so its VAD
        // can NEVER trigger and the AI will never respond to the candidate.
        this.diag(`❌ NO MICROPHONE (${micError.message}) — using silent stream; the AI cannot hear you.`);
        this.mediaStream = this.createDummyAudioStream();
      }

      // Audio Graph for Azure Voice Live (AudioWorklet — dedicated audio thread)
      this.sourceNode = this.inputAudioContext.createMediaStreamSource(this.mediaStream);

      // Load worklet module (served from /public/ as a static file)
      await this.inputAudioContext.audioWorklet.addModule('/audio-processor.worklet.js');

      // Create the worklet node — capture only, no speaker output
      this.workletNode = new AudioWorkletNode(this.inputAudioContext, 'mic-processor', {
        channelCount: 1,
        channelCountMode: 'explicit',
        numberOfOutputs: 0,
      });

      // Receive Int16 PCM ArrayBuffer from audio thread and forward to Azure.
      // No gate check here on purpose: while the AI is speaking the worklet
      // substitutes SILENCE rather than dropping frames, so the stream Azure
      // receives stays continuous in time and its turn detector keeps counting.
      this.workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (!this.wsOpen || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        try {
          const base64Audio = encode(new Uint8Array(event.data));
          this.ws.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: base64Audio
          }));
        } catch (err) {}
      };

      this.workletNode.onprocessorerror = (e) => {
        console.error('AudioWorklet processor error:', e);
      };

      // Connect: mic → visualiser input node + worklet (no destination = no speaker feedback)
      this.sourceNode.connect(this.inputNode);
      this.sourceNode.connect(this.workletNode);
      this.diag('🎤 Capture chain live — connecting to the interviewer');

      // ── NOW connect. The microphone is already streaming, so the greeting and
      // the first question are heard by a live capture chain, and the answer to
      // them is captured like any other.
      const tokenOk = await this.refreshClient();
      if (!tokenOk) return;
      await this.initSession();

      // Start the clock BEFORE the slow, non-critical video/recording setup, so
      // elapsed time (which the phase rules key off) matches the real interview.
      this.startInterviewTimer();

      // Start Video & Unified Recording
this.showWelcome = false;
await this.requestUpdate(); // Wait for DOM to render
await this.updateComplete;
await this.startVideoCapture();
await this.startUnifiedRecording();

setTimeout(() => this.proctoringActive = true, 3000);
      this.updateStatus('Interview in Progress');
      this.startSessionHealthMonitor();
      this.startProgressMonitor();
      this.startWatchdogTimer();

    } catch (e: any) {
      this.updateError('Start Failed: ' + e.message);
      if(document.fullscreenElement) document.exitFullscreen();
    }
  }

  private dismissStartPrompt() {
  this.showStartPrompt = false;
  this.requestUpdate();
}

private async stop() {
    if (this.stopCalled) return;
    this.stopCalled = true;

    if (this.silenceTriggerTimer) {
      clearTimeout(this.silenceTriggerTimer);
      this.silenceTriggerTimer = null;
    }
    if (this.fallbackTurnTimer) {
      clearTimeout(this.fallbackTurnTimer);
      this.fallbackTurnTimer = null;
    }
    if (this.greetingFailsafeTimer) {
      clearTimeout(this.greetingFailsafeTimer);
      this.greetingFailsafeTimer = null;
    }

    this.showCompletionPopup = true;
    this.requestUpdate();

    this.updateStatus('Finalizing...');
    this.stopInterviewTimer();
    this.stopSessionHealthMonitor();
    this.stopProgressMonitor();
    this.stopWatchdogTimer();
    this.removeProctoringListeners();
    console.log(`⚠️ Total violations recorded: ${this.violationCount}`);
    if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});

    // Stop Recorder and wait for final chunk
    if (this.unifiedRecorder && this.unifiedRecorder.state !== 'inactive') {
        this.unifiedRecorder.stop();
        await new Promise(r => setTimeout(r, 500));
    }

    // Stop Audio
    this.sources.forEach(s => { try{ s.stop() }catch(e){} });
    this.sources.clear();

    // Stop Streams
    if (this.mediaStream) this.mediaStream.getTracks().forEach(t => t.stop());
    if (this.videoStream) this.videoStream.getTracks().forEach(t => t.stop());

    // Disconnect AudioWorklet
    if (this.workletNode) {
      try { this.workletNode.disconnect(); } catch (e) {}
      try { this.workletNode.port.close(); } catch (e) {}
    }

    // Close Azure WebSocket
    if (this.ws && this.sessionStartedSuccessfully) {
      try { this.ws.close(); } catch (e) {}
    }

    try {
        // Mark Complete in DB and get session data
        const response = await completeInterview(this.sessionId);

        if (!response.ok) {
            throw new Error('Failed to complete interview');
        }

        const data = await response.json();
        console.log('✅ Interview marked complete, session data:', data);
        
        // Close completion popup
        this.showCompletionPopup = false;
        this.requestUpdate();

        // Small delay before calling Power Automate
        await new Promise(r => setTimeout(r, 1000));

        // CORRECTED: Call Power Automate flow with proper POST request
        console.log('📤 Calling Power Automate flow...');
        
        const powerAutomateResponse = await triggerPowerAutomate(data.sessionData);

        const powerAutomateText = await powerAutomateResponse.text();
        console.log('📥 Power Automate raw response:', powerAutomateText);

        if (powerAutomateResponse.ok) {
            console.log('✅ Power Automate flow triggered successfully');
            try {
                const powerAutomateData = JSON.parse(powerAutomateText);
                console.log('✅ Power Automate parsed response:', powerAutomateData);
            } catch (e) {
                console.log('⚠️ Power Automate response is not JSON, but request succeeded');
            }
        } else {
            console.error('⚠️ Power Automate flow failed:', powerAutomateResponse.status);
            console.error('Response body:', powerAutomateText);
        }

    } catch (error: any) {
        console.error('❌ Error in completion flow:', error);
        console.error('Error details:', error.message);
    }

    this.updateStatus('Completed');
    setTimeout(() => {
        this.showThankYouPopup = true;
        this.requestUpdate();
    }, 1000);
}


private handleRequestReattempt() {
  this.showReattemptForm = true;
  this.requestUpdate();
}

private cancelReattemptRequest() {
  this.showReattemptForm = false;
  this.reattemptReason = '';
  this.requestUpdate();
}

private async submitReattemptRequest() {
  if (!this.reattemptReason.trim()) {
    alert('Please provide a reason for your reattempt request');
    return;
  }

  this.submittingReattempt = true;
  this.requestUpdate();

  try {
    const response = await submitReattemptRequest({
      sessionId: this.sessionId,
      candidateName: this.sessionData?.candidateName || '',
      candidateEmail: this.sessionData?.candidateEmail || '',
      reason: this.reattemptReason.trim(),
      timestamp: new Date().toISOString()
    });

    if (response.ok) {
      alert('Your reattempt request has been submitted successfully. Our HR team will review and contact you soon.');
      this.showReattemptForm = false;
      this.showThankYouPopup = false;
      this.reattemptReason = '';
      // Optionally redirect to a thank you page
      setTimeout(() => window.location.reload(), 1000);
    } else {
      throw new Error('Failed to submit request');
    }
  } catch (error) {
    console.error('Error submitting reattempt request:', error);
    alert('Failed to submit your request. Please contact HR directly.');
  } finally {
    this.submittingReattempt = false;
    this.requestUpdate();
  }
}

private closeThankYouPopup() {
  this.showThankYouPopup = false;
  this.requestUpdate();
  setTimeout(() => {
    window.location.reload();
  }, 500);
}
  // --------------------------------------------------------------------------------
  // HELPERS
  // --------------------------------------------------------------------------------

  private cleanupAudioPlayback() {
    this.sources.forEach(s => { try{ s.stop() }catch(e){} });
    this.sources.clear();
    // Drop anything still waiting to be scheduled, or a cancelled turn's tail
    // would play after the audio it belonged to was stopped.
    if (this.pcmFlushTimer) { clearTimeout(this.pcmFlushTimer); this.pcmFlushTimer = null; }
    this.pcmQueue = [];
    this.pcmQueuedSamples = 0;
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private startInterviewTimer() {
    this.interviewStartTime = Date.now();
    this.interviewTimerInterval = window.setInterval(() => {
      this.interviewDuration = Math.floor((Date.now() - this.interviewStartTime) / 1000);

      // HARD MAXIMUM DURATION: enforce the 60-minute (3600s) cap. The 55-minute
      // notes ask the AI to wrap up; this is the guaranteed backstop so the
      // interview can never exceed 60 minutes.
      if (this.interviewDuration >= this.maximumMinutes() * 60 && !this.maxDurationReached && !this.stopCalled) {
        this.maxDurationReached = true;
        console.warn('⏰ 60-minute maximum reached — ending the interview now.');
        this.stop();
        return;
      }

      // FEATURE 2: TIME WARNING - 55 minute notification (3300 seconds)
      if (this.interviewDuration >= 3300 && !this.warningGiven && this.ws && this.wsOpen) {
        this.warningGiven = true;
        
        try {
          this.sendRealtimeText('IMPORTANT: We are approaching the 60-minute maximum duration limit. We have approximately 5 minutes remaining. Thank the candidate for their time and wrap up the conversation naturally.', false);
          console.log('⏰ 55-minute warning triggered and sent to AI');
        } catch (e) {
          console.error('Failed to send 55-minute warning:', e);
        }
      }
      this.requestUpdate();
    }, 1000);
  }

  private stopInterviewTimer() {
    if (this.interviewTimerInterval) {
      clearInterval(this.interviewTimerInterval);
      this.interviewTimerInterval = undefined;
    }
  }

  // --------------------------------------------------------------------------------
  // PROCTORING SYSTEM
  // --------------------------------------------------------------------------------

private setupProctoringListeners() {
    console.log('🔒 Setting up comprehensive proctoring listeners...');

    // 1. FULLSCREEN MONITORING (with cross-browser support)
    const handleFullscreenChange = () => {
      if (!this.proctoringActive) return;

      const isCurrentlyFullscreen = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).msFullscreenElement
      );

      if (!isCurrentlyFullscreen && this.inSession) {
        this.recordViolation('FULLSCREEN_EXIT', 'Exited fullscreen mode');
        this.showFullscreenPrompt = true;
        console.warn('🚨 Fullscreen violation detected');
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    this.proctoringCleanupFunctions.push(() => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    });

    // 2. TAB SWITCHING / VISIBILITY MONITORING
    const handleVisibilityChange = () => {
      if (!this.proctoringActive) return;

      if (document.hidden && this.inSession) {
        const now = Date.now();
        if (now - this.lastVisibilityChange > 1000) {
          this.tabSwitchCount++;
          this.recordViolation('TAB_SWITCH', `Switched to another tab/window (Count: ${this.tabSwitchCount})`);
          this.lastVisibilityChange = now;
          console.warn('🚨 Tab switch detected');
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    this.proctoringCleanupFunctions.push(() => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    });

    // 3. WINDOW BLUR DETECTION (grace period: if focus returns within 2s, no violation)
    const handleWindowBlur = () => {
      if (!this.proctoringActive || !this.inSession) return;
      const now = Date.now();
      if (now - this.lastVisibilityChange < 1000) return; // debounce rapid events
      if (this.blurViolationTimer !== null) return; // already pending

      this.blurViolationTimer = setTimeout(() => {
        this.blurViolationTimer = null;
        if (!this.inSession || !this.proctoringActive) return;
        this.recordViolation('WINDOW_BLUR', 'Window lost focus');
        this.lastVisibilityChange = Date.now();
        console.warn('🚨 Window blur detected');
      }, 2000); // 2s grace — volume overlays dismiss in <1s
    };

    const handleWindowFocus = () => {
      if (this.blurViolationTimer !== null) {
        clearTimeout(this.blurViolationTimer);
        this.blurViolationTimer = null;
        console.log('ℹ️ Focus returned quickly — blur ignored (volume key or brief OS overlay)');
      }
    };

    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    this.proctoringCleanupFunctions.push(() => {
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      if (this.blurViolationTimer !== null) { clearTimeout(this.blurViolationTimer); this.blurViolationTimer = null; }
    });

    // 4. KEYBOARD SHORTCUT BLOCKING
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!this.inSession || !this.proctoringActive) return;

      const blockedCombos = [
        (e.altKey && e.key === 'Tab'),              // Alt+Tab
        (e.ctrlKey && e.key === 'Tab'),             // Ctrl+Tab
        (e.metaKey && e.key === 'Tab'),             // Cmd+Tab (Mac)
        (e.key === 'Meta' || e.key === 'OS'),       // Windows key
        (e.ctrlKey && e.key === 'w'),               // Ctrl+W (close tab)
        (e.ctrlKey && e.key === 'n'),               // Ctrl+N (new window)
        (e.ctrlKey && e.key === 't'),               // Ctrl+T (new tab)
        (e.ctrlKey && e.shiftKey && e.key === 'n'), // Ctrl+Shift+N (incognito)
        (e.key === 'F11'),                          // F11 (fullscreen toggle)
        (e.altKey && e.key === 'F4'),               // Alt+F4 (close window)
        (e.ctrlKey && e.altKey && e.key === 'Delete'), // Ctrl+Alt+Del
        (e.key === 'PrintScreen'),                  // PrintScreen
      ];

      if (blockedCombos.some(combo => combo)) {
        e.preventDefault();
        e.stopPropagation();
        this.recordViolation('KEYBOARD_SHORTCUT', `Attempted restricted shortcut: ${e.key}`);
        console.warn('🚨 Blocked keyboard shortcut:', e.key);
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    this.proctoringCleanupFunctions.push(() => {
      document.removeEventListener('keydown', handleKeyDown, true);
    });

    // 5. DEVELOPER TOOLS BLOCKING
    const handleDevTools = (e: KeyboardEvent) => {
      if (!this.inSession || !this.proctoringActive) return;

      const devToolsCombos = [
        (e.key === 'F12'),                          // F12
        (e.ctrlKey && e.shiftKey && e.key === 'I'), // Ctrl+Shift+I
        (e.ctrlKey && e.shiftKey && e.key === 'J'), // Ctrl+Shift+J
        (e.ctrlKey && e.shiftKey && e.key === 'C'), // Ctrl+Shift+C
        (e.metaKey && e.altKey && e.key === 'I'),   // Cmd+Option+I (Mac)
      ];

      if (devToolsCombos.some(combo => combo)) {
        e.preventDefault();
        this.recordViolation('DEV_TOOLS', 'Attempted to open developer tools');
        console.warn('🚨 Developer tools access blocked');
      }
    };

    document.addEventListener('keydown', handleDevTools, true);
    this.proctoringCleanupFunctions.push(() => {
      document.removeEventListener('keydown', handleDevTools, true);
    });

    // 6. CONTEXT MENU BLOCKING (Right-click prevention)
    const handleContextMenu = (e: MouseEvent) => {
      if (this.inSession && this.proctoringActive) {
        e.preventDefault();
        this.recordViolation('CONTEXT_MENU', 'Attempted to open context menu (right-click)');
        console.warn('🚨 Context menu blocked');
      }
    };

    document.addEventListener('contextmenu', handleContextMenu);
    this.proctoringCleanupFunctions.push(() => {
      document.removeEventListener('contextmenu', handleContextMenu);
    });

    // 7. MULTIPLE MONITOR DETECTION
    const checkMultipleMonitors = () => {
      if (this.inSession && this.proctoringActive && window.screen) {
        const screenWidth = window.screen.width;
        const screenHeight = window.screen.height;
        const windowX = window.screenX;
        const windowY = window.screenY;

        // Check if window is on secondary monitor
        if (windowX < 0 || windowY < 0 || windowX > screenWidth || windowY > screenHeight) {
          this.recordViolation('MULTIPLE_MONITORS', 'Window detected on secondary monitor');
          console.warn('🚨 Multiple monitors detected');
        }

        // Use Screen Details API if available
        if ('getScreenDetails' in window) {
          (window as any).getScreenDetails().then((screens: any) => {
            if (screens.screens && screens.screens.length > 1) {
              console.warn('⚠️ Multiple monitors detected via Screen Details API');
            }
          }).catch(() => {});
        }
      }
    };

    const monitorInterval = setInterval(checkMultipleMonitors, 5000);
    this.proctoringCleanupFunctions.push(() => {
      clearInterval(monitorInterval);
    });

    console.log('✅ Comprehensive proctoring listeners registered (will activate after setup)');
  }

  private removeProctoringListeners() {
    this.proctoringActive = false;
    this.proctoringCleanupFunctions.forEach(fn => fn());
  }

  private async reenterFullscreen() {
    try { await document.documentElement.requestFullscreen(); this.showFullscreenPrompt = false; } catch(e){}
  }

  private async enterFullscreen() {
    try { await document.documentElement.requestFullscreen(); this.isFullscreen = true; } catch(e){}
  }

  private recordViolation(type: string, desc: string) {
    const v = { type, description: desc, timestamp: this.now() };
    this.violations = [...this.violations, v];
    this.violationCount++;
    this.showWarning(v);

    postViolation(this.sessionId, v).catch(()=>{});

    if(this.violationCount >= this.maxViolations) {
        this.warningMessage = 'Too many violations. Terminating...';
        setTimeout(() => this.stop(), 3000);
    }
  }

  private showWarning(v: any) {
    this.warningMessage = `⚠️ Warning: ${v.description}`;
    setTimeout(() => { if(this.warningMessage.includes(v.description)) this.warningMessage = ''; }, 5000);
  }

  private dismissWarning() { this.warningMessage = ''; this.requestUpdate(); }

    private handleBeforeUnload(e: BeforeUnloadEvent) {
    if (this.inSession && !this.stopCalled) {
      e.preventDefault();
      e.returnValue = '';
      sendEmergencySaveBeacon(this.sessionId, {
        transcript: this.transcript,
        duration: this.interviewDuration
      });
    }
  }

  // --------------------------------------------------------------------------------
  // RENDER
  // --------------------------------------------------------------------------------

  render() {
    return html`
      <div>

<!-- ────────────────────────────────────────────────────────────────────────
     VOICE DIAGNOSTICS OVERLAY
     diagLog was populated by this.diag() but never rendered anywhere, so every
     connection/schema/Azure-error message was invisible — which made "the AI is
     silent" impossible to diagnose from the UI. Rendered here as a fixed overlay
     so the failure point is always visible. Shows only when there is something
     to show, and carries no secrets (the ticket is masked before it reaches
     diag()).
     ──────────────────────────────────────────────────────────────────────── -->
${this.showDiagnostics && this.diagLog.length > 0
  ? html`
      <div style="position:fixed; bottom:8px; left:8px; z-index:99999; max-width:min(560px,92vw);
                  max-height:38vh; overflow:auto; background:rgba(12,14,18,0.92); color:#d6e2f0;
                  font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
                  padding:8px 10px; border:1px solid #2c3542; border-radius:8px;">
        <div style="display:flex; gap:10px; align-items:center; margin-bottom:6px;
                    padding-bottom:5px; border-bottom:1px solid #2c3542; font-weight:700; color:#8fb6e8;">
          <span>VOICE DIAGNOSTICS</span>
          <span style="font-weight:400; color:${this.wsOpen ? '#4ade80' : '#f87171'};">
            WS ${this.wsOpen ? 'OPEN' : 'CLOSED'}
          </span>
          <span style="font-weight:400; color:${this.greetingReceived ? '#4ade80' : '#fbbf24'};">
            AI audio ${this.greetingReceived ? 'RECEIVED' : 'NONE YET'}
          </span>
          <span style="font-weight:400; color:#94a3b8;">schema ${this.activeSessionSchema}</span>
        </div>
        ${this.diagLog.map(l => html`<div style="white-space:pre-wrap; word-break:break-word;">${l}</div>`)}
      </div>
    `
  : ''}

${this.showPermissionCheck
  ? html`
      <div class="permission-check-overlay">
        <div class="permission-check-box">
          <div class="permission-check-title">🎥 Setup Check</div>
          <div class="permission-check-subtitle">
            Please allow access to your microphone and camera
          </div>
          
          <div class="permission-check-items">
<!-- Microphone Check -->
<div class="permission-item ${this.micPermissionGranted ? 'granted' : ''}">
  <div class="permission-item-header">
    <div class="permission-item-title">
      <span>🎤</span>
      <span>Microphone</span>
    </div>
    <div class="permission-status ${this.micPermissionGranted ? 'granted' : 'pending'}">
      ${this.micPermissionGranted ? '✓ Granted' : '⏳ Pending'}
    </div>
  </div>
  
  ${this.micPermissionGranted && this.headphonesConnected
    ? html`
        <div style="color: #15803d; font-size: 13px; margin-top: 8px; padding: 10px; background: #dcfce7; border-radius: 8px; display: flex; align-items: center; gap: 8px;">
          <span>✅</span>
          <span><strong>External microphone detected</strong> - Headphones/headset likely connected</span>
        </div>
      `
    : this.micPermissionGranted && !this.headphonesConnected
    ? html`
        <div style="color: #92400e; font-size: 13px; margin-top: 8px; padding: 10px; background: #fef3c7; border-radius: 8px; display: flex; align-items: center; gap: 8px;">
          <span>⚠️</span>
          <span><strong>Built-in microphone detected</strong> - Please connect headphones/earbuds for better audio quality</span>
        </div>
      `
    : ''}
  
  ${!this.micPermissionGranted
    ? html`
        <div style="color: #64748b; font-size: 13px; margin-top: 8px;">
          Click "Allow" when prompted by your browser
        </div>
      `
    : ''}
  
  ${this.micPermissionGranted
    ? html`
        <button
          class="recheck-headphones-btn"
          @click=${() => this.recheckHeadphones()}
          style="margin-top: 12px; padding: 8px 16px; background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.2s ease;"
          onmouseover="this.style.background='#e2e8f0'"
          onmouseout="this.style.background='#f1f5f9'"
        >
          <span>🔄</span>
          <span>Recheck Headphones</span>
        </button>
      `
    : ''}
  
  <!-- HEADPHONE CHECK HIDDEN - keeping code for future use
  ${this.micPermissionGranted && !this.headphonesConnected
    ? html`
        <div class="headphone-warning">
          <span>⚠️</span>
          <span><strong>Headphones Required:</strong> Please connect headphones or AirPods to continue</span>
        </div>
      `
    : this.micPermissionGranted && this.headphonesConnected
    ? html`
        <div style="color: #15803d; font-size: 13px; margin-top: 8px; display: flex; align-items: center; gap: 6px;">
          <span>🎧</span>
          <span>Headphones detected</span>
        </div>
      `
    : ''}
  -->
</div>
            
            <!-- Camera Check -->
            <div class="permission-item ${this.cameraPermissionGranted ? 'granted' : ''}">
              <div class="permission-item-header">
                <div class="permission-item-title">
                  <span>🔹</span>
                  <span>Camera</span>
                </div>
                <div class="permission-status ${this.cameraPermissionGranted ? 'granted' : 'pending'}">
                  ${this.cameraPermissionGranted ? '✓ Granted' : '⏳ Pending'}
                </div>
              </div>
              
              ${!this.cameraPermissionGranted
                ? html`
                    <div style="color: #64748b; font-size: 13px; margin-top: 8px;">
                      Click "Allow" when prompted by your browser
                    </div>
                  `
                : ''}
            </div>
          </div>

          <!-- Alone Room Confirmation -->
          <div class="alone-room-confirmation ${this.aloneRoomConfirmed ? 'checked' : ''}">
            <label class="checkbox-container">
              <input 
                type="checkbox" 
                @change=${this.handleAloneRoomChange}
                .checked=${this.aloneRoomConfirmed}
              />
              <span class="checkbox-label">
                <strong>I confirm</strong> that I am alone in a private, quiet room with no other people present during this interview
              </span>
            </label>
          </div>

          <!-- Headphone & Background Noise Confirmation -->
<div class="headphone-noise-confirmation ${this.headphoneNoiseConfirmed ? 'checked' : ''}">
  <label class="checkbox-container">
    <input 
      type="checkbox" 
      @change=${this.handleHeadphoneNoiseChange}
      .checked=${this.headphoneNoiseConfirmed}
    />
    <span class="headphone-noise-label">
      <strong>⚠️ IMPORTANT:</strong> I confirm that I will be using <span class="highlight-text">headphones/earphones</span> during the entire interview and ensure there will be <span class="highlight-text">no background noise or disturbances</span> 
    </span>
  </label>
</div>
          
          <div class="permission-actions">
  ${!this.micPermissionGranted || !this.cameraPermissionGranted
    ? html`
        <button 
          class="retry-permission-btn"
          @click=${() => {
            if (!this.micPermissionGranted) this.requestMicrophonePermission();
            if (!this.cameraPermissionGranted) this.requestCameraPermission();
          }}
        >
          Retry Permissions
        </button>
      `
    : ''}
  
<button
  class="continue-permission-btn"
  @click=${() => this.proceedWithInterview()}
  ?disabled=${!this.micPermissionGranted || !this.cameraPermissionGranted || !this.aloneRoomConfirmed || !this.headphoneNoiseConfirmed}
>
  ${this.micPermissionGranted && this.cameraPermissionGranted && this.aloneRoomConfirmed && this.headphoneNoiseConfirmed
    ? '✓ Continue to Interview'
    : (!this.aloneRoomConfirmed || !this.headphoneNoiseConfirmed) && this.micPermissionGranted && this.cameraPermissionGranted
    ? '⏳ Please confirm all requirements...'
    : '⏳ Waiting for Permissions...'}
</button>
</div>        </div>
      </div>
    `
  : ''}

${this.showStartPrompt
  ? html`
      <div class="start-prompt-overlay">
        <div class="start-prompt-box">
          <div class="start-prompt-notice"> IMPORTANT NOTICE</div>
          <div class="start-prompt-icon">🎤</div>
          <div class="start-prompt-title">Ready to Begin!</div>
          <div class="start-prompt-text">
            Say <strong>"Hello"</strong> to start the interview.
            <br /><br />
            The AI interviewer will greet you and begin with the first question.
          </div>
          <button class="start-prompt-btn" @click=${() => this.dismissStartPrompt()}>
            Got it!
          </button>
        </div>
      </div>
    `
  : ''}
        ${this.showWelcome
          ? html`
<div class="welcome-screen">
        <div class="welcome-content">
          <div class="logo-section">
            <div class="logo-icon"><img src="/Systech_Logo.png" alt="Systech Logo" /></div>
            <h1>AI Interview Platform</h1>
            <p class="welcome-subtitle">Professional Session</p>
          </div>


          
${this.error
  ? html`
      <div class="error-box">
        <div class="error-icon">⚠️</div>
        <div class="error-title">Unable to Start Interview</div>
        <div class="error-message">${this.error}</div>
        <div class="error-help">
          If this problem persists, please contact your interviewer for assistance.
        </div>
      </div>
    `
  : this.isAlreadyCompleted
  ? html`
      <div class="completed-info-box">
        <div class="completed-info-icon">✅</div>
        <div class="completed-info-title">Interview Already Completed</div>
        <div class="completed-info-text">
          This interview has already been completed and submitted successfully.
          <br /><br />
          You cannot retake this interview using the same link.
        </div>
        
        <div class="completed-info-details">
          <p><strong>Candidate:</strong> ${this.sessionData?.candidateName || 'N/A'}</p>
          <p><strong>Position:</strong> ${this.sessionData?.jobTitle || 'N/A'}</p>
          ${this.sessionData?.completedAt ? html`
            <p><strong>Completed On:</strong> ${new Date(this.sessionData.completedAt).toLocaleString()}</p>
          ` : ''}
        </div>

        <div style="margin-top: 24px; padding: 16px; background: rgba(251, 191, 36, 0.15); border: 2px solid #fbbf24; border-radius: 12px;">
          <p style="font-size: 14px; color: #92400e; margin: 0;">
            <strong>Need Help?</strong> If you believe you should have access to a new interview or if you experienced technical issues, please contact your recruiter or HR representative.
          </p>
        </div>
      </div>
    `
  : html`
      <div class="info-grid">
        <div class="info-box">
          <div class="info-label">Candidate</div>
          <p class="info-value">${this.sessionData?.candidateName || 'Loading...'}</p>
        </div>
        <div class="info-box">
          <div class="info-label">Position</div>
          <p class="info-value">${this.sessionData?.jobTitle || 'Loading...'}</p>
        </div>
      </div>

      <div class="proctoring-warning">
        <div class="proctoring-warning-title">
          <span>🔒</span>
          <span>PROCTORED & RECORDED INTERVIEW</span>
        </div>
        <ul>
          <li><strong>Fullscreen Mode:</strong> The interview must be completed in fullscreen mode</li>
          <li><strong>Video Recording:</strong> Your video and audio will be recorded throughout</li>
          <li><strong>No Tab Switching:</strong> Switching tabs or windows is prohibited</li>
          <li><strong>Keyboard Restrictions:</strong> Certain keyboard shortcuts are disabled</li>
          <li><strong>Violation Limit:</strong> 4 violations will result in automatic termination</li>
          <li><strong>Privacy:</strong> Ensure you're alone in a private, quiet space</li>
        </ul>
      </div>

      <div class="instructions">
        <div class="instructions-title">
          <span>ℹ️</span>
          <span>Before You Begin</span>
        </div>
        <ul>
          <li>Ensure you're in a quiet, well-lit environment</li>
          <li>Check that your microphone and camera are working properly</li>
          <li>Have a stable internet connection</li>
          <li>Speak clearly and at a natural pace</li>
          <li>Close all other applications and browser tabs</li>
          <li>Disable notifications on your device</li>
        </ul>
      </div>

      <button
        class="start-btn"
        @click=${() => this.checkPermissions()}
        ?disabled=${!this.sessionData}
      >
        Start Interview
      </button>
    `}
        </div>
      </div>
            `
          : html`
              <div class="interview-container">
                <div class="top-bar">
                  <div class="top-bar-left">
                    <div class="top-logo">💼</div>
                    <div>
                      <div class="top-title">${this.sessionData?.jobTitle}</div>
                      <div class="top-subtitle">${this.sessionData?.candidateName}</div>
                    </div>
                  </div>
                  <div style="display: flex; gap: 12px; align-items: center;">
                    <div class="recording-badge"><span>🔴</span><span>REC</span></div>
                    ${this.violationCount > 0 ? html`
                        <div class="violation-badge"><span>⚠️</span><span>${this.violationCount}/${this.maxViolations}</span></div>
                    ` : ''}
                    <div class="timer-badge"><span>⏱️</span><span>${formatDuration(this.interviewDuration)}</span></div>
                  </div>
                </div>

                <div class="video-preview">
                  <video id="candidateVideo" autoplay playsinline muted
                    style="position: absolute; top: 90px; right: 20px; width: 200px; height: 150px;
                    border-radius: 12px; border: 2px solid #3b82f6; background: #000; object-fit: cover; z-index: 10;">
                  </video>
                </div>


${this.warningMessage ? html`
    <div class="warning-overlay">
        <div class="warning-box">
            <div class="warning-icon">⚠️</div>
            <div class="warning-title">Proctoring Notice</div>
            <div class="warning-text">${this.warningMessage}</div>
            ${this.violations.length > 0
              ? html`
                  <div class="warning-violation-list">
                    <strong>Recent Violations:</strong>
                    ${this.violations.slice(-3).map(
                      (v) => html`
                        <div class="warning-violation-item">
                          <span>⚠ </span>
                          <span>[${v.timestamp}] ${v.type}: ${v.description}</span>
                        </div>
                      `
                    )}
                  </div>
                `
              : ''}
            <button class="continue-btn" @click=${() => this.dismissWarning()}>
              I Understand - Continue
            </button>
        </div>
    </div>
` : ''}

                ${this.showFullscreenPrompt ? html`
                    <div class="fullscreen-prompt-overlay">
                        <div class="fullscreen-prompt-box">
                            <div class="fullscreen-prompt-title">Fullscreen Required</div>
                            <button class="reenter-fullscreen-btn" @click=${() => this.reenterFullscreen()}>Re-enter</button>
                        </div>
                    </div>
                ` : ''}

                <gdm-live-audio-visuals-3d
                  .inputNode=${this.inputNode}
                  .outputNode=${this.outputNode}
                ></gdm-live-audio-visuals-3d>

                <div class="bottom-section">
                  <div class="status-display"><span class="status-text">${this.status}</span></div>
                  <div class="controls">
                    <button class="control-btn" @click=${() => this.stop()} ?disabled=${!this.inSession}>End Interview</button>
                  </div>
                </div>
              </div>
            `}

${this.showCompletionPopup
  ? html`
      <div class="completion-popup-overlay">
        <div class="completion-popup-box">
          <div class="completion-popup-icon">⏳</div>
          <div class="completion-popup-title">Processing Your Interview</div>
          <div class="completion-popup-text">
            Please wait while we finalize your interview session and upload your recording.
            <br /><br />
            This process may take a few moments.
          </div>
          <div style="display: flex; justify-content: center; margin: 20px 0;">
            <div class="completion-spinner"></div>
          </div>
          <div class="completion-popup-warning">
            <span>⚠️</span>
            <span>Please do not close this tab or window until processing is complete</span>
          </div>
        </div>
      </div>
    `
  : ''}

${this.showThankYouPopup
  ? html`
      <div class="thank-you-overlay">
        <div class="thank-you-box" style="position: relative;">
          <!-- Close X button in top-right corner -->
          <button 
            class="thank-you-close-btn"
            @click=${() => this.closeThankYouPopup()}
            title="Close"
          >
            ×
          </button>
          <div class="thank-you-icon">🎉</div>
          <div class="thank-you-title">Thank You for Participating!</div>
          <div class="thank-you-text">
            Your interview has been successfully completed and submitted.
            <br /><br />
            We appreciate you taking the time to participate in this interview process. 
            Our team will review your responses and get back to you with the results soon.
          </div>

          <div class="thank-you-divider"></div>

          <div class="reattempt-section">
            <div class="reattempt-section-title">Faced Any Technical Issues?</div>
            <div class="reattempt-section-text">
              If you experienced any technical difficulties during the interview and believe 
              a reattempt is necessary, please let us know. Our HR team will review your request 
              and contact you accordingly.
            </div>
            <button 
              class="request-reattempt-btn" 
              @click=${() => this.handleRequestReattempt()}
            >
              Request Reattempt
            </button>
          </div>
                  <button 
            class="thank-you-ok-btn"
            @click=${() => this.closeThankYouPopup()}
          >
            OK, Got It!
          </button>
        </div>
      </div>
    `
  : ''}

${this.showReattemptForm
  ? html`
      <div class="reattempt-form-overlay">
        <div class="reattempt-form-box">
          <div class="reattempt-form-title">Request Interview Reattempt</div>
          <div class="reattempt-form-subtitle">
            Please describe the technical issues you faced during the interview
          </div>

          <div class="reattempt-form-group">
            <label class="reattempt-form-label">
              Reason for Reattempt Request <span style="color: #ef4444;">*</span>
            </label>
            <textarea
              class="reattempt-form-textarea"
              placeholder="Example: My internet connection dropped multiple times, causing interruptions in the interview..."
              .value=${this.reattemptReason}
              @input=${(e: any) => { this.reattemptReason = e.target.value; }}
            ></textarea>
          </div>

          <div class="reattempt-form-actions">
            <button 
              class="reattempt-form-cancel" 
              @click=${() => this.cancelReattemptRequest()}
              ?disabled=${this.submittingReattempt}
            >
              Cancel
            </button>
            <button 
              class="reattempt-form-submit" 
              @click=${() => this.submitReattemptRequest()}
              ?disabled=${this.submittingReattempt}
            >
              ${this.submittingReattempt 
                ? html`<div class="submit-spinner"></div><span>Submitting...</span>`
                : html`<span>Submit Request</span>`
              }
            </button>
          </div>
        </div>
      </div>
    `
  : ''}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'interview-component': InterviewComponent;
  }
}






