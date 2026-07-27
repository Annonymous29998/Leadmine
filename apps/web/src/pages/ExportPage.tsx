import { useState } from 'react';
import { Save } from 'lucide-react';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/app';
import { Button, Input, Label } from '@/components/ui';

const FORMATS = [
  { id: 'csv', label: 'CSV' },
  { id: 'json', label: 'JSON' },
  { id: 'txt', label: 'TXT (one email per line)' },
  { id: 'md', label: 'Markdown report' },
  { id: 'inbox_flow', label: 'Inbox Flow contacts CSV' },
] as const;

export function ExportPage() {
  const { emails, stats, params, exportPath, setExportPath, setStatus } = useAppStore();
  const [selected, setSelected] = useState<string[]>(['csv', 'json', 'txt', 'md']);
  const [error, setError] = useState('');
  const [paths, setPaths] = useState<string[]>([]);

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const save = async () => {
    setError('');
    if (!emails.length || !params || !stats) {
      setError('No results to export. Run an extraction first.');
      return;
    }
    if (!selected.length) {
      setError('Select at least one export format.');
      return;
    }
    try {
      const res = await api.export({
        formats: selected,
        exportPath: exportPath || undefined,
        subject: params.subject,
        location: params.location,
        domains: params.domains,
        maxResults: params.maxResults,
        mode: params.mode,
        emails,
        stats,
      });
      setPaths(res.paths);
      setStatus(`Exported ${res.paths.length} file(s) to ${res.exportDir}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="w-full space-y-4">
      <header>
        <h2 className="page-title">Export</h2>
        <p className="page-sub">Save results to disk</p>
      </header>

      <div className="tui-box">
        <div className="tui-box-title">Formats</div>
        <div className="space-y-2 p-4 text-sm">
          {FORMATS.map((f) => (
            <label key={f.id} className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                className="accent-[hsl(188_92%_52%)]"
                checked={selected.includes(f.id)}
                onChange={() => toggle(f.id)}
              />
              {f.label}
            </label>
          ))}
        </div>
      </div>

      <div className="tui-box">
        <div className="tui-box-title">Destination</div>
        <div className="p-4">
          <Label>Export directory (optional)</Label>
          <Input
            value={exportPath}
            onChange={(e) => setExportPath(e.target.value)}
            placeholder="./exports (default)"
          />
        </div>
      </div>

      {error && (
        <p className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {paths.length > 0 && (
        <div className="tui-box">
          <div className="tui-box-title">Saved</div>
          <ul className="space-y-1 p-3 text-xs text-primary">
            {paths.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <Button onClick={() => void save()}>
        <Save className="h-4 w-4" />
        Save exports
      </Button>
    </div>
  );
}
