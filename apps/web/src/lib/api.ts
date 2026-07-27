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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    const err = data.error;
    throw new Error(
      typeof err === 'string' ? err : err?.message || JSON.stringify(err) || res.statusText,
    );
  }
  return data as T;
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
  settings: () =>
    request<{
      hasSerpapi: boolean;
      hasGoogleCse: boolean;
      usesDdgFallback: boolean;
      warning: string | null;
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

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
