import { isBareTld, quoteIfNeeded, resolveGeo } from './geo.js';

export type ExtractedEmail = {
  email: string;
  domain: string;
  sourceUrl: string;
  context: string;
};

export type ExtractionStats = {
  totalFound: number;
  uniqueCount: number;
  duplicatesRemoved: number;
  rejectedInvalid?: number;
};

export type SearchParams = {
  subject: string;
  location: string;
  domains: string[];
  maxResults: number;
  mode: 'urls' | 'web_search';
  urlList?: string;
  fileContent?: string;
  fileName?: string;
};

export type LogEntry = {
  level: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  message: string;
  at: string;
};

const EMAIL_RE =
  /(?<![.\w])[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}(?![.\w])/g;
const MAILTO_RE =
  /mailto:([a-zA-Z0-9._%+\-]+(?:%40|@)[a-zA-Z0-9.\-%]+(?:\.[a-zA-Z]{2,}))/gi;
const OBFUSCATED_RE =
  /([a-zA-Z0-9._%+\-]{1,64})\s*(?:\(|\[)?\s*(?:at|AT)\s*(?:\)|\])?\s*([a-zA-Z0-9.\-]{1,120})\s*(?:\(|\[)?\s*(?:dot|DOT)\s*(?:\)|\])?\s*([a-zA-Z]{2,24})/g;

export function slug(text: string): string {
  const s = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '');
  return s || 'export';
}

/** Normalize user domain input: strip @, www, schemes, paths; reject bare TLDs. */
export function parseDomains(input: string | string[]): string[] {
  const raw = Array.isArray(input) ? input : input.split(/[,;\s]+/);
  const out: string[] = [];
  const seen = new Set<string>();

  for (let d of raw) {
    d = d.trim().toLowerCase();
    if (!d) continue;
    d = d.replace(/^@+/, '');
    d = d.replace(/^https?:\/\//, '');
    d = d.replace(/^www\./, '');
    d = d.split('/')[0]?.split('?')[0]?.split('#')[0] ?? '';
    d = d.replace(/\.+$/, '');
    if (!d || isBareTld(d)) continue;
    if (!d.includes('.')) continue;
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(d)) continue;
    if (seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

/** Exact match or subdomain of an allowed domain (never match bare TLD). */
export function domainAllowed(emailDomain: string, allowed: string[]): boolean {
  if (!allowed.length) return true;
  const domain = emailDomain.toLowerCase();
  return allowed.some((d) => {
    if (isBareTld(d)) return false;
    return domain === d || domain.endsWith(`.${d}`);
  });
}

/** Sniffy-style multi-query builder (contact / team / PDF / email). */
export function buildSearchQueries(
  subject: string,
  location: string,
  domains: string[],
  mode: 'full' | 'simple' = 'full',
): string[] {
  const subj = subject.trim();
  const locRaw = location.trim();
  const loc = quoteIfNeeded(location);
  const domainClause = domains.length
    ? `(${domains.map((d) => `"@${d}"`).join(' OR ')})`
    : '';
  const base = [subj, loc].filter(Boolean).join(' ');
  const withDom = [base, domainClause].filter(Boolean).join(' ');

  // Serper free accounts reject advanced operators (OR / inurl / filetype).
  if (mode === 'simple') {
    const plain = [subj, locRaw].filter(Boolean).join(' ');
    const queries = [
      `${plain} contact email`.trim(),
      `${plain} contact us`.trim(),
      `${plain} team email`.trim(),
      domains[0] ? `${plain} @${domains[0]}`.trim() : `${plain} email address`.trim(),
    ];
    return [...new Set(queries.map((q) => q.replace(/\s+/g, ' ').trim()).filter(Boolean))];
  }

  const queries = [
    [withDom, '("email" OR "contact" OR "mailto" OR "e-mail" OR "contact us")']
      .filter(Boolean)
      .join(' '),
    [base, 'inurl:contact', domainClause].filter(Boolean).join(' '),
    [base, 'inurl:about', domainClause].filter(Boolean).join(' '),
    [base, '("team" OR "staff" OR "directory" OR "people" OR "our-team" OR "meet-the-team")', domainClause]
      .filter(Boolean)
      .join(' '),
    [base, '("leadership" OR "partners" OR "principals" OR "associates")', domainClause]
      .filter(Boolean)
      .join(' '),
    [
      base,
      '(filetype:pdf OR filetype:doc OR filetype:docx OR filetype:xls OR filetype:xlsx OR filetype:ppt OR filetype:pptx)',
      domainClause,
    ]
      .filter(Boolean)
      .join(' '),
    [withDom, '("@gmail.com" OR "@yahoo.com" OR "@outlook.com" OR email)'].filter(Boolean).join(' '),
    [withDom, 'email', '-linkedin', '-facebook', '-instagram', '-twitter', '-youtube'].filter(Boolean).join(' '),
  ];

  return [...new Set(queries.map((q) => q.replace(/\s+/g, ' ').trim()).filter(Boolean))];
}

export function buildSearchQuery(subject: string, location: string, domains: string[]): string {
  return buildSearchQueries(subject, location, domains)[0] ?? subject;
}

export function buildTags(subject: string, location: string): string {
  const s = slug(subject);
  const l = location.trim() ? slug(location) : '';
  return l ? `${s}_${l}` : s;
}

function contextSnippet(text: string, email: string, length = 80): string {
  const idx = text.toLowerCase().indexOf(email.toLowerCase());
  if (idx === -1) {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > length ? `${clean.slice(0, length)}…` : clean;
  }
  const half = Math.floor(length / 2);
  const start = Math.max(0, idx - half);
  const end = Math.min(text.length, idx + email.length + half);
  let snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) snippet = `…${snippet}`;
  if (end < text.length) snippet = `${snippet}…`;
  return snippet.slice(0, length + 3);
}

/** Strip scripts/styles and decode common HTML entities / obfuscation. */
export function normalizeHtmlForEmails(html: string): string {
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  t = t
    .replace(/&#0*64;/gi, '@')
    .replace(/&#x0*40;/gi, '@')
    .replace(/&commat;/gi, '@')
    .replace(/&#0*46;/gi, '.')
    .replace(/&#x0*2e;/gi, '.')
    .replace(/&dot;/gi, '.');

  t = t.replace(OBFUSCATED_RE, '$1@$2.$3');

  return t;
}

export function extractEmailsFromText(
  text: string,
  sourceUrl: string,
  allowedDomains: string[],
): ExtractedEmail[] {
  if (!text) return [];
  const normalized = normalizeHtmlForEmails(text);
  const seen = new Set<string>();
  const results: ExtractedEmail[] = [];

  const add = (raw: string) => {
    let email = raw.trim().toLowerCase();
    try {
      email = decodeURIComponent(email.replace(/%40/gi, '@'));
    } catch {
      email = email.replace(/%40/gi, '@');
    }
    email = email.replace(/^mailto:/i, '');
    if (seen.has(email)) return;
    if (
      !/^[a-z0-9](?:[a-z0-9._+\-]{0,62}[a-z0-9])?@[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?)+$/i.test(
        email,
      )
    ) {
      return;
    }
    if (email.includes('..')) return;
    if (/\.(png|jpe?g|gif|webp|svg|ico|css|js|woff2?|pdf)$/i.test(email.split('@')[0] ?? '')) {
      return;
    }
    const domain = email.split('@')[1] ?? '';
    if (!domainAllowed(domain, allowedDomains)) return;
    seen.add(email);
    results.push({
      email,
      domain,
      sourceUrl,
      context: contextSnippet(normalized, email),
    });
  };

  for (const m of normalized.matchAll(MAILTO_RE)) add(m[1]);
  for (const m of normalized.matchAll(EMAIL_RE)) add(m[0]);
  return results;
}

export function parseUrlList(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    if (!/^https?:\/\//i.test(line)) {
      if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(line)) {
        line = `https://${line}`;
      } else continue;
    }
    try {
      const u = new URL(line);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      const href = u.href;
      if (seen.has(href)) continue;
      seen.add(href);
      out.push(href);
    } catch {
      /* skip */
    }
  }
  return out;
}

export function namesFromEmail(email: string): { firstName: string; lastName: string } {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._\-+]+/).filter((p) => p && !/^\d+$/.test(p));
  const cap = (p: string) => (p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : '');
  if (!parts.length) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: cap(parts[0]), lastName: '' };
  return {
    firstName: cap(parts[0]),
    lastName: parts.slice(1).map(cap).join(' '),
  };
}

export function dedupeEmails(emails: ExtractedEmail[]): {
  emails: ExtractedEmail[];
  stats: ExtractionStats;
} {
  const seen = new Set<string>();
  const unique: ExtractedEmail[] = [];
  for (const e of emails) {
    const key = e.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...e, email: key });
  }
  return {
    emails: unique,
    stats: {
      totalFound: emails.length,
      uniqueCount: unique.length,
      duplicatesRemoved: Math.max(0, emails.length - unique.length),
    },
  };
}

export { resolveGeo };
