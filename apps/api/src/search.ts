import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import {
  crawlHostAllowed,
  extractEmailsFromText,
  isExactCompanyHostFilter,
  isFreeWebmailDomain,
  type DomainFilter,
  type ExtractedEmail,
  type LogEntry,
} from './extract.js';
import { resolveGeo, type GeoHint } from './geo.js';
import {
  extractTextFromOffice,
  extractTextFromPdf,
  isOfficeUrl,
  isPdfUrl,
} from './office.js';

const FETCH_TIMEOUT_MS = 22_000;
const FETCH_CONCURRENCY = 24;
const MAX_SEED_URLS = 50_000;
const MAX_CRAWL_QUEUE = 100_000;
const MAX_BODY_BYTES = 3_500_000;

const BLOCKED_HOST_RE =
  /(^|\.)(linkedin\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|tiktok\.com|youtube\.com|youtu\.be|rocketreach\.co|contactout\.com|zoominfo\.com|apollo\.io|hunter\.io|pinterest\.com|reddit\.com|glassdoor\.com|indeed\.com|wikipedia\.org|wikimedia\.org)$/i;

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
];

export type CrawlOptions = {
  proxies?: string[];
  useProxy?: boolean;
};

function log(
  logs: LogEntry[],
  level: LogEntry['level'],
  message: string,
  onLog?: (e: LogEntry) => void,
) {
  const entry: LogEntry = { level, message, at: new Date().toISOString() };
  logs.push(entry);
  onLog?.(entry);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function isBlockedUrl(url: string): boolean {
  return BLOCKED_HOST_RE.test(hostOf(url));
}

function isPrivateIp(ip: string): boolean {
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    return (
      v === '::1' ||
      v.startsWith('fc') ||
      v.startsWith('fd') ||
      v.startsWith('fe80') ||
      v === '::'
    );
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

async function assertSafeUrl(url: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('unsupported protocol');
  }
  if (parsed.username || parsed.password) throw new Error('credentials in URL');
  const host = parsed.hostname;
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('blocked host');
  }
  const literal = isIP(host);
  if (literal) {
    if (isPrivateIp(host)) throw new Error('private IP blocked');
  } else {
    const records = await lookup(host, { all: true });
    if (!records.length) throw new Error('DNS failed');
    for (const r of records) {
      if (isPrivateIp(r.address)) throw new Error('private IP blocked');
    }
  }
  if (isBlockedUrl(parsed.href)) throw new Error('blocked site');
  return parsed;
}

function normalizeProxy(raw: string): string | null {
  const p = raw.trim();
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;
  // host:port or user:pass@host:port
  return `http://${p}`;
}

class ProxyRotator {
  private idx = 0;
  constructor(private list: string[]) {}
  next(): string | undefined {
    if (!this.list.length) return undefined;
    const p = this.list[this.idx % this.list.length];
    this.idx += 1;
    return p;
  }
}

function pickUa(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]!;
}

async function fetchPage(
  url: string,
  rotator?: ProxyRotator,
  attempt = 1,
): Promise<{ text: string; finalUrl: string }> {
  await assertSafeUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const headers: Record<string, string> = {
    'User-Agent': pickUa(),
    Accept:
      'text/html,application/xhtml+xml,application/pdf,application/vnd.openxmlformats-officedocument.*,application/octet-stream;q=0.8,*/*;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  try {
    const proxyUrl = rotator?.next();
    const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

    const doFetch = async (target: string) =>
      undiciFetch(target, {
        signal: controller.signal,
        redirect: 'manual',
        headers,
        dispatcher,
      });

    let current = await doFetch(url);
    let finalUrl = url;
    for (let hop = 0; hop < 5 && [301, 302, 303, 307, 308].includes(current.status); hop++) {
      const loc = current.headers.get('location');
      if (!loc) break;
      finalUrl = new URL(loc, finalUrl).href;
      await assertSafeUrl(finalUrl);
      current = await doFetch(finalUrl);
    }

    // Soft-skip empty / gone pages without counting as hard crawl errors upstream when retried
    if (current.status === 404 || current.status === 410) {
      throw new Error(`HTTP ${current.status}`);
    }
    if (!current.ok) {
      if (attempt < 2 && [408, 425, 429, 500, 502, 503, 504].includes(current.status)) {
        clearTimeout(timer);
        await sleep(600 + Math.random() * 400);
        return fetchPage(url, rotator, attempt + 1);
      }
      throw new Error(`HTTP ${current.status}`);
    }
    const ctype = current.headers.get('content-type') || '';
    const buf = Buffer.from(await current.arrayBuffer());
    const sliced = buf.subarray(0, MAX_BODY_BYTES);

    if (isPdfUrl(finalUrl, ctype) || (sliced.length > 4 && sliced.subarray(0, 4).toString() === '%PDF')) {
      const text = await extractTextFromPdf(sliced);
      return { text, finalUrl };
    }
    if (isOfficeUrl(finalUrl, ctype)) {
      return { text: extractTextFromOffice(sliced), finalUrl };
    }
    if (ctype && !/text|html|xml|json|javascript|csv|octet-stream|pdf|msword|officedocument|excel|powerpoint/i.test(ctype)) {
      if (/\.(pdf|docx?|xlsx?|pptx?)(\?|$)/i.test(finalUrl)) {
        if (/\.pdf/i.test(finalUrl)) {
          return { text: await extractTextFromPdf(sliced), finalUrl };
        }
        return { text: extractTextFromOffice(sliced), finalUrl };
      }
      // Last resort: scan binary for email-like strings
      const latin = sliced.toString('latin1');
      if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(latin)) {
        return { text: latin, finalUrl };
      }
      throw new Error(`skip non-text (${ctype.split(';')[0]})`);
    }
    return { text: sliced.toString('utf8'), finalUrl };
  } catch (err) {
    const msg = (err as Error).message || String(err);
    if (attempt < 2 && /aborted|timeout|ECONNRESET|ECONNREFUSED|socket|fetch failed/i.test(msg)) {
      clearTimeout(timer);
      await sleep(500);
      return fetchPage(url, rotator, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Sniffy link patterns — only follow real hrefs (no blind /contact probing → fewer 404s) */
function discoverContactLinks(html: string, baseUrl: string, _needsMore: boolean): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const PATH_RE =
    /\/(contact|contact-us|contactus|about|about-us|team|our-team|meet-the-team|staff|people|directory|leadership|locations|company|who-we-are)(\/|$)/i;
  const SOFT_RE =
    /contact|about-us|our-team|meet-the-team|leadership|staff-directory|people|team/i;

  try {
    const base = new URL(baseUrl);
    const re = /href=["']([^"'#]+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      try {
        const abs = new URL(m[1], base).href;
        if (hostOf(abs) !== hostOf(baseUrl)) continue;
        if (/\.(css|js|png|jpe?g|gif|svg|ico|woff2?|zip)(\?|$)/i.test(abs)) continue;
        const path = new URL(abs).pathname.toLowerCase();
        if (PATH_RE.test(path) || SOFT_RE.test(path)) {
          if (!seen.has(abs) && !isBlockedUrl(abs)) {
            seen.add(abs);
            found.push(abs);
          }
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* ignore */
  }
  return found.slice(0, 30);
}

export async function extractFromUrls(
  urls: string[],
  domainsOrFilter: string[] | DomainFilter,
  maxResults: number,
  logs: LogEntry[],
  cancelled: () => boolean,
  onLog?: (e: LogEntry) => void,
  maxDepth = 1,
  crawl?: CrawlOptions,
): Promise<ExtractedEmail[]> {
  if (maxResults <= 0) return [];

  const filter: DomainFilter = Array.isArray(domainsOrFilter)
    ? { mode: domainsOrFilter.length ? 'exact' : 'any', domains: domainsOrFilter }
    : domainsOrFilter;

  const results: ExtractedEmail[] = [];
  const seen = new Set<string>();
  const scraped = new Set<string>();
  const companyHosts = isExactCompanyHostFilter(filter);
  const webmailExact =
    filter.mode === 'exact' &&
    filter.domains.length > 0 &&
    filter.domains.every((d) => isFreeWebmailDomain(d));
  const scoped = filter.mode === 'exact';
  const effectiveDepth = webmailExact ? 0 : maxDepth;

  const queue = urls.filter((u) => {
    if (isBlockedUrl(u)) {
      log(logs, 'WARNING', `Skip blocked host: ${u}`, onLog);
      return false;
    }
    if (companyHosts && !crawlHostAllowed(hostOf(u), filter)) {
      log(logs, 'WARNING', `Skip off-domain host (filter): ${u}`, onLog);
      return false;
    }
    return true;
  });

  const depthMap = new Map<string, number>();
  for (const u of queue) depthMap.set(u, 0);

  const proxies =
    crawl?.useProxy && crawl.proxies?.length
      ? crawl.proxies.map(normalizeProxy).filter((p): p is string => Boolean(p))
      : [];
  const rotator = proxies.length ? new ProxyRotator(proxies) : undefined;
  if (rotator) {
    log(logs, 'INFO', `Proxy rotation enabled (${proxies.length} prox${proxies.length === 1 ? 'y' : 'ies'})`, onLog);
  }

  let idx = 0;
  let active = 0;
  const depthLimit = Math.min(3, Math.max(0, effectiveDepth));
  const pageBudget = Math.min(
    MAX_CRAWL_QUEUE,
    Math.max(
      queue.length * 2,
      scoped && webmailExact
        ? Math.min(Math.max(queue.length, 200), maxResults >= 1_000 ? 2_000 : 800)
        : companyHosts
          ? Math.min(4_000, maxResults >= 1_000 ? 2_000 : 800)
          : maxResults >= 50_000
            ? 80_000
            : maxResults >= 10_000
              ? 40_000
              : maxResults >= 5_000
                ? 20_000
                : maxResults >= 1_000
                  ? 8_000
                  : maxResults >= 500
                    ? 3_000
                    : Math.max(1_000, queue.length * 5),
    ),
  );
  if (filter.mode === 'corporate') {
    log(logs, 'INFO', 'Domain filter: corporate emails only (skip gmail/outlook/yahoo/…)', onLog);
  } else if (scoped) {
    log(
      logs,
      'INFO',
      companyHosts
        ? `Domain filter crawl: only hosts matching ${filter.domains.join(', ')}`
        : `Domain filter crawl: search seeds for @${filter.domains.join('/@')} only (no deep wander)`,
      onLog,
    );
  }
  log(logs, 'INFO', `Crawl plan: ${queue.length} seed URL(s), up to ${pageBudget} pages, depth ${depthLimit}`, onLog);

  const pushEmails = (list: ExtractedEmail[]) => {
    for (const em of list) {
      if (seen.has(em.email)) continue;
      seen.add(em.email);
      results.push(em);
      log(logs, 'SUCCESS', `Found: ${em.email}`, onLog);
      if (results.length >= maxResults) return;
    }
  };

  async function worker() {
    while (!cancelled() && results.length < maxResults && scraped.size < pageBudget) {
      if (idx >= queue.length) {
        if (active === 0) return;
        await sleep(50);
        continue;
      }
      const i = idx++;
      const url = queue[i];
      if (!url || scraped.has(url)) continue;
      scraped.add(url);
      active += 1;
      const depth = depthMap.get(url) ?? 0;

      log(logs, 'INFO', `Fetching ${url}`, onLog);
      try {
        const { text, finalUrl } = await fetchPage(url, rotator);
        if (isBlockedUrl(finalUrl)) {
          log(logs, 'WARNING', `Skip redirect to blocked host: ${finalUrl}`, onLog);
        } else {
          log(logs, 'SUCCESS', `Fetched ${finalUrl} (${text.length} bytes)`, onLog);
          pushEmails(extractEmailsFromText(text, finalUrl, filter));

          if (results.length < maxResults && !cancelled() && depth < depthLimit && scraped.size < pageBudget) {
            for (const extra of discoverContactLinks(
              text,
              finalUrl,
              results.length < maxResults,
            )) {
              if (companyHosts && !crawlHostAllowed(hostOf(extra), filter)) continue;
              if (
                !scraped.has(extra) &&
                !queue.includes(extra) &&
                queue.length < MAX_CRAWL_QUEUE
              ) {
                depthMap.set(extra, depth + 1);
                queue.push(extra);
              }
            }
          }
        }
      } catch (err) {
        const msg = (err as Error).message;
        if (/HTTP 404|HTTP 410|skip non-text|blocked site|blocked host/i.test(msg)) {
          log(logs, 'WARNING', `Skip ${url}: ${msg}`, onLog);
        } else {
          log(logs, 'ERROR', `Failed ${url}: ${msg}`, onLog);
        }
      } finally {
        active -= 1;
      }
    }
  }

  const n = Math.min(FETCH_CONCURRENCY, Math.max(1, queue.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  log(logs, 'INFO', `Crawl finished: ${scraped.size} page(s), ${results.length} email candidate(s)`, onLog);
  return results.slice(0, maxResults);
}

async function serpApiPage(
  query: string,
  apiKey: string,
  start: number,
  geo: GeoHint,
  num = 10,
): Promise<{ links: string[]; error?: string }> {
  const params = new URLSearchParams({
    q: query,
    api_key: apiKey,
    engine: 'google',
    num: String(Math.min(100, Math.max(10, num))),
    start: String(start),
  });
  if (geo.location) params.set('location', geo.location);
  if (geo.gl) params.set('gl', geo.gl);
  if (geo.hl) params.set('hl', geo.hl);
  if (geo.google_domain) params.set('google_domain', geo.google_domain);

  const res = await fetch(`https://serpapi.com/search.json?${params}`);
  const data = (await res.json()) as {
    error?: string;
    organic_results?: { link?: string }[];
  };
  if (!res.ok || data.error) {
    return { links: [], error: data.error || `SerpAPI HTTP ${res.status}` };
  }
  const links: string[] = [];
  for (const item of data.organic_results ?? []) {
    if (item.link) links.push(item.link);
  }
  return { links };
}

/** Serper client: POST https://google.serper.dev/search */
async function serperPage(
  query: string,
  apiKey: string,
  page: number,
  geo: GeoHint,
  num = 10,
): Promise<{ links: string[]; error?: string }> {
  const body: Record<string, unknown> = {
    q: query,
    page: page + 1,
    num: Math.min(100, Math.max(10, num)),
  };
  if (geo.location) body.location = geo.location;
  if (geo.gl) body.gl = geo.gl;

  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as {
    message?: string;
    organic?: { link?: string }[];
  };
  if (!res.ok) {
    return { links: [], error: data.message || `Serper HTTP ${res.status}` };
  }
  const links: string[] = [];
  for (const item of data.organic ?? []) {
    if (item.link) links.push(item.link);
  }
  return { links };
}

export type SearchKeys = {
  serperKey?: string;
  serpApiKey?: string;
};

/** Unified web search — Serper first (fast), SerpAPI only if still need seeds. */
export async function searchWeb(
  queries: string[],
  keys: SearchKeys,
  maxResults: number,
  location: string,
  logs: LogEntry[],
  cancelled: () => boolean,
  onLog?: (e: LogEntry) => void,
  opts?: {
    seedLimit?: number;
    maxPages?: number;
    queriesLimit?: number;
    /** When true, never call the second search provider (saves free-tier credits). */
    singleProvider?: boolean;
  },
): Promise<string[]> {
  // Keep seed collection tight so crawl can start quickly.
  // (Old caps for 500 leads: 2000 URLs × 10 pages × 8 queries × 2 providers → minutes of wait.)
  const seedLimit =
    opts?.seedLimit ??
    Math.min(
      MAX_SEED_URLS,
      Math.max(
        40,
        maxResults >= 50_000
          ? 12_000
          : maxResults >= 10_000
            ? 4_000
            : maxResults >= 5_000
              ? 1_500
              : maxResults >= 1_000
                ? 400
                : maxResults >= 500
                  ? 200
                  : Math.min(Math.ceil(maxResults * 2), 120),
      ),
    );
  const perPage = maxResults >= 200 ? 100 : 20;
  const maxPages =
    opts?.maxPages ??
    (maxResults >= 50_000
      ? 8
      : maxResults >= 10_000
        ? 4
        : maxResults >= 5_000
          ? 3
          : maxResults >= 1_000
            ? 2
            : 1);
  const geo = resolveGeo(location);
  if (geo.gl || geo.location) {
    log(
      logs,
      'INFO',
      `Geo bias: ${[geo.location, geo.gl && `gl=${geo.gl}`, geo.google_domain]
        .filter(Boolean)
        .join(' · ')}`,
      onLog,
    );
  }

  const serperKey = keys.serperKey?.trim() || '';
  const serpApiKey = keys.serpApiKey?.trim() || '';
  // Prefer SerpAPI when both exist on free Serper accounts (Serper blocks advanced/simple patterns oddly).
  // Still try Serper first if it's the only key; fall back to SerpAPI on free-tier errors.
  const primary: { name: 'Serper' | 'SerpAPI'; key: string } | null = serperKey
    ? { name: 'Serper', key: serperKey }
    : serpApiKey
      ? { name: 'SerpAPI', key: serpApiKey }
      : null;
  const fallback: { name: 'Serper' | 'SerpAPI'; key: string } | null =
    serperKey && serpApiKey ? { name: 'SerpAPI', key: serpApiKey } : null;

  if (!primary) {
    throw new Error(
      'No search API key. Set SERPER_API_KEY and/or SERPAPI_KEY in .env and restart.',
    );
  }

  log(
    logs,
    'INFO',
    fallback
      ? `Search: ${primary.name} first, auto-fallback to ${fallback.name} if blocked/empty`
      : `Search provider: ${primary.name}`,
    onLog,
  );

  const urls: string[] = [];
  const seen = new Set<string>();
  const queryList = opts?.queriesLimit
    ? queries.slice(0, opts.queriesLimit)
    : queries;
  log(
    logs,
    'INFO',
    `Google seed target: ${seedLimit} URLs (${maxPages} page(s) × up to ${perPage}/page, ${queryList.length} queries)`,
    onLog,
  );

  const addLinks = (links: string[]) => {
    for (const link of links) {
      if (isBlockedUrl(link)) continue;
      if (seen.has(link)) continue;
      seen.add(link);
      urls.push(link);
      if (urls.length >= seedLimit) return;
    }
  };

  let freeTierBlocked = false;
  let gotAnyPage = false;

  const runProvider = async (
    provider: { name: 'Serper' | 'SerpAPI'; key: string },
    query: string,
  ): Promise<'ok' | 'blocked' | 'empty' | 'error'> => {
    let status: 'ok' | 'blocked' | 'empty' | 'error' = 'empty';
    for (let page = 0; page < maxPages && urls.length < seedLimit; page++) {
      if (cancelled()) return status;
      const { links, error } =
        provider.name === 'Serper'
          ? await serperPage(query, provider.key, page, geo, perPage)
          : await serpApiPage(query, provider.key, page * perPage, geo, perPage);

      if (error) {
        log(logs, 'WARNING', `${provider.name}: ${error}`, onLog);
        if (/not allowed for free|query pattern|free account/i.test(error)) {
          freeTierBlocked = true;
          return 'blocked';
        }
        return 'error';
      }
      if (!links.length) return status === 'ok' ? 'ok' : 'empty';
      gotAnyPage = true;
      status = 'ok';
      addLinks(links);
      log(
        logs,
        'INFO',
        `${provider.name} search: ${query.slice(0, 80)}${query.length > 80 ? '…' : ''} → ${urls.length} URL(s)`,
        onLog,
      );
      if (links.length < Math.min(8, perPage / 2)) return 'ok';
      if (page + 1 < maxPages) await sleep(40);
    }
    return status;
  };

  // Pass 1: primary provider
  for (const query of queryList) {
    if (cancelled() || urls.length >= seedLimit) break;
    const st = await runProvider(primary, query);
    if (st === 'blocked') break;
  }

  // Pass 2: always fall back to SerpAPI if Serper free-tier blocked or returned nothing
  if (fallback && urls.length === 0 && !cancelled()) {
    log(
      logs,
      'INFO',
      freeTierBlocked
        ? `${primary.name} blocked this query type on free plan — switching to ${fallback.name}`
        : `${primary.name} returned no URLs — trying ${fallback.name}`,
      onLog,
    );
    for (const query of queryList) {
      if (cancelled() || urls.length >= seedLimit) break;
      await runProvider(fallback, query);
    }
  } else if (fallback && urls.length < seedLimit && !cancelled() && opts?.singleProvider !== true) {
    log(logs, 'INFO', `${fallback.name} fill-in (need more seed URLs)…`, onLog);
    for (const query of queryList) {
      if (cancelled() || urls.length >= seedLimit) break;
      await runProvider(fallback, query);
    }
  }

  if (!urls.length) {
    const domainHint = queryList.some((q) =>
      /outlook\.com|hotmail\.com|gmail\.com|yahoo\.com/i.test(q),
    )
      ? ' Free webmail (outlook/hotmail/gmail) + niche keywords often return 0 indexed pages — clear Domain Filter for company emails, or try broader terms like "founder contact email".'
      : '';
    throw new Error(
      freeTierBlocked && !fallback
        ? 'Serper free plan blocked these search queries. Add SERPAPI_KEY as fallback, or upgrade Serper.'
        : `Search returned no scrapeable URLs. Check Serper/SerpAPI keys and quota, or try broader terms.${domainHint}`,
    );
  }

  log(
    logs,
    'INFO',
    `Search returned ${urls.length} scrapeable URL(s) — starting crawl`,
    onLog,
  );
  return urls;
}

/** @deprecated use searchWeb — kept for older callers */
export async function searchSerpApi(
  queries: string[],
  apiKey: string,
  maxResults: number,
  location: string,
  logs: LogEntry[],
  cancelled: () => boolean,
  onLog?: (e: LogEntry) => void,
): Promise<string[]> {
  return searchWeb(
    queries,
    { serpApiKey: apiKey },
    maxResults,
    location,
    logs,
    cancelled,
    onLog,
  );
}
