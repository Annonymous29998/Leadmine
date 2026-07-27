import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play } from 'lucide-react';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/app';
import { Badge, Button, Input, Label, Textarea } from '@/components/ui';

function looksLikeDomains(input: string): boolean {
  return input
    .split(/[,;\s]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, '').replace(/^www\./, ''))
    .filter(Boolean)
    .some((d) => d.includes('.') && d !== 'com' && d !== 'org' && d !== 'net');
}

export function SearchPage() {
  const navigate = useNavigate();
  const {
    domainsDraft,
    setDomainsDraft,
    startExtraction,
    lastError,
    setLastError,
  } = useAppStore();

  const [subject, setSubject] = useState('');
  const [location, setLocation] = useState('');
  const [maxResults, setMaxResults] = useState(25);
  const [mode, setMode] = useState<'web_search' | 'urls'>('web_search');
  const [urlList, setUrlList] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [hasSerpapi, setHasSerpapi] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .settings()
      .then((s) => setHasSerpapi(s.hasSerpapi))
      .catch(() => setHasSerpapi(false));
  }, []);

  useEffect(() => {
    if (lastError) setError(lastError);
  }, [lastError]);

  const onFile = async (file: File | null) => {
    if (!file) {
      setFileContent('');
      setFileName('');
      return;
    }
    setFileName(file.name);
    setFileContent(await file.text());
  };

  const start = async () => {
    setError('');
    setLastError('');
    if (!subject.trim()) {
      setError('Subject / role is required.');
      return;
    }
    if (!domainsDraft.trim() || !looksLikeDomains(domainsDraft)) {
      setError('Enter real email domains like gmail.com (not bare TLDs like com).');
      return;
    }
    if (mode === 'web_search' && hasSerpapi === false) {
      setError('SERPAPI_KEY is required. Add it to .env and restart the API.');
      return;
    }
    if (mode === 'urls' && !urlList.trim() && !fileContent) {
      setError('Provide URLs or a local file.');
      return;
    }

    setDomainsDraft(domainsDraft);
    navigate('/progress');

    try {
      const { jobId } = await startExtraction({
        subject: subject.trim(),
        location: location.trim(),
        domains: domainsDraft,
        maxResults: Math.min(100, Math.max(1, maxResults)),
        mode,
        urlList,
        fileContent: fileContent || undefined,
        fileName: fileName || undefined,
      });
      // Only jump to results if this job is still current and user is on progress
      if (useAppStore.getState().jobId === jobId) {
        const path = window.location.pathname;
        if (path === '/progress' || path.endsWith('/progress')) {
          navigate('/results');
        }
      }
    } catch {
      navigate('/');
    }
  };

  return (
    <div className="w-full space-y-4">
      <header>
        <h2 className="page-title">Search</h2>
        <p className="page-sub">
          Worldwide SerpAPI search with location geo-bias · validated emails (syntax + MX)
        </p>
      </header>

      <div className="tui-box">
        <div className="tui-box-title">Query</div>
        <div className="space-y-4 p-4">
          <div>
            <Label>Subject / role [required]</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. engineers, CEO, marketing manager, dentist"
            />
          </div>
          <div>
            <Label>Location [city, region, or country — works worldwide]</Label>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Lagos, London, Tokyo, São Paulo, Dubai, Texas"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Used for Google geo bias (country + place). Leave blank for global results.
            </p>
          </div>
          <div>
            <Label>Email domains [comma-separated]</Label>
            <Input value={domainsDraft} onChange={(e) => setDomainsDraft(e.target.value)} />
          </div>
          <div>
            <Label>Max results</Label>
            <Input
              type="number"
              min={1}
              max={100}
              value={maxResults}
              onChange={(e) => setMaxResults(Number(e.target.value) || 25)}
              className="max-w-xs"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              15–35 is a good balance of speed and coverage.
            </p>
          </div>
        </div>
      </div>

      <div className="tui-box">
        <div className="tui-box-title">Source</div>
        <div className="space-y-3 p-4 text-sm">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="radio"
              className="accent-[hsl(188_92%_52%)]"
              checked={mode === 'web_search'}
              onChange={() => setMode('web_search')}
            />
            <span className="flex flex-wrap items-center gap-2">
              SerpAPI web search
              <Badge
                tone={
                  hasSerpapi === null ? 'info' : hasSerpapi ? 'success' : 'danger'
                }
              >
                {hasSerpapi === null ? 'checking…' : hasSerpapi ? 'key ready' : 'key missing'}
              </Badge>
            </span>
          </label>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="radio"
              className="accent-[hsl(188_92%_52%)]"
              checked={mode === 'urls'}
              onChange={() => setMode('urls')}
            />
            <span>Optional — paste URLs / upload a file only</span>
          </label>

          {hasSerpapi === false && mode === 'web_search' && (
            <p className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Add SERPAPI_KEY to `.env` and restart `npm run dev`.
            </p>
          )}

          {mode === 'urls' && (
            <div className="space-y-4 pt-2">
              <div>
                <Label>URLs [one per line]</Label>
                <Textarea
                  value={urlList}
                  onChange={(e) => setUrlList(e.target.value)}
                  rows={5}
                  placeholder="https://example.com/team"
                />
              </div>
              <div>
                <Label>Local file (.html, .htm, .txt, .csv)</Label>
                <Input
                  type="file"
                  accept=".html,.htm,.txt,.csv"
                  onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
                  className="file:mr-3 file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-foreground"
                />
                {fileName && <p className="mt-1 text-xs text-primary">loaded: {fileName}</p>}
              </div>
            </div>
          )}
        </div>
      </div>

      {error && (
        <p className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Button
        onClick={() => void start()}
        disabled={mode === 'web_search' && hasSerpapi !== true}
      >
        <Play className="h-4 w-4" />
        Start extraction
      </Button>
    </div>
  );
}
