// POST /api/create-interview - the real, UNMODIFIED endpoint (plan Strict
// Constraint #2/#7: request shape must stay multipart/form-data with
// jobTitle, toEmails, jobDescription, resumes - exactly as admin.html sends
// it today). This file only calls it; it does not change its contract.
// Mirrors backend/src/services/resumeFields.js's exported RESUME_FIELDS
// exactly - these are the real field names that service mines from the
// résumé text (regex/vocabulary-based, no model call), unchanged this
// session. Every scalar is '' and every list is [] when nothing was found -
// never omitted, so the UI can render an honest "Not found" per field.
export interface ResumeInfo {
  name: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  github: string;
  portfolio: string;
  jobTitle: string;
  experience: string;
  skills: string[];
  technicalSkills: string[];
  softSkills: string[];
  education: string[];
  certifications: string[];
  projects: string[];
  companies: string[];
  designations: string[];
  languages: string[];
}

export interface ResumeStats {
  fieldsDetected: number;
  totalFields: number;
  missingFields: string[];
}

export interface DocumentInfo {
  model?: string;
  pages?: number;
  processingTimeSeconds?: number;
}

export interface OcrDiagnostics {
  source: string;
  charactersExtracted: number;
  documentInfo?: DocumentInfo | null;
  warnings?: string[];
  error?: string | null;
  resumeInfo?: ResumeInfo | null;
  stats?: ResumeStats | null;
  rawText: string;
  rawTextTruncated: boolean;
}

export interface CreatedSession {
  sessionId: string;
  resumeFileName: string;
  interviewUrl: string;
  ocr: OcrDiagnostics;
}

export interface SkippedResume {
  fileName: string;
  reason: string;
}

export interface CreateInterviewResult {
  success: boolean;
  sessions?: CreatedSession[];
  count?: number;
  skipped?: SkippedResume[];
  skippedCount?: number;
  error?: string;
}

export async function createInterview(params: {
  jobTitle: string;
  toEmails: string;
  jobDescription: File;
  resumes: File[];
}): Promise<CreateInterviewResult> {
  const formData = new FormData();
  formData.append('jobTitle', params.jobTitle);
  formData.append('toEmails', params.toEmails);
  formData.append('jobDescription', params.jobDescription);
  for (const resume of params.resumes) {
    formData.append('resumes', resume);
  }

  const res = await fetch('/api/create-interview', {
    method: 'POST',
    body: formData,
  });

  const data = (await res.json()) as CreateInterviewResult;
  if (!res.ok && data.success === undefined) {
    // Defensive - the real endpoint always returns a JSON body with
    // `success`, but guard against an unexpected non-JSON error response.
    throw new Error(`Request failed with status ${res.status}`);
  }
  return data;
}
