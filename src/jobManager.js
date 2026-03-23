// ESM module
// In-memory job store
const jobs = new Map();

export function createJob(input) {
  const job = {
    job_id: crypto.randomUUID(),
    status: 'pending',
    input,
    assets: {},
    result: null,
    error: null,
    created_at: new Date().toISOString()
  };
  jobs.set(job.job_id, job);
  return job;
}

export function getJob(id) { return jobs.get(id) || null; }
export function updateJob(id, updates) {
  const job = jobs.get(id);
  if (job) jobs.set(id, { ...job, ...updates });
}
export function getAllJobs() { return Array.from(jobs.values()); }
