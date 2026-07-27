import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui';

export function SettingsPage() {
  const [info, setInfo] = useState<{
    hasSerpapi: boolean;
    warning: string | null;
  } | null>(null);

  useEffect(() => {
    api
      .settings()
      .then((s) => setInfo({ hasSerpapi: s.hasSerpapi, warning: s.warning }))
      .catch(() => setInfo(null));
  }, []);

  return (
    <div className="w-full space-y-4">
      <header>
        <h2 className="page-title">Settings</h2>
        <p className="page-sub">LeadMine uses SerpAPI only for web search</p>
      </header>

      <div className="tui-box">
        <div className="tui-box-title">SerpAPI</div>
        <div className="space-y-3 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span>SERPAPI_KEY</span>
            <Badge tone={info?.hasSerpapi ? 'success' : 'danger'}>
              {info?.hasSerpapi ? 'configured' : 'missing'}
            </Badge>
          </div>
          {info?.warning && (
            <p className="border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              {info.warning}
            </p>
          )}
        </div>
      </div>

      <div className="tui-box">
        <div className="tui-box-title">.env</div>
        <pre className="overflow-auto p-4 text-xs text-muted-foreground">{`SERPAPI_KEY=your_key_here
SEARCH_PROVIDER=serpapi`}</pre>
      </div>
    </div>
  );
}
