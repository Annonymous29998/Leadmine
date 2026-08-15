import {
  buildSearchQueries,
  dedupeEmails,
  extractEmailsFromText,
  isFreeWebmailDomain,
  parseDomainFilter,
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
  const filter = parseDomainFilter(body.domains);
  const domains = filter.domains;

  const params: SearchParams = {
    subject: body.subject,
    location: body.location,
    domains:
      filter.mode === 'corporate'
        ? ['company']
        : filter.mode === 'any'
          ? []
          : domains,
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
      const fromFile = extractEmailsFromText(body.fileContent, label, filter);
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
        filter,
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
      filter,
      economy ? 'simple' : 'full',
    );
    const webmailExact =
      filter.mode === 'exact' &&
      filter.domains.length > 0 &&
      filter.domains.every((d) => isFreeWebmailDomain(d));
    // ISP/webmail hunts need many Google queries — old cap of 2 starved comcast.net runs.
    const queryCap = webmailExact
      ? Math.min(16, Math.max(8, allQueries.length))
      : filter.mode === 'exact'
        ? Math.min(4, Math.max(2, filter.domains.length + 1))
        : filter.mode === 'corporate'
          ? 4
          : body.maxResults >= 5_000
            ? 6
            : 4;
    push(
      'INFO',
      filter.mode === 'corporate'
        ? 'Domain filter: COMPANY emails only (all corporate domains — not gmail/outlook/yahoo)'
        : filter.mode === 'exact'
          ? `Domain filter ON — only: ${filter.domains.join(', ')}`
          : 'Domain filter OFF — company + gmail/outlook/yahoo/…',
    );
    if (webmailExact) {
      push(
        'INFO',
        `Webmail/ISP hunt: keep searching until ${body.maxResults} leads or sources run out`,
      );
    }
    const searchKeys = { serperKey, serpApiKey: serpKey };

    const seedLimit = webmailExact
      ? Math.min(
          economy ? 1_500 : 3_000,
          Math.max(250, Math.ceil(Math.min(body.maxResults, 10_000) * (economy ? 0.45 : 0.7))),
        )
      : Math.min(
          economy ? 100 : 200,
          Math.max(25, Math.ceil(Math.min(body.maxResults, 1_000) * (economy ? 0.25 : 0.5))),
        );

    const maxRounds = webmailExact
      ? Math.min(10, Math.max(3, Math.ceil(body.maxResults / 200)))
      : 1;
    const seenUrls = new Set<string>();
    const seenEmails = new Set<string>();
    const depth = webmailExact ? Math.max(2, body.maxDepth ?? 2) : body.maxDepth ?? 1;

    for (let round = 1; round <= maxRounds; round++) {
      if (opts.cancelled()) break;
      if (seenEmails.size >= body.maxResults) break;

      const need = body.maxResults - seenEmails.size;
      const qEnd = Math.min(allQueries.length, queryCap + (round - 1) * 4);
      const queries = allQueries.slice(0, Math.max(queryCap, qEnd));
      if (!queries.length) break;

      push(
        'INFO',
        `Hunt round ${round}/${maxRounds}: need ${need} more lead(s), ${queries.length} Google quer${queries.length === 1 ? 'y' : 'ies'}`,
      );

      let urls: string[] = [];
      try {
        urls = await searchWeb(
          queries,
          searchKeys,
          body.maxResults,
          body.location,
          logs,
          opts.cancelled,
          opts.onLog,
          {
            seedLimit,
            maxPages: webmailExact
              ? body.maxResults >= 1_000
                ? 5
                : body.maxResults >= 300
                  ? 4
                  : 3
              : economy || body.maxResults < 1_000
                ? 1
                : 2,
            queriesLimit: queries.length,
            singleProvider: false,
          },
        );
      } catch (err) {
        if (round === 1) throw err;
        push('WARNING', `Hunt round ${round} search stopped: ${(err as Error).message}`);
        break;
      }

      const freshUrls = urls.filter((u) => {
        if (seenUrls.has(u)) return false;
        seenUrls.add(u);
        return true;
      });
      if (!freshUrls.length) {
        push('INFO', `Hunt round ${round}: no new URLs — stopping search`);
        break;
      }

      push('INFO', `Crawl starting with ${freshUrls.length} new seed URL(s)…`);
      const candidateCap = Math.min(
        250_000,
        Math.max(need * 15, need + 2_000, 1_500),
      );
      const batch = await extractFromUrls(
        freshUrls,
        filter,
        candidateCap,
        logs,
        () => opts.cancelled() || seenEmails.size >= body.maxResults,
        opts.onLog,
        depth,
        crawl,
      );
      for (const e of batch) {
        raw.push(e);
        seenEmails.add(e.email.toLowerCase());
      }

      push('INFO', `Hunt round ${round} done: ${seenEmails.size} unique candidate(s) so far`);
      if (seenEmails.size >= body.maxResults) break;
      if (freshUrls.length < 8) {
        push('INFO', 'Few new seeds left — ending hunt rounds');
        break;
      }
    }
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
