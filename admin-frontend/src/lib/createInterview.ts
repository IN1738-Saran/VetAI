// POST /api/create-interview - the real, UNMODIFIED endpoint (plan Strict
// Constraint #2/#7: request shape must stay multipart/form-data with
// jobTitle, toEmails, jobDescription, resumes - exactly as admin.html sends
// it today). This file only calls it; it does not change its contract.
export interface OcrDiagnostics {
  source: string;
  charactersExtracted: number;
  documentInfo?: unknown;
  warnings?: unknown;
  error?: string | null;
  resumeInfo?: unknown;
  stats?: unknown;
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
