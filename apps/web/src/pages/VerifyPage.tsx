import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, authFetch, clearAuthToken } from '@/lib/api';
import '@/styles/sniffy.css';

const LOGO = ` _      _____    _    ____    __  __ ___ _   _ _____
| |    | ____|  / \\  |  _ \\  |  \\/  |_ _| \\ | | ____|
| |    |  _|   / _ \\ | | | | | |\\/| || ||  \\| |  _|
| |___ | |___ / ___ \\| |_| | | |  | || || |\\  | |___
|_____||_____/_/   \\_\\____/  |_|  |_|___|_| \\_|_____|`;

type Counts = { reachable: number; invalid: number; unknown: number };

export function VerifyPage() {
  const [text, setText] = useState('');
  const [smtp, setSmtp] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [checked, setChecked] = useState(0);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Counts>({ reachable: 0, invalid: 0, unknown: 0 });
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const pollRef = useRef<number | null>(null);

  const stopPoll = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => stopPoll(), []);

  const poll = useCallback(() => {
    stopPoll();
    pollRef.current = window.setInterval(async () => {
      try {
        const data = await api.verifyProgress();
        setProgress(data.progress || 0);
        setChecked(data.checked || 0);
        setTotal(data.total || 0);
        if (data.counts) setCounts(data.counts);

        if (['completed', 'stopped', 'error', 'idle'].includes(data.status)) {
          stopPoll();
          setRunning(false);
          if (data.status === 'completed') {
            setDone(true);
            setStatus(
              `Done — reachable ${data.counts?.reachable ?? 0}, invalid ${data.counts?.invalid ?? 0}, unknown ${data.counts?.unknown ?? 0}`,
            );
          } else if (data.status === 'stopped') {
            setDone(Boolean(data.counts?.reachable || data.counts?.invalid || data.counts?.unknown));
            setStatus('Stopped');
          } else if (data.status === 'error') {
            setError(data.error || 'Verification failed');
            setStatus('Error');
          }
        }
      } catch (err) {
        stopPoll();
        setRunning(false);
        setError(err instanceof Error ? err.message : 'Progress check failed');
      }
    }, 800);
  }, []);

  const onStart = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setDone(false);
    setStatus('Starting…');
    setProgress(0);
    setCounts({ reachable: 0, invalid: 0, unknown: 0 });
    try {
      await api.verifyEmails({ text, smtp });
      setRunning(true);
      setStatus('Verifying (DNS / MX / SMTP)…');
      poll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start verification');
      setStatus('');
    }
  };

  const onStop = async () => {
    try {
      await api.verifyStop();
    } catch {
      /* ignore */
    }
  };

  const download = async (format: 'reachable' | 'invalid' | 'unknown' | 'all') => {
    try {
      const res = await authFetch(`/api/verify_download?format=${format}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || res.statusText);
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const match = /filename="([^"]+)"/.exec(cd);
      const filename = match?.[1] || `${format}.txt`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    }
  };

  return (
    <div className="sniffy-root">
      <div className="sniffy-container">
        <div className="sniffy-topnav">
          <Link to="/">Extractor</Link>
          <Link to="/verify">Verify</Link>
          <Link to="/export">Export</Link>
          <Link to="/settings">Settings</Link>
          <button
            type="button"
            className="sniffy-btn sniffy-btn-ghost"
            style={{ marginLeft: 'auto', padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
            onClick={() => {
              clearAuthToken();
              window.location.assign('/login');
            }}
          >
            Sign out
          </button>
        </div>

        <div className="sniffy-logo">
          <pre>{LOGO}</pre>
          <span className="sniffy-online">EMAIL VERIFIER</span>
        </div>

        <div className="sniffy-card">
          <div className="sniffy-card-header">
            <span>Hazmat-style check (free — no paid API)</span>
          </div>
          <div className="sniffy-card-body">
            <p className="sniffy-hint" style={{ marginBottom: '1rem' }}>
              Checks syntax, MX (DNS), role/disposable filters, and SMTP mailbox probe when
              possible — same idea as Hazmat / Reacher. Download <strong>reachable</strong> emails
              before campaigns to protect your SMTP.
            </p>

            <form onSubmit={onStart}>
              <label className="sniffy-label" htmlFor="verify-list">
                Email list (one per line)
              </label>
              <textarea
                id="verify-list"
                className="sniffy-input"
                rows={12}
                value={text}
                onChange={(ev) => setText(ev.target.value)}
                placeholder={'john.smith@company.com\njane.doe@agency.org\ninfo@skip-me.com'}
                disabled={running}
                required
              />

              <label className="sniffy-switch" style={{ marginTop: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={smtp}
                  onChange={(ev) => setSmtp(ev.target.checked)}
                  disabled={running}
                />
                <span>SMTP mailbox probe (best accuracy; may be blocked on cloud — then results go to unknown)</span>
              </label>

              <div className="sniffy-actions" style={{ marginTop: '1rem' }}>
                <button type="submit" className="sniffy-btn sniffy-btn-primary" disabled={running}>
                  Start verification
                </button>
                <button
                  type="button"
                  className="sniffy-btn sniffy-btn-danger"
                  onClick={onStop}
                  disabled={!running}
                >
                  Stop
                </button>
                {status ? (
                  <span className={`sniffy-badge ${error ? 'sniffy-badge-danger' : 'sniffy-badge-info'}`}>
                    {status}
                  </span>
                ) : null}
              </div>
            </form>

            {error ? (
              <div className="sniffy-hint" style={{ color: 'var(--sn-danger)', marginTop: '0.75rem' }}>
                {error}
              </div>
            ) : null}
          </div>
        </div>

        <div className="sniffy-card">
          <div className="sniffy-card-header">
            <span>Progress</span>
          </div>
          <div className="sniffy-card-body">
            <div className="sniffy-progress">
              <div className="sniffy-progress-bar" style={{ width: `${Math.max(progress, running ? 2 : 0)}%` }}>
                {Math.round(progress)}%
              </div>
            </div>
            <div className="sniffy-hint" style={{ marginTop: '0.5rem' }}>
              Checked {checked} / {total}
            </div>
            <div className="sniffy-row sniffy-row-4" style={{ marginTop: '1rem', marginBottom: 0 }}>
              <div className="sniffy-stat">
                <h5>Reachable</h5>
                <p>{counts.reachable}</p>
              </div>
              <div className="sniffy-stat">
                <h5>Invalid</h5>
                <p>{counts.invalid}</p>
              </div>
              <div className="sniffy-stat">
                <h5>Unknown</h5>
                <p>{counts.unknown}</p>
              </div>
              <div className="sniffy-stat">
                <h5>Total</h5>
                <p>{total}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="sniffy-card">
          <div className="sniffy-card-header">
            <span>Downloads (like Hazmat)</span>
          </div>
          <div className="sniffy-card-body">
            <div className="sniffy-actions">
              <button
                type="button"
                className="sniffy-btn sniffy-btn-success"
                disabled={!done && !counts.reachable}
                onClick={() => download('reachable')}
              >
                reachable.txt
              </button>
              <button
                type="button"
                className="sniffy-btn sniffy-btn-danger"
                disabled={!done && !counts.invalid}
                onClick={() => download('invalid')}
              >
                invalid.txt
              </button>
              <button
                type="button"
                className="sniffy-btn sniffy-btn-ghost"
                disabled={!done && !counts.unknown}
                onClick={() => download('unknown')}
              >
                unknown.txt
              </button>
              <button
                type="button"
                className="sniffy-btn sniffy-btn-primary"
                disabled={!done && !(counts.reachable || counts.invalid || counts.unknown)}
                onClick={() => download('all')}
              >
                all.csv
              </button>
            </div>
            <p className="sniffy-hint" style={{ marginTop: '0.85rem' }}>
              Use <strong>reachable.txt</strong> in Inbox Flow campaigns. Unknown often means the
              cloud host blocked port 25 — still safer than sending invalids.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
