/**
 * Hazmat-style bulk email verification (free — no paid API).
 * Uses Node DNS (MX) + optional SMTP RCPT probe, same idea as
 * Reacher / check-if-email-exists.
 */
import { promises as dns } from 'node:dns';
import net from 'node:net';
import {
  isValidEmailSyntax,
  leadQualityScore,
  domainHasMx,
} from './validate.js';

export type VerifyBucket = 'reachable' | 'invalid' | 'unknown';

export type VerifyRow = {
  email: string;
  bucket: VerifyBucket;
  reason: string;
  score: number;
  mx: boolean;
  smtp: 'valid' | 'invalid' | 'unknown' | 'skipped';
};

const ROLE_LOCALS = new Set([
  'info',
  'contact',
  'support',
  'help',
  'admin',
  'sales',
  'marketing',
  'hello',
  'office',
  'team',
  'mail',
  'email',
  'newsletter',
  'noreply',
  'no-reply',
  'postmaster',
  'abuse',
  'security',
]);

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

const DISPOSABLE_HINTS = [
  'mailinator.com',
  'guerrillamail.com',
  'tempmail',
  '10minutemail',
  'throwaway',
  'yopmail.com',
  'trashmail',
  'getnada',
  'temp-mail',
  'discard.email',
];

function smtpRcptCheck(
  email: string,
  mxHost: string,
  timeoutMs = 4000,
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
      const isFinal = last[3] === ' ';
      if (!isFinal && code < 400) return;

      if (stage === 0) {
        if (code === 220) {
          stage = 1;
          buffer = '';
          socket.write('EHLO leadmine.verify\r\n');
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
        else if (code === 550 || code === 551 || code === 552 || code === 553 || code === 554)
          finish('invalid');
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
    return records[0]!.exchange;
  } catch {
    return null;
  }
}

export function parseEmailList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\r\n,;]+/)) {
    const e = raw.trim().toLowerCase().replace(/^<|>$/g, '');
    if (!e.includes('@')) continue;
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

/** Single-email Hazmat-style classification. */
export async function verifyOneEmail(
  email: string,
  opts?: { smtp?: boolean },
): Promise<VerifyRow> {
  const e = email.trim().toLowerCase();
  const doSmtp = opts?.smtp !== false;

  if (!isValidEmailSyntax(e)) {
    return {
      email: e,
      bucket: 'invalid',
      reason: 'invalid syntax',
      score: 0,
      mx: false,
      smtp: 'skipped',
    };
  }

  const [local, domain] = e.split('@');
  const base = (local ?? '').split(/[._+\-]/)[0] ?? '';
  const score = leadQualityScore(e);

  if (DISPOSABLE_HINTS.some((d) => (domain ?? '').includes(d))) {
    return {
      email: e,
      bucket: 'invalid',
      reason: 'disposable domain',
      score: 0,
      mx: false,
      smtp: 'skipped',
    };
  }

  if (ROLE_LOCALS.has(base) || ROLE_LOCALS.has(local ?? '')) {
    return {
      email: e,
      bucket: 'invalid',
      reason: 'role / generic mailbox (not a personal lead)',
      score,
      mx: false,
      smtp: 'skipped',
    };
  }

  const hasMx = await domainHasMx(domain ?? '');
  if (!hasMx) {
    return {
      email: e,
      bucket: 'invalid',
      reason: 'no MX records (domain cannot receive mail)',
      score,
      mx: false,
      smtp: 'skipped',
    };
  }

  // Big providers block/greet SMTP probes — treat syntax+MX person-like as reachable
  if (SMTP_UNRELIABLE.has(domain ?? '') || !doSmtp) {
    if (score >= 60) {
      return {
        email: e,
        bucket: 'reachable',
        reason: doSmtp
          ? 'syntax + MX (provider skips SMTP probe)'
          : 'syntax + MX + quality (SMTP off)',
        score,
        mx: true,
        smtp: 'skipped',
      };
    }
    return {
      email: e,
      bucket: 'unknown',
      reason: `low person-score (${score})`,
      score,
      mx: true,
      smtp: 'skipped',
    };
  }

  const mxHost = await getMxHost(domain ?? '');
  if (!mxHost) {
    return {
      email: e,
      bucket: 'unknown',
      reason: 'MX lookup inconclusive',
      score,
      mx: true,
      smtp: 'unknown',
    };
  }

  const smtp = await smtpRcptCheck(e, mxHost);
  if (smtp === 'valid') {
    return {
      email: e,
      bucket: 'reachable',
      reason: 'mailbox accepted by SMTP server',
      score: Math.min(100, score + 10),
      mx: true,
      smtp: 'valid',
    };
  }
  if (smtp === 'invalid') {
    return {
      email: e,
      bucket: 'invalid',
      reason: 'mailbox rejected by SMTP server',
      score,
      mx: true,
      smtp: 'invalid',
    };
  }

  // Inconclusive SMTP (common on cloud hosts without proxy)
  if (score >= 60) {
    return {
      email: e,
      bucket: 'unknown',
      reason: 'SMTP inconclusive (try proxy / home network for sharper checks)',
      score,
      mx: true,
      smtp: 'unknown',
    };
  }
  return {
    email: e,
    bucket: 'unknown',
    reason: 'SMTP inconclusive + low score',
    score,
    mx: true,
    smtp: 'unknown',
  };
}

export type BulkVerifyResult = {
  reachable: VerifyRow[];
  invalid: VerifyRow[];
  unknown: VerifyRow[];
  total: number;
  checked: number;
};

export async function verifyEmailList(
  emails: string[],
  opts?: {
    smtp?: boolean;
    concurrency?: number;
    cancelled?: () => boolean;
    onProgress?: (done: number, total: number, last?: VerifyRow) => void;
  },
): Promise<BulkVerifyResult> {
  const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const reachable: VerifyRow[] = [];
  const invalid: VerifyRow[] = [];
  const unknown: VerifyRow[] = [];
  const concurrency = Math.max(1, Math.min(6, opts?.concurrency ?? 4));
  let checked = 0;

  for (let i = 0; i < list.length; i += concurrency) {
    if (opts?.cancelled?.()) break;
    const batch = list.slice(i, i + concurrency);
    const rows = await Promise.all(batch.map((e) => verifyOneEmail(e, { smtp: opts?.smtp })));
    for (const row of rows) {
      checked += 1;
      if (row.bucket === 'reachable') reachable.push(row);
      else if (row.bucket === 'invalid') invalid.push(row);
      else unknown.push(row);
      opts?.onProgress?.(checked, list.length, row);
    }
  }

  return { reachable, invalid, unknown, total: list.length, checked };
}

export function formatBucketFile(rows: VerifyRow[], header: string): string {
  const lines = [
    `# ${header}`,
    `# count=${rows.length}`,
    ...rows.map((r) => `${r.email}  # ${r.reason} (score ${r.score})`),
    '',
  ];
  return lines.join('\n');
}
