import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { useAppStore } from '@/stores/app';
import { Badge, Button } from '@/components/ui';

export function ResultsPage() {
  const { emails, stats } = useAppStore();
  const summary = stats
    ? `${stats.totalFound} candidates · ${stats.uniqueCount} validated${
        stats.rejectedInvalid
          ? ` · ${stats.rejectedInvalid} invalid`
          : ''
      }${
        stats.duplicatesRemoved
          ? ` · ${stats.duplicatesRemoved} dupes`
          : ''
      }`
    : emails.length
      ? `${emails.length} validated`
      : 'No run yet';


  return (
    <div className="flex h-full w-full flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="page-title">Results</h2>
          <p className="page-sub">{summary}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="info">{emails.length} rows</Badge>
          <Link to="/export">
            <Button size="sm" variant="outline">
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
          </Link>
        </div>
      </header>

      <div className="tui-box flex min-h-0 flex-1 flex-col">
        <div className="tui-box-title">Validated emails</div>
        <div className="table-scroll min-h-0 flex-1">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-muted text-accent">
              <tr>
                <th className="border-b border-border px-3 py-2 font-medium uppercase tracking-wider">
                  Email
                </th>
                <th className="border-b border-border px-3 py-2 font-medium uppercase tracking-wider">
                  Domain
                </th>
                <th className="border-b border-border px-3 py-2 font-medium uppercase tracking-wider">
                  Source URL
                </th>
                <th className="border-b border-border px-3 py-2 font-medium uppercase tracking-wider">
                  Context
                </th>
              </tr>
            </thead>
            <tbody>
              {emails.map((e) => (
                <tr key={e.email} className="odd:bg-background/40 hover:bg-primary/5">
                  <td className="border-b border-border/40 px-3 py-2 text-primary">{e.email}</td>
                  <td className="border-b border-border/40 px-3 py-2">{e.domain}</td>
                  <td className="max-w-[220px] truncate border-b border-border/40 px-3 py-2 text-muted-foreground">
                    {e.sourceUrl}
                  </td>
                  <td className="max-w-[280px] truncate border-b border-border/40 px-3 py-2 text-muted-foreground">
                    {e.context}
                  </td>
                </tr>
              ))}
              {!emails.length && (
                <tr>
                  <td colSpan={4} className="px-3 py-10 text-center text-muted-foreground">
                    {stats
                      ? '$ no validated emails for this query — try a clearer location or broader domains'
                      : '$ no results yet — run an extraction from Search'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
