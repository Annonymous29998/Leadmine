import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function secret(): string {
  return (
    process.env.AUTH_SECRET?.trim() ||
    process.env.ADMIN_PASSWORD?.trim() ||
    'leadmin-dev-secret-change-me'
  );
}

export function getAdminCredentials(): { email: string; password: string } {
  return {
    email: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
    password: process.env.ADMIN_PASSWORD || '',
  };
}

export function authConfigured(): boolean {
  const { email, password } = getAdminCredentials();
  return Boolean(email && password);
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // still do a compare to reduce timing leaks on length
    timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function verifyCredentials(email: string, password: string): boolean {
  const admin = getAdminCredentials();
  if (!admin.email || !admin.password) return false;
  return (
    safeEqual(email.trim().toLowerCase(), admin.email) &&
    safeEqual(password, admin.password)
  );
}

type TokenPayload = { email: string; exp: number };

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function issueToken(email: string): string {
  const payload: TokenPayload = {
    email: email.trim().toLowerCase(),
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret()).update(body).digest();
  return `${body}.${b64url(sig)}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = createHmac('sha256', secret()).update(body).digest();
  let got: Buffer;
  try {
    got = fromB64url(sig);
  } catch {
    return null;
  }
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const payload = JSON.parse(fromB64url(body).toString('utf8')) as TokenPayload;
    if (!payload?.email || typeof payload.exp !== 'number') return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function readBearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!authConfigured()) {
    return reply.status(503).send({
      error: 'Login is not configured. Set ADMIN_EMAIL and ADMIN_PASSWORD.',
    });
  }
  const token = readBearer(req);
  if (!token) {
    return reply.status(401).send({ error: 'Authentication required' });
  }
  const payload = verifyToken(token);
  if (!payload) {
    return reply.status(401).send({ error: 'Session expired. Please sign in again.' });
  }
  (req as FastifyRequest & { user?: TokenPayload }).user = payload;
}

/** Non-secret session id for logging only */
export function newSessionId(): string {
  return randomBytes(8).toString('hex');
}
