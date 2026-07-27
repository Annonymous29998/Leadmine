import { create } from 'zustand';
import type { ExtractedEmail, ExtractionStats, LogEntry, SearchParams } from '@/lib/api';
import { api } from '@/lib/api';

const DOMAINS_KEY = 'leadmin.domains';
const EXPORT_KEY = 'leadmin.exportPath';

type AppState = {
  params: SearchParams | null;
  emails: ExtractedEmail[];
  stats: ExtractionStats | null;
  logs: LogEntry[];
  extracting: boolean;
  status: string;
  lastError: string;
  domainsDraft: string;
  exportPath: string;
  jobId: number;
  setStatus: (s: string) => void;
  setExtracting: (v: boolean) => void;
  setLastError: (e: string) => void;
  appendLog: (log: LogEntry) => void;
  setResult: (payload: {
    emails: ExtractedEmail[];
    stats: ExtractionStats;
    logs: LogEntry[];
    params: SearchParams;
  }) => void;
  clear: () => void;
  cancelExtraction: () => void;
  setEmailsFromSniffy: (emails: ExtractedEmail[]) => void;
  setDomainsDraft: (v: string) => void;
  setExportPath: (v: string) => void;
  startExtraction: (
    body: Record<string, unknown>,
  ) => Promise<{ cancelled: boolean; uniqueCount: number; jobId: number }>;
};

let abortController: AbortController | null = null;

const OLD_DOMAIN_PRESET =
  'gmail.com, outlook.com, yahoo.com, hotmail.com, icloud.com';

function loadDomainsDraft(): string {
  if (typeof localStorage === 'undefined') return '';
  const saved = localStorage.getItem(DOMAINS_KEY);
  // Sniffy starts empty — clear the old LeadMine preset if still stored
  if (!saved || saved === OLD_DOMAIN_PRESET) {
    localStorage.removeItem(DOMAINS_KEY);
    return '';
  }
  return saved;
}

const defaultDomains = loadDomainsDraft();

const defaultExport =
  typeof localStorage !== 'undefined' ? localStorage.getItem(EXPORT_KEY) || '' : '';

export const useAppStore = create<AppState>((set, get) => ({
  params: null,
  emails: [],
  stats: null,
  logs: [],
  extracting: false,
  status: 'Ready',
  lastError: '',
  domainsDraft: defaultDomains,
  exportPath: defaultExport,
  jobId: 0,
  setStatus: (status) => set({ status }),
  setExtracting: (extracting) => set({ extracting }),
  setLastError: (lastError) => set({ lastError }),
  appendLog: (log) => set((s) => ({ logs: [...s.logs, log] })),
  setResult: ({ emails, stats, logs, params }) =>
    set({ emails, stats, logs, params, extracting: false }),
  clear: () => {
    abortController?.abort();
    abortController = null;
    set((s) => ({
      emails: [],
      stats: null,
      logs: [],
      params: null,
      status: 'Results cleared',
      extracting: false,
      lastError: '',
      jobId: s.jobId + 1,
    }));
  },
  cancelExtraction: () => {
    abortController?.abort();
    abortController = null;
    set({
      extracting: false,
      status: 'Extraction cancelled',
    });
  },
  setEmailsFromSniffy: (emails) =>
    set({
      emails,
      stats: {
        totalFound: emails.length,
        uniqueCount: emails.length,
        duplicatesRemoved: 0,
      },
    }),
  setDomainsDraft: (domainsDraft) => {
    localStorage.setItem(DOMAINS_KEY, domainsDraft);
    set({ domainsDraft });
  },
  setExportPath: (exportPath) => {
    localStorage.setItem(EXPORT_KEY, exportPath);
    set({ exportPath });
  },
  startExtraction: async (body) => {
    abortController?.abort();
    const controller = new AbortController();
    abortController = controller;
    const jobId = get().jobId + 1;

    set({
      jobId,
      extracting: true,
      lastError: '',
      logs: [
        {
          level: 'INFO',
          message: 'Connecting to API…',
          at: new Date().toISOString(),
        },
      ],
      emails: [],
      stats: null,
      status: 'Extracting…',
    });

    try {
      const result = await api.extractStream(body, {
        signal: controller.signal,
        onLog: (log) => {
          if (get().jobId !== jobId) return;
          get().appendLog(log);
        },
      });

      if (get().jobId !== jobId) {
        return { cancelled: true, uniqueCount: 0, jobId };
      }

      set({
        emails: result.emails,
        stats: result.stats,
        logs: result.logs.length ? result.logs : get().logs,
        params: result.params,
        extracting: false,
        status: result.cancelled
          ? `Cancelled — kept ${result.stats.uniqueCount} valid`
          : `Done — ${result.stats.uniqueCount} validated email(s)`,
      });

      return {
        cancelled: result.cancelled,
        uniqueCount: result.stats.uniqueCount,
        jobId,
      };
    } catch (err) {
      if (get().jobId !== jobId) {
        return { cancelled: true, uniqueCount: 0, jobId };
      }
      if ((err as Error).name === 'AbortError') {
        set({ extracting: false, status: 'Extraction cancelled' });
        return { cancelled: true, uniqueCount: get().emails.length, jobId };
      }
      const msg = (err as Error).message || 'Extraction failed';
      set({
        extracting: false,
        lastError: msg,
        status: `Error: ${msg}`,
      });
      throw err;
    } finally {
      if (abortController === controller) abortController = null;
      if (get().jobId === jobId && get().extracting) {
        set({ extracting: false });
      }
    }
  },
}));
