// ============================================================================
// REPORT HIGHLIGHTS SERVICE (new, additive file)
//
// Extracts real Strengths / Gaps-against-the-JD content out of the profile
// match report's own text, using the same generic heading/bullet parser
// reportPdf.js uses for layout. This is a heuristic, not a schema this
// backend controls - the report is written by n8n's external pipeline, and
// its exact wording has never been formally specified. If the text doesn't
// contain a recognizable Strengths/Gaps section, the corresponding array is
// empty; nothing is ever invented to fill it.
// ============================================================================
import { parseBlocks } from './reportPdf.js';

// A CONTAINS check, not an exact match - the report is written by an
// external pipeline whose exact heading wording has never been formally
// specified, and real headings vary ("Key Strengths", "Strengths &
// Highlights", "Candidate Strengths", "Skill Gaps", "Gaps vs. the JD",
// "Areas of Concern", ...). isHeadingLine() already restricts candidates to
// short (<=70 char), non-sentence lines before this ever runs, so a keyword
// match here is still scoped to real heading-shaped lines, not arbitrary
// body text.
const STRENGTHS_HEADING = /strength/i;
const GAPS_HEADING = /(\bgaps?\b|weakness|concern|risk\s+area|\bimprovement\b|development\s+area|missing\s+skill)/i;

// Bullets directly under the heading are the real signal. If a heading has
// no bullets under it (just a prose paragraph), fall back to splitting that
// paragraph into sentences - still the report's own real words, just not
// authored as a list.
function collectItemsAfterHeading(blocks, headingIndex) {
    const items = [];
    for (let i = headingIndex + 1; i < blocks.length; i++) {
        const block = blocks[i];
        if (block.type === 'heading') break;
        if (block.type === 'bullet') {
            items.push(block.text);
        } else if (block.type === 'paragraph' && items.length === 0) {
            const sentences = block.text
                .split(/(?<=[.?!])\s+/)
                .map((s) => s.trim())
                .filter(Boolean);
            items.push(...sentences);
        }
    }
    return items;
}

export function extractHighlights(text) {
    const blocks = parseBlocks(text);
    let strengths = [];
    let gaps = [];

    blocks.forEach((block, i) => {
        if (block.type !== 'heading') return;
        const label = block.text.trim();
        if (STRENGTHS_HEADING.test(label)) {
            strengths = collectItemsAfterHeading(blocks, i);
        } else if (GAPS_HEADING.test(label)) {
            gaps = collectItemsAfterHeading(blocks, i);
        }
    });

    return { strengths, gaps };
}

// Real (not heuristic-heading-dependent) Strengths/Gaps: `skills` is the
// required-skill list from a Job Library posting the frontend matched to
// this candidate's jobtitle (admin-frontend/src/lib/jobLibrary.ts - this
// backend doesn't own that list, it's passed in per request).
//
// A naive "does the skill name appear anywhere in the text" check is wrong
// in a specific, dangerous way for THIS use case: a report calling out a
// gap almost always names the missing skill ("no mention of Kafka
// streaming", "CI/CD was not discussed") - so plain substring matching
// would misreport a documented gap as a demonstrated strength, which is
// worse than not showing this at all. So the check is scoped per SENTENCE,
// not a fixed character window (a window can bleed into the next sentence
// and negate an unrelated, actually-positive mention right before it): a
// skill counts as "matched" only if at least one sentence names it without
// a negation cue anywhere in that same sentence; if every sentence naming
// it is negated (or it's never named at all), it's "missing". Still
// entirely grounded in the report's own real words - nothing invented -
// just read one sentence at a time instead of via a bare substring test.
const NEGATION_PATTERN =
    /\b(no|not|without|lack(?:s|ing)?|missing|limited|absent|none|zero|minimal|insufficient|never|unable)\b|n't\b/i;

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Reuses parseBlocks (reportPdf.js) rather than a hand-rolled line/sentence
// splitter: it already turns raw, line-wrapped report text into correct
// units - each bullet is its own self-contained claim (never merged with a
// sibling bullet), and each paragraph is already joined into one clean,
// space-separated string (line-wrap artifacts removed) safe to further
// split on sentence punctuation. A first attempt here split on bare
// newlines directly, which broke a single line-wrapped sentence in two and
// let an unrelated skill on the second half escape a negation that was
// only visible in the first half - this version doesn't have that bug
// because parseBlocks already resolved line-wrapping before this runs.
function unitsForNegationCheck(text) {
    const blocks = parseBlocks(text);
    const units = [];
    for (const block of blocks) {
        if (block.type === 'heading') continue;
        if (block.type === 'bullet') {
            units.push(block.text);
        } else {
            units.push(
                ...block.text
                    .split(/(?<=[.?!])\s+/)
                    .map((s) => s.trim())
                    .filter(Boolean)
            );
        }
    }
    return units;
}

export function matchSkillsAgainstText(text, skills) {
    const units = unitsForNegationCheck(text);
    const matched = [];
    const missing = [];

    for (const skill of skills) {
        const pattern = new RegExp(`(?<![a-z0-9])${escapeRegex(skill)}(?![a-z0-9])`, 'i');
        const hasPositiveMention = units.some((unit) => pattern.test(unit) && !NEGATION_PATTERN.test(unit));
        (hasPositiveMention ? matched : missing).push(skill);
    }

    return { matched, missing };
}
