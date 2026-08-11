import { randomUUID } from 'node:crypto';
import {
  formatBucketFile,
  parseEmailList,
  verifyEmailList,
  type BulkVerifyResult,
  type VerifyRow,
} from './verify-bulk.js';

export type VerifyJobStatus = 'starting' | 'running' | 'completed' | 'stopped' | 'error';

export type VerifyJob = {
  id: string;
  status: VerifyJobStatus;
  progress: number;
  total: number;
  checked: number;
  counts: { reachable: number; invalid: number; unknown: number };
  error?: string;
  result?: BulkVerifyResult;
  startedAt: string;
  finishedAt?: string;
  smtp: boolean;
};

const jobs = new Map<string, VerifyJob>();
const cancelFns = new Map<string, () => void>();
let activeId: string | null = null;

export function getVerifyJob(id?: string | null): VerifyJob | null {
  if (id) return jobs.get(id) ?? null;
  if (activeId) return jobs.get(activeId) ?? null;
  return null;
}

export function getVerifyProgress(job: VerifyJob) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    total: job.total,
    checked: job.checked,
    error: job.error,
    counts: job.result
      ? {
          reachable: job.result.reachable.length,
          invalid: job.result.invalid.length,
          unknown: job.result.unknown.length,
        }
      : { ...job.counts },
    smtp: job.smtp,
  };
}

export async function startVerifyJob(input: {
  text: string;
  smtp?: boolean;
}): Promise<{ jobId: string; status: string }> {
  if (activeId) {
    const cur = jobs.get(activeId);
    if (cur && (cur.status === 'running' || cur.status === 'starting')) {
      throw new Error('A verification job is already running. Stop it first.');
    }
  }

  const emails = parseEmailList(input.text);
  if (!emails.length) throw new Error('Paste at least one email address.');
  if (emails.length > 20_000) throw new Error('Max 20,000 emails per batch.');

  const id = randomUUID();
  const smtp = input.smtp !== false;
  const job: VerifyJob = {
    id,
    status: 'starting',
    progress: 0,
    total: emails.length,
    checked: 0,
    counts: { reachable: 0, invalid: 0, unknown: 0 },
    startedAt: new Date().toISOString(),
    smtp,
  };
  jobs.set(id, job);
  activeId = id;

  let cancelled = false;
  cancelFns.set(id, () => {
    cancelled = true;
  });

  void (async () => {
    job.status = 'running';
    try {
      const result = await verifyEmailList(emails, {
        smtp,
        concurrency: 4,
        cancelled: () => cancelled,
        onProgress: (done, total, last) => {
          job.checked = done;
          job.total = total;
          job.progress = Math.round((done / Math.max(1, total)) * 100);
          if (last) {
            if (last.bucket === 'reachable') job.counts.reachable += 1;
            else if (last.bucket === 'invalid') job.counts.invalid += 1;
            else job.counts.unknown += 1;
          }
        },
      });
      if (cancelled) {
        job.status = 'stopped';
        job.result = result;
        job.finishedAt = new Date().toISOString();
        return;
      }
      job.result = result;
      job.progress = 100;
      job.status = 'completed';
      job.finishedAt = new Date().toISOString();
    } catch (err) {
      job.status = 'error';
      job.error = err instanceof Error ? err.message : String(err);
      job.finishedAt = new Date().toISOString();
    } finally {
      cancelFns.delete(id);
    }
  })();

  return { jobId: id, status: 'running' };
}

export function stopVerifyJob(): { status: string } {
  const job = activeId ? jobs.get(activeId) : null;
  if (!job || (job.status !== 'running' && job.status !== 'starting')) {
    return { status: 'idle' };
  }
  cancelFns.get(job.id)?.();
  job.status = 'stopped';
  job.finishedAt = new Date().toISOString();
  return { status: 'stopped' };
}

export function getVerifyDownload(
  job: VerifyJob,
  format: 'reachable' | 'invalid' | 'unknown' | 'all',
): { filename: string; body: string; contentType: string } | null {
  if (!job.result) return null;
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  if (format === 'reachable') {
    return {
      filename: `reachable_${stamp}.txt`,
      body: formatBucketFile(job.result.reachable, 'Reachable / legitimate emails'),
      contentType: 'text/plain; charset=utf-8',
    };
  }
  if (format === 'invalid') {
    return {
      filename: `invalid_${stamp}.txt`,
      body: formatBucketFile(job.result.invalid, 'Invalid emails'),
      contentType: 'text/plain; charset=utf-8',
    };
  }
  if (format === 'unknown') {
    return {
      filename: `unknown_${stamp}.txt`,
      body: formatBucketFile(job.result.unknown, 'Unknown / inconclusive emails'),
      contentType: 'text/plain; charset=utf-8',
    };
  }
  const all: VerifyRow[] = [
    ...job.result.reachable,
    ...job.result.invalid,
    ...job.result.unknown,
  ];
  const csv = [
    'email,bucket,score,mx,smtp,reason',
    ...all.map(
      (r) =>
        `${r.email},${r.bucket},${r.score},${r.mx},${r.smtp},"${r.reason.replace(/"/g, '""')}"`,
    ),
    '',
  ].join('\n');
  return {
    filename: `verify_all_${stamp}.csv`,
    body: csv,
    contentType: 'text/csv; charset=utf-8',
  };
}
