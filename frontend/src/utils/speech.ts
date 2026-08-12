/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure speech-classification helpers used to drive interview turn-taking logic.
 * Extracted verbatim from interview.tsx; behavior is identical.
 */
import type { ExperienceLevel } from '../types';
import {
  FRESHER_KEYWORDS,
  EXPERIENCED_TITLES,
  REPEAT_PHRASES,
  DONT_KNOW_PHRASES,
  MULTI_WORD_FILLERS,
  FILLERS,
  COMPLETION_PHRASES,
  TRAILING_WORDS,
} from '../constants';

/**
 * Infer years of professional experience from employment date ranges such as
 * "Jan 2021 - Present", "2019 – 2023", "03/2020 to 06/2022".
 *
 * Most résumés never write the sentence "5 years of experience" — they just list
 * roles with dates. Relying only on that phrase (as this module used to) made a
 * six-year engineer look like a fresher. Spans are merged by taking the earliest
 * start and latest end so overlapping or consecutive roles are not double
 * counted.
 */
function yearsFromDateRanges(text: string): number {
  const currentYear = new Date().getFullYear();
  // A 4-digit year, then a dash/"to", then either another 4-digit year or
  // present/current/now/till date.
  const range = /(19|20)\d{2}\s*(?:[-–—]|\bto\b)\s*((?:19|20)\d{2}|present|current|now|till date|todate)/gi;

  let earliest = Infinity;
  let latest = -Infinity;

  for (const m of text.matchAll(range)) {
    const start = parseInt(m[0].slice(0, 4), 10);
    const endRaw = m[2].toLowerCase();
    const end = /^(19|20)\d{2}$/.test(endRaw) ? parseInt(endRaw, 10) : currentYear;

    // Ignore nonsense and ranges that are clearly education, not employment
    // (a start before 1980 or an end in the future is not a real work span).
    if (start < 1980 || start > currentYear || end < start || end > currentYear) continue;

    earliest = Math.min(earliest, start);
    latest = Math.max(latest, end);
  }

  if (earliest === Infinity) return 0;
  return Math.max(0, latest - earliest);
}

export function determineExperienceLevel(resumeText: string): ExperienceLevel {
  if (!resumeText) return 'FRESHER';
  const text = resumeText.toLowerCase();

  const isExplicitFresher = FRESHER_KEYWORDS.some(k => text.includes(k));

  // Explicit "N years of experience" phrasing, when present.
  const yearsMatch = text.match(/(\d+)\+?\s*years?\s*(?:of\s*)?(experience|exp|work)/i);
  const statedYears = yearsMatch ? parseInt(yearsMatch[1], 10) : 0;

  // ...and the far more common case: dates against job entries.
  const yearsExp = Math.max(statedYears, yearsFromDateRanges(text));

  const hasExperiencedTitle = EXPERIENCED_TITLES.some(t => text.includes(t));
  const hasEmploymentMarker =
    text.includes('worked at') || text.includes('company:') ||
    text.includes('work experience') || text.includes('professional experience') ||
    text.includes('employment history');

  // An explicit fresher declaration wins unless the résumé also shows real
  // tenure — someone who writes "fresher" but has three years of dated roles is
  // treated as experienced.
  //
  // Tenure means DATES or a stated year count, NOT a title keyword.
  // hasExperiencedTitle is a bare substring test, so it fires on "a course
  // taught by a senior engineer", "reported to the Lead Architect", or a skills
  // line mentioning "consultant". Letting one incidental word override an
  // explicit self-declaration sent freshers down the EXPERIENCED prompt branch,
  // which asks about production deployments and corporate stakeholders — the
  // precise complaint that freshers get panel-level questions.
  if (isExplicitFresher) {
    return yearsExp >= 2 ? 'EXPERIENCED' : 'FRESHER';
  }

  // No fresher signal: any concrete evidence of employment makes this an
  // experienced candidate. Only a résumé with none of it falls through.
  if (yearsExp >= 1 || hasExperiencedTitle || hasEmploymentMarker) {
    return 'EXPERIENCED';
  }

  return 'FRESHER';
}

export function isRepeatRequest(text: string): boolean {
  if (!text) return false;
  const clean = text.toLowerCase()
    .replace(/['`.,\/#!$%\^&\*;:{}=\-_~()?]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return REPEAT_PHRASES.some(p => clean.includes(p));
}

export function isHesitationOrIDontKnow(text: string): boolean {
  if (!text) return false;
  const clean = text.toLowerCase()
    .replace(/['`.,\/#!$%\^&\*;:{}=\-_~()?]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return DONT_KNOW_PHRASES.some(p => clean.includes(p));
}

export function isFillerSpeech(text: string): boolean {
  if (!text) return true;
  let clean = text.toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "") // remove punctuation
    .replace(/\s+/g, " ") // normalize spaces
    .trim();

  if (!clean) return true;

  MULTI_WORD_FILLERS.forEach(f => {
    clean = clean.replaceAll(f, '').replace(/\s+/g, ' ').trim();
  });

  if (!clean) return true;

  if (FILLERS.includes(clean)) return true;

  // Check regex for pure non-word sound variations
  if (/^h+[m]+$/i.test(clean) || /^u+[m]+$/i.test(clean) || /^u+h+$/i.test(clean) || /^h+[a]+n+$/i.test(clean) || /^e+r+$/i.test(clean) || /^a+h+$/i.test(clean)) return true;

  return false;
}

export function isCompletionPhrase(text: string): boolean {
  if (!text) return false;
  const clean = text.toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return COMPLETION_PHRASES.some(phrase => clean.endsWith(phrase));
}

export function getSilenceDelay(text: string): number {
  const cleanText = text.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
  const words = cleanText.split(/\s+/).filter(Boolean);

  // 1. Check for completion phrases (instant response)
  if (isCompletionPhrase(text)) {
    return 0; // instant
  }

  // 2. Check for filler/thinking phrases
  if (isFillerSpeech(text)) {
    return 15000; // wait 15 seconds (virtually wait forever for continuation)
  }

  // 3. Check for mid-sentence trailing words or very short phrases (usually thinking pauses)
  const lastWord = words[words.length - 1] || '';
  const isTrailing = TRAILING_WORDS.includes(lastWord);

  if (words.length < 6 || isTrailing) {
    console.log('⏳ Short segment or trailing word detected. Candidate is likely mid-sentence. Setting long silence timer (5.0s).');
    return 5000; // 5.0 seconds client wait (total 6.2s)
  }

  // 4. Substantive completed sentence
  console.log('🟢 Substantive completed sentence detected. Setting low-latency silence timer (2.0s).');
  return 2000; // 2.0 seconds client wait (total 3.2s)
}
