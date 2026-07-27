import { useEffect, useRef } from 'react';
import { Square } from 'lucide-react';
import { useAppStore } from '@/stores/app';
import { Badge, Button } from '@/components/ui';

const COLORS: Record<string, string> = {
  INFO: 'text-info',
  SUCCESS: 'text-primary',
  WARNING: 'text-warning',
  ERROR: 'text-destructive',
};

export function ProgressPage() {
  const { logs, extracting, emails, stats, cancelExtraction } = useAppStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  const foundInLogs = logs.filter(
    (l) => l.message.startsWith('Found:') || l.message.startsWith('Candidate:'),
  ).length;

  return (
    <div className="flex h-full w-full flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="page-title">Progress</h2>
          <p className="page-sub">
            {extracting ? '⠋ Extracting & validating…' : 'Idle / complete'} ·{' '}
            {foundInLogs} candidates seen · {stats?.uniqueCount ?? emails.length} validated
          </p>
        </div>
        <div className="flex items-center gap-2">
          {extracting && (
            <Button size="sm" variant="outline" onClick={() => cancelExtraction()}>
              <Square className="h-3.5 w-3.5" />
              Cancel
            </Button>
          )}
          <Badge tone={extracting ? 'warning' : 'success'}>
            {extracting ? 'RUNNING' : 'READY'}
          </Badge>
        </div>
      </header>

      <div className="tui-box flex min-h-[20rem] flex-1 flex-col">
        <div className="tui-box-title">Live log</div>
        <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed">
          {logs.length === 0 && (
            <p className="text-muted-foreground">
              $ waiting for job… Start an extraction from Search.
            </p>
          )}
          {logs.map((log, i) => (
            <div key={`${log.at}-${i}`} className="whitespace-pre-wrap">
              <span className="text-muted-foreground">{log.at.slice(11, 19)}</span>{' '}
              <span className={COLORS[log.level] || ''}>[{log.level}]</span> {log.message}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
