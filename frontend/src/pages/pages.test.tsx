import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../api/client';
import { accuracy, decision, meta, rows } from '../test/fixtures';
import { DayAheadBrief } from './DayAheadBrief';
import { ForecastAccuracy } from './ForecastAccuracy';

vi.mock('../components/charts/EChart', () => ({
  EChart: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} />,
}));

vi.mock('../api/client', () => ({
  api: { meta: vi.fn(), decision: vi.fn(), accuracy: vi.fn() },
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

const headline = () => screen.findByRole('region', { name: 'Forecast at gate closure' });

beforeEach(() => {
  vi.mocked(api.meta).mockResolvedValue(meta);
  vi.mocked(api.decision).mockResolvedValue(decision);
  vi.mocked(api.accuracy).mockResolvedValue(accuracy);
});

describe('Day-Ahead', () => {
  it('leads with the forecast known at the gate and how far to trust it', async () => {
    renderAt('/brief?date=2026-01-15&gate=09:50', <DayAheadBrief />, '/brief');
    const h = await headline();
    expect(api.decision).toHaveBeenCalledWith('2026-01-15', '09:50');
    expect(h).toHaveTextContent('Delivery Fri 16 Jan 2026');
    expect(h).toHaveTextContent('240.0 GWh');
    expect(h).toHaveTextContent('likely 168–252 GWh');
    expect(h).toHaveTextContent('Run published Thu 15 Jan 09:30 UK, 14.5–37.5 h ahead');
    // Error history uses only days completed before the decision.
    expect(h).toHaveTextContent('Typical miss at this lead time: 1,650 MW an hour');
    expect(h).toHaveTextContent('running 1,400 MW high on average');
    expect(h).toHaveTextContent('13 January days completed before this decision');
    expect(h).toHaveTextContent(/Stale feed: the last 5 runs repeated .* Wed 14 Jan 18:30 UK/);
    expect(h).not.toHaveTextContent('Actual:');
  });

  it('falls back to the latest decision and default gate for invalid URL params', async () => {
    renderAt('/brief?date=2026-03-01&gate=25:99', <DayAheadBrief />, '/brief');
    await headline();
    expect(api.decision).toHaveBeenCalledWith('2026-01-31', '09:50');
  });

  it('shows actuals, error and actual columns only after Show actuals', async () => {
    const user = userEvent.setup();
    renderAt('/brief?date=2026-01-15', <DayAheadBrief />, '/brief');
    await headline();
    expect(screen.queryByRole('columnheader', { name: 'Actual' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Show actuals' }));
    const h = await headline();
    // Fixture: 211.2 GWh actual vs 240.0 GWh forecast.
    expect(h).toHaveTextContent('Actual: 211.2 GWh. The forecast was 28.8 GWh (14%) too high');
    await user.click(screen.getByText('Hourly data'));
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Actual' })).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(25);
    expect(screen.getByRole('button', { name: /export hourly data as csv/i })).toBeInTheDocument();
  });

  it('warns when the forecast covers only part of the day', async () => {
    vi.mocked(api.decision).mockResolvedValue({
      ...decision,
      forecast: { ...decision.forecast!, hours_with_forecast: 22, band_p10_energy_gwh: null },
    });
    renderAt('/brief?date=2026-01-15', <DayAheadBrief />, '/brief');
    const h = await headline();
    expect(h).toHaveTextContent('The forecast covers only 22 of 24 hours at this gate');
    expect(h).not.toHaveTextContent('likely');
  });

  it('says so when no January day had finished before the decision', async () => {
    vi.mocked(api.decision).mockResolvedValue({
      ...decision,
      typical_error_known_at_gate: { ...decision.typical_error_known_at_gate, n_days: 0 },
    });
    renderAt('/brief?date=2026-01-01', <DayAheadBrief />, '/brief');
    expect(await headline()).toHaveTextContent(
      'No January day had finished before this decision, so there is no error history yet',
    );
  });

  it('switches gate from the selector and offers a custom time', async () => {
    const user = userEvent.setup();
    renderAt('/brief?date=2026-01-15', <DayAheadBrief />, '/brief');
    await headline();
    await user.selectOptions(screen.getByLabelText('Gate closure'), '09:20');
    expect(api.decision).toHaveBeenLastCalledWith('2026-01-15', '09:20');
    await user.selectOptions(screen.getByLabelText('Gate closure'), 'custom');
    expect(screen.getByLabelText('Custom gate closure time, UK')).toHaveValue('09:20');
  });
});

describe('buy beyond wind', () => {
  it('works out the volume to buy for the default demand', async () => {
    renderAt('/brief?date=2026-01-15', <DayAheadBrief />, '/brief');
    await headline();
    // Fixture forecast is 10,000 MW every hour: 24 h x (30,000 - 10,000) MW = 480 GWh.
    expect(screen.getByText('480.0 GWh')).toBeInTheDocument();
    expect(screen.getByText(/Largest hourly need 20,000 MW at 00:00/)).toBeInTheDocument();
  });

  it('adds the low-wind case when every hour has a P10', async () => {
    vi.mocked(api.decision).mockResolvedValue({
      ...decision,
      rows: rows.map((r) => ({ ...r, band_p10_mw: 7000, band_p90_mw: 10500 })),
    });
    renderAt('/brief?date=2026-01-15&demand=40000', <DayAheadBrief />, '/brief');
    await headline();
    expect(screen.getByText('720.0 GWh')).toBeInTheDocument(); // 24 x 30,000
    expect(screen.getByText('792.0 GWh')).toBeInTheDocument(); // 24 x 33,000
    expect(screen.getByText(/Forecast uncertainty adds 72.0 GWh/)).toBeInTheDocument();
  });

  it('can be switched off with an empty demand', async () => {
    renderAt('/brief?date=2026-01-15&demand=', <DayAheadBrief />, '/brief');
    await headline();
    expect(screen.getByText(/Enter the demand you have to cover/)).toBeInTheDocument();
  });

  it('compares the plan with what was actually needed only with actuals shown', async () => {
    renderAt('/brief?date=2026-01-15&reveal=1', <DayAheadBrief />, '/brief');
    await headline();
    // Actual 8,800 MW: need 24 x 21,200 = 508.8 GWh, so buying on the forecast was 28.8 GWh short.
    expect(screen.getByText('508.8 GWh')).toBeInTheDocument();
    expect(screen.getByText(/left you short by 28.8 GWh/)).toBeInTheDocument();
  });
});

describe('Accuracy', () => {
  it('shows four numbers and a takeaway computed from the API data', async () => {
    renderAt('/accuracy?gate=09:50', <ForecastAccuracy />, '/accuracy');
    expect(await screen.findByText('2,013 MW')).toBeInTheDocument();
    expect(api.accuracy).toHaveBeenCalledWith('2026-01-01', '2026-01-31', '09:50');
    expect(screen.getByText('+1,730 MW')).toBeInTheDocument();
    expect(screen.getByText('3,000 MW')).toBeInTheDocument();
    expect(screen.getByText('77%')).toBeInTheDocument();
    const takeaway = screen.getByText(/Buying on it as-is/);
    expect(takeaway).toHaveTextContent('The forecast was too high in 75% of hours');
    expect(takeaway).toHaveTextContent('29 GWh more wind than arrived over these 2 days');
  });

  it('describes the age curve on hours scored at every age', async () => {
    renderAt('/accuracy', <ForecastAccuracy />, '/accuracy');
    // 48 h runs no longer cover every hour, so the comparison stops at 24 h.
    expect(
      await screen.findByText(
        'MAE grows from 1,688 MW with the freshest run to 1,948 MW for runs 24 h old.',
      ),
    ).toBeInTheDocument();
  });

  it('links each worst day to the Day-Ahead view with actuals', async () => {
    renderAt('/accuracy?gate=09:50', <ForecastAccuracy />, '/accuracy');
    const link = await screen.findByRole('link', { name: /Open day/ });
    expect(link).toHaveAttribute('href', '/brief?date=2026-01-27&gate=09:50&reveal=1');
  });

  it('says too low when the bias is negative, and both ways when it is small', async () => {
    vi.mocked(api.accuracy).mockResolvedValue({
      ...accuracy,
      summary: { ...accuracy.summary, bias_mw: -1500, energy_error_mwh: -30000 },
    });
    const { unmount } = renderAt('/accuracy', <ForecastAccuracy />, '/accuracy');
    expect(await screen.findByText(/Buying on it as-is/)).toHaveTextContent(
      'too low in 25% of hours',
    );
    unmount();
    vi.mocked(api.accuracy).mockResolvedValue({
      ...accuracy,
      summary: { ...accuracy.summary, bias_mw: 100 },
    });
    renderAt('/accuracy', <ForecastAccuracy />, '/accuracy');
    expect(await screen.findByText(/Errors went both ways/)).toHaveTextContent(
      'high in 75% of hours and low in 25%',
    );
  });
});

describe('compatibility with older API responses', () => {
  it('renders Accuracy when a cached response has no timeline or age curve', async () => {
    // Regression: a browser-cached pre-deploy response lacked `timeline` and crashed the page.
    const older = { ...accuracy };
    delete older.timeline;
    delete older.by_forecast_age;
    vi.mocked(api.accuracy).mockResolvedValue(older);
    renderAt('/accuracy', <ForecastAccuracy />, '/accuracy');
    expect(await screen.findByText('2,013 MW')).toBeInTheDocument();
    expect(screen.queryByText('Forecast at the gate vs actual')).not.toBeInTheDocument();
    expect(screen.queryByText('Error vs forecast age')).not.toBeInTheDocument();
  });
});
