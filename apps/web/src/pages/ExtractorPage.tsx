import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, authFetch, clearAuthToken } from '@/lib/api';
import { useAppStore } from '@/stores/app';
import '@/styles/sniffy.css';

type SniffyRow = {
  timestamp: string;
  source_page: string;
  type: string;
  value: string;
  score: number;
};

type ProgressStats = {
  pages_crawled: number;
  pages_failed: number;
  emails_found: number;
  leads_found: number;
};

const LOGO = ` _      _____    _    ____    __  __ ___ _   _ _____
| |    | ____|  / \\  |  _ \\  |  \\/  |_ _| \\ | | ____|
| |    |  _|   / _ \\ | | | | | |\\/| || ||  \\| |  _|
| |___ | |___ / ___ \\| |_| | | |  | || || |\\  | |___
|_____||_____/_/   \\_\\____/  |_|  |_|___|_| \\_|_____|`;

export function ExtractorPage() {
  const navigate = useNavigate();
  const { domainsDraft, setDomainsDraft, setEmailsFromSniffy } = useAppStore();

  const [searchTerms, setSearchTerms] = useState('');
  const [location, setLocation] = useState('');
  const [maxResults, setMaxResults] = useState(25_000);
  const [useProxy, setUseProxy] = useState(false);
  const [proxyList, setProxyList] = useState('');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState<'info' | 'ok' | 'warn' | 'danger'>('info');
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState<ProgressStats>({
    pages_crawled: 0,
    pages_failed: 0,
    emails_found: 0,
    leads_found: 0,
  });
  const [crawling, setCrawling] = useState<string[]>([]);
  const [results, setResults] = useState<SniffyRow[]>([]);
  const [page, setPage] = useState(1);
  const [hasSerpapi, setHasSerpapi] = useState<boolean | null>(null);
  const [showDownload, setShowDownload] = useState(false);
  const [liveLogs, setLiveLogs] = useState<string[]>([]);
  const [modal, setModal] = useState<{ open: boolean; title: string; body: string }>({
    open: false,
    title: 'Extraction Status',
    body: '',
  });
  const pollRef = useRef<number | null>(null);
  const rowsPerPage = 11;

  const mergeRows = (prev: SniffyRow[], incoming: SniffyRow[]) => {
    const map = new Map(prev.map((r) => [r.value, r]));
    for (const r of incoming) map.set(r.value, r);
    return [...map.values()].sort((a, b) => (b.score || 0) - (a.score || 0));
  };

  useEffect(() => {
    api
      .settings()
      .then((s) => setHasSerpapi(s.hasSerpapi))
      .catch(() => setHasSerpapi(false));
  }, []);

  const proxyCount = useMemo(
    () =>
      proxyList
        .split(/\r?\n/)
        .map((p) => p.trim())
        .filter(Boolean).length,
    [proxyList],
  );

  const stopPoll = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const updateStatus = (text: string, tone: typeof statusTone) => {
    setStatus(text);
    setStatusTone(tone);
  };

  const poll = useCallback(() => {
    stopPoll();
    pollRef.current = window.setInterval(async () => {
      try {
        const data = await api.getProgress();
        setProgress(data.progress || 0);
        if (data.stats) setStats(data.stats);
        setCrawling(data.currently_crawling || []);

        // Prefer incremental new_results while running; full snapshot when finished
        if (data.results?.length) {
          setResults(data.results);
        } else if (data.new_results?.length) {
          setResults((prev) => mergeRows(prev, data.new_results ?? []));
        }

        if (data.logs?.length) {
          setLiveLogs(
            data.logs
              .filter((l) =>
                /^(Failed|Skip|Fetching|Found:|Valid:|Rejected:|Serper|SerpAPI|Dual search|Google seed|Geo bias)/i.test(
                  l.message,
                ),
              )
              .slice(-10)
              .map((l) => `[${l.level}] ${l.message}`),
          );
        }

        // Clarify early phase: Google search runs before any page crawl
        if (
          (data.status === 'running' || data.status === 'starting') &&
          (data.stats?.pages_crawled ?? 0) === 0 &&
          !(data.results?.length || data.new_results?.length)
        ) {
          updateStatus('Searching Google for URLs (crawl starts after this)…', 'info');
        } else if (data.status === 'running' || data.status === 'starting') {
          updateStatus('Extraction in progress', 'info');
        }

        const final = ['completed', 'stopped', 'error', 'idle'];
        if (final.includes(data.status) || data.status?.startsWith('error')) {
          stopPoll();
          setRunning(false);
          setCrawling([]);
          if (data.results?.length) setResults(data.results);

          if (data.status === 'completed') {
            updateStatus('Extraction completed', 'ok');
            setProgress(100);
            setPage(1);
            const leadCount = data.stats?.leads_found ?? data.results?.length ?? 0;
            const saved = data.savedDir
              ? `\n\nAuto-saved on server to:\n${data.savedDir}`
              : '';
            setModal({
              open: true,
              title: 'Extraction Status',
              body: `Extraction complete! Found ${leadCount} quality leads.${saved}\n\nCSV download started in your browser.`,
            });
            if (leadCount > 0) {
              setShowDownload(true);
              // Sniffy-style: auto-download results to the browser
              void (async () => {
                try {
                  const res = await authFetch('/api/download_results?format=csv');
                  if (!res.ok) return;
                  const blob = await res.blob();
                  const cd = res.headers.get('Content-Disposition') || '';
                  const match = /filename\*?=(?:UTF-8''|")?([^\";]+)/i.exec(cd);
                  const filename = match
                    ? decodeURIComponent(match[1].replace(/"/g, ''))
                    : 'leadmin_results.csv';
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = filename;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(url);
                } catch {
                  /* user can click Download CSV */
                }
              })();
            }
          } else if (data.status === 'stopped') {
            updateStatus('Extraction stopped', 'warn');
            const leadCount = data.stats?.leads_found ?? data.results?.length ?? 0;
            const saved = data.savedDir ? `\n\nPartial results saved to:\n${data.savedDir}` : '';
            setModal({
              open: true,
              title: 'Extraction Status',
              body: `Extraction was stopped by the user.${saved}`,
            });
            if (leadCount > 0) {
              setShowDownload(true);
              void (async () => {
                try {
                  const res = await authFetch('/api/download_results?format=csv');
                  if (!res.ok) return;
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'leadmin_results_partial.csv';
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(url);
                } catch {
                  /* ignore */
                }
              })();
            }
          } else if (data.status === 'idle') {
            updateStatus('', 'info');
          } else {
            const msg = data.error || data.status.replace(/^error:?\s*/i, 'Error: ');
            updateStatus(msg, 'danger');
            setModal({ open: true, title: 'Extraction Status', body: msg });
          }
        } else {
          updateStatus(data.status || 'Processing...', 'info');
        }
      } catch (err) {
        stopPoll();
        setRunning(false);
        updateStatus('Error checking progress', 'danger');
        setModal({
          open: true,
          title: 'Extraction Status',
          body: (err as Error).message || 'Error checking progress',
        });
      }
    }, 1000);
  }, []);

  useEffect(() => () => stopPoll(), []);

  // Restore last job results into the table (Sniffy keeps them visible)
  useEffect(() => {
    void api
      .getProgress()
      .then((data) => {
        if (data.stats) setStats(data.stats);
        if (data.results?.length) {
          setResults(data.results);
          setShowDownload(true);
          setProgress(data.progress || (data.status === 'completed' ? 100 : data.progress) || 0);
        }
        if (data.status === 'completed') updateStatus('Extraction completed', 'ok');
        if (data.status === 'running' || data.status === 'starting') {
          setRunning(true);
          updateStatus('Extraction in progress', 'info');
          poll();
        }
      })
      .catch(() => undefined);
  }, [poll]);

  useEffect(() => {
    if (!results.length) return;
    setEmailsFromSniffy(
      results.map((r) => ({
        email: r.value,
        domain: r.value.split('@')[1] || '',
        sourceUrl: r.source_page.replace(/^LeadMine Crawl:\s*/i, '').replace(/^Sniffy Crawl:\s*/i, ''),
        context: '',
      })),
    );
  }, [results, setEmailsFromSniffy]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const terms = searchTerms
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (!terms.length) {
      updateStatus('Enter at least one search term', 'danger');
      return;
    }
    if (hasSerpapi === false) {
      updateStatus('Search API key is missing. Check Settings / .env', 'danger');
      return;
    }
    if (useProxy && proxyCount === 0) {
      updateStatus('Add at least one proxy, or turn off Use Proxy.', 'warn');
      return;
    }

    setResults([]);
    setPage(1);
    setProgress(0);
    setStats({ pages_crawled: 0, pages_failed: 0, emails_found: 0, leads_found: 0 });
    setShowDownload(false);
    setRunning(true);
    updateStatus('Starting extraction...', 'info');

    try {
      await api.startExtraction({
        searchTerms: terms,
        location: location.trim(),
        domains: domainsDraft,
        maxResults,
        maxDepth: 3,
        useProxy,
        proxyList,
        deepCrawl: true,
      });
      updateStatus('Extraction in progress', 'info');
      poll();
    } catch (err) {
      setRunning(false);
      updateStatus((err as Error).message || 'Error starting extraction', 'danger');
    }
  };

  const onStop = async () => {
    await api.stopExtraction();
    updateStatus('Stopping...', 'warn');
  };

  const onDownload = async (format: 'csv' | 'txt' | 'legitimate' | 'json' = 'csv') => {
    try {
      const res = await authFetch(`/api/download_results?format=${format}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(
          typeof err.error === 'string' ? err.error : 'Download failed',
        );
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const match = /filename\*?=(?:UTF-8''|")?([^\";]+)/i.exec(cd);
      const fallback =
        format === 'json'
          ? 'leadmin_leads.json'
          : format === 'legitimate'
            ? 'leadmin_legitimate_emails.txt'
            : format === 'txt'
              ? 'leadmin_all_emails.txt'
              : 'leadmin_results.csv';
      const filename = match ? decodeURIComponent(match[1].replace(/"/g, '')) : fallback;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      updateStatus((err as Error).message || 'Download failed', 'danger');
    }
  };

  const pageCount = Math.max(1, Math.ceil(results.length / rowsPerPage));
  const pageRows = results.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  const badgeClass =
    statusTone === 'ok'
      ? 'sniffy-badge-ok'
      : statusTone === 'warn'
        ? 'sniffy-badge-warn'
        : statusTone === 'danger'
          ? 'sniffy-badge-danger'
          : 'sniffy-badge-info';

  return (
    <div className="sniffy-root">
      <div className="sniffy-container">
        <div className="sniffy-topnav">
          <Link to="/verify">Verify</Link>
          <Link to="/export">Export</Link>
          <Link to="/settings">Settings</Link>
          <Link to="/help">Help</Link>
          <Link to="/search">Classic UI</Link>
          <button
            type="button"
            className="sniffy-btn sniffy-btn-ghost"
            style={{ marginLeft: 'auto', padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
            onClick={() => {
              clearAuthToken();
              navigate('/login', { replace: true });
            }}
          >
            Sign out
          </button>
        </div>

        <h1 className="sniffy-logo">
          <pre>{LOGO}</pre>
          <span className="sniffy-online">online</span>
        </h1>

        {/* API key status (Sniffy license banner equivalent) */}
        <div className="sniffy-card">
          <div className="sniffy-card-header">
            <span>API Status</span>
          </div>
          <div className="sniffy-card-body">
            {hasSerpapi === null ? (
              <div className="sniffy-alert sniffy-alert-ok">Checking API status…</div>
            ) : hasSerpapi ? (
              <div className="sniffy-alert sniffy-alert-ok">
                <strong>Valid License</strong>
                <br />
                Welcome to LeadMine. Ready to extract.
              </div>
            ) : (
              <div className="sniffy-alert sniffy-alert-danger">
                <strong>API Error:</strong> Search API key is missing. Add it to `.env` and restart the
                server.
              </div>
            )}
          </div>
        </div>

        {/* Search Parameters — Sniffy structure */}
        <div className="sniffy-card">
          <div className="sniffy-card-header">
            <span>Search Parameters</span>
          </div>
          <div className="sniffy-card-body">
            <form onSubmit={(e) => void onSubmit(e)}>
              <div className="sniffy-row sniffy-row-2">
                <div>
                  <label className="sniffy-label" htmlFor="searchTerm">
                    Search Terms (one per line)
                  </label>
                  <textarea
                    id="searchTerm"
                    className="sniffy-textarea"
                    rows={3}
                    required
                    value={searchTerms}
                    onChange={(e) => setSearchTerms(e.target.value)}
                  />
                </div>
                <div>
                  <label className="sniffy-label" htmlFor="location">
                    Location (City, State, Country)
                  </label>
                  <input
                    id="location"
                    className="sniffy-input"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="e.g. New York, NY, USA"
                  />
                </div>
              </div>

              <div className="sniffy-row sniffy-row-2">
                <div>
                  <label className="sniffy-label" htmlFor="domain">
                    Domain Filter (optional)
                  </label>
                  <input
                    id="domain"
                    className="sniffy-input"
                    value={domainsDraft}
                    onChange={(e) => setDomainsDraft(e.target.value)}
                    placeholder="empty = all · company.com = corporate · gmail.com"
                  />
                  <p className="sniffy-hint" style={{ marginTop: '0.35rem' }}>
                    <strong>Empty</strong> = company + Gmail/Outlook/Yahoo. Type{' '}
                    <code>company.com</code> (or <code>company</code>) = all corporate domains
                    only. Type <code>gmail.com, yahoo.com</code> = only those free-mail domains.
                  </p>
                </div>
                <div>
                  <label className="sniffy-label" htmlFor="maxResults">
                    Max Results
                  </label>
                  <select
                    id="maxResults"
                    className="sniffy-select"
                    value={maxResults}
                    onChange={(e) => setMaxResults(Number(e.target.value))}
                  >
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={500}>500</option>
                    <option value={1000}>1,000</option>
                    <option value={5000}>5,000</option>
                    <option value={10000}>10,000</option>
                    <option value={25000}>25,000</option>
                    <option value={50000}>50,000</option>
                    <option value={100000}>100,000</option>
                    <option value={250000}>250,000</option>
                  </select>
                </div>
              </div>

              <div className="sniffy-hint">Proxies are optional.</div>

              <div className="sniffy-row" style={{ marginTop: '1rem' }}>
                <label className="sniffy-switch">
                  <input
                    type="checkbox"
                    checked={useProxy}
                    onChange={(e) => setUseProxy(e.target.checked)}
                  />
                  Use Proxy
                </label>
              </div>

              {useProxy && (
                <div className="sniffy-row">
                  <div>
                    <label className="sniffy-label" htmlFor="proxyList">
                      Proxy List (one per line)
                    </label>
                    <textarea
                      id="proxyList"
                      className="sniffy-textarea"
                      rows={3}
                      value={proxyList}
                      onChange={(e) => setProxyList(e.target.value)}
                      placeholder={
                        'http://proxy1:port\nhttp://proxy2:port\nhttp://user:pass@proxy3:port'
                      }
                    />
                    <div className="sniffy-hint" style={{ fontWeight: 400, color: 'var(--sn-muted)' }}>
                      Enter proxies in format: http://ip:port or http://user:pass@ip:port
                    </div>
                  </div>
                </div>
              )}

              <div className="sniffy-actions">
                <button
                  type="submit"
                  className="sniffy-btn sniffy-btn-primary"
                  disabled={running || hasSerpapi === false}
                >
                  Start Extraction
                </button>
                {running && (
                  <button type="button" className="sniffy-btn sniffy-btn-danger" onClick={() => void onStop()}>
                    Stop Extraction
                  </button>
                )}
                {showDownload && results.length > 0 && (
                  <span className="sniffy-download-group">
                    <button
                      type="button"
                      className="sniffy-btn sniffy-btn-success"
                      onClick={() => onDownload('csv')}
                    >
                      Download CSV
                    </button>
                    <button
                      type="button"
                      className="sniffy-btn sniffy-btn-success"
                      onClick={() => onDownload('txt')}
                    >
                      TXT
                    </button>
                    <button
                      type="button"
                      className="sniffy-btn sniffy-btn-success"
                      onClick={() => onDownload('legitimate')}
                    >
                      Legitimate
                    </button>
                    <button
                      type="button"
                      className="sniffy-btn sniffy-btn-success"
                      onClick={() => onDownload('json')}
                    >
                      JSON
                    </button>
                  </span>
                )}
                {status && <span className={`sniffy-badge ${badgeClass}`}>{status}</span>}
              </div>
            </form>
          </div>
        </div>

        {/* Progress — Sniffy structure */}
        <div className="sniffy-card">
          <div className="sniffy-card-header">
            <span>Progress</span>
          </div>
          <div className="sniffy-card-body">
            <div className="sniffy-progress">
              <div
                className="sniffy-progress-bar"
                style={{ width: `${Math.max(progress, running ? 2 : 0)}%` }}
              >
                {Math.round(progress)}%
              </div>
            </div>
            <div className="sniffy-crawling">
              {crawling.map((url) => (
                <div key={url}>Crawling: {url}</div>
              ))}
              {running && !crawling.length && stats.pages_crawled === 0 && !liveLogs.length ? (
                <div>Phase 1/2: querying Google (Serper/SerpAPI) for seed URLs…</div>
              ) : null}
              {liveLogs.length > 0 && (
                <div className="sniffy-live-logs">
                  {liveLogs.map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </div>
              )}
            </div>
            <div className="sniffy-row sniffy-row-4" style={{ marginTop: '1rem', marginBottom: 0 }}>
              <div className="sniffy-stat">
                <h5>Pages Crawled</h5>
                <p>{stats.pages_crawled}</p>
              </div>
              <div className="sniffy-stat">
                <h5>Pages Failed</h5>
                <p>{stats.pages_failed}</p>
              </div>
              <div className="sniffy-stat">
                <h5>Emails Found</h5>
                <p>{stats.emails_found}</p>
              </div>
              <div className="sniffy-stat">
                <h5>Leads Found</h5>
                <p>{stats.leads_found}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Results — Sniffy structure */}
        <div className="sniffy-card">
          <div className="sniffy-card-header">
            <span>Results</span>
          </div>
          <div className="sniffy-card-body">
            <div className="sniffy-table-wrap">
              <table
                className="sniffy-table"
                style={{ display: results.length ? 'table' : 'none' }}
              >
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Score</th>
                    <th>Source</th>
                    <th>Found On</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr key={`${r.value}-${r.timestamp}`}>
                      <td className="email">{r.value}</td>
                      <td>{r.score ?? '—'}</td>
                      <td title={r.source_page}>
                        {r.source_page.startsWith('LeadMine Crawl') ||
                        r.source_page.startsWith('Sniffy Crawl')
                          ? 'LeadMine Crawl'
                          : r.source_page.length > 40
                            ? `${r.source_page.slice(0, 40)}…`
                            : r.source_page}
                      </td>
                      <td>{new Date(r.timestamp).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!results.length && (
                <p style={{ color: 'var(--sn-muted)', textAlign: 'center', padding: '2rem 0' }}>
                  {running
                    ? 'Crawling… valid leads appear here live as they are verified.'
                    : 'Results will appear here as leads are found…'}
                </p>
              )}
            </div>

            {pageCount > 1 && (
              <div className="sniffy-pagination">
                <button
                  type="button"
                  className="sniffy-page"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                {Array.from({ length: pageCount }, (_, i) => i + 1)
                  .filter((n) => n === 1 || n === pageCount || Math.abs(n - page) <= 2)
                  .map((n, idx, arr) => {
                    const prev = arr[idx - 1];
                    const gap = prev && n - prev > 1;
                    return (
                      <span key={n} style={{ display: 'contents' }}>
                        {gap && (
                          <button type="button" className="sniffy-page" disabled>
                            …
                          </button>
                        )}
                        <button
                          type="button"
                          className={`sniffy-page ${n === page ? 'active' : ''}`}
                          onClick={() => setPage(n)}
                        >
                          {n}
                        </button>
                      </span>
                    );
                  })}
                <button
                  type="button"
                  className="sniffy-page"
                  disabled={page >= pageCount}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {modal.open && (
        <div className="sniffy-modal-backdrop" onClick={() => setModal((m) => ({ ...m, open: false }))}>
          <div className="sniffy-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sniffy-modal-header">
              <strong>{modal.title}</strong>
              <button
                type="button"
                className="sniffy-btn sniffy-btn-ghost"
                onClick={() => setModal((m) => ({ ...m, open: false }))}
              >
                ✕
              </button>
            </div>
            <div className="sniffy-modal-body">{modal.body}</div>
            <div className="sniffy-modal-footer">
              <button
                type="button"
                className="sniffy-btn sniffy-btn-ghost"
                onClick={() => setModal((m) => ({ ...m, open: false }))}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
