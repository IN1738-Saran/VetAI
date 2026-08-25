// Shared client for the real, existing public.job_email_configs table
// (backend/src/controllers/jobEmailController.js) - the per-job-title
// notification email lists automatically used when an interview is
// created. Used both by Email Center (browse/manage) and by the New
// Interview page's email autocomplete (Old_Version's admin.html "Saved
// job-title configs" suggestions), so the fetch itself lives in one place.
export interface JobEmailConfig {
  id: number;
  jobtitle: string;
  emails: string;
}

export async function fetchJobEmailConfigs(query?: string): Promise<JobEmailConfig[]> {
  const qs = query && query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
  const res = await fetch(`/api/job-email-configs${qs}`);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const body = await res.json();
  return body.configs ?? [];
}
