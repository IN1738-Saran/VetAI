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

import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { encode, decode, decodeAudioData } from './utils';
import './visual-3d';

const API_BASE = (import.meta.env.VITE_API_BASE || '/api');

@customElement('interview-component')
export class InterviewComponent extends LitElement {
  // -----------------------------------------------------------------------
  // UI & STATE
  // -----------------------------------------------------------------------
  @state() status = '';
  @state() error = '';
  @state() diagLog: string[] = []; // Visible on-screen diagnostic log (no API keys)
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
  private sessionHandle: string | null = null;
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




  // Azure Voice Live API configuration
  private ws: WebSocket | null = null;
  private voiceConfig: { endpoint: string; apiKey: string; model: string; apiVersion: string } | null = null;
  private wsOpen = false;
  private stopCalled = false;
  // Mic gate — prevents echo feeding back into VAD while AI is speaking
  private isModelSpeaking = false;
  private micGateTimer: ReturnType<typeof setTimeout> | null = null;
  // Greeting flag — true once first AI audio chunk arrives
  private greetingReceived = false;

  // Dynamic turn control & state machine
  private currentResponseId: string | null = null;
  private currentResponseMsgId: string | null = null;
  private cancelledResponseId: string | null = null;
  private currentAITranscriptBuffer = ''; // Real-time buffer for coaching phrase detection
  private silenceTriggerTimer: ReturnType<typeof setTimeout> | null = null;
  private isUserSpeaking = false;
  private playAudioImmediately = false;
  private bufferedAudioDeltas: Array<string> = [];
  
  // Explicit Turn State Machine & Interruption Guard Variables
  private hasCandidateAnsweredSinceLastAIQuestion = true; // True initially so greeting can fire
  private greetingSent = false; // Flag to prevent multiple greeting response.create calls
  private askedQuestionsList: Array<string> = [];
  private candidateExperienceLevel: 'FRESHER' | 'EXPERIENCED' = 'EXPERIENCED';
  private watchdogInterval: number | undefined = undefined;
  
  private currentPhase: 1 | 2 | 3 | 4 = 1;
  private phase1QuestionIndex = 0;
  private primaryQuestionCount = 0; // Tracks primary questions (0 to 20+)
  private followupCountForCurrentTopic = 0; // Tracks 3 to 5 follow-up questions per topic (0 to 4)
  private behavioralCount = 0;
  private activeTopicName = 'Introduction';
  private speechStartedGuardTimestamp = 0; // Prevents micro-interruptions during initial AI speech
  private lastTurnTriggerTimestamp = 0;

  private determineExperienceLevel(resumeText: string): 'FRESHER' | 'EXPERIENCED' {
    if (!resumeText) return 'FRESHER';
    const text = resumeText.toLowerCase();

    // Key phrases explicitly indicating Freshers
    const fresherKeywords = [
      'fresher', 'entry level', 'recent graduate', 'b.tech student', 'btech student',
      'b.e. student', 'm.tech student', 'graduate student', 'bachelor of', 'master of',
      'pursuing b.tech', 'pursuing btech', 'no professional experience', 'academic projects only',
      'campus placement', 'intern only', 'student'
    ];

    const isExplicitFresher = fresherKeywords.some(k => text.includes(k));
    
    // Key indicators for Experienced Candidates
    const yearsMatch = text.match(/(\d+)\+?\s*years?\s*(of)?\s*(experience|exp|work)/i);
    const yearsExp = yearsMatch ? parseInt(yearsMatch[1], 10) : 0;
    
    const experiencedTitles = ['senior', 'lead', 'architect', 'principal', 'manager', 'specialist', 'consultant', 'staff engineer'];
    const hasExperiencedTitle = experiencedTitles.some(t => text.includes(t));

    if (isExplicitFresher || (yearsExp === 0 && !hasExperiencedTitle && !text.includes('worked at') && !text.includes('company:'))) {
      if (yearsExp >= 2 || hasExperiencedTitle) {
        return 'EXPERIENCED';
      }
      return 'FRESHER';
    }

    return 'EXPERIENCED';
  }

  private isRepeatRequest(text: string): boolean {
    if (!text) return false;
    const clean = text.toLowerCase()
      .replace(/['`.,\/#!$%\^&\*;:{}=\-_~()?]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const repeatPhrases = [
      'can you repeat', 'could you repeat', 'repeat the question', 'repeat that',
      'repeat please', 'please repeat', 'pardon', 'pardon me', 'didnt catch that',
      'did not catch that', 'say that again', 'can you say that again',
      'could you say that again', 'what was the question', 'what is the question',
      'say again', 'come again'
    ];

    return repeatPhrases.some(p => clean.includes(p));
  }

  private isHesitationOrIDontKnow(text: string): boolean {
    if (!text) return false;
    const clean = text.toLowerCase()
      .replace(/['`.,\/#!$%\^&\*;:{}=\-_~()?]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const dontKnowPhrases = [
      'dont know', 'do not know', 'no idea', 'not sure', 'im not sure', 'i am not sure',
      'skip', 'skip this', 'next question', 'no concept', 'havent worked on', 'have not worked on',
      'no experience with', 'pass', 'can we move on', 'move to next', 'dont have experience',
      'not familiar', 'no knowledge'
    ];

    return dontKnowPhrases.some(p => clean.includes(p));
  }

  private isFillerSpeech(text: string): boolean {
    if (!text) return true;
    let clean = text.toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "") // remove punctuation
      .replace(/\s+/g, " ") // normalize spaces
      .trim();
    
    if (!clean) return true;

    const multiWordFillers = [
      'let me think', 'let me see', 'one second', 'wait a minute', 'just a moment', 'just a second',
      'let\'s see', 'hang on', 'give me a second', 'give me a moment', 'one moment', 'just a minute',
      'hold on a second', 'hold on a minute', 'give me a min', 'one min', 'wait a sec'
    ];

    multiWordFillers.forEach(f => {
      clean = clean.replaceAll(f, '').replace(/\s+/g, ' ').trim();
    });

    if (!clean) return true;

    const fillers = [
      'hmm', 'hm', 'hmmm', 'hmmmm', 'han', 'haan', 'ha', 'umm', 'um', 'ummm', 'uh', 'uhh', 'err', 'errr',
      'ah', 'ahh', 'haaan', 'haaa'
    ];

    if (fillers.includes(clean)) return true;

    // Check regex for pure non-word sound variations
    if (/^h+[m]+$/i.test(clean) || /^u+[m]+$/i.test(clean) || /^u+h+$/i.test(clean) || /^h+[a]+n+$/i.test(clean) || /^e+r+$/i.test(clean) || /^a+h+$/i.test(clean)) return true;

    return false;
  }

  private isCompletionPhrase(text: string): boolean {
    if (!text) return false;
    const clean = text.toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const completionPhrases = [
      'thats it', 'thats all', 'i am done', 'i am finished', 'im done', 'im finished',
      'thats my experience', 'go ahead', 'your turn', 'any questions', 'that covers it',
      'that is all', 'that is it'
    ];

    return completionPhrases.some(phrase => clean.endsWith(phrase));
  }

  private diag(msg: string) {
    const t = new Date().toLocaleTimeString('en-IN', { hour12: false });
    const entry = `[${t}] ${msg}`;
    console.log('🔍 DIAG:', entry);
    this.diagLog = [...this.diagLog.slice(-14), entry]; // Keep last 15 lines
  }

  private forceUngateMic() {
    if (this.micGateTimer) {
      clearTimeout(this.micGateTimer);
    }
    // 300ms decay buffer — ungates mic quickly so candidate answer is not muted or lost
    this.micGateTimer = window.setTimeout(() => {
      this.isModelSpeaking = false;
      if (this.workletNode) {
        this.workletNode.port.postMessage({ type: 'gate', value: false });
      }
      this.micGateTimer = null;
    }, 300);
  }

  private cancelActiveResponse() {
    if (this.currentResponseId) {
      this.cancelledResponseId = this.currentResponseId;
    }
    if (this.ws && this.wsOpen && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'response.cancel' }));
    }
    this.forceUngateMic();
  }

  private getSilenceDelay(text: string): number {
    const cleanText = text.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
    const words = cleanText.split(/\s+/).filter(Boolean);
    
    // 1. Check for completion phrases (instant response)
    if (this.isCompletionPhrase(text)) {
      return 0; // instant
    }
    
    // 2. Check for filler/thinking phrases
    if (this.isFillerSpeech(text)) {
      return 15000; // wait 15 seconds (virtually wait forever for continuation)
    }
    
    // 3. Check for mid-sentence trailing words or very short phrases (usually thinking pauses)
    const trailingWords = ['and', 'so', 'because', 'but', 'or', 'like', 'then', 'actually', 'mean', 'maybe'];
    const lastWord = words[words.length - 1] || '';
    const isTrailing = trailingWords.includes(lastWord);
    
    if (words.length < 6 || isTrailing) {
      console.log('⏳ Short segment or trailing word detected. Candidate is likely mid-sentence. Setting long silence timer (5.0s).');
      return 5000; // 5.0 seconds client wait (total 6.2s)
    }
    
    // 4. Substantive completed sentence
    console.log('🟢 Substantive completed sentence detected. Setting low-latency silence timer (2.0s).');
    return 2000; // 2.0 seconds client wait (total 3.2s)
  }

  private playAudioChunk(chunkData: string) {
    this.audioQueue = this.audioQueue.then(async () => {
      if (this.outputAudioContext.state === 'suspended') {
        await this.outputAudioContext.resume();
      }
      try {
        this.outputNode.connect(this.outputAudioContext.destination);
      } catch (e) {}
      const audioBuffer = await decodeAudioData(decode(chunkData), this.outputAudioContext, 24000, 1);
      this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
      const src = this.outputAudioContext.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(this.outputNode);
      this.sources.add(src);
      this.isModelSpeaking = true;
      if (this.workletNode) {
        this.workletNode.port.postMessage({ type: 'gate', value: true });
      }

      src.addEventListener('ended', () => {
        this.sources.delete(src);
        if (this.sources.size === 0) {
          console.log('🔊 Speaker audio playback completed. Ungating mic for candidate.');
          this.forceUngateMic();
        }
      });

      src.start(this.nextStartTime);
      this.nextStartTime += audioBuffer.duration;
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

  static styles = css`

  .headphone-noise-confirmation {
  background: #fef3c7;
  border: 3px solid #f59e0b;
  border-radius: 12px;
  padding: 20px;
  margin-top: 16px;
  text-align: left;
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
}

.headphone-noise-confirmation.checked {
  border-color: #22c55e;
  background: #f0fdf4;
}

.headphone-noise-label {
  font-size: 14px;
  color: black;
  line-height: 1.6;
  cursor: pointer;
  font-weight: 700;
}

.headphone-noise-label strong {
  color: #dc2626;
  font-weight: 900;
  text-transform: uppercase;
}

.headphone-noise-label .highlight-text {
  color: #dc2626;
  font-weight: 900;
  background: rgba(220, 38, 38, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}

.recheck-headphones-btn:hover {
  background: #e2e8f0;
  transform: translateY(-1px);
}

.recheck-headphones-btn:active {
  transform: translateY(0);
}

  .thank-you-close-btn {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 40px;
  height: 40px;
  background: rgba(255, 255, 255, 0.9);
  border: 2px solid #10b981;
  border-radius: 50%;
  font-size: 20px;
  font-weight: 700;
  color: #065f46;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.thank-you-close-btn:hover {
  background: white;
  transform: scale(1.1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.thank-you-ok-btn {
  padding: 14px 40px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 16px rgba(16, 185, 129, 0.3);
  margin-top: 24px;
}

.thank-you-ok-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.4);
}

.start-prompt-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  z-index: 4500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  animation: fadeIn 0.3s ease;
}

.start-prompt-box {
  background: linear-gradient(135deg, #fef3c7 0%, #fed7aa 100%);
  padding: 40px 50px;
  border-radius: 20px;
  max-width: 480px;
  width: 100%;
  text-align: center;
  box-shadow: 0 25px 80px rgba(0, 0, 0, 0.4);
  border: 3px solid #f97316;
  animation: slideUp 0.5s ease;
}

.start-prompt-notice {
  display: inline-block;
  background: #f97316;
  color: white;
  padding: 8px 24px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  margin-bottom: 20px;
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
}

.start-prompt-icon {
  font-size: 64px;
  margin-bottom: 20px;
  animation: pulse 2s ease-in-out infinite;
  filter: drop-shadow(0 4px 8px rgba(249, 115, 22, 0.3));
}

.start-prompt-title {
  font-size: 24px;
  font-weight: 700;
  color: #c2410c;
  margin-bottom: 16px;
  letter-spacing: -0.5px;
}

.start-prompt-text {
  color: #9a3412;
  font-size: 16px;
  line-height: 1.7;
  margin-bottom: 28px;
}

.start-prompt-text strong {
  color: #ea580c;
  font-weight: 700;
}

.start-prompt-btn {
  padding: 14px 40px;
  background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 16px rgba(249, 115, 22, 0.4);
}

.start-prompt-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(249, 115, 22, 0.5);
  background: linear-gradient(135deg, #ea580c 0%, #dc2626 100%);
}

  .completion-popup-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(10px);
  z-index: 5000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  animation: fadeIn 0.3s ease;
}

.completion-popup-box {
  background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
  padding: 50px;
  border-radius: 24px;
  max-width: 520px;
  width: 100%;
  text-align: center;
  box-shadow: 0 25px 80px rgba(0, 0, 0, 0.5);
  border: 3px solid #3b82f6;
}

.completion-popup-icon {
  font-size: 72px;
  margin-bottom: 24px;
  animation: pulse 2s ease-in-out infinite;
}

.completion-popup-title {
  font-size: 26px;
  font-weight: 700;
  color: #1e40af;
  margin-bottom: 16px;
  letter-spacing: -0.5px;
}

.completion-popup-text {
  color: #1e40af;
  font-size: 16px;
  line-height: 1.8;
  margin-bottom: 28px;
}

.completion-popup-warning {
  background: rgba(251, 191, 36, 0.15);
  border: 2px solid #fbbf24;
  border-radius: 12px;
  padding: 16px;
  margin-top: 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  color: #92400e;
  font-weight: 600;
}

.completion-spinner {
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 3px solid #3b82f6;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

  .permission-check-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  z-index: 4000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 40px 20px;
  overflow-y: auto;
  animation: fadeIn 0.3s ease;
}

.permission-check-box {
  background: white;
  padding: 40px;
  border-radius: 20px;
  max-width: 600px;
  width: 100%;
  text-align: center;
  box-shadow: 0 25px 80px rgba(0, 0, 0, 0.4);
  border: 2px solid #3b82f6;
  margin-bottom: 40px;
}

.permission-check-title {
  font-size: 24px;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 12px;
}

.permission-check-subtitle {
  color: #64748b;
  font-size: 14px;
  margin-bottom: 32px;
}

.permission-check-items {
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin-bottom: 32px;
}

.permission-item {
  background: #f8fafc;
  padding: 24px;
  border-radius: 12px;
  border: 2px solid #e2e8f0;
  text-align: left;
}

.permission-item.granted {
  border-color: #22c55e;
  background: #f0fdf4;
}

.permission-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.permission-item-title {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 16px;
  font-weight: 600;
  color: #1e293b;
}

.permission-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}

.permission-status.granted {
  background: #dcfce7;
  color: #15803d;
}

.permission-status.pending {
  background: #fef3c7;
  color: #92400e;
}

.permission-status.denied {
  background: #fee2e2;
  color: #991b1b;
}

.test-video-container {
  position: relative;
  width: 100%;
  height: 200px;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
  margin-top: 12px;
}

.test-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.audio-level-container {
  margin-top: 12px;
}

.audio-level-bar {
  width: 100%;
  height: 20px;
  background: #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
  position: relative;
}

.audio-level-fill {
  height: 100%;
  background: linear-gradient(90deg, #22c55e 0%, #16a34a 100%);
  transition: width 0.1s ease;
  border-radius: 10px;
}

.audio-level-text {
  font-size: 12px;
  color: #64748b;
  margin-top: 6px;
  text-align: center;
}

.permission-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
      margin-top: 15px;
}

.retry-permission-btn {
  padding: 12px 24px;
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
}

.retry-permission-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(245, 158, 11, 0.4);
}

.continue-permission-btn {
  padding: 12px 32px;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 16px rgba(59, 130, 246, 0.3);
}

.continue-permission-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(59, 130, 246, 0.4);
}

.continue-permission-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.completion-thank-you-box {
  background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
  border: 2px solid #10b981;
  border-radius: 16px;
  padding: 24px;
  margin: 24px 0;
  text-align: center;
}

.completion-thank-you-title {
  font-size: 20px;
  font-weight: 700;
  color: #065f46;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.completion-thank-you-text {
  font-size: 15px;
  color: #047857;
  line-height: 1.6;
  margin-bottom: 20px;
}

.request-reattempt-btn {
  padding: 14px 32px;
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 16px rgba(245, 158, 11, 0.3);
}

.request-reattempt-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(245, 158, 11, 0.4);
}

.thank-you-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(10px);
  z-index: 5000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  animation: fadeIn 0.3s ease;
}

.thank-you-box {
  background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
  padding: 50px;
  border-radius: 24px;
  max-width: 580px;
  width: 100%;
  text-align: center;
  box-shadow: 0 25px 80px rgba(0, 0, 0, 0.5);
  border: 3px solid #10b981;
}

.thank-you-icon {
  font-size: 72px;
  margin-bottom: 24px;
  animation: pulse 2s ease-in-out infinite;
}

.thank-you-title {
  font-size: 28px;
  font-weight: 700;
  color: #065f46;
  margin-bottom: 16px;
  letter-spacing: -0.5px;
}

.thank-you-text {
  color: #047857;
  font-size: 16px;
  line-height: 1.8;
  margin-bottom: 32px;
}

.thank-you-divider {
  height: 2px;
  background: linear-gradient(90deg, transparent, #10b981, transparent);
  margin: 32px 0;
}

.reattempt-section {
  background: rgba(255, 255, 255, 0.7);
  border-radius: 16px;
  padding: 24px;
  margin-top: 24px;
}

.reattempt-section-title {
  font-size: 16px;
  font-weight: 600;
  color: #065f46;
  margin-bottom: 12px;
}

.reattempt-section-text {
  font-size: 14px;
  color: #047857;
  line-height: 1.6;
  margin-bottom: 20px;
}

.request-reattempt-btn {
  padding: 14px 32px;
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 16px rgba(245, 158, 11, 0.3);
}

.request-reattempt-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(245, 158, 11, 0.4);
}

.reattempt-form-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.9);
  backdrop-filter: blur(12px);
  z-index: 5500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  animation: fadeIn 0.3s ease;
}

.reattempt-form-box {
  background: white;
  padding: 40px;
  border-radius: 20px;
  max-width: 540px;
  width: 100%;
  box-shadow: 0 25px 80px rgba(0, 0, 0, 0.6);
  border: 2px solid #f59e0b;
}

.reattempt-form-title {
  font-size: 24px;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 12px;
}

.reattempt-form-subtitle {
  color: #64748b;
  font-size: 14px;
  margin-bottom: 24px;
}

.reattempt-form-group {
  margin-bottom: 20px;
  text-align: left;
}

.reattempt-form-label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
  margin-bottom: 8px;
}

.reattempt-form-textarea {
  width: 100%;
  min-height: 120px;
  padding: 12px;
  border: 2px solid #e2e8f0;
  border-radius: 12px;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
  transition: all 0.3s ease;
}

.reattempt-form-textarea:focus {
  outline: none;
  border-color: #f59e0b;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.1);
}

.reattempt-form-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 24px;
}

.reattempt-form-cancel {
  padding: 12px 24px;
  background: #f1f5f9;
  color: #64748b;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
}

.reattempt-form-cancel:hover {
  background: #e2e8f0;
}

.reattempt-form-submit {
  padding: 12px 28px;
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  color: white;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  gap: 8px;
}

.reattempt-form-submit:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(245, 158, 11, 0.4);
}

.reattempt-form-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.submit-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid white;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

.completed-info-box {
  background: linear-gradient(135d, #dbeafe 0%, #bfdbfe 100%);
  border: 2px solid #3b82f6;
  border-radius: 16px;
  padding: 32px;
  margin: 24px 0;
  text-align: center;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);
}

.completed-info-icon {
  font-size: 64px;
  margin-bottom: 20px;
}

.completed-info-title {
  font-size: 24px;
  font-weight: 700;
  color: #1e40af;
  margin-bottom: 12px;
}

.completed-info-text {
  font-size: 15px;
  color: #1e3a8a;
  line-height: 1.7;
  margin-bottom: 20px;
}

.completed-info-details {
  background: rgba(255, 255, 255, 0.7);
  border-radius: 12px;
  padding: 16px;
  margin-top: 20px;
  text-align: left;
}

.completed-info-details p {
  font-size: 14px;
  color: #1e40af;
  margin: 8px 0;
}

.completed-info-details strong {
  color: #1e293b;
}


    .warning-violation-list { background: rgba(255, 255, 255, 0.7); border-radius: 12px; padding: 16px; margin: 20px 0; text-align: left; }
    .warning-violation-list strong { color: #92400e; font-size: 14px; display: block; margin-bottom: 12px; }
    .warning-violation-item { display: flex; align-items: flex-start; gap: 8px; padding: 8px; background: rgba(251, 191, 36, 0.1); border-radius: 8px; margin-bottom: 8px; font-size: 12px; color: #78350f; }
    .warning-violation-item:last-child { margin-bottom: 0; }
    .warning-icon { font-size: 56px; margin-bottom: 20px; }
    .fullscreen-prompt-icon { font-size: 56px; margin-bottom: 20px; }
    .fullscreen-prompt-title { font-size: 22px; font-weight: 700; color: #1e40af; margin-bottom: 16px; }
    .fullscreen-prompt-text { color: #1e40af; font-size: 15px; line-height: 1.7; margin-bottom: 24px; }

.error-icon { font-size: 64px; margin-bottom: 20px; animation: pulse 2s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
.error-help { font-size: 14px; color: #7f1d1d; padding: 12px 16px; background: rgba(255, 255, 255, 0.6); border-radius: 8px; margin-top: 16px; }

.logo-section { margin-bottom: 24px; }

.proctoring-warning { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 2px solid #fbbf24; border-radius: 16px; padding: 20px; margin: 20px 0; text-align: left; box-shadow: 0 4px 12px rgba(251, 191, 36, 0.2); }
.proctoring-warning-title { color: #92400e; font-weight: 700; font-size: 14px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
.proctoring-warning ul { margin: 8px 0 0 0; padding-left: 20px; color: #78350f; font-size: 13px; line-height: 1.8; }
.proctoring-warning ul li { margin-bottom: 4px; }
.proctoring-warning ul li strong { color: #92400e; }

.instructions { background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%); border: 2px solid #3b82f6; border-radius: 16px; padding: 20px; margin: 20px 0; text-align: left; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2); }
.instructions-title { color: #1e40af; font-weight: 700; font-size: 14px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
.instructions ul { margin: 8px 0 0 0; padding-left: 20px; color: #1e40af; font-size: 13px; line-height: 1.8; }
.instructions ul li { margin-bottom: 4px; }
    :host { display: block; width: 100%; height: 100vh; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }

    .welcome-screen { position: fixed; inset: 0; background: linear-gradient(135deg, #f5f7fa 0%, #e4e8ec 100%); z-index: 1000; display: flex; align-items: center; justify-content: center; animation: fadeIn 0.6s ease; padding: 20px; overflow-y: auto; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .welcome-content { max-width: 720px; width: 100%; max-height: calc(100vh - 40px); padding: 40px 50px; background: #ffffff; border-radius: 24px; text-align: center; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.08), 0 0 1px rgba(0, 0, 0, 0.1); animation: slideUp 0.7s ease; border: 1px solid rgba(0, 0, 0, 0.04); overflow-y: auto; margin: auto; }
    @keyframes slideUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }

    .error-box { background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%); border: 2px solid #ef4444; border-radius: 16px; padding: 32px; margin: 24px 0; text-align: center; animation: shake 0.5s ease; box-shadow: 0 8px 24px rgba(239, 68, 68, 0.2); }
    @keyframes shake { 0%, 100% { transform: translateX(0); } 10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); } 20%, 40%, 60%, 80% { transform: translateX(5px); } }
    .error-title { font-size: 24px; font-weight: 700; color: #dc2626; margin-bottom: 16px; }
    .error-message { font-size: 16px; color: #991b1b; line-height: 1.7; white-space: pre-wrap; margin-bottom: 24px; }

        .retry-info-box { background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%); border: 2px solid #3b82f6; border-radius: 16px; padding: 24px; margin: 24px 0; text-align: center; }
    .retry-info-title { font-size: 20px; font-weight: 700; color: #1e40af; margin-bottom: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; }
    .retry-info-text { font-size: 15px; color: #1e3a8a; line-height: 1.6; margin-bottom: 12px; }
    .retry-timer { font-size: 24px; font-weight: 700; color: #1e40af; font-family: 'Courier New', monospace; }
    .attempt-badge { display: inline-block; padding: 6px 12px; background: #3b82f6; color: white; border-radius: 8px; font-size: 13px; font-weight: 600; margin-top: 8px; }

    .logo-icon { width: 56px; height: 56px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); border-radius: 16px; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 8px 24px rgba(59, 130, 246, 0.2); margin-bottom: 16px; }
    .logo-icon img { width: 100%; height: 100%; object-fit: contain; border-radius: 10px; }
    .welcome-content h1 { font-size: 28px; color: #1e293b; margin: 0 0 10px 0; font-weight: 700; }
    .welcome-subtitle { color: #64748b; font-size: 15px; margin-bottom: 24px; }

    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 24px 0; }
    .info-box { background: #f8fafc; padding: 20px; border-radius: 16px; border: 1px solid #e2e8f0; text-align: left; }
    .info-label { color: #64748b; font-size: 12px; font-weight: 600; text-transform: uppercase; margin-bottom: 6px; }
    .info-value { color: #1e293b; font-size: 16px; font-weight: 600; margin: 0; }

    .proctoring-warning { background: #fef3c7; border: 2px solid #fbbf24; border-radius: 12px; padding: 16px; margin: 20px 0; text-align: left; }
    .proctoring-warning-title { color: #92400e; font-weight: 700; font-size: 13px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
    .proctoring-warning ul { margin: 0; padding-left: 20px; color: #78350f; font-size: 13px; line-height: 1.6; }

    .start-btn { width: 100%; padding: 16px 32px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; border: none; border-radius: 12px; font-size: 16px; font-weight: 600; cursor: pointer; transition: all 0.3s ease; box-shadow: 0 4px 16px rgba(59, 130, 246, 0.3); margin-top: 20px; }
    .start-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .interview-container { height: 100vh; width: 100vw; display: flex; flex-direction: column; background: linear-gradient(135deg, #f5f7fa 0%, #e4e8ec 100%); position: relative; }
    .top-bar { background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(10px); padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(0, 0, 0, 0.05); z-index: 100; }
    .top-bar-left { display: flex; align-items: center; gap: 12px; }
    .top-title { font-size: 16px; font-weight: 600; color: #1e293b; }
    .top-subtitle { font-size: 13px; color: #64748b; }

    .violation-badge { display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; font-size: 12px; font-weight: 600; color: #856404; }
    .timer-badge { display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: #e0f2fe; border: 1px solid #0ea5e9; border-radius: 8px; font-size: 12px; font-weight: 600; color: #0369a1; font-family: 'Courier New', monospace; }
    .recording-badge { display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: #dcfce7; border: 1px solid #22c55e; border-radius: 8px; font-size: 12px; font-weight: 600; color: #15803d; font-family: 'Courier New', monospace; }
    .attempt-badge-small { display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: #dbeafe; border: 1px solid #3b82f6; border-radius: 8px; font-size: 12px; font-weight: 600; color: #1e40af; font-family: 'Courier New', monospace; }

    .video-preview { position: relative; }
    
    .bottom-section { position: fixed; bottom: 0; left: 0; right: 0; padding: 24px; background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(10px); border-top: 1px solid rgba(0, 0, 0, 0.05); display: flex; flex-direction: column; gap: 16px; align-items: center; z-index: 100; box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.04); }
    .status-display { font-size: 14px; color: #64748b; display: flex; align-items: center; gap: 8px; }
    .status-icon { animation: spin 2s linear infinite; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .control-btn { padding: 14px 28px; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; border: none; border-radius: 12px; font-size: 15px; font-weight: 600; cursor: pointer; transition: all 0.3s ease; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 16px rgba(239, 68, 68, 0.3); }
    .control-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .warning-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px); z-index: 2000; display: flex; align-items: center; justify-content: center; padding: 20px; animation: fadeIn 0.3s ease; }
    .warning-box { background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); padding: 32px; border-radius: 16px; max-width: 500px; width: 100%; text-align: center; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3); border: 2px solid #fbbf24; }
    .warning-title { font-size: 20px; font-weight: 700; color: #92400e; margin-bottom: 12px; }
    .continue-btn { padding: 12px 24px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }

    .fullscreen-prompt-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(8px); z-index: 3000; display: flex; align-items: center; justify-content: center; padding: 20px; animation: fadeIn 0.3s ease; }
    .fullscreen-prompt-box { background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); padding: 40px; border-radius: 20px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 25px 80px rgba(0, 0, 0, 0.4); border: 2px solid #3b82f6; }
    .reenter-fullscreen-btn { padding: 14px 32px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; border: none; border-radius: 12px; font-size: 16px; font-weight: 600; cursor: pointer; }

    .alone-room-confirmation {
  background: #f8fafc;
  border: 2px solid #e2e8f0;
  border-radius: 12px;
  padding: 20px;
  margin-top: 24px;
  text-align: left;
}

.alone-room-confirmation.checked {
  border-color: #22c55e;
  background: #f0fdf4;
}

.checkbox-container {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  cursor: pointer;
}

.checkbox-container input[type="checkbox"] {
  width: 20px;
  height: 20px;
  margin-top: 2px;
  cursor: pointer;
  accent-color: #3b82f6;
}

.checkbox-label {
  font-size: 14px;
  color: #1e293b;
  line-height: 1.6;
  cursor: pointer;
}

.checkbox-label strong {
  color: #dc2626;
  font-weight: 700;
}

.headphone-warning {
  background: #fef3c7;
  border: 2px solid #fbbf24;
  border-radius: 8px;
  padding: 12px;
  margin-top: 12px;
  font-size: 13px;
  color: #92400e;
  display: flex;
  align-items: center;
  gap: 8px;
}
  `;

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
      const res = await fetch(`${API_BASE}/interview/${this.sessionId}/token`, { method: 'POST' });
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
        if (triggerResponse) {
          this.ws.send(JSON.stringify({ type: 'response.create' }));
        }
        console.log('🗣️ Sent system/progress note to Azure (triggerResponse=' + triggerResponse + '):', text.substring(0, 50) + '...');
      } catch (e) {
        console.warn('Failed to send text note to Azure session:', e);
      }
    }
  }

private async loadSessionData() {
  try {
    const r = await fetch(`${API_BASE}/interview/${this.sessionId}`);
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

    // Reset Interview State Machine
    this.currentPhase = 1;
    this.phase1QuestionIndex = 0;
    this.primaryQuestionCount = 0;
    this.followupCountForCurrentTopic = 0;
    this.behavioralCount = 0;

    // Determine Candidate Experience Level from Resume
    this.candidateExperienceLevel = this.determineExperienceLevel(this.sessionData?.resumeText || '');
    console.log(`👤 Candidate Experience Level Classified: [${this.candidateExperienceLevel}]`);

    const systemInstruction = `You are a strict, senior technical interviewer conducting a live job interview for Systech. Your only job is to evaluate the candidate by asking structured questions and listening to their responses. You do NOT coach, encourage, or assist the candidate in any way. Conduct the entire interview in English.

CANDIDATE EXPERIENCE LEVEL: [${this.candidateExperienceLevel}]

${this.candidateExperienceLevel === 'FRESHER' ? `FRESHER RULES:
- Candidate has NO corporate or production experience.
- ONLY ask about: academic projects, internships, core fundamentals, and hypothetical scenarios.
- NEVER ask about managing clients, production deployments, or stakeholder meetings.
` : `EXPERIENCED PROFESSIONAL RULES:
- Ask about actual production systems, architecture decisions, real-world debugging, and measurable impact.
`}

CRITICAL BEHAVIOR RULES — NON-NEGOTIABLE:

RULE 1: ONE QUESTION AT A TIME.
Ask exactly ONE question per turn. Stop after asking the question and let the candidate speak.

RULE 2: NEVER INTERRUPT.
If the candidate is speaking, do not interrupt. Wait until their turn completes.

RULE 3: NO FILLER OR COACHING PHRASES — NEVER USE ANY OF THESE:
"Take your time" / "Whenever you are ready" / "I am here to listen" / "Feel free to take a moment" / "Please let me know when you are ready" / "I am ready to listen" / "No worries" / "That is okay" / "Good answer" / "Great" / "Interesting" / "Let us start with the basics" / "I will ask an easier question" / "Now I am moving to the technical evaluation" / "Now we will start the behavioral evaluation" / "Now we move to the next phase" / "I will wait" / "Take your own time" / "Whenever you are confident" / Any phrase that coaches, hints, encourages, or announces internal interview strategy.

RULE 4: NO PHASE ANNOUNCEMENTS.
Never say what phase you are in or transitioning to. Transition between phases naturally without announcing phase names.

RULE 5: NO COACHING.
You are an EVALUATOR ONLY. Never hint at answers or suggest approaches.

RULE 6: I DO NOT KNOW HANDLING.
If candidate says "I don't know", "skip", "not sure" — ask a simpler fundamental question on the same topic directly without announcing difficulty change.

RULE 7: REPEAT REQUESTS.
If candidate says "Can you repeat?", "Pardon?", "What was the question?" — repeat the EXACT previous question word-for-word.

INTERVIEW STRUCTURE:

PHASE 1 — INTRODUCTION (2 QUESTIONS ONLY — NO FOLLOW-UPS ALLOWED):
- Question 1: "What do you know about Systech?"
- Question 2: "Please give me a brief introduction about yourself and your background."
- ABSOLUTELY NO FOLLOW-UP QUESTIONS IN PHASE 1. After both introduction questions are answered, transition directly to Phase 2 (Technical Evaluation).

PHASE 2 — TECHNICAL EVALUATION (85% of interview):
- Ask minimum 17 primary technical questions derived from Resume and Job Description.
- For each primary question, ask 3 to 5 contextual follow-up questions probing: internals, edge cases, debugging, performance, architecture.
- Behavioral questions are FORBIDDEN during Phase 2.

PHASE 3 — BEHAVIORAL EVALUATION (15% of interview):
- Ask minimum 3 primary behavioral questions.
- For each, probe for STAR details (Situation, Task, Action, Result).
- Technical questions are FORBIDDEN during Phase 3.

PHASE 4 — CLOSING:
- Ask once: "Do you have any questions for me?"
- End permanently with EXACTLY: "Thank you, ${this.sessionData.candidateName}. It was a pleasure speaking with you today. We appreciate the time you took to participate in this interview. The team will review your interview and follow up within a few business days. Have a wonderful day, and we wish you the very best."

REQUIREMENTS:
- Minimum 20 primary questions (17 technical + 3 behavioral). Follow-up questions are unlimited.
- Never end before 30 minutes AND 20 primary questions are completed.
- Never repeat a question already asked in this session.
- Always derive questions from the candidate Resume and Job Description.

---
ROLE: ${this.sessionData.jobTitle}

JOB DESCRIPTION:
${this.sessionData.jobDescription}

CANDIDATE: ${this.sessionData.candidateName}

RESUME:
${this.sessionData.resumeText || 'No resume provided.'}
---

START IMMEDIATELY — say this greeting now:
"Hello ${this.sessionData.candidateName}, welcome to your interview with Systech. I am your AI interviewer for today. Let us get started. My first question is — what do you know about Systech?"`;

    try {
      // Parse host from configuration
      let host = this.voiceConfig.endpoint;
      if (host.startsWith('https://')) {
        host = host.substring(8);
      } else if (host.startsWith('http://')) {
        host = host.substring(7);
      } else if (host.startsWith('wss://')) {
        host = host.substring(6);
      } else if (host.startsWith('ws://')) {
        host = host.substring(5);
      }
      if (host.endsWith('/')) {
        host = host.substring(0, host.length - 1);
      }
      if (!host.includes('.')) {
        host = `${host}.services.ai.azure.com`;
      }

      // Determine the correct WebSocket URL path based on endpoint type:
      // openai.azure.com  -> /openai/realtime (standard Azure OpenAI)
      // services.ai.azure.com -> /voice-live/realtime (Azure AI Foundry Voice Live)
      // cognitiveservices.azure.com -> /openai/realtime (Cognitive Services)
      let wsUrl = '';
      const isVoiceLiveFoundry = host.includes('services.ai.azure.com');
      const isStandardOpenAI = host.includes('openai.azure.com');
      const isCognitiveServices = host.includes('cognitiveservices.azure.com');

      if (isVoiceLiveFoundry) {
        wsUrl = `wss://${host}/voice-live/realtime?api-version=${this.voiceConfig.apiVersion}&model=${this.voiceConfig.model}&api-key=${this.voiceConfig.apiKey}`;
      } else if (isStandardOpenAI || isCognitiveServices) {
        wsUrl = `wss://${host}/openai/realtime?api-version=${this.voiceConfig.apiVersion}&deployment=${this.voiceConfig.model}&api-key=${this.voiceConfig.apiKey}`;
      } else {
        // Unknown endpoint format — try standard OpenAI path
        wsUrl = `wss://${host}/openai/realtime?api-version=${this.voiceConfig.apiVersion}&deployment=${this.voiceConfig.model}&api-key=${this.voiceConfig.apiKey}`;
      }

      // Log the wsUrl (with API key masked for security)
      const maskedUrl = wsUrl.replace(/api-key=[^&]+/, 'api-key=***');
      this.diag(`Endpoint type: ${isVoiceLiveFoundry ? 'Azure AI Foundry' : isStandardOpenAI ? 'Azure OpenAI' : 'Unknown'}`);
      this.diag(`Model: ${this.voiceConfig.model} | API Version: ${this.voiceConfig.apiVersion}`);
      this.diag(`Connecting to: ${maskedUrl.substring(0, 60)}...`);
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

        // Configure session — minimal required fields only for broad model compatibility.
        const sessionUpdate = {
          type: 'session.update',
          session: {
            modalities: ['audio'],
            instructions: systemInstruction,
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 1000  // 1.0s — fast low latency response
            }
          }
        };
        this.ws!.send(JSON.stringify(sessionUpdate));
        this.diag('📤 session.update sent — waiting for session.updated...');

        if (!resumeHandle) {
          this.greetingReceived = false;
          this.greetingSent = false;
          this.hasCandidateAnsweredSinceLastAIQuestion = false;
          this.speechStartedGuardTimestamp = Date.now();
        } else {
          this.reconnectionInProgress = false;
          this.conversationStateBeforeDisconnect = null;
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
            this.forceUngateMic();

            // If session update error occurs, send safe fallback session.update
            if (message.error?.message && !this.greetingReceived) {
              this.diag('⚠️ Sending fallback session.update...');
              const fallbackSessionUpdate = {
                type: 'session.update',
                session: {
              modalities: ['audio'],
                  instructions: systemInstruction,
                  turn_detection: { type: 'server_vad', threshold: 0.5, silence_duration_ms: 2000 }
                }
              };
              if (this.ws && this.wsOpen) {
                this.ws.send(JSON.stringify(fallbackSessionUpdate));
                const greetingInstruction = `Speak your opening greeting now out loud to candidate ${this.sessionData.candidateName}: "Hello ${this.sessionData.candidateName}, welcome to your interview with Systech. I'm your AI interviewer for today. Let's get started. My first question is — what do you know about Systech?"`;
                this.ws.send(JSON.stringify({ type: 'response.create', response: { modalities: ['audio'], instructions: greetingInstruction } }));
              }
            }
            return;
          }

          // Handle session.updated confirmation from Azure -> Trigger opening greeting exactly ONCE
          if (message.type === 'session.updated') {
            this.diag('✅ session.updated confirmed by Azure!');
            if (!this.greetingSent && !this.greetingReceived) {
              this.greetingSent = true;
              this.diag('🎤 Sending single response.create for opening greeting...');
              const greetingInstruction = `Speak your opening greeting now out loud to candidate ${this.sessionData.candidateName}: "Hello ${this.sessionData.candidateName}, welcome to your interview with Systech. I'm your AI interviewer for today. Let's get started. My first question is — what do you know about Systech?"`;
              this.ws?.send(JSON.stringify({
                type: 'response.create',
                response: { modalities: ['audio'], instructions: greetingInstruction }
              }));
            }
          }

          // Track response creation & user speech protection
          if (message.type === 'response.created' && message.response) {
            this.diag(`📨 response.created: id=${message.response.id}`);
            this.currentAITranscriptBuffer = ''; // Reset for fresh phrase detection
            this.currentResponseId = message.response.id;
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

          // 1a. REAL-TIME AI transcript monitoring — cancel response immediately if coaching phrase detected
          if (message.type === 'response.audio_transcript.delta' && message.delta) {
            if (message.response_id === this.cancelledResponseId) return;

            // Accumulate transcript delta for this response
            if (!this.currentAITranscriptBuffer) this.currentAITranscriptBuffer = '';
            this.currentAITranscriptBuffer += message.delta;
            const bufLower = this.currentAITranscriptBuffer.toLowerCase();

            // Banned coaching phrases — cancel response the instant any are detected
            const bannedPhrases = [
              'take your time', 'whenever you are ready', 'whenever you\'re ready',
              'i\'m here to listen', 'i am here to listen',
              'feel free to take a moment', 'feel free',
              'please let me know when you are ready', 'let me know when you are ready',
              'i\'ll wait', 'i will wait', 'i\'m waiting', 'i am waiting',
              'i\'m ready to listen', 'i am ready to listen',
              'no worries', 'that\'s okay', 'that is okay',
              'i\'ll give you a moment', 'i will give you a moment',
              'i\'m here whenever', 'please take your time',
              'moving to the technical', 'moving to the behavioral',
              'next phase', 'phase 2', 'phase 3', 'technical evaluation',
              'behavioral evaluation', 'behavioral round',
              'i\'ll ask an easier', 'let me ask something easier',
              'start with the basics', 'ask a simpler',
              'thank you for your response', 'thank you for sharing'
            ];

            const detected = bannedPhrases.find(phrase => bufLower.includes(phrase));
            if (detected) {
              console.warn(`🚫 BANNED PHRASE DETECTED mid-stream: "${detected}" — cancelling response NOW`);
              this.cancelActiveResponse();
              this.currentAITranscriptBuffer = '';
              this.cleanupAudioPlayback();
              this.forceUngateMic();
              return;
            }
          }

          // 1. AI Speech Transcription & Early Closing Prevention
          if (message.type === 'response.audio_transcript.done' && message.transcript) {
            this.currentAITranscriptBuffer = ''; // Reset buffer for next response
            if (message.response_id === this.cancelledResponseId) {
              console.log('🗑️ Discarding transcript of cancelled response:', message.response_id);
              return;
            }
            const text = message.transcript.trim();
            this.lastAIMessage = text;
            this.lastAIMessageTime = Date.now();
            this.aiWasSpeaking = true;

            // EARLY CLOSING INTERCEPTION (< 30 mins / 1800s)
            const isClosingPhrase = text.includes('Do you have any questions for me') || text.includes('Thank you,') || text.includes('pleasure speaking with you today');
            if (this.interviewDuration < 1800 && isClosingPhrase) {
              console.warn('🛑 Early Closing Intercepted! Elapsed time is only ' + Math.floor(this.interviewDuration / 60) + ' min. Minimum duration is 30 minutes.');
              this.cancelActiveResponse();
              this.sendRealtimeText(
                `[SYSTEM NOTE: REJECTED EARLY CLOSING - Elapsed time is only ${Math.floor(this.interviewDuration / 60)} minutes. You are strictly forbidden from closing before 30 minutes. Ask the next technical primary question or follow-up question now.]`,
                true
              );
              return;
            }

            // Reset flag: candidate has not answered this newly delivered AI question yet
            this.hasCandidateAnsweredSinceLastAIQuestion = false;

            if (text && !this.askedQuestionsList.includes(text)) {
              this.askedQuestionsList.push(text);
            }

            // Sync AI transcription turn in real-time
            if (text) {
              const entry = { role: 'AI Interviewer', text: text, timestamp: new Date().toISOString() };
              this.transcript = [...this.transcript, entry];
              fetch(`${API_BASE}/interview/${this.sessionId}/transcript`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transcript: entry })
              }).catch(err => console.error('Error posting transcript:', err));
            }
          }

          // 2. Turn completion
          if (message.type === 'response.done') {
            this.aiWasSpeaking = false;
            this.forceUngateMic();
          }

          // 3. User Speech Stopped Event -> Rapid Turn Trigger
          if (message.type === 'input_audio_buffer.speech_stopped') {
            console.log('🎙️ User speech stopped. Evaluating turn trigger...');
            this.isUserSpeaking = false;
          }

          if (message.type === 'conversation.item.input_audio_transcription.completed' && message.transcript) {
            this.lastUserMessage = message.transcript;
            this.lastUserMessageTime = Date.now();
            this.isUserSpeaking = false;

            const text = message.transcript.trim();
            if (!text) return;
            console.log('🗣️ Candidate said:', text);

            // Save transcript entry for all candidate speech
            const entry = { role: 'Candidate', text: text, timestamp: new Date().toISOString() };
            this.transcript = [...this.transcript, entry];
            fetch(`${API_BASE}/interview/${this.sessionId}/transcript`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ transcript: entry })
            }).catch(err => console.error('Error posting transcript:', err));

            // FILLER WORDS: Log thinking pause and wait for candidate to continue
            if (this.isFillerSpeech(text)) {
              console.log('🤫 Filler/thinking pause detected — waiting for candidate answer');
              return;
            }

            // REPEAT REQUEST: Candidate asks to repeat the question
            if (this.isRepeatRequest(text)) {
              console.log('🔁 Repeat requested:', text);
              this.hasCandidateAnsweredSinceLastAIQuestion = false;
              if (this.ws && this.wsOpen) {
                const prevQuestion = this.lastAIMessage || 'What do you know about Systech?';
                this.sendRealtimeText(
                  `[SYSTEM NOTE: Candidate asked you to repeat the question. Repeat EXACTLY: "${prevQuestion}" — word for word, no changes.]`,
                  true
                );
              }
              return;
            }

            // I DON'T KNOW: Candidate explicitly skips or says they don't know
            if (this.isHesitationOrIDontKnow(text)) {
              console.log('💡 Candidate IDK/hesitation:', text);
              this.hasCandidateAnsweredSinceLastAIQuestion = true;
              if (this.ws && this.wsOpen) {
                this.sendRealtimeText(
                  `[SYSTEM NOTE: Candidate said they don't know ("${text}"). Ask a simpler fundamental question on the same topic. Do NOT announce difficulty change. Do NOT say "Let me ask something easier". Just ask the simpler question directly.]`,
                  true
                );
              }
              return;
            }

            // SUBSTANTIVE CANDIDATE ANSWER — Trigger Next Turn via State Machine
            this.hasCandidateAnsweredSinceLastAIQuestion = true;
            this.isModelSpeaking = false;

            if (this.ws && this.wsOpen) {
              this.lastTurnTriggerTimestamp = Date.now();
              let directive = '';

              // PHASE 1 — INTRODUCTION (2 Mandatory Intro Questions, NO Follow-ups)
              if (this.currentPhase === 1) {
                if (this.phase1QuestionIndex === 0) {
                  this.phase1QuestionIndex = 1;
                  directive = `[SYSTEM NOTE: CANDIDATE ANSWERED INTRO QUESTION 1. Ask Intro Question 2 now: "Please give me a brief introduction about yourself and your background." Do NOT ask any follow-up questions for Phase 1.]`;
                } else {
                  this.currentPhase = 2;
                  this.primaryQuestionCount = 1;
                  this.followupCountForCurrentTopic = 0;
                  directive = `[SYSTEM NOTE: PHASE 1 COMPLETE. Silently transition to Phase 2 Technical Evaluation now. Ask Primary Technical Question #1 derived from candidate's Resume/JD. Do NOT announce phase transitions.]`;
                }
              } 
              // PHASE 2 — TECHNICAL EVALUATION (17 Primary Questions + 3 to 5 Contextual Follow-ups per topic)
              else if (this.currentPhase === 2) {
                if (this.followupCountForCurrentTopic < 4) {
                  this.followupCountForCurrentTopic++;
                  directive = `[SYSTEM NOTE: CANDIDATE ANSWER RECEIVED. Ask Contextual Technical Follow-up Question #${this.followupCountForCurrentTopic} of 4 on this topic, probing deeper into details mentioned in candidate's response. DO NOT repeat previous questions.]`;
                } else {
                  this.followupCountForCurrentTopic = 0;
                  this.primaryQuestionCount++;
                  if (this.primaryQuestionCount <= 17) {
                    directive = `[SYSTEM NOTE: Topic complete. Ask Next Primary Technical Question #${this.primaryQuestionCount} of 17 derived from Resume/JD.]`;
                  } else {
                    this.currentPhase = 3;
                    this.behavioralCount = 1;
                    directive = `[SYSTEM NOTE: Phase 2 Technical complete. Transition to Phase 3 Behavioral Evaluation. Ask Primary Behavioral Question #1 of 3. Probe for STAR details.]`;
                  }
                }
              }
              // PHASE 3 — BEHAVIORAL EVALUATION (3 Primary Behavioral Questions + Follow-ups)
              else if (this.currentPhase === 3) {
                if (this.followupCountForCurrentTopic < 2) {
                  this.followupCountForCurrentTopic++;
                  directive = `[SYSTEM NOTE: CANDIDATE ANSWER RECEIVED. Ask Contextual Behavioral Follow-up Question #${this.followupCountForCurrentTopic} probing for STAR details.]`;
                } else {
                  this.followupCountForCurrentTopic = 0;
                  this.behavioralCount++;
                  if (this.behavioralCount <= 3) {
                    directive = `[SYSTEM NOTE: Behavioral topic complete. Ask Next Primary Behavioral Question #${this.behavioralCount} of 3.]`;
                  } else {
                    this.currentPhase = 4;
                    directive = `[SYSTEM NOTE: Phase 3 Behavioral complete. Transition to Phase 4 Closing. Ask ONCE: "Do you have any questions for me?" then deliver exact closing statement.]`;
                  }
                }
              }

              if (directive) {
                console.log(`⚡ State Machine Turn Trigger (Phase ${this.currentPhase}, Primary #${this.primaryQuestionCount}, Followup #${this.followupCountForCurrentTopic})...`);
                this.sendRealtimeText(directive, true);
              }
            }
          }

          // 5. AI Audio output delta — gate mic during AI playback
          if (message.type === 'response.audio.delta' && message.delta) {
            if (message.response_id === this.cancelledResponseId) {
              return;
            }
            this.isModelSpeaking = true;
            this.isUserSpeaking = false;
            if (this.workletNode) this.workletNode.port.postMessage({ type: 'gate', value: true });
            if (this.micGateTimer) { clearTimeout(this.micGateTimer); this.micGateTimer = null; }

            const chunkData = message.delta;
            this.greetingReceived = true;
            this.playAudioChunk(chunkData);
          }

          // 6. Interruption (VAD speech start) — PROTECTED WITH SPEECH GUARD
          if (message.type === 'input_audio_buffer.speech_started') {
            if (this.silenceTriggerTimer) {
              clearTimeout(this.silenceTriggerTimer);
              this.silenceTriggerTimer = null;
            }
            this.isUserSpeaking = true;

            const timeSinceAISpeechStarted = Date.now() - this.speechStartedGuardTimestamp;
            
            // GUARD: Do NOT interrupt AI if speech started within the last 2.5 seconds (prevents breathing/mic clicks from killing AI speech)
            if ((this.isModelSpeaking || this.aiWasSpeaking) && timeSinceAISpeechStarted > 2500) {
              console.log('🛑 Confirmed user speech interruption (>2.5s into AI speech). Flushing AI playback.');
              this.cleanupAudioPlayback();
              this.aiWasSpeaking = false;
              this.cancelActiveResponse();
              this.audioQueue = Promise.resolve();
              this.lastAIMessage = '';
            }
            this.bufferedAudioDeltas = [];
          }

        } catch (err) {
          console.error('Error handling WebSocket message:', err);
        }
      };

      this.ws.onclose = async (ev) => {
        this.wsOpen = false;
        this.diag(`🔴 WebSocket CLOSED — code: ${ev.code}, reason: "${ev.reason || 'none'}"`);
        if (!this.greetingReceived && !this.stopCalled) {
          this.updateError(`❌ Azure rejected the connection (code ${ev.code}). Check AZURE_VOICELIVE_ENDPOINT, AZURE_VOICELIVE_API_KEY, and AZURE_VOICELIVE_MODEL in interview-backend/.env.`);
          this.forceUngateMic();
          return;
        }

        if (this.inSession && !this.stopCalled && !this.isReconnecting && this.sessionStartedSuccessfully) {
          this.isReconnecting = true;
          this.reconnectionInProgress = true;
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

private async restoreConversationContinuity() {
  if (!this.conversationStateBeforeDisconnect || !this.ws || !this.wsOpen) {
    return;
  }

  const state = this.conversationStateBeforeDisconnect;
  const timeSinceDisconnect = Date.now() - state.timestamp;
  
  try {
    // CASE 1: AI was mid-question when session dropped.
    if (state.aiWasSpeaking) {
      this.sendRealtimeText(`[SYSTEM NOTE: The session has been fully restored with complete conversation history. You were mid-question. If the candidate asks you to repeat the question, repeat it exactly as you asked it. Otherwise continue the interview naturally from where you left off.]`);
    }
    // CASE 2: AI had finished asking and candidate was responding when session dropped.
    else if (timeSinceDisconnect < 30000) {
      this.sendRealtimeText(`[SYSTEM NOTE: The session has been fully restored. The candidate was in the middle of answering. Do not ask a new question yet. If the candidate seems to be waiting for you, ask them to continue with what they were saying.]`);
    }
    // CASE 3: Generic resumption — session was idle at disconnect.
    else {
      this.sendRealtimeText(`[SYSTEM NOTE: Continue the interview naturally from where you left off.]`);
    }

  } catch (e) {
    console.error('Failed to restore continuity:', e);
  } finally {
    this.conversationStateBeforeDisconnect = null;
    this.reconnectionInProgress = false;
  }
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
  this.isModelSpeaking = false;
  if (this.micGateTimer) { clearTimeout(this.micGateTimer); this.micGateTimer = null; }
  if (this.workletNode) this.workletNode.port.postMessage({ type: 'gate', value: false });

  try {
    if (!this.sessionHandle) throw new Error('No session handle available');
    // Refresh the token before reconnecting — the original token uses: 3 budget
    // allows for the initial connection + up to 2 reconnections.
    await this.refreshClient();
    await this.initSession(this.sessionHandle);
  } catch (e: any) {
    if (this.sessionHandle && this.reconnectAttempts < this.maxReconnectAttempts && this.inSession && !this.stopCalled) {
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
        console.log('📊 Session Active | Duration:', this.formatDuration(this.interviewDuration));
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

      if (
        !this.greetingSent &&
        !this.greetingReceived &&
        sessionAge > 6000 &&
        !this.isModelSpeaking &&
        timeSinceAISpeech > 6000
      ) {
        console.warn('⚠️ Watchdog: greeting not received after 6s — re-triggering greeting only');
        this.greetingSent = true;
        this.lastTurnTriggerTimestamp = now;
        const greetingInstruction = `Say immediately: "Hello ${this.sessionData.candidateName}, welcome to your interview with Systech. I am your AI interviewer for today. Let us get started. My first question is — what do you know about Systech?"`;
        this.ws.send(JSON.stringify({
          type: 'response.create',
          response: { modalities: ['audio'], instructions: greetingInstruction }
        }));
      }
      // If interview is already running, do NOT force any response — let Azure VAD handle it
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

      // Send a dynamic, silent elapsed time status update every 3 minutes (up to 54 minutes)
      if (elapsedMinutes > 0 && elapsedMinutes % 3 === 0 && elapsedMinutes < 55 && this.lastProgressMinutesFired !== elapsedMinutes) {
        this.lastProgressMinutesFired = elapsedMinutes;
        try {
          let systemNote = '';
          if (elapsedMinutes < 25) {
            systemNote = `[SYSTEM NOTE: Elapsed time is ${elapsedMinutes} minutes. Minimum duration is 25-30 minutes. You are strictly FORBIDDEN from transitioning to Phase 4 closing or asking "Do you have any questions for me?". You must continue Phase 2 (Technical) or Phase 3 (Behavioral). Ensure you ask at least 20 primary questions total across the interview and exactly 3 to 5 contextual follow-up questions per topic based on the candidate's answers and resume. Keep this note confidential.]`;
          } else if (elapsedMinutes >= 25 && elapsedMinutes < 30) {
            systemNote = `[SYSTEM NOTE: Elapsed time is ${elapsedMinutes} minutes. You are reaching the 25-30 minute threshold. Ensure all required primary questions (minimum 20 overall) and their 3 to 5 contextual follow-ups per topic are satisfied. You may transition to Phase 4 closing once evaluation is thorough. Keep this note confidential.]`;
          } else {
            systemNote = `[SYSTEM NOTE: Elapsed time is ${elapsedMinutes} minutes. You have satisfied the 30-minute minimum duration. If you have completed Phase 2 technical and Phase 3 behavioral evaluation with 3 to 5 follow-up questions per topic, you may transition to Phase 4 closing. Keep this note confidential.]`;
          }
          this.sendRealtimeText(systemNote, false);
          console.log(`📊 ${elapsedMinutes}-minute silent time update injected`);
        } catch (e) {
          console.warn(`Time update injection failed (${elapsedMinutes}min):`, e);
        }
      }

      // Hard closing warning at 55 minutes
      if (elapsedMinutes >= 55 && this.progressChecksFired === 0) {
        this.progressChecksFired = 1;
        try {
          this.sendRealtimeText(`[SYSTEM NOTE: 55 minutes have elapsed. We are close to the 60-minute maximum duration limit. You must conclude the interview now. Move to Phase 4 closing, ask 'Do you have any questions for me?' exactly once, answer their questions using only the approved recruiter responses, and end the interview politely. This is the final phase; do not return to any previous questions.]`);
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
        const res = await fetch(`${API_BASE}/upload-chunk`, {
          method: 'POST',
          body: formData,
          headers: { 'x-session-id': this.sessionId }
        });
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
      fetch(`${API_BASE}/interview/${this.sessionId}/mark-started`, { method: 'POST' }).catch(() => {});

      // Fetch a fresh token immediately before connecting — bootstrap() token may have expired
      const tokenOk = await this.refreshClient();
      if (!tokenOk) return;

      // Connect to Azure Voice Live
      await this.initSession();

      // Get Microphone (Fallback to synthetic silent stream if no hardware mic connected)
      try {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, sampleRate: 24000, echoCancellation: true, noiseSuppression: true }
        });
      } catch (micError: any) {
        console.warn('⚠️ Physical microphone not accessible or missing:', micError.message);
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
      // Gate check is NOT needed here — the worklet discards audio at the source
      // when gated, so no data arrives on this handler while AI is speaking.
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

      // Start Video & Unified Recording
this.showWelcome = false;
await this.requestUpdate(); // Wait for DOM to render
await this.updateComplete;
await this.startVideoCapture();
await this.startUnifiedRecording();

setTimeout(() => this.proctoringActive = true, 3000);
      this.updateStatus('Interview in Progress');
      this.startInterviewTimer();
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
        const response = await fetch(`${API_BASE}/interview/${this.sessionId}/complete`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }
        });

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
        
	const powerAutomateUrl = 'https://d2a786f706de4e6f92cd5f53f5358c.c3.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/b5aa7e09880b4d69ab93373f695091dd/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=REDACTED_SAS_TOKEN';
        
        const powerAutomateResponse = await fetch(powerAutomateUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(data.sessionData)
        });

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
    const response = await fetch('https://n8n.systechusa.com/webhook/retryreason', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: this.sessionId,
        candidateName: this.sessionData?.candidateName || '',
        candidateEmail: this.sessionData?.candidateEmail || '',
        reason: this.reattemptReason.trim(),
        timestamp: new Date().toISOString()
      })
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
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private startInterviewTimer() {
    this.interviewStartTime = Date.now();
    this.interviewTimerInterval = window.setInterval(() => {
      this.interviewDuration = Math.floor((Date.now() - this.interviewStartTime) / 1000);
      // FEATURE 2: TIME WARNING - 55 minute notification (3300 seconds)
      if (this.interviewDuration >= 3300 && !this.warningGiven && this.ws && this.wsOpen) {
        this.warningGiven = true;
        
        try {
          this.sendRealtimeText('IMPORTANT: We are approaching the 60-minute maximum duration limit. We have approximately 5 minutes remaining. Thank the candidate for their time and wrap up the conversation naturally.');
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

  private formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
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

    fetch(`${API_BASE}/interview/${this.sessionId}/violation`, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(v)
    }).catch(()=>{});

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
      navigator.sendBeacon(`${API_BASE}/interview/${this.sessionId}/emergency-save`, JSON.stringify({
        transcript: this.transcript,
        duration: this.interviewDuration
      }));
    }
  }

  // --------------------------------------------------------------------------------
  // RENDER
  // --------------------------------------------------------------------------------

  render() {
    return html`
      <div>

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
                    <div class="timer-badge"><span>⏱️</span><span>${this.formatDuration(this.interviewDuration)}</span></div>
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






