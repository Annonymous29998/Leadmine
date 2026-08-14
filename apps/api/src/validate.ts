import { promises as dns } from 'node:dns';
import net from 'node:net';
import type { ExtractedEmail, LogEntry } from './extract.js';

const FILE_EXT_LOCAL =
  /\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|map|woff2?|ttf|eot|mp[34]|pdf|zip|gz|xml|json)$/i;

const INVALID_LOCALS = new Set([
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'mailer-daemon',
  'postmaster',
  'abuse',
  'example',
  'test',
  'null',
  'undefined',
  'webmaster',
  'hostmaster',
  'spam',
  'fake',
  'xxx',
  'asdf',
  'qwerty',
]);

const ROLE_LOCALS = new Set([
  'info',
  'contact',
  'support',
  'help',
  'helpdesk',
  'admin',
  'sales',
  'marketing',
  'hello',
  'office',
  'team',
  'mail',
  'email',
  'enquiries',
  'enquiry',
  'inquiry',
  'inquiries',
  'customerservice',
  'customer-service',
  'customersupport',
  'newsletter',
  'news',
  'press',
  'media',
  'hr',
  'jobs',
  'careers',
  'billing',
  'accounts',
  'privacy',
  'legal',
  'security',
  'reception',
  'general',
  'feedback',
  'service',
  'services',
  'orders',
  'order',
  'bookings',
  'booking',
  'reservations',
  'reservation',
  'admissions',
  'registrar',
  'volunteer',
  'volunteers',
  'donate',
  'donations',
  'outreach',
  'communications',
  'comms',
  'partnerships',
  'servicedesk',
  'techsupport',
  'webmaster',
  'postmaster',
  'hostmaster',
  'abuse',
  'root',
  'officehours',
  'customerservices',
]);

/** Hard reject: info@, support@, noreply@, etc. — not personal leads. */
export function isRoleOrGenericEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  const at = e.indexOf('@');
  if (at < 1) return true;
  const local = e.slice(0, at);
  const base = local.split(/[._+\-]/)[0] ?? local;

  if (INVALID_LOCALS.has(base) || INVALID_LOCALS.has(local)) return true;
  if (ROLE_LOCALS.has(base) || ROLE_LOCALS.has(local)) return true;

  if (/no[-_.]?reply|donotreply|do-not-reply|mailer[-.]?daemon|unsubscribe|bounce|auto[-_.]?reply/.test(local)) {
    return true;
  }

  if (
    /^(info|support|contact|sales|help|admin|office|team|mail|hr|jobs|careers|press|media|billing|legal|privacy|security|newsletter|marketing|service|reception|general|feedback|enquir|inquir|customer)([._+\-]|$|\d)/.test(
      local,
    )
  ) {
    return true;
  }

  // Every segment is a role word → department@ style
  const segments = local.split(/[._+\-]/).filter(Boolean);
  if (segments.length > 1 && segments.every((s) => ROLE_LOCALS.has(s) || INVALID_LOCALS.has(s))) {
    return true;
  }

  return false;
}

const DISPOSABLE_HINTS = [
  'mailinator.com',
  'guerrillamail.com',
  'tempmail',
  '10minutemail',
  'throwaway',
  'yopmail.com',
  'trashmail',
  'guerrillamail',
  'sharklasers',
  'getnada',
  'temp-mail',
  'discard.email',
];

const MX_TTL_MS = 15 * 60 * 1000;
const MX_NEG_TTL_MS = 60 * 1000;

type MxCacheEntry = { ok: boolean; expires: number };
const mxCache = new Map<string, MxCacheEntry>();

export function isValidEmailSyntax(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (e.length < 6 || e.length > 254) return false;
  if (e.includes('..') || e.startsWith('.') || e.includes('.@') || e.includes('@.')) return false;

  const m =
    /^([a-z0-9](?:[a-z0-9._+\-]{0,62}[a-z0-9])?)@([a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?)+)$/i.exec(
      e,
    );
  if (!m) return false;

  const local = m[1];
  const domain = m[2];
  if (FILE_EXT_LOCAL.test(local)) return false;
  if (local.includes(' ')) return false;
  if (/^\d+$/.test(local)) return false;
  if (INVALID_LOCALS.has(local.split(/[._+\-]/)[0] ?? '')) return false;
  if (DISPOSABLE_HINTS.some((d) => domain.includes(d))) return false;
  if (!domain.includes('.')) return false;
  const tld = domain.split('.').pop() ?? '';
  if (tld.length < 2) return false;
  // Junk / non-lead patterns
  if (/^[0-9a-f]{8,}$/i.test(local.replace(/[._+\-]/g, ''))) return false; // hex hash
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(local)) return false; // uuid-ish
  if (local.includes('%') || local.includes(' ')) return false;
  if (local.length < 3) return false;
  if (/^\d+[a-z]{0,2}$/i.test(local)) return false; // mostly numeric
  if (isRoleOrGenericEmail(e)) return false;
  return true;
}

/** 0–100 lead quality (Sniffy calculate_email_score style). */
export function leadQualityScore(email: string): number {
  const e = email.trim().toLowerCase();
  if (!isValidEmailSyntax(e)) return 0;
  const [local, domain] = e.split('@');
  if (!local || !domain) return 0;

  if (isRoleOrGenericEmail(e)) return 0;

  let score = 50;
  const base = local.split(/[._+\-]/)[0] ?? local;

  // Generic / role prefixes (Sniffy generic_prefixes) — score 0 above, belt-and-suspenders
  if (ROLE_LOCALS.has(base) || ROLE_LOCALS.has(local)) return 0;
  if (INVALID_LOCALS.has(base)) return 0;

  // Person-like patterns
  if (/^[a-z]+[._][a-z]+/.test(local)) score += 35; // first.last
  else if (/^[a-z]{2,}\.[a-z]{2,}/.test(local)) score += 35;
  else if (/^[a-z]{3,}[0-9]{0,3}$/.test(local)) score += 25; // name or name12
  else if (/^[a-z]+[0-9]{4,}$/.test(local)) score -= 15;

  if (local.length >= 5 && local.length <= 30) score += 10;
  if (local.length > 40) score -= 20;
  if (/[aeiou]/i.test(local) && /[bcdfghjklmnpqrstvwxyz]/i.test(local)) score += 10;

  // Consumer mailbox providers often used as personal leads
  if (
    /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|icloud|me|mac|aol|proton|protonmail)\./.test(
      domain,
    ) ||
    [
      'gmail.com',
      'googlemail.com',
      'yahoo.com',
      'outlook.com',
      'hotmail.com',
      'icloud.com',
      'me.com',
      'aol.com',
      'proton.me',
      'protonmail.com',
    ].includes(domain)
  ) {
    score += 5;
  }

  if (DISPOSABLE_HINTS.some((d) => domain.includes(d))) return 0;

  // Placeholder / template locals
  if (/^(user|username|yourname|name|email|firstname|lastname|xxx+|abc|sample)/i.test(local)) {
    return Math.min(score, 40);
  }

  return Math.max(0, Math.min(100, score));
}

export async function domainHasMx(domain: string): Promise<boolean> {
  const d = domain.toLowerCase();
  const cached = mxCache.get(d);
  if (cached && cached.expires > Date.now()) return cached.ok;

  try {
    const records = await dns.resolveMx(d);
    const ok = Array.isArray(records) && records.length > 0;
    mxCache.set(d, { ok, expires: Date.now() + MX_TTL_MS });
    return ok;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // Transient / SERVFAIL — short negative cache only
    const ttl = code === 'ENOTFOUND' || code === 'ENODATA' ? MX_TTL_MS : MX_NEG_TTL_MS;
    mxCache.set(d, { ok: false, expires: Date.now() + ttl });
    return false;
  }
}

function smtpRcptCheck(
  email: string,
  mxHost: string,
  timeoutMs = 2500,
): Promise<'valid' | 'invalid' | 'unknown'> {
  return new Promise((resolve) => {
    const socket = net.createConnection(25, mxHost);
    let stage = 0;
    let buffer = '';
    let settled = false;

    const finish = (result: 'valid' | 'invalid' | 'unknown') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };

    const timer = setTimeout(() => finish('unknown'), timeoutMs);
    socket.setEncoding('utf8');
    socket.on('error', () => finish('unknown'));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] ?? '';
      const code = parseInt(last.slice(0, 3), 10);
      if (!code) return;
      const isFinal = /^\d{3}[\s-]/.test(last) && last[3] === ' ';
      if (!isFinal && code < 400) return;

      if (stage === 0) {
        if (code === 220) {
          stage = 1;
          buffer = '';
          socket.write('EHLO leadmine.local\r\n');
        } else finish('unknown');
      } else if (stage === 1) {
        if (code === 250) {
          stage = 2;
          buffer = '';
          socket.write('MAIL FROM:<verify@leadmine.local>\r\n');
        } else if (code >= 500) finish('unknown');
      } else if (stage === 2) {
        if (code === 250) {
          stage = 3;
          buffer = '';
          socket.write(`RCPT TO:<${email}>\r\n`);
        } else finish('unknown');
      } else if (stage === 3) {
        if (code === 250 || code === 251) finish('valid');
        else if (code === 550 || code === 551 || code === 553 || code === 554) finish('invalid');
        else finish('unknown');
      }
    });
  });
}

async function getMxHost(domain: string): Promise<string | null> {
  try {
    const records = await dns.resolveMx(domain);
    if (!records.length) return null;
    records.sort((a, b) => a.priority - b.priority);
    return records[0].exchange;
  } catch {
    return null;
  }
}

const SMTP_UNRELIABLE = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
]);

export type ValidationResult = {
  email: string;
  ok: boolean;
  reason: string;
  score?: number;
};

const MIN_LEAD_SCORE = 60; // Sniffy legitimate threshold

export async function validateEmailAddress(email: string): Promise<ValidationResult> {
  const e = email.trim().toLowerCase();
  if (!isValidEmailSyntax(e)) {
    return { email: e, ok: false, reason: 'invalid syntax' };
  }

  if (isRoleOrGenericEmail(e)) {
    return { email: e, ok: false, reason: 'role / generic mailbox (not a personal lead)', score: 0 };
  }

  const score = leadQualityScore(e);
  if (score < MIN_LEAD_SCORE) {
    return { email: e, ok: false, reason: `low lead quality (score ${score})`, score };
  }

  const domain = e.split('@')[1] ?? '';
  const hasMx = await domainHasMx(domain);
  if (!hasMx) {
    return { email: e, ok: false, reason: 'domain has no mail server (MX)', score };
  }

  const smtpEnabled = process.env.ENABLE_SMTP_CHECK === '1';
  if (!smtpEnabled || SMTP_UNRELIABLE.has(domain)) {
    return { email: e, ok: true, reason: 'syntax+MX+quality', score };
  }

  const mx = await getMxHost(domain);
  if (!mx) return { email: e, ok: true, reason: 'syntax+MX+quality', score };

  try {
    const smtp = await smtpRcptCheck(e, mx);
    if (smtp === 'invalid') {
      return { email: e, ok: false, reason: 'mailbox rejected by server', score };
    }
    if (smtp === 'valid') {
      return { email: e, ok: true, reason: 'syntax+MX+SMTP+quality', score: Math.min(100, score + 5) };
    }
    return { email: e, ok: true, reason: 'syntax+MX+quality (SMTP inconclusive)', score };
  } catch {
    return { email: e, ok: true, reason: 'syntax+MX+quality', score };
  }
}

export async function filterValidEmails(
  emails: ExtractedEmail[],
  logs: LogEntry[],
  cancelled: () => boolean,
  onLog?: (e: LogEntry) => void,
  targetCount?: number,
): Promise<{ valid: ExtractedEmail[]; rejected: number }> {
  const valid: ExtractedEmail[] = [];
  let rejected = 0;
  const concurrency = 8;
  const target = targetCount ?? emails.length;

  const push = (level: LogEntry['level'], message: string) => {
    const entry: LogEntry = { level, message, at: new Date().toISOString() };
    logs.push(entry);
    onLog?.(entry);
  };

  // Prefer higher-quality candidates first
  const ranked = [...emails].sort(
    (a, b) => leadQualityScore(b.email) - leadQualityScore(a.email),
  );

  push(
    'INFO',
    `Validating up to ${ranked.length} email(s) (syntax + MX + lead quality ≥ ${MIN_LEAD_SCORE}${
      process.env.ENABLE_SMTP_CHECK === '1' ? ' + SMTP' : ''
    })…`,
  );

  for (let i = 0; i < ranked.length && valid.length < target; i += concurrency) {
    if (cancelled()) break;
    const batch = ranked.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((em) => validateEmailAddress(em.email)));
    for (let j = 0; j < batch.length; j++) {
      if (valid.length >= target) break;
      const em = batch[j];
      const res = results[j];
      if (res.ok) {
        valid.push(em);
        push('SUCCESS', `Valid: ${em.email} (${res.reason}, score ${res.score ?? '—'})`);
      } else {
        rejected += 1;
        push('WARNING', `Rejected: ${em.email} — ${res.reason}`);
      }
    }
  }

  push('INFO', `Validation done — ${valid.length} quality leads kept, ${rejected} rejected`);
  return { valid, rejected };
}
