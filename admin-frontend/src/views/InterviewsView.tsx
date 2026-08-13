import { useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { X, UploadCloud, CheckCircle2 } from 'lucide-react';
import { createInterview, type CreateInterviewResult } from '@/lib/createInterview';
import { NotAvailable } from '@/components/NotAvailable';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_RESUMES = 5;

function isPdfLike(file: File) {
  return file.name.toLowerCase().endsWith('.pdf') && file.size > 0 && file.size <= MAX_BYTES;
}

function formatBytes(n: number) {
  return n > 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

export function InterviewsView() {
  const queryClient = useQueryClient();
  // Job Library's "Start interview" pre-fills the title via navigation
  // state - this is a real convenience, not a fake shortcut: documents
  // still have to be uploaded and the form still submits to the real,
  // unmodified create-interview endpoint (plan section 4.4's "Do not
  // connect a fake 'Start interview' button..." is about skipping real
  // requirements, not about pre-filling a text field).
  const location = useLocation();
  const prefilledJobTitle = (location.state as { jobTitle?: string } | null)?.jobTitle ?? '';

  const [jobTitle, setJobTitle] = useState(prefilledJobTitle);
  const [emails, setEmails] = useState<string[]>([]);
  const [emailDraft, setEmailDraft] = useState('');
  const [jobDescriptionFile, setJobDescriptionFile] = useState<File | null>(null);
  const [resumeFiles, setResumeFiles] = useState<File[]>([]);
  // Cosmetic-only fields (see NotAvailable notes below) - never sent to the
  // backend, which has no length/source/scheduling field today (plan
  // Strict Constraint #9: don't fake behavior the backend doesn't have).
  const [interviewLength, setInterviewLength] = useState<30 | 45 | 60>(45);
  const [source, setSource] = useState('Naukri');
  const [delivery, setDelivery] = useState<'now' | 'schedule'>('now');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateInterviewResult | null>(null);

  const jdInputRef = useRef<HTMLInputElement>(null);
  const resumeInputRef = useRef<HTMLInputElement>(null);

  function addEmail() {
    const value = emailDraft.trim().replace(/,$/, '');
    if (value && !emails.includes(value)) setEmails((prev) => [...prev, value]);
    setEmailDraft('');
  }

  const jdReady = jobDescriptionFile !== null && isPdfLike(jobDescriptionFile);
  const resumesReady = resumeFiles.length > 0 && resumeFiles.every(isPdfLike);
  const canSubmit = jobTitle.trim() !== '' && emails.length > 0 && jdReady && resumesReady && !submitting;

  async function handleSubmit() {
    if (!canSubmit || !jobDescriptionFile) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await createInterview({
        jobTitle: jobTitle.trim(),
        toEmails: emails.join(', '),
        jobDescription: jobDescriptionFile,
        resumes: resumeFiles,
      });
      setResult(res);
      if (res.success) {
        queryClient.invalidateQueries({ queryKey: ['candidates'] });
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create interview');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="rounded-card bg-card p-6 shadow-card">
          <div className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-ink">
            <CheckCircle2 className="text-status-green" size={20} />
            {result.success ? `Created ${result.count} interview(s)` : 'No interviews were created'}
          </div>
          {result.error && <p className="text-[13px] text-status-red-text">{result.error}</p>}
          {result.sessions && result.sessions.length > 0 && (
            <ul className="space-y-2 text-[13px]">
              {result.sessions.map((s) => (
                <li key={s.sessionId} className="rounded-lg bg-surface px-3 py-2">
                  <div className="font-medium text-ink">{s.resumeFileName}</div>
                  <div className="text-ink-muted">
                    {s.ocr.charactersExtracted} characters extracted via {s.ocr.source}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {result.skipped && result.skipped.length > 0 && (
            <div className="mt-4">
              <div className="mb-1 text-[13px] font-semibold text-status-amber-text">
                Skipped ({result.skippedCount})
              </div>
              <ul className="space-y-1 text-[13px] text-ink-muted">
                {result.skipped.map((s, i) => (
                  <li key={i}>
                    {s.fileName} - {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            type="button"
            onClick={() => setResult(null)}
            className="mt-4 rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-ink hover:bg-surface"
          >
            Create another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-1 text-[15px] font-semibold text-ink">1 - Interview details</div>
          <p className="mb-4 text-[12px] text-ink-muted">Fields marked * are required</p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[13px] font-medium text-ink">Job title *</label>
              <input
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="e.g. Data Engineer - Entry Level"
                className="w-full rounded-lg border border-border px-3 py-2 text-[13px]"
              />
              <button
                type="button"
                disabled
                title="Job Library is a placeholder in this pass - no saved jobs exist to fill from yet"
                className="mt-1 text-[12px] text-ink-faint underline decoration-dotted disabled:cursor-not-allowed"
              >
                Fill from Job Library
              </button>
            </div>

            <div>
              <label className="mb-1 block text-[13px] font-medium text-ink">Candidate email(s) *</label>
              <div className="flex flex-wrap gap-1.5 rounded-lg border border-border px-2 py-1.5">
                {emails.map((email) => (
                  <span
                    key={email}
                    className="flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[12px] text-ink"
                  >
                    {email}
                    <button type="button" onClick={() => setEmails((prev) => prev.filter((e) => e !== email))}>
                      <X size={12} />
                    </button>
                  </span>
                ))}
                <input
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addEmail();
                    }
                  }}
                  onBlur={addEmail}
                  placeholder="Press Enter or , to add"
                  className="min-w-[120px] flex-1 border-none text-[13px] outline-none"
                />
              </div>
              <p className="mt-1 text-[12px] text-ink-faint">One address per candidate.</p>
            </div>
          </div>
        </div>

        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-1 text-[15px] font-semibold text-ink">2 - Documents</div>
          <p className="mb-4 text-[12px] text-ink-muted">Both are required - one job description and at least one resume</p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[13px] font-medium text-ink">Job description *</label>
                {jobDescriptionFile && (
                  <button
                    type="button"
                    onClick={() => jdInputRef.current?.click()}
                    className="text-[12px] font-medium text-ink underline"
                  >
                    Replace
                  </button>
                )}
              </div>
              <input
                ref={jdInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => setJobDescriptionFile(e.target.files?.[0] ?? null)}
              />
              {jobDescriptionFile ? (
                <div
                  className={
                    'rounded-lg border px-3 py-3 text-[13px] ' +
                    (isPdfLike(jobDescriptionFile)
                      ? 'border-status-green bg-status-green-bg'
                      : 'border-status-red bg-status-red-bg')
                  }
                >
                  <div className="font-medium text-ink">{jobDescriptionFile.name}</div>
                  <div className="text-ink-muted">
                    {formatBytes(jobDescriptionFile.size)}
                    {!isPdfLike(jobDescriptionFile) && ' - must be a PDF under 10MB'}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => jdInputRef.current?.click()}
                  className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-border py-6 text-[13px] text-ink-muted hover:bg-surface"
                >
                  <UploadCloud size={18} />
                  Click to upload PDF
                </button>
              )}
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[13px] font-medium text-ink">Candidate resumes *</label>
                {resumeFiles.length > 0 && resumeFiles.length < MAX_RESUMES && (
                  <button
                    type="button"
                    onClick={() => resumeInputRef.current?.click()}
                    className="text-[12px] font-medium text-ink underline"
                  >
                    Add more
                  </button>
                )}
              </div>
              <input
                ref={resumeInputRef}
                type="file"
                accept=".pdf"
                multiple
                className="hidden"
                onChange={(e) => {
                  const incoming = Array.from(e.target.files ?? []);
                  setResumeFiles((prev) => [...prev, ...incoming].slice(0, MAX_RESUMES));
                }}
              />
              {resumeFiles.length > 0 ? (
                <div className="space-y-1.5">
                  {resumeFiles.map((f, i) => (
                    <div
                      key={i}
                      className={
                        'flex items-center justify-between rounded-lg border px-3 py-2 text-[13px] ' +
                        (isPdfLike(f) ? 'border-status-green bg-status-green-bg' : 'border-status-red bg-status-red-bg')
                      }
                    >
                      <div>
                        <div className="font-medium text-ink">{f.name}</div>
                        <div className="text-ink-muted">
                          {formatBytes(f.size)}
                          {!isPdfLike(f) && ' - must be a PDF under 10MB'}
                        </div>
                      </div>
                      <button type="button" onClick={() => setResumeFiles((prev) => prev.filter((_, idx) => idx !== i))}>
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => resumeInputRef.current?.click()}
                  className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-border py-6 text-[13px] text-ink-muted hover:bg-surface"
                >
                  <UploadCloud size={18} />
                  Click to upload up to {MAX_RESUMES} PDFs
                </button>
              )}
            </div>
          </div>
          <p className="mt-3 text-[12px] text-ink-faint">
            Read status and email detection per resume (as shown in the reference design) are only known once
            Document Intelligence actually processes the file server-side - there is no pre-submission preview
            endpoint, so that feedback appears in the results after you create the interview(s), not before.
          </p>
        </div>

        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-1 text-[15px] font-semibold text-ink">3 - Length and delivery</div>
          <p className="mb-4 text-[12px] text-ink-muted">Cosmetic only for now - see notes below</p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[13px] font-medium text-ink">Interview length</label>
              <div className="flex gap-2">
                {[30, 45, 60].map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => setInterviewLength(mins as 30 | 45 | 60)}
                    className={
                      'rounded-lg border px-3 py-2 text-[13px] font-medium ' +
                      (interviewLength === mins ? 'border-navy bg-navy text-white' : 'border-border text-ink')
                    }
                  >
                    {mins} min
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[12px] text-ink-faint">
                Not sent to the backend - interview duration has no server-side field today.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-[13px] font-medium text-ink">Where did these resumes come from?</label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-[13px]"
              >
                <option>Naukri</option>
                <option>LinkedIn</option>
                <option>Referral</option>
                <option>Other</option>
              </select>
              <p className="mt-1 text-[12px] text-ink-faint">Not sent to the backend - no source field exists today.</p>
            </div>
          </div>

          <div className="mt-4">
            <label className="mb-1 block text-[13px] font-medium text-ink">Send invitations</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDelivery('now')}
                className={
                  'rounded-lg border px-3 py-2 text-[13px] font-medium ' +
                  (delivery === 'now' ? 'border-navy bg-navy text-white' : 'border-border text-ink')
                }
              >
                Now
              </button>
              <button
                type="button"
                disabled
                title="Not implemented - would require new backend behavior and explicit approval before shipping (see plan Functional Requirement 5)"
                className="cursor-not-allowed rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-ink-faint"
              >
                Schedule
              </button>
            </div>
          </div>
        </div>

        {submitError && (
          <div className="rounded-card bg-status-red-bg p-4 text-[13px] text-status-red-text shadow-card">
            {submitError}
          </div>
        )}

        <button
          type="button"
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="w-full rounded-lg bg-accent px-4 py-3 text-[14px] font-semibold text-navy hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Creating interview(s)...' : 'Create interview(s)'}
        </button>
      </div>

      <div className="space-y-5">
        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-3 text-[14px] font-semibold text-ink">Job description</div>
          <NotAvailable reason="POST /api/create-interview does not return structured JD analysis (required/preferred skills, seniority) either before or after submission - only per-resume OCR diagnostics come back" />
        </div>

        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-3 text-[14px] font-semibold text-ink">Interview plan</div>
          <NotAvailable reason="question count/category breakdown is not returned by any existing endpoint" />
        </div>

        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-3 text-[14px] font-semibold text-ink">Ready to run</div>
          <ul className="space-y-2 text-[13px]">
            <ReadinessItem ok={jobTitle.trim() !== ''} label="Job title entered" />
            <ReadinessItem ok={emails.length > 0} label={`${emails.length} candidate email(s) added`} />
            <ReadinessItem ok={jdReady} label="Job description uploaded" />
            <ReadinessItem ok={resumesReady} label={`${resumeFiles.length} resume(s) uploaded`} />
          </ul>
        </div>
      </div>
    </div>
  );
}

function ReadinessItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className={ok ? 'text-status-green' : 'text-ink-faint'}>
        {ok ? <CheckCircle2 size={15} /> : <span className="block h-3.5 w-3.5 rounded-full border border-border" />}
      </span>
      <span className={ok ? 'text-ink' : 'text-ink-faint'}>{label}</span>
    </li>
  );
}
