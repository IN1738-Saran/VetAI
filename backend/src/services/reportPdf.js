// ============================================================================
// REPORT PDF SERVICE (new, additive file - does not modify any existing
// service, does not touch AI voice/interview logic in any way)
//
// Turns the raw text of the profile-match report / interview-feedback report
// (both written by n8n's external pipeline - this backend has never
// generated or controlled their exact wording/structure) into a clean,
// branded, professional-looking PDF instead of a plain .txt download.
//
// Layout is heuristic, not a parser for a known template: headings/bullets
// are detected from generic punctuation/case signals in the source text
// itself. Nothing is invented - if a signal isn't present, the line is just
// rendered as a normal paragraph.
// ============================================================================
import PDFDocument from 'pdfkit';
import { parseFeedbackReport } from './feedbackReportParser.js';

const NAVY = '#0B1A2C';
const GOLD = '#D6960A';
const INK = '#1A1A1A';
const MUTED = '#6B7280';
const RULE = '#E2E5EA';
const CARD_BG = '#F7F8FA';

// Same status palette the web app already uses (tailwind.config.js's
// status.green/amber/red) - one set of tones shared by the UI and the PDF.
const STATUS = {
    red: { color: '#DC2626', bg: '#FEE2E2', text: '#B91C1C' },
    amber: { color: '#D97706', bg: '#FEF3C7', text: '#92400E' },
    green: { color: '#16A34A', bg: '#DCFCE7', text: '#15803D' },
};

// One consistent threshold for every 0-100-normalised metric in the
// feedback report (overall score, communication rating, body language/
// confidence/engagement) - red below 45, amber below 70, else green.
function toneForPercent(value, max) {
    const pct = (value / max) * 100;
    if (pct < 45) return STATUS.red;
    if (pct < 70) return STATUS.amber;
    return STATUS.green;
}

const PAGE_MARGIN = 50;

function isBulletLine(line) {
    return /^\s*([-*•]|\d+[.)])\s+/.test(line);
}

function stripBulletMarker(line) {
    return line.replace(/^\s*([-*•]|\d+[.)])\s+/, '').trim();
}

// Minor connector words don't need their own capital in a Title Case
// heading ("Gaps Against the JD" is still a heading despite lowercase "the").
const TITLE_CASE_CONNECTORS = new Set([
    'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'to', 'for', 'with', 'vs', 'vs.', 'against',
]);

// Every significant word capitalized, e.g. "Strengths & Highlights" or "Gaps
// Against the JD" - a short line can be a real heading without being either
// ALL CAPS or colon-terminated, which the two checks below this one would
// otherwise miss entirely.
function isTitleCaseHeading(trimmed) {
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 6) return false;
    const significant = words.filter((w) => /[A-Za-z]/.test(w) && !TITLE_CASE_CONNECTORS.has(w.toLowerCase()));
    if (significant.length === 0) return false;
    return significant.every((w) => /^[A-Z]/.test(w));
}

// A heading is a short line, not itself a sentence (no trailing .?!), and
// visually distinct in one of a few generic ways that show up across most
// auto-generated report styles, without assuming any one specific style:
// explicitly marked (trailing ':'), ALL CAPS, or Title Case.
function isHeadingLine(trimmed) {
    if (!trimmed || trimmed.length > 70) return false;
    if (/[.?!]$/.test(trimmed)) return false;
    if (/:$/.test(trimmed)) return true;
    const letters = trimmed.replace(/[^A-Za-z]/g, '');
    if (letters.length >= 3 && letters === letters.toUpperCase()) return true;
    return isTitleCaseHeading(trimmed);
}

function parseBlocks(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let paragraph = [];

    const flush = () => {
        if (paragraph.length) {
            blocks.push({ type: 'paragraph', text: paragraph.join(' ').trim() });
            paragraph = [];
        }
    };

    for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (!trimmed) {
            flush();
            continue;
        }
        if (isBulletLine(trimmed)) {
            flush();
            blocks.push({ type: 'bullet', text: stripBulletMarker(trimmed) });
            continue;
        }
        if (isHeadingLine(trimmed)) {
            flush();
            blocks.push({ type: 'heading', text: trimmed.replace(/:$/, '') });
            continue;
        }
        paragraph.push(trimmed);
    }
    flush();
    return blocks;
}

function ensureRoom(doc, needed = 60) {
    if (doc.y > doc.page.height - doc.page.margins.bottom - needed) {
        doc.addPage();
        doc.y = PAGE_MARGIN;
    }
}

// A short gold rule directly under a heading's own text width (not a
// full-width divider) - reads as "this heading has an accent", giving the
// body real visual hierarchy instead of every block looking the same weight.
function renderHeading(doc, text) {
    ensureRoom(doc, 50);
    doc.moveDown(0.9);
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text(text, PAGE_MARGIN, y, {
        width: doc.page.width - PAGE_MARGIN * 2,
    });
    const textWidth = Math.min(
        doc.widthOfString(text, { font: 'Helvetica-Bold', size: 12 }) + 2,
        doc.page.width - PAGE_MARGIN * 2
    );
    const afterY = doc.y;
    doc.strokeColor(GOLD).lineWidth(1.5).moveTo(PAGE_MARGIN, afterY + 2).lineTo(PAGE_MARGIN + textWidth, afterY + 2).stroke();
    doc.y = afterY + 10;
}

// A small filled circle marker + a hanging indent, so a wrapped second line
// aligns under the first word rather than under the marker - this is what a
// plain "•  text" inline string can't do once a bullet wraps past one line.
function renderBullet(doc, text) {
    ensureRoom(doc, 40);
    const markerX = PAGE_MARGIN + 4;
    const textX = PAGE_MARGIN + 14;
    const textWidth = doc.page.width - PAGE_MARGIN - textX;
    const startY = doc.y;

    doc.fillColor(GOLD).circle(markerX, startY + 5, 2).fill();
    doc.font('Helvetica').fontSize(10.5).fillColor(INK).text(text, textX, startY, {
        width: textWidth,
        lineGap: 2,
    });
    doc.moveDown(0.45);
}

function renderParagraph(doc, text) {
    ensureRoom(doc, 40);
    doc.font('Helvetica').fontSize(10.5).fillColor(INK).text(text, PAGE_MARGIN, doc.y, {
        width: doc.page.width - PAGE_MARGIN * 2,
        lineGap: 3,
        align: 'left',
    });
    doc.moveDown(0.5);
}

/**
 * @param {object} opts
 * @param {string} opts.reportTitle - e.g. "Profile Match Report" or "Interview Feedback Report"
 * @param {string} [opts.candidateName]
 * @param {string} [opts.jobTitle]
 * @param {string} opts.sessionId
 * @param {string} opts.generatedOn - pre-formatted date string
 * @param {string} opts.bodyText - the raw report text to lay out
 * @returns {Promise<Buffer>}
 */
export function generateReportPdf({ reportTitle, candidateName, jobTitle, sessionId, generatedOn, bodyText }) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true });
        const chunks = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const pageWidth = doc.page.width;
        const contentWidth = pageWidth - PAGE_MARGIN * 2;

        // -- Header band ------------------------------------------------------
        doc.rect(0, 0, pageWidth, 92).fill(NAVY);
        doc.rect(0, 92, pageWidth, 3).fill(GOLD);
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20).text('VetAI', PAGE_MARGIN, 26);
        doc.font('Helvetica-Bold').fontSize(12).fillColor(GOLD).text(reportTitle.toUpperCase(), PAGE_MARGIN, 54, {
            characterSpacing: 0.5,
        });

        // -- Meta card ------------------------------------------------------------
        // A bordered, shaded block groups candidate/role/session/date together
        // as one clearly-scoped unit, instead of four same-weight lines that
        // blend into the body text below them.
        const cardY = 116;
        const cardHeight = 78;
        doc.roundedRect(PAGE_MARGIN, cardY, contentWidth, cardHeight, 6).fill(CARD_BG);
        doc.roundedRect(PAGE_MARGIN, cardY, contentWidth, cardHeight, 6).lineWidth(1).strokeColor(RULE).stroke();

        const cardPadX = 16;
        doc.font('Helvetica-Bold').fontSize(14).fillColor(INK).text(candidateName || 'N/A', PAGE_MARGIN + cardPadX, cardY + 14, {
            width: contentWidth - cardPadX * 2,
        });
        doc.font('Helvetica').fontSize(10.5).fillColor(MUTED).text(jobTitle || 'N/A', PAGE_MARGIN + cardPadX, doc.y + 2, {
            width: contentWidth - cardPadX * 2,
        });

        const metaY = cardY + cardHeight - 22;
        const metaColWidth = contentWidth / 2 - cardPadX;
        doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
            .text(`SESSION   ${sessionId}`, PAGE_MARGIN + cardPadX, metaY, { width: metaColWidth })
            .text(`GENERATED   ${generatedOn}`, PAGE_MARGIN + contentWidth / 2, metaY, { width: metaColWidth });

        doc.y = cardY + cardHeight + 24;

        // -- Body -----------------------------------------------------------------
        const blocks = parseBlocks(bodyText);
        if (blocks.length === 0) {
            doc.font('Helvetica').fontSize(11).fillColor(MUTED).text('No content was returned for this report.', PAGE_MARGIN, doc.y, {
                width: contentWidth,
            });
        }
        for (const block of blocks) {
            if (block.type === 'heading') {
                renderHeading(doc, block.text);
            } else if (block.type === 'bullet') {
                renderBullet(doc, block.text);
            } else {
                renderParagraph(doc, block.text);
            }
        }

        renderFooter(doc, reportTitle, pageWidth, contentWidth);
        doc.end();
    });
}

// Drawing inside the bottom margin (deliberately, for a footer) makes pdfkit
// think the text overflowed the page and silently insert an extra blank
// page to hold it - zeroing the bottom margin for the duration of this
// draw is the standard workaround. Shared by both report types.
function renderFooter(doc, reportTitle, pageWidth, contentWidth) {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const originalBottomMargin = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;

        doc.strokeColor(RULE).lineWidth(0.75).moveTo(PAGE_MARGIN, doc.page.height - 50).lineTo(pageWidth - PAGE_MARGIN, doc.page.height - 50).stroke();
        doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
            `VetAI — ${reportTitle} — Confidential — Page ${i - range.start + 1} of ${range.count}`,
            PAGE_MARGIN,
            doc.page.height - 38,
            { width: contentWidth, align: 'center' }
        );

        doc.page.margins.bottom = originalBottomMargin;
    }
}

function shortSessionId(id) {
    const value = String(id || '');
    return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

// -- Interview Feedback Report: structured layout -----------------------
// Built from a user-supplied reference template (a real report the old
// dashboard produced) - unlike generateReportPdf's generic block renderer,
// this one recognises specific real fields (score/verdict, per-skill /10
// scores, Communication rating, Body Language/Confidence/Engagement,
// Policy Violations, ...) via feedbackReportParser.js and lays each out
// with its own purpose-built visual (progress bars, a two-column
// Strengths/Gaps split, a colour-coded verdict band). Every section is
// independently optional: a report missing a given field just omits that
// section rather than showing an empty box or a fabricated placeholder.
// Anything the parser didn't recognise is appended at the end via the same
// generic block renderer generateReportPdf uses, so real report content
// can never be silently dropped just because it didn't match a pattern.

function sectionHeading(doc, text) {
    renderHeading(doc, text);
}

// name/label left, "X/Y" right, a coloured bar below, optional note.
function renderScoreBar(doc, { label, value, max, note, labelWidth }) {
    ensureRoom(doc, 40);
    const contentWidth = doc.page.width - PAGE_MARGIN * 2;
    const barWidth = labelWidth ?? contentWidth;
    const tone = toneForPercent(value, max);

    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(label, PAGE_MARGIN, y, {
        width: barWidth - 50,
        continued: false,
    });
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(tone.color).text(`${value}/${max}`, PAGE_MARGIN, y, {
        width: barWidth,
        align: 'right',
    });

    const barY = doc.y + 3;
    const barHeight = 6;
    doc.roundedRect(PAGE_MARGIN, barY, barWidth, barHeight, 3).fill(RULE);
    const filled = Math.max(2, Math.round((value / max) * barWidth));
    doc.roundedRect(PAGE_MARGIN, barY, filled, barHeight, 3).fill(tone.color);
    doc.y = barY + barHeight + 4;

    if (note) {
        doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(note, PAGE_MARGIN, doc.y, {
            width: barWidth,
            lineGap: 1,
        });
    }
    doc.y += 8;
}

// The overall score/verdict band - a full-width colour-coded box, or
// nothing at all when the report didn't state a score (never guessed).
function renderVerdictBand(doc, parsed, contentWidth) {
    if (parsed.overallScore === null) return;
    ensureRoom(doc, 90);
    const tone = toneForPercent(parsed.overallScore, 100);
    const y = doc.y;
    const rationale = parsed.verdictRationale || '';
    const rationaleHeight = rationale
        ? doc.font('Helvetica').fontSize(9.5).heightOfString(rationale, { width: contentWidth - 150, lineGap: 1 })
        : 0;
    const boxHeight = Math.max(74, 42 + rationaleHeight);

    doc.roundedRect(PAGE_MARGIN, y, contentWidth, boxHeight, 8).fill(tone.bg);
    doc.font('Helvetica-Bold').fontSize(30).fillColor(tone.text).text(String(parsed.overallScore), PAGE_MARGIN + 18, y + 14, {
        width: 90,
    });
    doc.font('Helvetica').fontSize(8).fillColor(tone.text).text('OUT OF 100', PAGE_MARGIN + 18, y + 50, { width: 90 });

    const textX = PAGE_MARGIN + 130;
    const textWidth = contentWidth - 150;
    if (parsed.verdict) {
        doc.font('Helvetica-Bold').fontSize(14).fillColor(tone.text).text(parsed.verdict, textX, y + 16, {
            width: textWidth,
        });
    }
    if (rationale) {
        doc.font('Helvetica').fontSize(9.5).fillColor(tone.text).text(rationale, textX, doc.y + 4, {
            width: textWidth,
            lineGap: 1,
        });
    }
    doc.y = y + boxHeight + 20;
}

function renderSkillAssessment(doc, skills, contentWidth) {
    if (!skills.length) return;
    sectionHeading(doc, 'Skill Assessment');
    for (const skill of skills) {
        ensureRoom(doc, 45);
        renderScoreBar(doc, { label: skill.name, value: skill.score, max: 10, note: skill.note, labelWidth: contentWidth });
    }
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED).text(
        'Skill scores are derived from the interview transcript.',
        PAGE_MARGIN,
        doc.y,
        { width: contentWidth }
    );
    doc.moveDown(0.8);
}

// Strengths (green) / Gaps (red) side by side. Row-by-row so a long entry
// in one column doesn't leave the other column's spacing looking broken;
// each row's height is the taller of its two cells.
function renderStrengthsAndGaps(doc, strengths, gaps, contentWidth) {
    if (!strengths.length && !gaps.length) return;

    const colWidth = (contentWidth - 20) / 2;
    const leftX = PAGE_MARGIN;
    const rightX = PAGE_MARGIN + colWidth + 20;
    const rows = Math.max(strengths.length, gaps.length);

    if (strengths.length && gaps.length) {
        // Both column headers together carry this section's visual weight -
        // a shared "Strengths & Gaps" label above them would be redundant.
        ensureRoom(doc, 50);
        doc.moveDown(0.9);
        doc.font('Helvetica-Bold').fontSize(10).fillColor(STATUS.green.text).text('Strengths', leftX, doc.y, { width: colWidth });
        const afterLeftHeaderY = doc.y;
        doc.font('Helvetica-Bold').fontSize(10).fillColor(STATUS.red.text).text('Gaps / Risks', rightX, afterLeftHeaderY - 12.5, {
            width: colWidth,
        });
        doc.y = Math.max(doc.y, afterLeftHeaderY) + 4;
    } else {
        sectionHeading(doc, strengths.length ? 'Strengths' : 'Gaps / Risks');
    }

    for (let i = 0; i < rows; i++) {
        ensureRoom(doc, 40);
        const rowY = doc.y;
        let leftEndY = rowY;
        let rightEndY = rowY;

        if (strengths[i]) {
            doc.fillColor(STATUS.green.color).circle(leftX + 4, rowY + 5, 2).fill();
            doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(strengths[i], leftX + 14, rowY, {
                width: colWidth - 14,
                lineGap: 1,
            });
            leftEndY = doc.y;
        }
        if (gaps[i]) {
            doc.fillColor(STATUS.red.color).circle(rightX + 4, rowY + 5, 2).fill();
            doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(gaps[i], rightX + 14, rowY, {
                width: colWidth - 14,
                lineGap: 1,
            });
            rightEndY = doc.y;
        }
        doc.y = Math.max(leftEndY, rightEndY) + 6;
    }
    doc.moveDown(0.4);
}

function renderCommunicationSection(doc, parsed, contentWidth) {
    const hasContent = parsed.communicationScore !== null || parsed.jobFit || parsed.additionalNotes;
    if (!hasContent) return;
    sectionHeading(doc, 'Communication & Professionalism');

    if (parsed.communicationScore !== null) {
        renderScoreBar(doc, {
            label: 'Overall communication rating',
            value: parsed.communicationScore,
            max: 100,
            note: parsed.communicationNote,
            labelWidth: contentWidth,
        });
    }

    if (parsed.jobFit) {
        ensureRoom(doc, 40);
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text('Job fit: ', PAGE_MARGIN, y, { continued: true, width: contentWidth });
        doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(parsed.jobFit, { width: contentWidth });
        doc.moveDown(0.6);
    }

    if (parsed.additionalNotes) {
        ensureRoom(doc, 50);
        const tone = toneForPercent(parsed.overallScore ?? 60, 100);
        const boxY = doc.y;
        const padX = 12;
        const textHeight = doc
            .font('Helvetica')
            .fontSize(9.5)
            .heightOfString(parsed.additionalNotes, { width: contentWidth - padX * 2 - 90, lineGap: 1 });
        const boxHeight = Math.max(30, textHeight + 16);
        doc.roundedRect(PAGE_MARGIN, boxY, contentWidth, boxHeight, 6).fill(tone.bg);
        doc.roundedRect(PAGE_MARGIN, boxY, contentWidth, boxHeight, 6).lineWidth(1).strokeColor(tone.color).stroke();
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(tone.text).text('Additional notes: ', PAGE_MARGIN + padX, boxY + 8, {
            continued: true,
            width: contentWidth - padX * 2,
        });
        doc.font('Helvetica').fontSize(9.5).fillColor(tone.text).text(parsed.additionalNotes, { width: contentWidth - padX * 2 - 90 });
        doc.y = boxY + boxHeight + 12;
    }
}

function renderVideoPresenceSection(doc, parsed, contentWidth) {
    const meters = [
        ['Body Language', parsed.bodyLanguage],
        ['Confidence', parsed.confidence],
        ['Engagement', parsed.engagement],
    ].filter(([, value]) => value !== null);

    const hasContent = parsed.videoPresenceSummary || meters.length > 0;
    if (!hasContent) return;

    sectionHeading(doc, 'Video & Presence Analysis');

    if (parsed.videoPresenceSummary) {
        renderParagraph(doc, parsed.videoPresenceSummary);
    }

    if (meters.length) {
        ensureRoom(doc, 40);
        const meterWidth = (contentWidth - 20 * (meters.length - 1)) / meters.length;
        const rowY = doc.y;
        let maxEndY = rowY;
        meters.forEach(([label, value], idx) => {
            const x = PAGE_MARGIN + idx * (meterWidth + 20);
            const tone = toneForPercent(value, 100);
            doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(label, x, rowY, { continued: true, width: meterWidth });
            doc.font('Helvetica-Bold').fontSize(9.5).fillColor(tone.color).text(`  ${value}`, { width: meterWidth });
            const barY = doc.y + 3;
            doc.roundedRect(x, barY, meterWidth, 6, 3).fill(RULE);
            doc.roundedRect(x, barY, Math.max(2, Math.round((value / 100) * meterWidth)), 6, 3).fill(tone.color);
            maxEndY = Math.max(maxEndY, barY + 6);
        });
        doc.y = maxEndY + 10;
    }
}

function renderBulletSection(doc, title, items) {
    if (!items.length) return;
    sectionHeading(doc, title);
    for (const item of items) {
        renderBullet(doc, item);
    }
}

/**
 * @param {object} opts
 * @param {string} [opts.candidateName]
 * @param {string} [opts.jobTitle]
 * @param {string} [opts.candidateEmail]
 * @param {string} [opts.interviewDate] - pre-formatted, real date string (or undefined)
 * @param {string} opts.sessionId
 * @param {string} opts.generatedOn - pre-formatted date string
 * @param {string} opts.bodyText - the raw feedback report text
 * @returns {Promise<Buffer>}
 */
export function generateFeedbackReportPdf({ candidateName, jobTitle, candidateEmail, interviewDate, sessionId, generatedOn, bodyText }) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true });
        const chunks = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const pageWidth = doc.page.width;
        const contentWidth = pageWidth - PAGE_MARGIN * 2;
        const reportTitle = 'Interview Feedback Report';
        const parsed = parseFeedbackReport(bodyText || '');

        // -- Header band --------------------------------------------------
        doc.rect(0, 0, pageWidth, 78).fill(NAVY);
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20).text('VetAI', PAGE_MARGIN, 22);
        doc.font('Helvetica-Bold').fontSize(11).fillColor(GOLD).text(reportTitle.toUpperCase(), 0, 30, {
            width: pageWidth,
            align: 'center',
            characterSpacing: 0.5,
        });
        doc.font('Helvetica').fontSize(8).fillColor('#C7CFDA').text(`Generated ${generatedOn}`, PAGE_MARGIN, 24, {
            width: contentWidth,
            align: 'right',
        });
        doc.text(`Session ${shortSessionId(sessionId)}`, PAGE_MARGIN, 36, { width: contentWidth, align: 'right' });

        // -- Meta card: 3 rows x 2 real fields each ------------------------
        const rows = [
            ['CANDIDATE', candidateName || 'Not provided', 'POSITION APPLIED', jobTitle || 'Not provided'],
            ['EMAIL', candidateEmail || 'Not provided', 'INTERVIEW DATE', interviewDate || 'Not available'],
            ['ROLE LEVEL', parsed.roleLevel || 'Not stated in this report', 'REPORT ID', sessionId],
        ];
        const cardY = 96;
        const rowHeight = 28;
        const cardHeight = rowHeight * rows.length;
        const colWidth = contentWidth / 2;
        doc.roundedRect(PAGE_MARGIN, cardY, contentWidth, cardHeight, 6).lineWidth(1).strokeColor(RULE).stroke();

        rows.forEach(([label1, value1, label2, value2], idx) => {
            const rowY = cardY + idx * rowHeight;
            if (idx % 2 === 1) doc.rect(PAGE_MARGIN + 1, rowY, contentWidth - 2, rowHeight).fill(CARD_BG);
            const labelY = rowY + 6;
            const valueY = rowY + 15.5;
            doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED).text(label1, PAGE_MARGIN + 14, labelY, { width: colWidth - 20 });
            doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(value1, PAGE_MARGIN + 14, valueY, { width: colWidth - 24 });
            doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED).text(label2, PAGE_MARGIN + colWidth + 14, labelY, {
                width: colWidth - 24,
            });
            doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(value2, PAGE_MARGIN + colWidth + 14, valueY, {
                width: colWidth - 28,
            });
        });

        doc.y = cardY + cardHeight + 20;

        // -- Body: structured sections, each independently optional --------
        renderVerdictBand(doc, parsed, contentWidth);
        renderSkillAssessment(doc, parsed.skills, contentWidth);
        renderStrengthsAndGaps(doc, parsed.strengths, parsed.gaps, contentWidth);
        renderCommunicationSection(doc, parsed, contentWidth);
        renderVideoPresenceSection(doc, parsed, contentWidth);
        renderBulletSection(doc, 'Policy Violations', parsed.policyViolations);
        renderBulletSection(doc, 'Key Observations', parsed.keyObservations);
        renderBulletSection(doc, 'Improvement Suggestions', parsed.improvementSuggestions);

        // Anything the parser didn't recognise is still real report content -
        // shown via the same generic renderer generateReportPdf uses, so it's
        // never silently dropped just because it didn't match a known section.
        if (parsed.leftover.length) {
            for (const block of parsed.leftover) {
                if (block.type === 'heading') renderHeading(doc, block.text);
                else if (block.type === 'bullet') renderBullet(doc, block.text);
                else renderParagraph(doc, block.text);
            }
        }

        const hadAnyStructure =
            parsed.overallScore !== null ||
            parsed.skills.length ||
            parsed.strengths.length ||
            parsed.gaps.length ||
            parsed.communicationScore !== null ||
            parsed.bodyLanguage !== null ||
            parsed.policyViolations.length ||
            parsed.keyObservations.length ||
            parsed.improvementSuggestions.length ||
            parsed.leftover.length;
        if (!hadAnyStructure) {
            doc.font('Helvetica').fontSize(11).fillColor(MUTED).text('No content was returned for this report.', PAGE_MARGIN, doc.y, {
                width: contentWidth,
            });
        }

        renderFooter(doc, reportTitle, pageWidth, contentWidth);
        doc.end();
    });
}

// Exported so reportHighlights.js can reuse the same generic block parsing
// (heading/bullet/paragraph detection) for Strengths/Gaps extraction,
// instead of re-implementing it against the same unverified report format.
export { parseBlocks };
