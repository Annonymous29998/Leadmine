import {
  buildSearchQueries,
  dedupeEmails,
  extractEmailsFromText,
  parseDomains,
  parseUrlList,
  type ExtractedEmail,
  type LogEntry,
  type SearchParams,
} from './extract.js';
import { extractFromUrls, searchWeb } from './search.js';
import { filterValidEmails } from './validate.js';

export type ExtractBody = {
  subject: string;
  location: string;
  domains: string | string[];
  maxResults: number;
  mode: 'urls' | 'web_search';
  urlList?: string;
  fileContent?: string;
  fileName?: string;
  maxDepth?: number;
  useProxy?: boolean;
  proxyList?: string;
};

export type ExtractResult = {
  cancelled: boolean;
  emails: ExtractedEmail[];
  stats: {
    totalFound: number;
    uniqueCount: number;
    duplicatesRemoved: number;
    rejectedInvalid: number;
  };
  logs: LogEntry[];
  params: SearchParams;
};

export async function runExtraction(
  body: ExtractBody,
  opts: {
    cancelled: () => boolean;
    onLog?: (e: LogEntry) => void;
    serpKey?: string;
    serperKey?: string;
  },
): Promise<ExtractResult> {
  // Empty = no filter (Sniffy Domain Filter is optional)
  const domains = parseDomains(body.domains);

  const params: SearchParams = {
    subject: body.subject,
    location: body.location,
    domains,
    maxResults: body.maxResults,
    mode: body.mode,
    urlList: body.urlList,
    fileContent: body.fileContent,
    fileName: body.fileName,
  };

  const logs: LogEntry[] = [];
  const push = (level: LogEntry['level'], message: string) => {
    const entry: LogEntry = { level, message, at: new Date().toISOString() };
    logs.push(entry);
    opts.onLog?.(entry);
  };

  const crawl = {
    useProxy: Boolean(body.useProxy),
    proxies: (body.proxyList || '')
      .split(/\r?\n/)
      .map((p) => p.trim())
      .filter(Boolean),
  };

  let raw: ExtractedEmail[] = [];

  if (body.mode === 'urls') {
    push('INFO', 'Scanning URLs / local files…');

    if (body.fileContent) {
      const label = body.fileName ? `file://${body.fileName}` : 'file://upload';
      const fromFile = extractEmailsFromText(body.fileContent, label, domains);
      raw.push(...fromFile);
      for (const e of fromFile) push('SUCCESS', `Candidate: ${e.email}`);
    }

    const urls = parseUrlList(body.urlList || '');
    if (!urls.length && !body.fileContent) {
      throw new Error('Provide URLs or a local file upload.');
    }

    if (urls.length) {
      const fromUrls = await extractFromUrls(
        urls,
        domains,
        Math.max(body.maxResults, body.maxResults * 2),
        logs,
        opts.cancelled,
        opts.onLog,
        body.maxDepth ?? 1,
        crawl,
      );
      raw.push(...fromUrls);
    }
  } else {
    const serperKey = opts.serperKey?.trim();
    const serpKey = opts.serpKey?.trim();
    if (!serperKey && !serpKey) {
      throw new Error(
        'Search API key required. Add SERPER_API_KEY (Sniffy) or SERPAPI_KEY to .env and restart.',
      );
    }

    push('INFO', 'Economy search (simple queries, free-tier safe) → crawl ASAP…');
    const economy = process.env.SEARCH_ECONOMY !== '0';
    const allQueries = buildSearchQueries(
      body.subject,
      body.location,
      domains,
      economy ? 'simple' : 'full',
    );
    // More queries when hunting any domain (gmail/outlook/company); fewer when filter is set.
    const queryCap = domains.length
      ? Math.min(4, Math.max(2, domains.length + 1))
      : body.maxResults >= 5_000
        ? 6
        : 4;
    const queries = allQueries.slice(0, queryCap);
    push(
      'INFO',
      domains.length
        ? `Domain filter ON — search + crawl scoped to: ${domains.join(', ')}`
        : 'Domain filter OFF — search + crawl any domain (gmail, outlook, hotmail, yahoo, company, …)',
    );
    const searchKeys = { serperKey, serpApiKey: serpKey };

    const seedLimit = Math.min(
      economy ? 100 : 200,
      Math.max(25, Math.ceil(Math.min(body.maxResults, 1_000) * (economy ? 0.25 : 0.5))),
    );
    const urls = await searchWeb(
      queries,
      searchKeys,
      body.maxResults,
      body.location,
      logs,
      opts.cancelled,
      opts.onLog,
      {
        seedLimit,
        maxPages: economy || body.maxResults < 1_000 ? 1 : 2,
        queriesLimit: queries.length,
        // Still allow SerpAPI auto-fallback if Serper free plan blocks queries
        singleProvider: false,
      },
    );
    push('INFO', `Crawl starting with ${urls.length} seed URL(s)…`);

    const candidateCap = Math.min(
      250_000,
      Math.max(body.maxResults * 15, body.maxResults + 5_000, 3_000),
    );
    raw = await extractFromUrls(
      urls,
      domains,
      candidateCap,
      logs,
      opts.cancelled,
      opts.onLog,
      body.maxDepth ?? 1,
      crawl,
    );
  }

  if (opts.cancelled()) push('WARNING', 'Cancelled by client');

  const { emails: unique, stats: dedupeStats } = dedupeEmails(raw);
  const { valid, rejected } = await filterValidEmails(
    unique,
    logs,
    opts.cancelled,
    opts.onLog,
    body.maxResults,
  );
  const emails = valid.slice(0, body.maxResults);

  return {
    cancelled: opts.cancelled(),
    emails,
    stats: {
      totalFound: dedupeStats.totalFound,
      uniqueCount: emails.length,
      duplicatesRemoved: dedupeStats.duplicatesRemoved,
      rejectedInvalid: rejected,
    },
    logs,
    params,
  };
}
