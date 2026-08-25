// Example roles shown in the Job Library. The Data/AI role families,
// levels, titles, and experience bands below are grounded in "Data, AI &
// Analytics Career Levels Guide 2026" (a career-ladder reference compiled
// from industry job boards, recruiter comp guides, and career-ladder
// research - see that document for its own source list), not invented -
// each level's title and years-of-experience band matches that guide's
// tables. A handful of specific, tech-stack-named postings (e.g. "Senior
// Data Engineer (DBT & Snowflake)") are additionally kept because they
// match real, currently-active jobtitle values in the live webhook/
// dataentry feed (confirmed live 2026-08-15), so their "candidates/avg
// score" stats are genuinely computed, not faked. Integration/Quality/Sales
// are separate Systech practice areas the career guide doesn't cover - left
// as they were. There's no shared jobs system yet, so anything added
// through "New job" is saved to this browser only (see saveCustomJob
// below) until a real jobs backend exists.
export interface JobPosting {
  title: string;
  department: string;
  seniority: string;
  status: 'Active' | 'Draft';
  interviewLengthMinutes: number;
  tags: string[];
}

export interface CustomJobPosting extends JobPosting {
  id: string;
  custom: true;
}

export const SAMPLE_JOBS: JobPosting[] = [
  // ---- Data Engineering (Data Engineer, Analytics Engineer, Data Architect) ----
  {
    title: 'Data Engineer (Fresher / 0-6 Months Experience)',
    department: 'Data Engineering',
    seniority: 'Fresher - 0-6 months',
    status: 'Active',
    interviewLengthMinutes: 30,
    tags: ['SQL', 'Python Basics', 'Eagerness to Learn'],
  },
  {
    title: 'Associate Data Engineer',
    department: 'Data Engineering',
    seniority: 'Junior - 0-2 yrs',
    status: 'Active',
    interviewLengthMinutes: 30,
    tags: ['SQL', 'ETL Basics', 'Python'],
  },
  {
    title: 'Junior Data Engineer / Analytics Engineer',
    department: 'Data Engineering',
    seniority: 'Junior - 0-2 yrs',
    status: 'Active',
    interviewLengthMinutes: 30,
    tags: ['SQL', 'dbt Basics', 'Reporting'],
  },
  {
    title: 'Data Engineer',
    department: 'Data Engineering',
    seniority: 'Mid-Level - 2-5 yrs',
    status: 'Active',
    interviewLengthMinutes: 45,
    tags: ['SQL', 'Python', 'ETL/ELT', 'Cloud Platform'],
  },
  {
    title: 'Senior Data Engineer (DBT & Snowflake)',
    department: 'Data Engineering',
    seniority: 'Senior - 6-10 yrs',
    status: 'Active',
    interviewLengthMinutes: 60,
    tags: ['dbt', 'Snowflake', 'SQL', 'Airflow', 'Python'],
  },
  {
    title: 'Senior Data Engineer - Azure',
    department: 'Data Engineering',
    seniority: 'Senior - 5-9 yrs',
    status: 'Active',
    interviewLengthMinutes: 45,
    tags: ['Azure', 'Databricks', 'ADF', 'Spark'],
  },
  {
    title: 'Lead Data Engineer (Azure Databricks)',
    department: 'Data Engineering',
    seniority: 'Staff/Lead - 8-12 yrs',
    status: 'Active',
    interviewLengthMinutes: 60,
    tags: ['Databricks', 'Kafka', 'Delta Lake', 'Terraform'],
  },
  {
    title: 'Staff Data Engineer',
    department: 'Data Engineering',
    seniority: 'Staff/Lead - 8-12 yrs',
    status: 'Draft',
    interviewLengthMinutes: 60,
    tags: ['Org-wide Data Strategy', 'Multi-team Projects', 'Data Governance'],
  },
  {
    title: 'DataOps Engineer',
    department: 'Data Engineering',
    seniority: 'Mid-Level - 4-7 yrs',
    status: 'Active',
    interviewLengthMinutes: 45,
    tags: ['CI/CD', 'Airflow', 'Monitoring', 'Python'],
  },
  {
    title: 'Junior Analytics Engineer',
    department: 'Data Engineering',
    seniority: 'Junior - 0-2 yrs',
    status: 'Active',
    interviewLengthMinutes: 30,
    tags: ['SQL', 'dbt', 'Snowflake/BigQuery/Databricks Basics'],
  },
  {
    title: 'Analytics Engineer',
    department: 'Data Engineering',
    seniority: 'Mid-Level - 2-5 yrs',
    status: 'Active',
    interviewLengthMinutes: 45,
    tags: ['dbt', 'SQL', 'Data Modeling', 'Warehouse Testing'],
  },
  {
    title: 'Senior Analytics Engineer',
    department: 'Data Engineering',
    seniority: 'Senior - 5-8 yrs',
    status: 'Active',
    interviewLengthMinutes: 60,
    tags: ['Analytics Foundation', 'Data Reliability', 'Automation'],
  },
  {
    title: 'Data Architect',
    department: 'Data Engineering',
    seniority: 'Data Architect - 8-12 yrs',
    status: 'Draft',
    interviewLengthMinutes: 60,
    tags: ['Data Modeling', 'Integration Strategy', 'Enterprise Blueprints'],
  },
  {
    title: 'Cloud Data Architect',
    department: 'Data Engineering',
    seniority: 'Senior/Principal - 12-18 yrs',
    status: 'Active',
    interviewLengthMinutes: 60,
    tags: ['Azure', 'AWS', 'Data Modeling', 'Governance'],
  },

  // ---- Data & Business Analytics (Data Analyst, Business Analyst, BI Developer) ----
  {
    title: 'Junior Data Analyst',
    department: 'Data & Business Analytics',
    seniority: 'Junior - 0-2 yrs',
    status: 'Active',
    interviewLengthMinutes: 30,
    tags: ['SQL', 'Data Cleaning', 'Standard Reporting'],
  },
  {
    title: 'Data Analyst',
    department: 'Data & Business Analytics',
    seniority: 'Mid-Level - 2-5 yrs',
    status: 'Active',
    interviewLengthMinutes: 45,
    tags: ['SQL', 'Dashboards', 'Stakeholder Presentations'],
  },
  {
    title: 'Senior Data Analyst',
    department: 'Data & Business Analytics',
    seniority: 'Senior - 5-8 yrs',
    status: 'Active',
    interviewLengthMinutes: 45,
    tags: ['Complex Analysis', 'Mentoring', 'Data Governance Policy'],
  },
  {
    title: 'Junior Business Analyst',
    department: 'Data & Business Analytics',
    seniority: 'Junior/Entry - 0-2 yrs',
    status: 'Active',
    interviewLengthMinutes: 30,
    tags: ['Requirements Gathering', 'Excel', 'SQL Basics'],
  },
  {
    title: 'Business Analyst - Data Analytics',
    department: 'Data & Business Analytics',
    seniority: 'Mid-Level - 2-5 yrs',
    status: 'Active',
    interviewLengthMinutes: 45,
    tags: ['Requirements', 'SQL', 'Dashboards', 'Stakeholder Management'],
  },
  {
    title: 'Senior Business Analyst - AI & Analytics',
    department: 'Data & Business Analytics',
    seniority: 'Senior - 5-8 yrs',
    status: 'Draft',
    interviewLengthMinutes: 45,
    tags: ['Process Design', 'Analytics', 'Roadmapping'],
  },
  {
    title: 'Junior BI Developer',
    department: 'Data & Business Analytics',
    seniority: 'Junior - 0-2 yrs',
    status: 'Active',
    interviewLengthMinutes: 30,
    tags: ['Power BI', 'Tableau Basics', 'DAX', 'SQL'],
  },
  {
    title: 'BI Developer',
    department: 'Data & Business Analytics',
    seniority: 'Mid-Level - 2-5 yrs',
    status: 'Active',
    interviewLengthMinutes: 45,
    tags: ['Power BI', 'Tableau', 'DAX', 'Semantic Models'],
  },
  {
    title: 'Senior BI Developer',
    department: 'Data & Business Analytics',
    seniority: 'Senior - 5-8 yrs',
    status: 'Active',
    interviewLengthMinutes: 45,
    tags: ['Enterprise Reporting Architecture', 'Performance Tuning'],
  },
  {
    title: 'Managed Services Analyst',
    department: 'Data & Business Analytics',
    seniority: 'Mid-Level - 2-5 yrs',
    status: 'Active',
    interviewLengthMinutes: 30,
    tags: ['Monitoring', 'SLAs', 'Support'],
  },

  // ---- Data Science ----
  {
    title: 'Junior Data Scientist',
    department: 'Data Science',
    seniority: 'Junior/Associate - 0-2 yrs',
    status: 'Active',
    interviewLengthMinutes: 30,
    tags: ['Python', 'Model Testing', 'Debugging'],
  },
  {
    title: 'Data Scientist',
    department: 'Data Science',
    seniority: 'Mid-Level - 2-5 yrs',
    status: 'Active',
    interviewLengthMinutes: 45,
    tags: ['Python', 'Statistics', 'Modeling Pipeline'],
  },
  {
    title: 'Senior Data Scientist',
    department: 'Data Science',
    seniority: 'Senior - 5-8 yrs',
    status: 'Active',
    interviewLengthMinutes: 60,
    tags: ['Python', 'Statistics', 'Machine Learning', 'A/B Testing'],
  },

  // ---- Machine Learning & AI Engineering ----
  {
    title: 'Junior ML Engineer',
    department: 'Machine Learning & AI Engineering',
    seniority: 'Junior - 0-2 yrs',
    status: 'Active',
    interviewLengthMinutes: 30,
    tags: ['Model Features', 'Training Pipelines'],
  },
  {
    title: 'ML Engineer',
    department: 'Machine Learning & AI Engineering',
    seniority: 'Mid-Level - 2-5 yrs',
    status: 'Active',
    interviewLengthMinutes: 45,
    tags: ['Model Training', 'Deployment', 'Production Operations'],
  },
  {
    title: 'Junior MLOps Engineer',
    department: 'Machine Learning & AI Engineering',
    seniority: 'Junior - 0-2 yrs',
    status: 'Draft',
    interviewLengthMinutes: 30,
    tags: ['CI/CD', 'Model Deployment Support'],
  },
  {
    title: 'MLOps Engineer',
    department: 'Machine Learning & AI Engineering',
    seniority: 'Mid-Level - 2-5 yrs',
    status: 'Active',
    interviewLengthMinutes: 45,
    tags: ['Inference APIs', 'Fine-tuning', 'Runtime Systems'],
  },
  {
    title: 'Junior AI Engineer',
    department: 'Machine Learning & AI Engineering',
    seniority: 'Junior - 0-2 yrs',
    status: 'Active',
    interviewLengthMinutes: 30,
    tags: ['Training Scripts', 'Inference Calls', 'Debugging'],
  },
  {
    title: 'AI Engineer',
    department: 'Machine Learning & AI Engineering',
    seniority: 'Mid-Level - 3-5 yrs',
    status: 'Active',
    interviewLengthMinutes: 45,
    tags: ['LLM APIs', 'RAG Pipelines', 'LangChain/LlamaIndex'],
  },
  {
    title: 'Senior AI Engineer',
    department: 'Machine Learning & AI Engineering',
    seniority: 'Senior - 5-8 yrs',
    status: 'Active',
    interviewLengthMinutes: 60,
    tags: ['System Design', 'Vector DBs', 'Hosting Strategy'],
  },
  {
    title: 'Junior AI/ML Engineer',
    department: 'Machine Learning & AI Engineering',
    seniority: 'Entry level - 0-2 yrs',
    status: 'Active',
    interviewLengthMinutes: 30,
    tags: ['Python', 'ML Fundamentals', 'Data Handling'],
  },
  {
    title: 'AI/ML Engineer',
    department: 'Machine Learning & AI Engineering',
    seniority: 'Senior - 5-8 yrs',
    status: 'Active',
    interviewLengthMinutes: 60,
    tags: ['Python', 'MLOps', 'PyTorch', 'Azure ML'],
  },

  // ---- Generative AI (GenAI/LLM Engineer, Prompt/Agentic Specializations) ----
  {
    title: 'Junior GenAI Engineer',
    department: 'Generative AI',
    seniority: 'Junior - 0-2 yrs',
    status: 'Active',
    interviewLengthMinutes: 30,
    tags: ['Prompt Design', 'Fine-tuning Basics', 'LLM API Integration'],
  },
  {
    title: 'GenAI Engineer',
    department: 'Generative AI',
    seniority: 'Mid-Level - 2-5 yrs',
    status: 'Active',
    interviewLengthMinutes: 45,
    tags: ['RAG Pipelines', 'Evals', 'Cost/Latency Tuning'],
  },
  {
    title: 'Senior GenAI Engineer',
    department: 'Generative AI',
    seniority: 'Senior - 5-8 yrs',
    status: 'Active',
    interviewLengthMinutes: 60,
    tags: ['Agentic Architecture', 'Multi-agent Orchestration', 'Tool Use'],
  },
  {
    title: 'Agentic AI Developer',
    department: 'Generative AI',
    seniority: 'Mid-Level - 3-6 yrs',
    status: 'Active',
    interviewLengthMinutes: 60,
    tags: ['Agent Frameworks', 'Python', 'APIs', 'Automation'],
  },
  {
    title: 'Prompt Engineer',
    department: 'Generative AI',
    seniority: 'Entry/Specialist - 0-3 yrs',
    status: 'Active',
    interviewLengthMinutes: 30,
    tags: ['System Prompts', 'Few-shot Examples', 'Structured Outputs'],
  },
  {
    title: 'AI Evaluator / Evals Engineer',
    department: 'Generative AI',
    seniority: 'Specialist Track - 3-8 yrs',
    status: 'Draft',
    interviewLengthMinutes: 45,
    tags: ['Evaluation Harnesses', 'Model-behavior Auditing', 'Safety Guardrails'],
  },
  {
    title: 'Enterprise AI Architect',
    department: 'Generative AI',
    seniority: 'Principal/Architect - 12+ yrs',
    status: 'Active',
    interviewLengthMinutes: 60,
    tags: ['Solution Architecture', 'AI Strategy', 'Azure/AWS'],
  },

  // ---- AI Research & Governance (AI/ML Research Scientist, Data Governance & AI Ethics) ----
  {
    title: 'Data Governance Specialist',
    department: 'AI Research & Governance',
    seniority: 'Mid-Level - 3-6 yrs',
    status: 'Draft',
    interviewLengthMinutes: 45,
    tags: ['Data Quality', 'Governance Frameworks', 'Bias Assessment'],
  },
  {
    title: 'Senior Data Governance Lead',
    department: 'AI Research & Governance',
    seniority: 'Senior/Lead - 6-10 yrs',
    status: 'Draft',
    interviewLengthMinutes: 45,
    tags: ['Governance Policy', 'Regulatory Risk', 'Board Reporting'],
  },
  {
    title: 'Junior Research Scientist',
    department: 'AI Research & Governance',
    seniority: 'Junior Researcher - 0-3 yrs',
    status: 'Draft',
    interviewLengthMinutes: 45,
    tags: ['Experiments', 'Paper Replication', 'Model Evaluation'],
  },
  {
    title: 'Research Scientist',
    department: 'AI Research & Governance',
    seniority: 'Mid/Senior - 3-8 yrs',
    status: 'Draft',
    interviewLengthMinutes: 60,
    tags: ['Research Direction', 'Publishing', 'Production Techniques'],
  },

  // ---- AI Product & Solutions (AI Product Manager, AI Solutions Architect) ----
  {
    title: 'AI Product Manager',
    department: 'AI Product & Solutions',
    seniority: 'Mid-Level - 3-6 yrs',
    status: 'Active',
    interviewLengthMinutes: 45,
    tags: ['AI Feature Roadmap', 'Requirements', 'Stakeholder Alignment'],
  },
  {
    title: 'Senior AI Product Manager',
    department: 'AI Product & Solutions',
    seniority: 'Senior - 6-10 yrs',
    status: 'Draft',
    interviewLengthMinutes: 60,
    tags: ['AI Product Strategy', 'Cross-team Leadership'],
  },
  {
    title: 'AI Solutions Architect',
    department: 'AI Product & Solutions',
    seniority: 'Mid-Level - 3-6 yrs',
    status: 'Active',
    interviewLengthMinutes: 45,
    tags: ['Solution Architecture', 'Client Deployment Design'],
  },
  {
    title: 'Senior AI Solutions Architect',
    department: 'AI Product & Solutions',
    seniority: 'Senior - 6-10 yrs',
    status: 'Draft',
    interviewLengthMinutes: 60,
    tags: ['Complex Multi-system Architecture', 'Client Strategy'],
  },

  // ---- Integration / Quality / Sales (separate Systech practice areas - not covered by the career guide) ----
  {
    title: 'MuleSoft API Developer',
    department: 'Integration',
    seniority: 'Mid - 3-6 yrs',
    status: 'Draft',
    interviewLengthMinutes: 45,
    tags: ['MuleSoft', 'REST', 'Java', 'RAML'],
  },
  {
    title: 'Associate Integration Developer',
    department: 'Integration',
    seniority: 'Entry level - 0-2 yrs',
    status: 'Active',
    interviewLengthMinutes: 30,
    tags: ['REST APIs', 'Java Basics', 'Integration Concepts'],
  },
  {
    title: 'Senior QA Analyst',
    department: 'Quality',
    seniority: 'Senior - 5-8 yrs',
    status: 'Active',
    interviewLengthMinutes: 45,
    tags: ['Selenium', 'API testing', 'SQL', 'Jira'],
  },
  {
    title: 'QA Analyst (Entry Level)',
    department: 'Quality',
    seniority: 'Entry level - 0-2 yrs',
    status: 'Active',
    interviewLengthMinutes: 30,
    tags: ['Manual Testing', 'Test Cases', 'Bug Tracking'],
  },
  {
    title: 'Inside Sales Lead',
    department: 'Sales',
    seniority: 'Mid - 3-5 yrs',
    status: 'Active',
    interviewLengthMinutes: 30,
    tags: ['CRM', 'Outreach', 'Negotiation'],
  },
  {
    title: 'Sales Development Representative',
    department: 'Sales',
    seniority: 'Entry level - 0-2 yrs',
    status: 'Active',
    interviewLengthMinutes: 30,
    tags: ['Prospecting', 'CRM', 'Communication'],
  },
];

const STORAGE_KEY = 'vetai_job_library_custom_jobs_v1';

// Jobs added through "New job" - saved to this browser's localStorage so
// they survive a reload. Genuinely functional, just not shared across
// devices/recruiters yet (there's no jobs table on the server today).
export function loadCustomJobs(): CustomJobPosting[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCustomJob(job: JobPosting): CustomJobPosting[] {
  const newJob: CustomJobPosting = {
    ...job,
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    custom: true,
  };
  const updated = [...loadCustomJobs(), newJob];
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }
  return updated;
}

export function departmentsFor(jobs: JobPosting[]): string[] {
  return ['All departments', ...Array.from(new Set(jobs.map((j) => j.department)))];
}

// Same normalization as candidateDerived.ts's statsForJobTitle (case/
// whitespace-insensitive - real feed titles have observed variants like a
// doubled space). Used to find a posting's real required-skill tags for a
// candidate by matching their real jobtitle field, not a separate id.
function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function findJobPostingForTitle(jobtitle: string, jobs: JobPosting[]): JobPosting | undefined {
  const normalized = normalizeTitle(jobtitle);
  return jobs.find((job) => normalizeTitle(job.title) === normalized);
}
