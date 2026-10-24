import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { AppShell } from './components/layout/AppShell';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { DayAheadBrief } from './pages/DayAheadBrief';
import { ForecastAccuracy } from './pages/ForecastAccuracy';
import { Methodology } from './pages/Methodology';

function NotFound() {
  useDocumentTitle('Page not found');
  const location = useLocation();
  return (
    <div className="rounded-xl border border-line bg-surface p-6 text-sm text-ink-secondary">
      <p className="font-semibold text-ink">No page at {location.pathname}</p>
      <Link to="/brief" className="mt-2 inline-block text-accent hover:underline">
        Go to Day-Ahead
      </Link>
    </div>
  );
}

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/brief" replace />} />
        <Route path="/brief" element={<DayAheadBrief />} />
        <Route path="/accuracy" element={<ForecastAccuracy />} />
        <Route path="/horizon" element={<Navigate to="/accuracy" replace />} />
        <Route path="/methodology" element={<Methodology />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppShell>
  );
}
