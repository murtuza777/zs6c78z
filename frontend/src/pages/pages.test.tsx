import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../api/client';
import { accuracy, decision, meta } from '../test/fixtures';
import { DayAheadBrief } from './DayAheadBrief';
import { ForecastAccuracy } from './ForecastAccuracy';

vi.mock('../components/charts/EChart', () => ({
  EChart: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} />,
}));

vi.mock('../api/client', () => ({
  api: { meta: vi.fn(), decision: vi.fn(), accuracy: vi.fn(), horizon: vi.fn() },
  ApiError: class extends Error {},
}));

function renderAt(path: string, element: JSX.Element, routePath: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePath} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.meta).mockResolvedValue(meta);
  vi.mocked(api.decision).mockResolvedValue(decision);
  vi.mocked(api.accuracy).mockResolvedValue(accuracy);
});

describe('Day-Ahead Brief', () => {
  it('requests the decision from URL state and shows the next-day delivery', async () => {
    renderAt('/brief?date=2026-01-15&gate=09:50', <DayAheadBrief />, '/brief');
    expect(await screen.findByText('Fri 16 Jan 2026')).toBeInTheDocument();
    expect(api.decision).toHaveBeenCalledWith('2026-01-15', '09:50');
    expect(screen.getAllByText('240.0 GWh').length).toBeGreaterThan(0); // KPI + revision row
    expect(screen.getByText(/Actuals are hidden/)).toBeInTheDocument();
    expect(
      screen.getByText(/Stale feed: values unchanged since Wed 14 Jan 18:30 UK/),
    ).toBeInTheDocument();
    expect(screen.queryByText('What actually happened')).not.toBeInTheDocument();
  });

  it('falls back to safe defaults for invalid URL params', async () => {
    renderAt('/brief?date=2026-03-01&gate=25:99', <DayAheadBrief />, '/brief');
    await screen.findByText('Fri 16 Jan 2026');
    expect(api.decision).toHaveBeenCalledWith('2026-01-31', '09:50'); // latest decision
  });

  it('reveals hindsight metrics and actual columns on demand', async () => {
    const user = userEvent.setup();
    renderAt('/brief?date=2026-01-15', <DayAheadBrief />, '/brief');
    await screen.findByText('Fri 16 Jan 2026');
    await user.click(screen.getByRole('switch', { name: 'Reveal actuals' }));
    expect(await screen.findByText('What actually happened')).toBeInTheDocument();
    const table = screen.getAllByRole('table').at(-1)!;
    expect(within(table).getAllByText('Actual').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('button', { name: /export hourly observations as csv/i }),
    ).toBeInTheDocument();
  });

  it('labels runs published after the gate only in hindsight mode', async () => {
    renderAt('/brief?date=2026-01-15&reveal=1', <DayAheadBrief />, '/brief');
    expect(await screen.findByText('after gate')).toBeInTheDocument();
    expect(screen.getByText('selected at gate')).toBeInTheDocument();
  });
});

describe('Forecast Accuracy', () => {
  it('summarises findings from API data and links worst days to the brief', async () => {
    renderAt('/accuracy?gate=09:50', <ForecastAccuracy />, '/accuracy');
    expect(await screen.findByText(/Key findings/)).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Open brief/ });
    expect(link).toHaveAttribute('href', '/brief?date=2026-01-27&gate=09:50&reveal=1');
    expect(api.accuracy).toHaveBeenCalledWith('2026-01-01', '2026-01-31', '09:50');
  });
});

describe('decision-time integrity', () => {
  it('leads with error known at the gate and labels the pilot figure separately', async () => {
    renderAt('/brief?date=2026-01-15', <DayAheadBrief />, '/brief');
    expect(await screen.findByText('Typical error, known at gate')).toBeInTheDocument();
    expect(screen.getByText(/MAE over 13 completed days/)).toBeInTheDocument();
    expect(screen.getByText(/all other days 2,051 MW/)).toBeInTheDocument();
  });

  it('flags partially forecast delivery days instead of implying a full day', async () => {
    vi.mocked(api.decision).mockResolvedValue({
      ...decision,
      forecast: { ...decision.forecast!, hours_with_forecast: 22, band_p10_energy_gwh: null },
    });
    renderAt('/brief?date=2026-01-15', <DayAheadBrief />, '/brief');
    expect(await screen.findByText('Partial: 22 of 24 h forecast')).toBeInTheDocument();
  });

  it('exposes metric explanations to assistive technology', async () => {
    renderAt('/brief?date=2026-01-15', <DayAheadBrief />, '/brief');
    const hint = await screen.findByRole('button', { name: 'What is Forecast wind energy?' });
    expect(hint).toHaveAccessibleDescription(/daily energy errors/);
  });

  it('marks the active gate preset with aria-pressed', async () => {
    renderAt('/brief?date=2026-01-15&gate=09:20', <DayAheadBrief />, '/brief');
    await screen.findByText('Fri 16 Jan 2026');
    const pressed = screen
      .getAllByRole('button', { pressed: true })
      .map((b) => b.textContent ?? '');
    expect(pressed.some((t) => t.includes('09:20'))).toBe(true);
  });
});

describe('accuracy findings wording', () => {
  it('states both error directions and the balance of bias', async () => {
    renderAt('/accuracy', <ForecastAccuracy />, '/accuracy');
    const findings = await screen.findByText(/above actual output in/);
    expect(findings).toHaveTextContent('above actual output in 75% of hours and below it in 25%');
    expect(findings).toHaveTextContent('overstated wind supply');
  });

  it('says understated when the bias is negative', async () => {
    vi.mocked(api.accuracy).mockResolvedValue({
      ...accuracy,
      summary: { ...accuracy.summary, bias_mw: -300, energy_error_mwh: -1000 },
    });
    renderAt('/accuracy', <ForecastAccuracy />, '/accuracy');
    const findings = await screen.findByText(/above actual output in/);
    expect(findings).toHaveTextContent('understated wind supply');
  });
});

describe('procurement what-if', () => {
  it('turns a demand into volumes to buy, from the same rows as the table', async () => {
    renderAt('/brief?date=2026-01-15&demand=30000', <DayAheadBrief />, '/brief');
    // Fixture: forecast 10,000 MW and P10 7,000 MW for 23 hours (hour 05 has no band).
    expect(await screen.findByText('Buy if wind matches the forecast')).toBeInTheDocument();
    expect(screen.getByText('480.0 GWh')).toBeInTheDocument(); // 24 h x (30,000 - 10,000)
    expect(screen.getByText('hourly P10 band unavailable')).toBeInTheDocument();
    expect(screen.getByText('Buy if forecast')).toBeInTheDocument(); // table column
  });

  it('offers an example demand when none is set', async () => {
    const user = userEvent.setup();
    renderAt('/brief?date=2026-01-15', <DayAheadBrief />, '/brief');
    await user.click(await screen.findByRole('button', { name: /example demand/i }));
    expect(await screen.findByText('480.0 GWh', {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it('compares the plans with what was actually needed only in hindsight mode', async () => {
    renderAt('/brief?date=2026-01-15&demand=30000&reveal=1', <DayAheadBrief />, '/brief');
    expect(await screen.findByText('Actually needed')).toBeInTheDocument();
    // actual 8,800 MW -> need 24 x 21,200 = 508.8 GWh; forecast plan short by 28.8 GWh
    expect(screen.getByText('508.8 GWh')).toBeInTheDocument();
    expect(screen.getByText(/forecast plan short by 28.8 GWh/)).toBeInTheDocument();
  });
});

describe('compatibility with older API responses', () => {
  it('renders the Accuracy page when a cached response has no timeline', async () => {
    // Regression: a browser-cached pre-deploy response lacked `timeline` and crashed the page.
    const older = { ...accuracy };
    delete older.timeline;
    vi.mocked(api.accuracy).mockResolvedValue(older);
    renderAt('/accuracy', <ForecastAccuracy />, '/accuracy');
    expect(await screen.findByText(/Key findings/)).toBeInTheDocument();
    expect(
      screen.queryByText('Forecast at the gate vs actual, every hour'),
    ).not.toBeInTheDocument();
  });
});
