import path from 'node:path';
import { existsSync } from 'node:fs';
import os from 'node:os';
import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import type { LogEntry, SearchParams } from './extract.js';
import {
  exportCsv,
  exportInboxFlowCsv,
  exportJson,
  exportMarkdown,
  exportTxt,
} from './export.js';
import { runExtraction } from './extract-job.js';
import {
  getActiveJob,
  getProgressPayload,
  saveJobResults,
  startJob,
  stopActiveJob,
} from './jobs.js';

export async function registerApp(
  app: FastifyInstance,
  opts: { root: string; exportsDir: string },
): Promise<void> {
  const DEFAULT_EXPORTS = opts.exportsDir;
  const ROOT = opts.root;

  await app.register(cors, { origin: true });

  const extractBody = z.object({
    subject: z.string().min(1),
    location: z.string().default(''),
    domains: z.union([z.string(), z.array(z.string())]),
    maxResults: z.number().int().min(1).max(250_000).default(25),
    mode: z.enum(['urls', 'web_search']),
    urlList: z.string().optional(),
    fileContent: z.string().optional(),
    fileName: z.string().optional(),
  });

  const exportBody = z.object({
    formats: z.array(z.enum(['csv', 'json', 'txt', 'md', 'inbox_flow'])).min(1),
    exportPath: z.string().optional(),
    subject: z.string(),
    location: z.string().default(''),
    domains: z.array(z.string()),
    maxResults: z.number().default(100),
    mode: z.enum(['urls', 'web_search']),
    emails: z.array(
      z.object({
        email: z.string(),
        domain: z.string(),
        sourceUrl: z.string(),
        context: z.string(),
      }),
    ),
    stats: z.object({
      totalFound: z.number(),
      uniqueCount: z.number(),
      duplicatesRemoved: z.number(),
      rejectedInvalid: z.number().optional(),
    }),
  });

  function formatApiError(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return 'Unknown error';
  }

  app.get('/api/settings', async () => {
    const serpapi = Boolean(process.env.SERPAPI_KEY?.trim());
    const serper = Boolean(process.env.SERPER_API_KEY?.trim());
    const ready = serpapi || serper;
    return {
      hasSerpapi: ready,
      hasSerper: serper,
      hasGoogleCse: false,
      usesDdgFallback: false,
      searchProvider: serper && serpapi ? 'serper+serpapi' : serper ? 'serper' : serpapi ? 'serpapi' : 'none',
      warning: ready ? null : 'Add SERPER_API_KEY and/or SERPAPI_KEY to .env to run extraction',
    };
  });

  app.post('/api/extract', async (req, reply) => {
    const parsed = extractBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const body = parsed.data;
    let cancelled = false;
    req.raw.on('aborted', () => {
      cancelled = true;
    });

    try {
      const result = await runExtraction(body, {
        cancelled: () => cancelled,
        serpKey: process.env.SERPAPI_KEY,
        serperKey: process.env.SERPER_API_KEY,
      });
      return result;
    } catch (err) {
      const msg = formatApiError(err);
      const status =
        msg.includes('API key') || msg.includes('SERPAPI_KEY') || msg.includes('SERPER')
          ? 503
          : msg.includes('SerpAPI') || msg.includes('Serper')
            ? 502
            : 400;
      return reply.status(status).send({ error: msg });
    }
  });

  app.post('/api/extract/stream', async (req, reply) => {
    const parsed = extractBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const body = parsed.data;
    let cancelled = false;

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const send = (event: string, data: unknown) => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    req.raw.on('aborted', () => {
      cancelled = true;
    });
    reply.raw.on('close', () => {
      cancelled = true;
    });

    send('log', {
      level: 'INFO',
      message: 'Job started…',
      at: new Date().toISOString(),
    } satisfies LogEntry);

    try {
      const result = await runExtraction(body, {
        cancelled: () => cancelled,
        serpKey: process.env.SERPAPI_KEY,
        serperKey: process.env.SERPER_API_KEY,
        onLog: (entry) => send('log', entry),
      });
      send('done', result);
    } catch (err) {
      send('error', { error: formatApiError(err) });
    } finally {
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  });

  app.post('/api/export', async (req, reply) => {
    const parsed = exportBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const body = parsed.data;
    if (!body.emails.length) {
      return reply.status(400).send({ error: 'No results to export.' });
    }

    const params: SearchParams = {
      subject: body.subject,
      location: body.location,
      domains: body.domains,
      maxResults: body.maxResults,
      mode: body.mode,
    };

    try {
      const requested = body.exportPath?.trim();
      let exportDir = DEFAULT_EXPORTS;
      if (requested) {
        const resolved = path.resolve(requested);
        const root = path.resolve(DEFAULT_EXPORTS);
        if (resolved !== root && !resolved.startsWith(root + path.sep)) {
          return reply
            .status(400)
            .send({ error: 'exportPath must be inside the project exports/ folder' });
        }
        exportDir = resolved;
      }

      const paths: string[] = [];
      for (const fmt of body.formats) {
        if (fmt === 'csv') paths.push(exportCsv(body.emails, params, exportDir));
        if (fmt === 'json') paths.push(exportJson(body.emails, params, body.stats, exportDir));
        if (fmt === 'txt') paths.push(exportTxt(body.emails, params, exportDir));
        if (fmt === 'md') paths.push(exportMarkdown(body.emails, params, body.stats, exportDir));
        if (fmt === 'inbox_flow') paths.push(exportInboxFlowCsv(body.emails, params, exportDir));
      }
      return { paths, exportDir };
    } catch (err) {
      return reply.status(400).send({ error: formatApiError(err) });
    }
  });

  const sniffyStartBody = z.object({
    searchTerms: z.array(z.string()).min(1).optional(),
    searchTerm: z.string().optional(),
    subject: z.string().optional(),
    location: z.string().default(''),
    domain: z.string().optional(),
    domains: z.union([z.string(), z.array(z.string())]).optional(),
    maxResults: z.union([z.number(), z.string()]).default(50),
    maxDepth: z.union([z.number(), z.string()]).default(1),
    useProxy: z.boolean().optional(),
    proxyList: z.string().optional(),
    deepCrawl: z.boolean().optional(),
    mode: z.enum(['urls', 'web_search']).optional(),
    urlList: z.string().optional(),
  });

  app.post('/api/start_extraction', async (req, reply) => {
    const parsed = sniffyStartBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const b = parsed.data;
    const terms =
      b.searchTerms?.filter((t) => t.trim()) ||
      (b.searchTerm || b.subject || '')
        .split(/\r?\n/)
        .map((t) => t.trim())
        .filter(Boolean);

    if (!terms.length) {
      return reply.status(400).send({ error: 'At least one search term is required.' });
    }

    const domains = b.domains ?? b.domain ?? '';
    const maxResults = Math.min(250_000, Math.max(1, Number(b.maxResults) || 10_000));
    const maxDepth = Math.min(3, Math.max(1, Number(b.maxDepth) || 2));

    if (!process.env.SERPAPI_KEY?.trim() && !process.env.SERPER_API_KEY?.trim()) {
      return reply.status(503).send({
        error:
          'Search API key required. Add SERPER_API_KEY or SERPAPI_KEY in Railway Variables and redeploy.',
      });
    }

    try {
      const started = await startJob(
        {
          subject: terms[0],
          searchTerms: terms,
          location: b.location || '',
          domains,
          maxResults,
          maxDepth,
          mode: b.mode || 'web_search',
          urlList: b.urlList,
          useProxy: Boolean(b.useProxy),
          proxyList: b.proxyList || '',
        },
        {
          serpKey: process.env.SERPAPI_KEY,
          serperKey: process.env.SERPER_API_KEY,
        },
      );
      return started;
    } catch (err) {
      return reply.status(409).send({ error: formatApiError(err) });
    }
  });

  app.get('/api/get_progress', async () => {
    const job = getActiveJob();
    if (!job) {
      return {
        status: 'idle',
        progress: 0,
        stats: { pages_crawled: 0, pages_failed: 0, emails_found: 0, leads_found: 0 },
        currently_crawling: [],
        new_results: [],
      };
    }
    return getProgressPayload(job);
  });

  app.post('/api/stop_extraction', async () => stopActiveJob());

  app.get('/api/download_results', async (req, reply) => {
    const job = getActiveJob();
    if (!job?.results.length) {
      return reply.status(404).send({ error: 'No results available' });
    }

    const q = req.query as { format?: string };
    const format = (q.format || 'csv').toLowerCase();
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

    if (!job.savedDir || !job.savedFiles?.length) {
      saveJobResults(job);
    }
    const files = job.savedFiles || [];
    const { readFileSync } = await import('node:fs');

    const sendDownload = (body: string | Buffer, contentType: string, filename: string) => {
      reply.header('Content-Type', contentType);
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Cache-Control', 'no-store');
      reply.header('X-Content-Type-Options', 'nosniff');
      return reply.send(body);
    };

    if (format === 'json') {
      const body = JSON.stringify(
        job.results.map((r) => ({
          email: r.value,
          score: r.score,
          source: r.source_page,
          timestamp: r.timestamp,
        })),
        null,
        2,
      );
      return sendDownload(body, 'application/json; charset=utf-8', `leadmin_leads_${stamp}.json`);
    }

    if (format === 'txt' || format === 'legitimate') {
      const pick =
        format === 'legitimate'
          ? files.find((f) => f.includes('legitimate_emails_'))
          : files.find((f) => f.includes('all_emails_'));
      if (pick) {
        return sendDownload(
          readFileSync(pick, 'utf8'),
          'text/plain; charset=utf-8',
          path.basename(pick),
        );
      }
      const lines =
        format === 'legitimate'
          ? job.results.filter((r) => r.score >= 60).map((r) => `${r.value} (${r.score})`)
          : job.results.map((r) => `${r.value} (${r.score})`);
      return sendDownload(
        lines.join('\n') + '\n',
        'text/plain; charset=utf-8',
        `leadmin_${format === 'legitimate' ? 'legitimate' : 'all'}_emails_${stamp}.txt`,
      );
    }

    const csv = files.find((f) => f.endsWith('.csv'));
    if (csv) {
      return sendDownload(
        readFileSync(csv, 'utf8'),
        'text/csv; charset=utf-8',
        path.basename(csv),
      );
    }
    const csvBody = [
      'timestamp,source_page,type,value,score',
      ...job.results.map(
        (r) =>
          `${r.timestamp},"${r.source_page.replace(/"/g, '""')}",${r.type},${r.value},${r.score}`,
      ),
    ].join('\n');
    return sendDownload(csvBody + '\n', 'text/csv; charset=utf-8', `leadmin_results_${stamp}.csv`);
  });

  const WEB_DIST = path.join(ROOT, 'apps/web/dist');
  if (existsSync(WEB_DIST)) {
    await app.register(fastifyStatic, {
      root: WEB_DIST,
      prefix: '/',
      wildcard: false,
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.method !== 'GET') {
        return reply.status(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
    console.log(`Web UI served from ${WEB_DIST}`);
  } else {
    console.warn(`Web UI missing at ${WEB_DIST} — API-only mode`);
  }

  const hasSerper = Boolean(process.env.SERPER_API_KEY?.trim());
  const hasSerp = Boolean(process.env.SERPAPI_KEY?.trim());
  const nets = Object.values(os.networkInterfaces()).flat().filter(Boolean);
  const lan = nets.find(
    (n) => n && !n.internal && String(n.family) === 'IPv4',
  )?.address;
  if (lan) console.log(`On your network → http://${lan}`);
  console.log(
    `Search: ${
      hasSerper && hasSerp
        ? 'Serper + SerpAPI ✓ (dual)'
        : hasSerper
          ? 'Serper ✓'
          : hasSerp
            ? 'SerpAPI ✓'
            : 'missing — set SERPER_API_KEY and/or SERPAPI_KEY'
    }`,
  );
}
