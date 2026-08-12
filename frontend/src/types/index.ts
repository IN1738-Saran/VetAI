/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** Candidate experience classification. */
export type ExperienceLevel = 'FRESHER' | 'EXPERIENCED';

/** A single line in the interview transcript. */
export interface TranscriptEntry {
  role: 'AI Interviewer' | 'Candidate';
  text: string;
  timestamp: string;
}

/** A recorded proctoring violation. */
export interface Violation {
  type: string;
  timestamp: string;
  description: string;
}

/**
 * What the token endpoint returns to the browser.
 *
 * This interface used to declare `endpoint` and `apiKey`, describing the OLD
 * insecure shape where the backend handed the Azure credential to the client and
 * the browser put `api-key=…` straight in the WebSocket URL — visible to anyone
 * in DevTools. That design is gone (the backend relays instead), but the type
 * survived it, unused. A type that still names `apiKey` is an invitation to put
 * the field back, so it is corrected here to match reality: the browser receives
 * a short-lived ticket and NO credential.
 */
export interface VoiceConfig {
  /** Short-lived (60s), session-bound JWT. Carries no Azure secret. */
  ticket: string;
  /** Same-origin relay path — the browser never dials Azure directly. */
  wsPath: string;
  model: string;
  apiVersion: string;
  isVoiceLiveFoundry: boolean;
}
