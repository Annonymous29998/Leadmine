import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtractedEmail, LogEntry } from './extract.js';
import { parseDomainFilter } from './extract.js';
import { runExtraction, type ExtractBody, type ExtractResult } from './extract-job.js';
import { isRoleOrGenericEmail, leadQualityScore, validateEmailAddress } from './validate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_EXPORTS =
  process.env.EXPORTS_DIR?.trim() ||
  (process.env.RAILWAY_ENVIRONMENT ? '/tmp/leadmin-exports' : path.join(ROOT, 'exports'));

export type SniffyResultRow = {
  timestamp: string;
  source_page: string;
  type: 'email';
  value: string;
  score: number;
};

export type JobStats = {
  pages_crawled: number;
  pages_failed: number;
  emails_found: number;
  leads_found: number;
};

export type JobState = {
  id: string;
  status: 'starting' | 'running' | 'completed' | 'stopped' | 'error';
  progress: number;
  stats: JobStats;
  currently_crawling: string[];
  results: SniffyResultRow[];
  new_results: SniffyResultRow[];
  logs: LogEntry[];
  error?: string;
  params?: ExtractBody & { maxDepth?: number; searchTerms?: string[] };
  startedAt: string;
  finishedAt?: string;
  savedDir?: string;
  savedFiles?: string[];
};

const jobs = new Map<string, JobState>();
let activeJobId: string | null = null;

function toRow(em: ExtractedEmail): SniffyResultRow {
  return {
    timestamp: new Date().toISOString(),
    source_page: em.sourceUrl.startsWith('http')
      ? `LeadMine Crawl: ${em.sourceUrl}`
      : em.sourceUrl,
    type: 'email',
    value: em.email,
    score: leadQualityScore(em.email) || 100,
  };
}

/** Persist like Sniffy: CSV + provider txt + legitimate_emails */
export function saveJobResults(job: JobState): { dir: string; files: string[] } {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const day = new Date().toISOString().slice(0, 10);
  const dir = path.join(DEFAULT_EXPORTS, day);
  mkdirSync(dir, { recursive: true });

  const emails = job.results.map((r) => r.value);
  const buckets = splitByProvider(emails);
  const files: string[] = [];

  const csvPath = path.join(dir, `results_${stamp}.csv`);
  const csvLines = [
    'timestamp,source_page,type,value,score',
    ...job.results.map(
      (r) =>
        `${r.timestamp},"${r.source_page.replace(/"/g, '""')}",${r.type},${r.value},${r.score}`,
    ),
  ];
  writeFileSync(csvPath, csvLines.join('\n') + '\n', 'utf8');
  files.push(csvPath);

  for (const [name, list] of Object.entries(buckets)) {
    const p = path.join(dir, `${name}_${stamp}.txt`);
    writeFileSync(p, list.join('\n') + (list.length ? '\n' : ''), 'utf8');
    files.push(p);
  }

  // Sniffy format: "# Legitimate Emails (Score >= 60)" + "email (score)"
  const legitRows = job.results.filter((r) => r.score >= 60);
  const legitPath = path.join(dir, `legitimate_emails_${stamp}.txt`);
  writeFileSync(
    legitPath,
    [
      '# Legitimate Emails (Score >= 60)',
      '# Format: email (score)',
      ...legitRows.map((r) => `${r.value} (${r.score})`),
      '',
    ].join('\n'),
    'utf8',
  );
  files.push(legitPath);

  const allPath = path.join(dir, `all_emails_${stamp}.txt`);
  writeFileSync(
    allPath,
    [
      '## All Extracted Emails with Scores',
      ...job.results.map((r) => `${r.value} (${r.score})`),
      '',
    ].join('\n'),
    'utf8',
  );
  files.push(allPath);

  job.savedDir = dir;
  job.savedFiles = files;
  return { dir, files };
}

export function getActiveJob(): JobState | null {
  if (!activeJobId) return null;
  return jobs.get(activeJobId) ?? null;
}

export function getJob(id: string): JobState | null {
  return jobs.get(id) ?? null;
}

export function getProgressPayload(job: JobState) {
  const fresh = job.new_results.splice(0, job.new_results.length);
  const done = job.status === 'completed' || job.status === 'stopped';
  const target = Math.min(250_000, Math.max(1, job.params?.maxResults || 1));
  return {
    status: job.status,
    progress: job.progress,
    target,
    stats: job.stats,
    currently_crawling: job.currently_crawling,
    new_results: fresh,
    // Stream full table while running (capped) so the UI shows emails live
    results: done ? job.results : job.results.length <= 3_000 ? [...job.results] : undefined,
    results_total: job.results.length,
    error: job.error,
    logs: job.logs.slice(-80),
    savedDir: job.savedDir,
    savedFiles: job.savedFiles?.map((f) => path.basename(f)),
  };
}

export function stopActiveJob(): { status: string } {
  const job = getActiveJob();
  if (!job || (job.status !== 'running' && job.status !== 'starting')) {
    return { status: 'idle' };
  }
  job.status = 'stopped';
  return { status: 'stopping' };
}

export async function startJob(
  body: ExtractBody & {
    searchTerms?: string[];
    maxDepth?: number;
    useProxy?: boolean;
    proxyList?: string;
  },
  keys?: { serpKey?: string; serperKey?: string },
): Promise<{ status: string; jobId: string }> {
  if (activeJobId) {
    const cur = jobs.get(activeJobId);
    if (cur && (cur.status === 'running' || cur.status === 'starting')) {
      throw new Error('An extraction is already running. Stop it first.');
    }
  }

  const id = randomUUID();
  const job: JobState = {
    id,
    status: 'starting',
    progress: 0,
    stats: { pages_crawled: 0, pages_failed: 0, emails_found: 0, leads_found: 0 },
    currently_crawling: [],
    results: [],
    new_results: [],
    logs: [],
    params: body,
    startedAt: new Date().toISOString(),
  };
  jobs.set(id, job);
  activeJobId = id;

  void (async () => {
    const checkCancel = () => job.status === 'stopped';

    job.status = 'running';
    job.progress = 2;

    const terms =
      body.searchTerms?.map((t) => t.trim()).filter(Boolean) ||
      (body.subject ? [body.subject] : []);
    if (!terms.length) {
      job.status = 'error';
      job.error = 'At least one search term is required.';
      job.finishedAt = new Date().toISOString();
      return;
    }

    const seen = new Set<string>();
    const validating = new Set<string>();
    const depth = Math.min(3, Math.max(1, body.maxDepth ?? 1));
    const totalTarget = Math.min(250_000, Math.max(1, body.maxResults));

    const syncProgress = () => {
      // Real progress = leads found / Max Results (never fake 100% until finished)
      if (job.status === 'completed') {
        job.progress = 100;
        return;
      }
      const leadPct = (job.results.length / totalTarget) * 100;
      if (job.results.length > 0) {
        job.progress = Math.min(99, Math.max(1, Math.round(leadPct)));
        return;
      }
      // No leads yet: show crawl activity only (capped low so bar isn't misleading)
      const pageHint = Math.min(12, Math.floor(job.stats.pages_crawled / 25));
      job.progress = Math.max(1, pageHint);
    };

    const pushLead = (email: string, score: number, sourceUrl: string) => {
      if (job.results.length >= totalTarget) return;
      if (seen.has(email)) return;
      seen.add(email);
      const row = toRow({
        email,
        domain: email.split('@')[1] ?? '',
        sourceUrl,
        context: '',
      });
      row.score = score;
      job.results.push(row);
      job.new_results.push(row);
      job.stats.leads_found = job.results.length;
      syncProgress();
    };

    const dropLead = (email: string) => {
      if (!seen.has(email)) return;
      seen.delete(email);
      job.results = job.results.filter((r) => r.value !== email);
      job.stats.leads_found = job.results.length;
      syncProgress();
    };

    try {
      for (let ti = 0; ti < terms.length; ti++) {
        if (checkCancel()) break;
        const remaining = totalTarget - job.results.length;
        if (remaining <= 0) break;

        const term = terms[ti];
        syncProgress();

        const pushLog = (entry: LogEntry) => {
          job.logs.push(entry);
          const msg = entry.message;
          if (msg.startsWith('Fetching ')) {
            job.currently_crawling = [msg.slice('Fetching '.length)];
          }
          if (msg.startsWith('Fetched ')) {
            job.stats.pages_crawled += 1;
            job.currently_crawling = [];
            syncProgress();
          }
          if (msg.startsWith('Failed ') || msg.startsWith('Skip ')) {
            if (msg.startsWith('Failed ')) job.stats.pages_failed += 1;
            job.currently_crawling = [];
          }
          if (msg.startsWith('Found:') || msg.startsWith('Candidate:')) {
            job.stats.emails_found += 1;

            const email = msg
              .replace(/^(Found:|Candidate:)\s*/i, '')
              .split(/\s+/)[0]
              ?.toLowerCase();
            if (
              email?.includes('@') &&
              !seen.has(email) &&
              !validating.has(email) &&
              job.results.length < totalTarget &&
              !isRoleOrGenericEmail(email) &&
              leadQualityScore(email) >= 60
            ) {
              // Show in the results table immediately; MX check may drop bad ones later
              const provisional = leadQualityScore(email);
              pushLead(email, provisional, 'LeadMine Crawl');
              validating.add(email);
              void validateEmailAddress(email).then((res) => {
                validating.delete(email);
                if (checkCancel()) return;
                if (!res.ok) {
                  dropLead(email);
                  return;
                }
                const existing = job.results.find((r) => r.value === email);
                if (existing) {
                  existing.score = Math.max(existing.score, res.score ?? provisional);
                } else if (job.results.length < totalTarget) {
                  pushLead(email, res.score ?? provisional, 'LeadMine Crawl');
                }
                syncProgress();
              });
            }
            syncProgress();
          }
          if (msg.startsWith('Valid:')) {
            const email = msg.replace(/^Valid:\s*/, '').split(/\s+/)[0]?.toLowerCase();
            if (email?.includes('@')) {
              const scoreMatch = /score\s+(\d+)/i.exec(msg);
              const score = scoreMatch ? Number(scoreMatch[1]) : leadQualityScore(email);
              if (!seen.has(email)) {
                pushLead(email, score, 'LeadMine Search');
              } else {
                const existing = job.results.find((r) => r.value === email);
                if (existing) existing.score = Math.max(existing.score, score);
              }
            }
            syncProgress();
          }
          if (/hunt round|Google seed|Crawl starting|Search returned/i.test(msg)) {
            syncProgress();
          }
        };

        let result: ExtractResult;
        try {
          result = await runExtraction(
            {
              subject: term,
              location: body.location || '',
              domains: body.domains,
              maxResults: remaining,
              mode: body.mode || 'web_search',
              urlList: body.urlList,
              fileContent: body.fileContent,
              fileName: body.fileName,
              maxDepth: depth,
              useProxy: body.useProxy,
              proxyList: body.proxyList,
            },
            {
              cancelled: () => checkCancel() || job.results.length >= totalTarget,
              onLog: pushLog,
              serpKey: keys?.serpKey,
              serperKey: keys?.serperKey,
            },
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // One bad term (e.g. niche + outlook filter) should not kill the whole multi-term job.
          if (/no scrapeable URLs|blocked these search|pattern not allowed/i.test(msg)) {
            job.logs.push({
              level: 'WARNING',
              message: `Skip term “${term}”: ${msg}`,
              at: new Date().toISOString(),
            });
            continue;
          }
          throw err;
        }

        // Let in-flight live MX checks finish (Sniffy streams as verified)
        for (let i = 0; i < 50 && validating.size > 0; i++) {
          await new Promise((r) => setTimeout(r, 100));
        }

        for (const em of result.emails) {
          if (job.results.length >= totalTarget) break;
          const existing = job.results.find((r) => r.value === em.email);
          if (existing) {
            if (em.sourceUrl.startsWith('http')) {
              existing.source_page = `LeadMine Crawl: ${em.sourceUrl}`;
              existing.score = Math.max(existing.score, leadQualityScore(em.email));
            }
            continue;
          }
          pushLead(em.email, leadQualityScore(em.email), em.sourceUrl);
        }
        syncProgress();
      }

      if (!job.results.length && !checkCancel()) {
        const filtered = parseDomainFilter(body.domains || '').mode !== 'any';
        throw new Error(
          filtered
            ? 'No scrapeable URLs / leads for these terms with the Domain Filter set. Try empty (all), company.com (corporate only), or gmail.com/yahoo.com. Also check Serper/SerpAPI quota.'
            : 'No scrapeable URLs for these terms. Check Serper/SerpAPI keys and quota, or try broader terms.',
        );
      }

      // Sniffy: keep legitimate leads (score >= 60)
      job.results = job.results
        .filter((r) => r.score >= 60)
        .sort((a, b) => b.score - a.score);
      job.stats.leads_found = job.results.length;

      job.progress = 100;
      job.currently_crawling = [];
      job.finishedAt = new Date().toISOString();

      if (job.results.length) {
        saveJobResults(job);
        job.logs.push({
          level: 'SUCCESS',
          message: `Auto-saved ${job.results.length} leads → ${job.savedDir}`,
          at: new Date().toISOString(),
        });
      }

      const current = jobs.get(id)?.status;
      if (current === 'stopped' || current === 'error') {
        if (current === 'stopped' && job.results.length && !job.savedDir) {
          saveJobResults(job);
        }
      } else {
        job.status = 'completed';
      }
    } catch (err) {
      job.status = 'error';
      job.error = (err as Error).message;
      job.finishedAt = new Date().toISOString();
      job.currently_crawling = [];
      if (job.results.length) saveJobResults(job);
    }
  })();

  return { status: 'started', jobId: id };
}

/** Provider buckets like Sniffy exports */
export function splitByProvider(emails: string[]): Record<string, string[]> {
  const buckets: Record<string, string[]> = {
    gmail: [],
    yahoo: [],
    outlook: [],
    hotmail: [],
    icloud: [],
    aol: [],
    protonmail: [],
    others: [],
    all: [],
  };
  for (const email of emails) {
    const e = email.toLowerCase().trim();
    if (!e.includes('@')) continue;
    buckets.all.push(e);
    const d = e.split('@')[1] ?? '';
    if (d === 'gmail.com' || d === 'googlemail.com') buckets.gmail.push(e);
    else if (d === 'yahoo.com' || d === 'ymail.com') buckets.yahoo.push(e);
    else if (d === 'outlook.com' || d === 'live.com' || d === 'msn.com') buckets.outlook.push(e);
    else if (d === 'hotmail.com') buckets.hotmail.push(e);
    else if (d === 'icloud.com' || d === 'me.com' || d === 'mac.com') buckets.icloud.push(e);
    else if (d === 'aol.com') buckets.aol.push(e);
    else if (d === 'proton.me' || d === 'protonmail.com') buckets.protonmail.push(e);
    else buckets.others.push(e);
  }
  return buckets;
}
