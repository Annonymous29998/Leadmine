const AUTH_KEY = 'leadmin_auth_token';

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

export type LogEntry = {
  level: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  message: string;
  at: string;
};

export type SearchParams = {
  subject: string;
  location: string;
  domains: string[];
  maxResults: number;
  mode: 'urls' | 'web_search';
};

export type ExtractResult = {
  emails: ExtractedEmail[];
  stats: ExtractionStats;
  logs: LogEntry[];
  cancelled: boolean;
  params: SearchParams;
};

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string) {
  localStorage.setItem(AUTH_KEY, token);
}

export function clearAuthToken() {
  try {
    localStorage.removeItem(AUTH_KEY);
  } catch {
    /* ignore */
  }
}

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = getAuthToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra || {}),
  };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: authHeaders(init?.headers),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    clearAuthToken();
    const onLogin = typeof window !== 'undefined' && window.location.pathname.startsWith('/login');
    if (!onLogin && !url.includes('/api/auth/login')) {
      window.location.assign('/login');
    }
  }
  if (!res.ok) {
    const err = (data as { error?: unknown }).error;
    throw new Error(
      typeof err === 'string' ? err : (err as { message?: string })?.message || JSON.stringify(err) || res.statusText,
    );
  }
  return data as T;
}

/** Authenticated fetch for binary downloads (CSV/TXT). */
export async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getAuthToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
  if (res.status === 401) {
    clearAuthToken();
    if (typeof window !== 'undefined') window.location.assign('/login');
  }
  return res;
}

function parseSseChunk(
  buffer: string,
  onEvent: (event: string, data: string) => void,
): string {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const part of parts) {
    if (!part.trim()) continue;
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of part.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length) onEvent(event, dataLines.join('\n'));
  }
  return rest;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ ok: boolean; token: string; email: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<{ ok: boolean; email: string }>('/api/auth/me'),

  authStatus: () =>
    request<{ configured: boolean; loginRequired: boolean }>('/api/auth/status'),

  settings: () =>
    request<{
      hasSerpapi: boolean;
      hasGoogleCse: boolean;
      usesDdgFallback: boolean;
      warning: string | null;
      loginRequired?: boolean;
    }>('/api/settings'),

  extract: (body: Record<string, unknown>, signal?: AbortSignal) =>
    request<ExtractResult>('/api/extract', {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    }),

  extractStream: async (
    body: Record<string, unknown>,
    opts: { signal?: AbortSignal; onLog?: (log: LogEntry) => void },
  ): Promise<ExtractResult> => {
    const res = await fetch('/api/extract/stream', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (res.status === 401) {
      clearAuthToken();
      window.location.assign('/login');
    }

    if (!res.ok || !res.body) {
      let message = res.statusText;
      try {
        const data = await res.json();
        message =
          typeof data.error === 'string'
            ? data.error
            : JSON.stringify(data.error) || message;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let doneResult: ExtractResult | null = null;
    let streamError: string | null = null;

    const handleEvent = (event: string, data: string) => {
      try {
        const parsed = JSON.parse(data) as unknown;
        if (event === 'log') opts.onLog?.(parsed as LogEntry);
        else if (event === 'done') doneResult = parsed as ExtractResult;
        else if (event === 'error') {
          streamError = (parsed as { error?: string }).error || 'Extraction failed';
        }
      } catch {
        /* ignore malformed chunk */
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer.trim()) parseSseChunk(buffer + '\n\n', handleEvent);
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      buffer = parseSseChunk(buffer, handleEvent);
    }

    if (streamError) throw new Error(streamError);
    if (!doneResult) throw new Error('Extraction ended with no result');
    return doneResult;
  },

  startExtraction: (body: Record<string, unknown>) =>
    request<{ status: string; jobId: string }>('/api/start_extraction', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getProgress: () =>
    request<{
      status: string;
      progress: number;
      stats?: {
        pages_crawled: number;
        pages_failed: number;
        emails_found: number;
        leads_found: number;
      };
      currently_crawling?: string[];
      new_results?: {
        timestamp: string;
        source_page: string;
        type: string;
        value: string;
        score: number;
      }[];
      logs?: { level: string; message: string; at: string }[];
      results?: {
        timestamp: string;
        source_page: string;
        type: string;
        value: string;
        score: number;
      }[];
      error?: string;
      savedDir?: string;
      savedFiles?: string[];
    }>('/api/get_progress'),

  stopExtraction: () =>
    request<{ status: string }>('/api/stop_extraction', { method: 'POST', body: '{}' }),

  export: (body: Record<string, unknown>) =>
    request<{ paths: string[]; exportDir: string }>('/api/export', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
