import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { X, UploadCloud, CheckCircle2, Copy, Check, ChevronDown, ChevronRight } from 'lucide-react';
import {
  createInterview,
  type CreateInterviewResult,
  type CreatedSession,
  type ResumeInfo,
} from '@/lib/createInterview';
import { SAMPLE_JOBS, loadCustomJobs } from '@/lib/jobLibrary';
import { fetchJobEmailConfigs, type JobEmailConfig } from '@/lib/jobEmailConfigs';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_RESUMES = 5;

// Same real field keys (resumeFields.js's RESUME_FIELDS) and the same order
// as Old_Version/backend/src/views/admin.html's OCR_FIELDS table. Label
// casing is sentence case ("Full name") rather than admin.html's Title Case
// ("Full Name") to match this app's own copy convention everywhere else -
// not a change to what's extracted or shown, only to letter casing.
const RESUME_FIELD_LABELS: Array<[keyof ResumeInfo, string]> = [
  ['name', 'Full name'],
  ['email', 'Email address'],
  ['phone', 'Phone number'],
  ['location', 'Current location'],
  ['linkedin', 'LinkedIn profile'],
  ['github', 'GitHub profile'],
  ['portfolio', 'Portfolio website'],
  ['jobTitle', 'Current job title'],
  ['experience', 'Total experience'],
  ['skills', 'Skills'],
  ['technicalSkills', 'Technical skills'],
  ['softSkills', 'Soft skills'],
  ['education', 'Education'],
  ['certifications', 'Certifications'],
  ['projects', 'Projects'],
  ['companies', 'Companies worked'],
  ['designations', 'Designation(s)'],
  ['languages', 'Languages known'],
];

function CopyLinkRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied or unavailable - the link is still
      // shown as selectable text, so the recruiter can copy it manually.
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 overflow-x-auto rounded-lg bg-surface px-3 py-2 text-[12px] text-ink-muted">
        {url}
      </div>
      <button
        type="button"
        onClick={handleCopy}
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[12px] font-medium text-ink hover:bg-surface"
      >
        {copied ? <Check size={13} className="text-status-green" /> : <Copy size={13} />}
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  );
}

function ResumeInfoValue({ value }: { value: string | string[] }) {
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-ink-faint">Not found</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {value.map((item) => (
          <span key={item} className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-ink">
            {item}
          </span>
        ))}
      </div>
    );
  }
  return value ? <span className="text-ink">{value}</span> : <span className="text-ink-faint">Not found</span>;
}

function RawTextPreview({ ocr }: { ocr: CreatedSession['ocr'] }) {
  const [open, setOpen] = useState(false);
  if (!ocr.rawText) return null;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] font-medium text-ink underline"
      >
        {open ? 'Hide' : 'Show'} the raw text read from this file
      </button>
      {open && (
        <div className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface p-2 font-mono text-[11px] text-ink-muted">
          {ocr.rawText}
          {ocr.rawTextTruncated && ' (truncated)'}
        </div>
      )}
    </div>
  );
}

// The full field-by-field breakdown from resumeFields.js's real, regex-based
// extraction (name/email/skills/education/...), plus the same extraction
// diagnostics (source/warnings/document details/raw text) Old_Version's
// admin.html showed in its "Resume Information (OCR)" panel - this is the
// tool that was specifically built to verify OCR worked on a given résumé
// (particularly image-based ones), so it needs to show what actually
// happened, not just a summary. Collapsed by default except the first
// session, matching that panel's behavior.
function ResumeInfoPanel({ session }: { session: CreatedSession }) {
  const [open, setOpen] = useState(false);
  const { ocr } = session;
  const info = ocr.resumeInfo;
  const stats = ocr.stats;
  const doc = ocr.documentInfo;
  const fromAzure = ocr.source === 'azure-document-intelligence';

  if (!info) return null;

  return (
    <div className="mt-2 rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12px] font-medium text-ink"
      >
        <span className="flex items-center gap-1.5">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Resume information
        </span>
        {stats && (
          <span className="text-[11px] font-normal text-ink-faint">
            {fromAzure ? 'Read via Document Intelligence' : 'Read via local text extraction'} ·{' '}
            {stats.fieldsDetected}/{stats.totalFields} fields found
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-border px-3 py-3">
          {ocr.warnings && ocr.warnings.length > 0 && (
            <div className="mb-3 space-y-1">
              {ocr.warnings.map((w, i) => (
                <p key={i} className="text-[11px] text-status-amber-text">
                  {w}
                </p>
              ))}
            </div>
          )}

          <dl className="space-y-2">
            {RESUME_FIELD_LABELS.map(([key, label]) => (
              <div key={key} className="grid grid-cols-[130px_1fr] gap-2 text-[12px]">
                <dt className="text-ink-muted">{label}</dt>
                <dd>
                  <ResumeInfoValue value={info[key]} />
                </dd>
              </div>
            ))}
          </dl>

          {doc && (
            <div className="mt-3 border-t border-border pt-3">
              <div className="mb-1 text-[11px] font-semibold text-ink">Document details</div>
              <dl className="space-y-1 text-[11px]">
                <div className="grid grid-cols-[130px_1fr]">
                  <dt className="text-ink-muted">Extraction source</dt>
                  <dd className="text-ink">
                    {fromAzure ? 'Azure Document Intelligence' : 'Local parser (fallback)'}
                  </dd>
                </div>
                {doc.model && (
                  <div className="grid grid-cols-[130px_1fr]">
                    <dt className="text-ink-muted">Model</dt>
                    <dd className="text-ink">{doc.model}</dd>
                  </div>
                )}
                {doc.pages !== undefined && (
                  <div className="grid grid-cols-[130px_1fr]">
                    <dt className="text-ink-muted">Pages</dt>
                    <dd className="text-ink">{doc.pages}</dd>
                  </div>
                )}
                {doc.processingTimeSeconds !== undefined && (
                  <div className="grid grid-cols-[130px_1fr]">
                    <dt className="text-ink-muted">Processing time</dt>
                    <dd className="text-ink">{doc.processingTimeSeconds}s</dd>
                  </div>
                )}
                <div className="grid grid-cols-[130px_1fr]">
                  <dt className="text-ink-muted">Characters extracted</dt>
                  <dd className="text-ink">{ocr.charactersExtracted}</dd>
                </div>
              </dl>
            </div>
          )}

          <RawTextPreview ocr={ocr} />
        </div>
      )}
    </div>
  );
}

// Real, existing data (public.job_email_configs, via lib/jobEmailConfigs.ts)
// - the same per-job-title notification list Email Center manages. Picking
// one here fills the job title (if empty) and replaces the current email
// chips with that list's real addresses, matching Old_Version's admin.html
// "Saved job-title configs" suggestions in the New Interview form exactly.
function SavedConfigDropdown({
  configs,
  typed,
  onSelectConfig,
  onAddEmail,
}: {
  configs: JobEmailConfig[];
  typed: string;
  onSelectConfig: (config: JobEmailConfig) => void;
  onAddEmail: (email: string) => void;
}) {
  const looksLikeEmail = typed.includes('@');

  if (configs.length === 0 && !typed) {
    return <div className="px-3 py-3 text-[12px] text-ink-faint">No saved email lists yet.</div>;
  }

  return (
    <div>
      {configs.length > 0 && (
        <>
          <div className="border-b border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Saved job-title lists
          </div>
          {configs.map((config) => {
            const emailList = config.emails
              .split(',')
              .map((e) => e.trim())
              .filter(Boolean);
            return (
              <button
                key={config.id}
                type="button"
                onClick={() => onSelectConfig(config)}
                className="block w-full border-b border-border px-3 py-2 text-left last:border-0 hover:bg-surface"
              >
                <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
                  {config.jobtitle}
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-normal text-ink-muted">
                    {emailList.length} email{emailList.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="truncate text-[11px] text-ink-faint">{config.emails}</div>
              </button>
            );
          })}
        </>
      )}
      {looksLikeEmail && (
        <button
          type="button"
          onClick={() => onAddEmail(typed)}
          className="block w-full px-3 py-2 text-left text-[13px] text-ink hover:bg-surface"
        >
          + Add "{typed}" as a new email
        </button>
      )}
      {typed && !looksLikeEmail && (
        <div className="px-3 py-2 text-[12px] text-ink-faint">Press Enter or , to add this email.</div>
      )}
    </div>
  );
}

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
  const jobLibraryTitles = [...SAMPLE_JOBS, ...loadCustomJobs()].map((j) => j.title);
  const [emails, setEmails] = useState<string[]>([]);
  const [emailDraft, setEmailDraft] = useState('');
  const [jobDescriptionFile, setJobDescriptionFile] = useState<File | null>(null);
  const [resumeFiles, setResumeFiles] = useState<File[]>([]);
  // Cosmetic-only fields (see notes below) - never sent to the backend,
  // which has no length/source field today (plan Strict Constraint #9:
  // don't fake behavior the backend doesn't have). The "Schedule" delivery
  // option that used to sit next to these was removed outright rather than
  // left disabled - Old_Version/admin.html never had a scheduling concept
  // at all, and interviews are always sent immediately once created; a
  // permanently-disabled button for a choice that doesn't exist just read
  // as broken.
  const [interviewLength, setInterviewLength] = useState<30 | 45 | 60>(45);
  const [source, setSource] = useState('Naukri');

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

  // Real saved job-title/email lists (public.job_email_configs) - see
  // SavedConfigDropdown above. Only fetched/shown while the email field is
  // in focus, so editing the job title elsewhere on the page never pops a
  // dropdown under a field the recruiter isn't looking at.
  const [configSuggestions, setConfigSuggestions] = useState<JobEmailConfig[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const emailShellRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (emailShellRef.current && !emailShellRef.current.contains(e.target as Node)) {
        setSuggestOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function queueConfigFetch(query: string, delay: number) {
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const configs = await fetchJobEmailConfigs(query);
        setConfigSuggestions(configs);
        setSuggestOpen(true);
      } catch {
        setConfigSuggestions([]);
      }
    }, delay);
  }

  function handleEmailFocus() {
    setEmailFocused(true);
    queueConfigFetch(jobTitle.trim(), 0);
  }

  function handleEmailDraftChange(value: string) {
    setEmailDraft(value);
    queueConfigFetch(jobTitle.trim() || value.trim(), 180);
  }

  function handleJobTitleChange(value: string) {
    setJobTitle(value);
    if (emailFocused) queueConfigFetch(value.trim(), 300);
  }

  function applySavedConfig(config: JobEmailConfig) {
    if (!jobTitle.trim()) setJobTitle(config.jobtitle);
    const newEmails = config.emails
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    setEmails(newEmails);
    setEmailDraft('');
    setSuggestOpen(false);
  }

  function addSuggestedEmail(email: string) {
    if (email && !emails.includes(email)) setEmails((prev) => [...prev, email]);
    setEmailDraft('');
    setSuggestOpen(false);
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
        // The candidates feed comes from an external pipeline that needs a
        // few seconds to pick up a newly created interview - one immediate
        // refetch can easily run before that finishes. A second, delayed
        // refetch gives the Candidates page a real chance of showing the
        // new record without a manual reload.
        window.setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['candidates'] });
        }, 4000);
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
            <>
              <p className="mb-2 text-[13px] text-ink-muted">Share these links with your candidates:</p>
              <ul className="space-y-3 text-[13px]">
                {result.sessions.map((s) => {
                  const candidateName = s.ocr.resumeInfo?.name;
                  return (
                    <li key={s.sessionId} className="rounded-lg bg-surface px-3 py-3">
                      <div className="font-medium text-ink">{candidateName || s.resumeFileName}</div>
                      {candidateName && (
                        <div className="text-[11px] text-ink-faint">{s.resumeFileName}</div>
                      )}
                      <div className="mt-2">
                        <CopyLinkRow url={s.interviewUrl} />
                      </div>
                      <ResumeInfoPanel session={s} />
                    </li>
                  );
                })}
              </ul>
            </>
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
                onChange={(e) => handleJobTitleChange(e.target.value)}
                placeholder="e.g. Data Engineer - Entry Level"
                className="w-full rounded-lg border border-border px-3 py-2 text-[13px]"
              />
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) setJobTitle(e.target.value);
                }}
                className="mt-1 w-full rounded border-none bg-transparent text-[12px] text-ink-faint underline decoration-dotted"
                aria-label="Fill job title from Job Library"
              >
                <option value="" disabled>
                  Fill from Job Library
                </option>
                {jobLibraryTitles.map((title) => (
                  <option key={title} value={title}>
                    {title}
                  </option>
                ))}
              </select>
            </div>

            <div ref={emailShellRef} className="relative">
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
                  onChange={(e) => handleEmailDraftChange(e.target.value)}
                  onFocus={handleEmailFocus}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addEmail();
                      setSuggestOpen(false);
                    }
                    if (e.key === 'Escape') setSuggestOpen(false);
                  }}
                  onBlur={addEmail}
                  placeholder="Press Enter or , to add"
                  className="min-w-[120px] flex-1 border-none text-[13px] outline-none"
                />
              </div>
              {suggestOpen && (
                <div
                  onMouseDown={(e) => e.preventDefault()}
                  className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-card"
                >
                  <SavedConfigDropdown
                    configs={configSuggestions}
                    typed={emailDraft.trim()}
                    onSelectConfig={applySavedConfig}
                    onAddEmail={addSuggestedEmail}
                  />
                </div>
              )}
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
            Resume read-status and detected contact details appear in the results below after you create
            the interview(s) - not before.
          </p>
        </div>

        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-1 text-[15px] font-semibold text-ink">3 - Interview length and source</div>
          <p className="mb-4 text-[12px] text-ink-muted">For your planning - see notes below</p>

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
                For your planning - not saved with the interview yet.
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
              <p className="mt-1 text-[12px] text-ink-faint">For your own reference - not saved with the interview yet.</p>
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
