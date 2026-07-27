export function HelpPage() {
  const sections = [
    {
      title: 'What LeadMine does',
      body: 'Searches the public web with SerpAPI using your location for Google geo-bias, scrapes contact/about pages, then validates emails (syntax + MX) before Results.',
    },
    {
      title: 'Location (worldwide)',
      body: 'Enter any city, region, or country — Lagos, London, Tokyo, São Paulo, Dubai, Texas, etc. LeadMine maps it to the right Google country domain and place bias so results are local to that area.',
    },
    {
      title: 'SerpAPI',
      body: 'Required for web search. Put SERPAPI_KEY in .env and restart npm run dev. Multiple query variants run per job for better coverage.',
    },
    {
      title: 'Email validation',
      body: 'Candidates must pass strict syntax and have a real mail domain (MX). Invalid / fake / disposable addresses are dropped. Gmail/Outlook cannot prove mailbox existence remotely.',
    },
    {
      title: 'Tips for more emails',
      body: 'Use a clear role + location (e.g. “dentist Austin”). Keep domains specific (gmail.com, company.com). Max results 15–35. Prefer public company contact pages over social networks (those are blocked).',
    },
    {
      title: 'Compliance',
      body: 'Public data only. You are responsible for CAN-SPAM / GDPR. Export only — no sending.',
    },
  ];

  return (
    <div className="w-full space-y-4">
      <header>
        <h2 className="page-title">Help</h2>
        <p className="page-sub">Worldwide SerpAPI search + validated emails</p>
      </header>

      {sections.map((s) => (
        <div key={s.title} className="tui-box">
          <div className="tui-box-title">{s.title}</div>
          <p className="p-4 text-sm text-muted-foreground">{s.body}</p>
        </div>
      ))}
    </div>
  );
}
