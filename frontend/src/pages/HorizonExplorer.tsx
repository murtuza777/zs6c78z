import { useEffect, useMemo, useState } from 'react';

import { useHorizon, useMeta } from '../api/hooks';
import type { MetaResponse } from '../api/types';
import { EChart } from '../components/charts/EChart';
import { buildHorizonOption } from '../components/charts/horizonChart';
import { DateRangeFields } from '../components/controls/DateControls';
import { Card, ErrorState, LoadingState, StatTile } from '../components/ui/primitives';
import { useUrlPatch } from '../hooks/useUrlState';
import { fmtMW, fmtNumber, fmtPct, fmtSignedMW } from '../lib/format';
import { parseDateParam, parseNumberParam } from '../lib/params';
import { cx } from '../lib/cx';

export function HorizonExplorer() {
  const meta = useMeta();
  if (meta.isPending) return <LoadingState label="Loading scope…" />;
  if (meta.isError) return <ErrorState error={meta.error} onRetry={() => meta.refetch()} />;
  return <Explorer meta={meta.data} />;
}

function Explorer({ meta }: { meta: MetaResponse }) {
  const [params, patch] = useUrlPatch();
  const min = meta.delivery_date_min;
  const max = meta.delivery_date_max;
  const from = parseDateParam(params.get('from'), min, max, min);
  const to = parseDateParam(params.get('to'), from, max, max);
  const horizon = parseNumberParam(params.get('h'), 0, meta.horizon_h_max, 24);
  // Local slider state keeps dragging smooth; the URL (and query) update on release.
  const [draft, setDraft] = useState(horizon);
  useEffect(() => setDraft(horizon), [horizon]);
  const query = useHorizon(from, to, horizon);
  const option = useMemo(() => (query.data ? buildHorizonOption(query.data) : null), [query.data]);
  const m = query.data?.metrics;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Horizon Explorer</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Compare actual generation with the forecast that was at least <em>H</em> hours old at each
          target hour, independent of any market gate. Use it to see how accuracy decays with lead
          time.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3 rounded-xl border border-line bg-surface px-4 py-3">
        <DateRangeFields
          label="Delivery dates"
          from={from}
          to={to}
          min={min}
          max={max}
          onChange={(f, t) => patch({ from: f === min ? null : f, to: t === max ? null : t })}
        />
        <div className="min-w-[240px] flex-1">
          <label htmlFor="horizon" className="mb-1.5 flex justify-between text-xs text-ink-muted">
            <span>Minimum forecast lead time (H)</span>
            <span className="font-semibold text-ink tabular-nums">{draft} h</span>
          </label>
          <input
            id="horizon"
            type="range"
            min={0}
            max={meta.horizon_h_max}
            step={1}
            value={draft}
            onChange={(e) => setDraft(Number(e.target.value))}
            onPointerUp={() => patch({ h: String(draft) })}
            onKeyUp={() => patch({ h: String(draft) })}
            className="w-full accent-[#1aa0bf]"
          />
        </div>
      </div>

      {query.isPending && <LoadingState label="Selecting forecasts by lead time…" />}
      {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
      {query.data && option && m && (
        <div
          className={cx('space-y-4 transition-opacity', query.isPlaceholderData && 'opacity-60')}
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatTile emphasis label="MAE" value={fmtMW(m.mae_mw)} />
            <StatTile label="RMSE" value={fmtMW(m.rmse_mw)} />
            <StatTile label="Bias" value={fmtSignedMW(m.bias_mw)} />
            <StatTile label="WAPE" value={fmtPct(m.wape_pct)} />
            <StatTile
              label="Matched hours"
              value={`${fmtNumber(m.n_matched)}/${fmtNumber(m.n_expected)}`}
              detail={`${fmtPct(m.coverage_pct)} coverage`}
            />
          </div>
          <Card title="Actual vs forecast" subtitle={query.data.rule}>
            <EChart
              option={option}
              height={380}
              ariaLabel={`Actual and ${horizon} hour forecast`}
            />
          </Card>
        </div>
      )}
    </div>
  );
}
