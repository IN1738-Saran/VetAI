/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Speech-classification word/phrase lists.
 * Extracted verbatim from the classifier helpers in the original interview.tsx
 * so behavior is preserved exactly.
 */

// Phrases that genuinely indicate a FRESHER.
//
// 'bachelor of', 'master of' and a bare 'student' were removed on 2026-08-03.
// They are education-section boilerplate present on virtually EVERY résumé,
// including a fifteen-year veteran's, so they matched almost everyone. Because
// determineExperienceLevel() treats a match as "explicitly a fresher", any
// experienced candidate who lacked a senior-sounding job title AND did not
// happen to write the literal phrase "N years of experience" was classified
// FRESHER — which switches the system prompt to the branch that FORBIDS asking
// about production systems, client work and stakeholder communication. The
// interview was then wrong for the candidate in front of it.
//
// Every entry below names a fresher explicitly or is a student-only formulation
// ('b.tech student' still matches, 'bachelor of technology' no longer does).
export const FRESHER_KEYWORDS = [
  'fresher', 'entry level', 'entry-level', 'recent graduate', 'fresh graduate',
  'b.tech student', 'btech student', 'b.e. student', 'be student', 'm.tech student',
  'graduate student', 'pursuing b.tech', 'pursuing btech', 'pursuing b.e', 'pursuing m.tech',
  'currently pursuing', 'no professional experience', 'no work experience',
  'academic projects only', 'campus placement', 'intern only', 'seeking entry'
];

// Key indicators for Experienced Candidates
export const EXPERIENCED_TITLES = ['senior', 'lead', 'architect', 'principal', 'manager', 'specialist', 'consultant', 'staff engineer'];

export const REPEAT_PHRASES = [
  'can you repeat', 'could you repeat', 'repeat the question', 'repeat that',
  'repeat please', 'please repeat', 'pardon', 'pardon me', 'didnt catch that',
  'did not catch that', 'say that again', 'can you say that again',
  'could you say that again', 'what was the question', 'what is the question',
  'say again', 'come again'
];

export const DONT_KNOW_PHRASES = [
  'dont know', 'do not know', 'no idea', 'not sure', 'im not sure', 'i am not sure',
  'skip', 'skip this', 'next question', 'no concept', 'havent worked on', 'have not worked on',
  'no experience with', 'pass', 'can we move on', 'move to next', 'dont have experience',
  'not familiar', 'no knowledge'
];

export const MULTI_WORD_FILLERS = [
  'let me think', 'let me see', 'one second', 'wait a minute', 'just a moment', 'just a second',
  'let\'s see', 'hang on', 'give me a second', 'give me a moment', 'one moment', 'just a minute',
  'hold on a second', 'hold on a minute', 'give me a min', 'one min', 'wait a sec'
];

export const FILLERS = [
  'hmm', 'hm', 'hmmm', 'hmmmm', 'han', 'haan', 'ha', 'umm', 'um', 'ummm', 'uh', 'uhh', 'err', 'errr',
  'ah', 'ahh', 'haaan', 'haaa'
];

export const COMPLETION_PHRASES = [
  'thats it', 'thats all', 'i am done', 'i am finished', 'im done', 'im finished',
  'thats my experience', 'go ahead', 'your turn', 'any questions', 'that covers it',
  'that is all', 'that is it'
];

// Mid-sentence trailing words that usually indicate the candidate is still thinking
export const TRAILING_WORDS = ['and', 'so', 'because', 'but', 'or', 'like', 'then', 'actually', 'mean', 'maybe'];
