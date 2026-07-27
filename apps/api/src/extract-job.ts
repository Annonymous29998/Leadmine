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

    push(
      'INFO',
      serperKey && serpKey
        ? 'Dual web search (Serper + SerpAPI)…'
        : serperKey
          ? 'Serper web search…'
          : 'SerpAPI web search…',
    );
    const queries = buildSearchQueries(body.subject, body.location, domains);
    const urls = await searchWeb(
      queries,
      { serperKey, serpApiKey: serpKey },
      body.maxResults,
      body.location,
      logs,
      opts.cancelled,
      opts.onLog,
    );
    if (!urls.length) {
      push(
        'WARNING',
        'Search returned no scrapeable pages. Try a clearer location (city/country) or broader subject.',
      );
    }
    // Gather many candidates from pages; Max Results only caps validated leads
    const candidateCap = Math.min(
      250_000,
      Math.max(body.maxResults * 25, body.maxResults + 20_000, 10_000),
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
