import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { ExtractorPage } from '@/pages/ExtractorPage';
import { SearchPage } from '@/pages/SearchPage';
import { ProgressPage } from '@/pages/ProgressPage';
import { ResultsPage } from '@/pages/ResultsPage';
import { ExportPage } from '@/pages/ExportPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { HelpPage } from '@/pages/HelpPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Sniffy-style full-page extractor (no sidebar) */}
        <Route path="/" element={<ExtractorPage />} />

        {/* Classic LeadMine chrome */}
        <Route element={<AppLayout />}>
          <Route path="search" element={<SearchPage />} />
          <Route path="progress" element={<ProgressPage />} />
          <Route path="results" element={<ResultsPage />} />
          <Route path="export" element={<ExportPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="help" element={<HelpPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
