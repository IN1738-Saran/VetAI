// ============================================================================
// INTERVIEW FEEDBACK REPORT PARSER (new, additive file)
//
// Mines the real interview-feedback report text (written by n8n's external
// pipeline, stored as interview_{sessionId}.txt in the interview-final-
// feedback container) for the structured fields a proper feedback report
// needs: overall score/verdict, per-skill scores, strengths/gaps,
// communication rating, job fit, video/presence analysis and its three
// sub-scores, and the policy-violations/observations/suggestions lists.
//
// This is a heuristic, not a schema this backend controls, exactly like
// reportHighlights.js's Strengths/Gaps extraction - regex/vocabulary based
// so behaviour is inspectable, and every field is genuinely optional: a
// report that doesn't mention "Body Language" simply yields bodyLanguage:
// null, never a fabricated number. Whatever isn't recognised is returned
// separately as `leftover` blocks so the PDF layer can still show it (via
// the existing generic block renderer) instead of silently dropping real
// report content that didn't match a known pattern.
// ============================================================================
import { parseBlocks } from './reportPdf.js';

function cleanLine(line) {
    return String(line || '').trim();
}

// "38/100", "38 / 100", "Score: 38/100", "Overall Score - 38/100"
const RE_SCORE_OUT_OF_100 = /(\d{1,3})\s*\/\s*100\b/;
// "6/10", "6 / 10"
const RE_SCORE_OUT_OF_10 = /(\d{1,2})\s*\/\s*10\b/;

// A verdict is a short, ALL-CAPS (or Title Case) line with no trailing
// sentence punctuation - "DO NOT RECOMMEND", "STRONG FIT", "RECOMMEND WITH
// RESERVATIONS", etc. Deliberately not a fixed vocabulary list: the exact
// wording this pipeline uses has never been formally specified.
function looksLikeVerdict(line) {
    if (!line || line.length > 60) return false;
    if (/[.?!]$/.test(line)) return false;
    if (RE_SCORE_OUT_OF_100.test(line) || RE_SCORE_OUT_OF_10.test(line)) return false;
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 6) return false;
    const letters = line.replace(/[^A-Za-z]/g, '');
    if (letters.length < 3) return false;
    return letters === letters.toUpperCase() || words.every((w) => /^[A-Z]/.test(w));
}

const SKILL_HEADING = /^skill\s*assessment$/i;
const STRENGTHS_HEADING = /^strengths?$/i;
const GAPS_HEADING = /^gaps?(\s*\/\s*risks?)?$|^risks?$|^weaknesses$/i;
const COMMUNICATION_HEADING = /^communication\s*(&|and)?\s*professionalism$/i;
const VIDEO_HEADING = /^video\s*(&|and)?\s*presence\s*analysis$/i;
const POLICY_HEADING = /^policy\s*violations?$/i;
const OBSERVATIONS_HEADING = /^key\s*observations?$/i;
const SUGGESTIONS_HEADING = /^improvement\s*suggestions?$/i;

const SECTION_HEADINGS = [
    SKILL_HEADING,
    STRENGTHS_HEADING,
    GAPS_HEADING,
    COMMUNICATION_HEADING,
    VIDEO_HEADING,
    POLICY_HEADING,
    OBSERVATIONS_HEADING,
    SUGGESTIONS_HEADING,
];

// parseBlocks() classifies a short line as a "heading" using generic visual
// signals (ALL CAPS, or every significant word capitalised) - which also
// catches short in-section lines like "Body Language: 42" or "SQL: 6/10"
// that are NOT actually a new section. Only a line matching one of this
// parser's OWN known section titles should ever end a section's inner loop;
// every other "heading"-shaped block found inside a section is still real
// content to inspect (a score line, or a note that happened to be short).
function isKnownSectionHeading(text) {
    const label = cleanLine(text);
    return SECTION_HEADINGS.some((re) => re.test(label));
}

const ROLE_LEVEL_HINTS = [
    'fresher', 'entry level', 'entry-level', '0-6 months', '0–6 months', 'junior', 'associate',
    'mid level', 'mid-level', 'senior', 'lead', 'staff', 'principal',
];

function findRoleLevel(text) {
    for (const line of text.split(/\r?\n/)) {
        const trimmed = cleanLine(line);
        if (!trimmed || trimmed.length > 80) continue;
        const lower = trimmed.toLowerCase();
        if (ROLE_LEVEL_HINTS.some((hint) => lower.includes(hint)) && !/[.?!]$/.test(trimmed)) {
            return trimmed.replace(/^role\s*level\s*[:\-]\s*/i, '');
        }
    }
    return null;
}

// "SQL: 6/10", "SQL - 6/10", "SQL 6/10" (short, ends with an /10 score, and
// what's left after stripping the score reads as a skill name, not a
// sentence).
function matchSkillLine(text) {
    const trimmed = cleanLine(text);
    if (!trimmed || trimmed.length > 80) return null;
    const scoreMatch = RE_SCORE_OUT_OF_10.exec(trimmed);
    if (!scoreMatch) return null;
    const name = trimmed.slice(0, scoreMatch.index).replace(/[:\-\s]+$/, '').trim();
    if (!name || name.length > 40 || /[.?!]$/.test(name)) return null;
    return { name, score: Number(scoreMatch[1]) };
}

function matchNamedScore(text, labelPattern) {
    const trimmed = cleanLine(text);
    const match = new RegExp(`^${labelPattern}\\s*[:\\-]?\\s*(\\d{1,3})(?:\\s*/\\s*100)?\\s*$`, 'i').exec(trimmed);
    return match ? Number(match[1]) : null;
}

// Consumes blocks from `blocks[i]` onward as long as they are bullets,
// pushing their text into `into`. Returns the index just past the last
// bullet consumed.
function consumeBullets(blocks, i, into) {
    while (i < blocks.length && blocks[i].type === 'bullet') {
        into.push(cleanLine(blocks[i].text));
        i++;
    }
    return i;
}

// Consumes blocks from `blocks[i]` onward until the next block that is
// itself one of this parser's known section headings (or the end of the
// document) - the general-purpose "section body" scanner used for
// Skill Assessment / Communication / Video & Presence, all of which mix
// score lines, notes and short labels that parseBlocks may have classified
// as "heading" for purely visual reasons unrelated to section structure.
function sectionBodyBounds(blocks, start) {
    let end = start;
    while (end < blocks.length && !isKnownSectionHeading(blocks[end].text)) end++;
    return end;
}

export function parseFeedbackReport(text) {
    const blocks = parseBlocks(text);
    const result = {
        overallScore: null,
        verdict: null,
        verdictRationale: null,
        roleLevel: findRoleLevel(text),
        skills: [],
        strengths: [],
        gaps: [],
        communicationScore: null,
        communicationNote: null,
        jobFit: null,
        additionalNotes: null,
        videoPresenceSummary: null,
        bodyLanguage: null,
        confidence: null,
        engagement: null,
        policyViolations: [],
        keyObservations: [],
        improvementSuggestions: [],
        leftover: [],
    };

    let i = 0;

    // -- Overall score / verdict / rationale - always precedes every real
    //    section heading, so this only ever looks at the very first blocks. --
    if (i < blocks.length) {
        const first = cleanLine(blocks[i].text);
        const scoreMatch = RE_SCORE_OUT_OF_100.exec(first);
        if (scoreMatch && first.replace(RE_SCORE_OUT_OF_100, '').trim().length < 20) {
            result.overallScore = Number(scoreMatch[1]);
            i++;
            if (i < blocks.length && looksLikeVerdict(cleanLine(blocks[i].text))) {
                result.verdict = cleanLine(blocks[i].text);
                i++;
            }
            if (i < blocks.length && blocks[i].type === 'paragraph' && !isKnownSectionHeading(blocks[i].text)) {
                result.verdictRationale = cleanLine(blocks[i].text);
                i++;
            }
        }
    }

    // -- Section-by-section pass ------------------------------------------
    while (i < blocks.length) {
        const label = cleanLine(blocks[i].text);

        if (SKILL_HEADING.test(label)) {
            const end = sectionBodyBounds(blocks, i + 1);
            let j = i + 1;
            while (j < end) {
                const skill = matchSkillLine(blocks[j].text);
                if (skill) {
                    let note = '';
                    if (j + 1 < end && !matchSkillLine(blocks[j + 1].text)) {
                        note = cleanLine(blocks[j + 1].text);
                        j += 2;
                    } else {
                        j += 1;
                    }
                    result.skills.push({ ...skill, note });
                } else {
                    j++;
                }
            }
            i = end;
            continue;
        }

        if (STRENGTHS_HEADING.test(label)) {
            i = consumeBullets(blocks, i + 1, result.strengths);
            continue;
        }

        if (GAPS_HEADING.test(label)) {
            i = consumeBullets(blocks, i + 1, result.gaps);
            continue;
        }

        if (COMMUNICATION_HEADING.test(label)) {
            const end = sectionBodyBounds(blocks, i + 1);
            let j = i + 1;
            while (j < end) {
                const cur = cleanLine(blocks[j].text);
                const commScore = matchNamedScore(cur, 'overall\\s*communication\\s*rating');
                if (commScore !== null) {
                    result.communicationScore = commScore;
                    j++;
                    continue;
                }
                // "Job Fit:" and "Additional Notes:" aren't guaranteed to sit
                // on their own paragraph - a report with no blank line
                // between them merges into one block. Split on the labels
                // wherever they appear rather than assuming block boundaries
                // line up with these fields.
                const segments = cur.split(/(?=\b(?:job\s*fit|additional\s*notes)\s*[:\-])/i);
                for (const segment of segments) {
                    const trimmedSeg = segment.trim();
                    if (!trimmedSeg) continue;
                    if (/^job\s*fit\s*[:\-]/i.test(trimmedSeg)) {
                        result.jobFit = trimmedSeg.replace(/^job\s*fit\s*[:\-]\s*/i, '').trim();
                    } else if (/^additional\s*notes\s*[:\-]/i.test(trimmedSeg)) {
                        result.additionalNotes = trimmedSeg.replace(/^additional\s*notes\s*[:\-]\s*/i, '').trim();
                    } else if (!result.communicationNote) {
                        result.communicationNote = trimmedSeg;
                    }
                }
                j++;
            }
            i = end;
            continue;
        }

        if (VIDEO_HEADING.test(label)) {
            const end = sectionBodyBounds(blocks, i + 1);
            let j = i + 1;
            while (j < end) {
                const cur = cleanLine(blocks[j].text);
                const bodyLang = matchNamedScore(cur, 'body\\s*language');
                const conf = matchNamedScore(cur, 'confidence');
                const eng = matchNamedScore(cur, 'engagement');
                const combined = /body\s*language\D{0,5}(\d{1,3}).*confidence\D{0,5}(\d{1,3}).*engagement\D{0,5}(\d{1,3})/i.exec(
                    cur
                );
                if (bodyLang !== null) result.bodyLanguage = bodyLang;
                if (conf !== null) result.confidence = conf;
                if (eng !== null) result.engagement = eng;
                if (bodyLang === null && conf === null && eng === null) {
                    if (combined) {
                        result.bodyLanguage = Number(combined[1]);
                        result.confidence = Number(combined[2]);
                        result.engagement = Number(combined[3]);
                    } else if (blocks[j].type === 'paragraph' && !result.videoPresenceSummary) {
                        result.videoPresenceSummary = cur;
                    }
                }
                j++;
            }
            i = end;
            continue;
        }

        if (POLICY_HEADING.test(label)) {
            i = consumeBullets(blocks, i + 1, result.policyViolations);
            continue;
        }

        if (OBSERVATIONS_HEADING.test(label)) {
            i = consumeBullets(blocks, i + 1, result.keyObservations);
            continue;
        }

        if (SUGGESTIONS_HEADING.test(label)) {
            i = consumeBullets(blocks, i + 1, result.improvementSuggestions);
            continue;
        }

        result.leftover.push(blocks[i]);
        i++;
    }

    return result;
}

// True when the report matched enough real structure to justify the
// specialised layout - a report that matched almost nothing is better shown
// with the plain generic renderer than a mostly-empty "structured" one.
export function looksStructured(parsed) {
    const signals = [
        parsed.overallScore !== null,
        parsed.skills.length > 0,
        parsed.strengths.length > 0 || parsed.gaps.length > 0,
        parsed.communicationScore !== null,
        parsed.bodyLanguage !== null || parsed.confidence !== null || parsed.engagement !== null,
    ];
    return signals.filter(Boolean).length >= 2;
}
