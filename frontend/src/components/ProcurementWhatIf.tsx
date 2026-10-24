import { useCallback } from 'react';

import { useDebouncedCommit } from '../hooks/useDebouncedCommit';
import { fmtGWh, fmtMW, fmtUkTime } from '../lib/format';
import { DEMAND_MAX_MW, type ProcurementPlan, shortfallText } from '../lib/procurement';
import { Card } from './ui/primitives';

const inputClass =
  'w-28 rounded-md bg-raised px-2 py-1.5 text-sm text-ink ring-1 ring-inset ring-edge tabular-nums [color-scheme:dark] focus:outline-none focus:ring-accent/70';

interface Props {
  plan: ProcurementPlan | null;
  totalHours: number;
  reveal: boolean;
  demand: string;
  share: string;
  onChange: (values: { demand?: string; share?: string }) => void;
}

/** Demand minus the wind you can count on, hour by hour: the volume left to buy. */
export function ProcurementWhatIf({ plan, totalHours, reveal, demand, share, onChange }: Props) {
  const commitDemand = useCallback((v: string) => onChange({ demand: v }), [onChange]);
  const commitShare = useCallback((v: string) => onChange({ share: v }), [onChange]);
  const [demandDraft, setDemandDraft] = useDebouncedCommit(demand, commitDemand, 400);
  const [shareDraft, setShareDraft] = useDebouncedCommit(share, commitShare, 400);

  return (
    <Card title="Buy beyond wind">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-secondary">
        <label className="flex items-center gap-2">
          Demand
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={DEMAND_MAX_MW}
            step={500}
            placeholder="MW"
            value={demandDraft}
            onChange={(e) => setDemandDraft(e.target.value)}
            className={inputClass}
          />
          MW, flat
        </label>
        <label className="flex items-center gap-2">
          Wind you count on
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            step={5}
            value={shareDraft}
            onChange={(e) => setShareDraft(e.target.value)}
            className={`${inputClass} w-20`}
          />
          % of GB wind
        </label>
      </div>

      {plan ? (
        <div className="mt-4 space-y-1.5 text-sm text-ink-secondary" aria-live="polite">
          <p>
            <strong className="text-lg font-semibold text-ink">{fmtGWh(plan.forecastGwh)}</strong>{' '}
            if wind arrives as forecast
            {plan.lowWindGwh != null && (
              <>
                {' · '}
                <strong className="text-lg font-semibold text-ink">
                  {fmtGWh(plan.lowWindGwh)}
                </strong>{' '}
                to cover the low-wind case (P10)
              </>
            )}
          </p>
          <p className="text-ink-muted">
            {plan.uncertaintyCoverGwh != null &&
              `Forecast uncertainty adds ${fmtGWh(plan.uncertaintyCoverGwh)}. `}
            {plan.peakLowWindMw
              ? `Largest hourly need ${fmtMW(plan.peakLowWindMw.mw)} at ${fmtUkTime(plan.peakLowWindMw.start_time)}.`
              : plan.peakForecastMw &&
                `Largest hourly need ${fmtMW(plan.peakForecastMw.mw)} at ${fmtUkTime(plan.peakForecastMw.start_time)}.`}
            {plan.plannedHours < totalHours &&
              ` Covers the ${plan.plannedHours} of ${totalHours} hours that have a forecast.`}
          </p>
          {reveal && plan.actualNeedGwh != null && (
            <p>
              <span className="text-actual">Hindsight:</span> actually needed{' '}
              <strong className="text-ink">{fmtGWh(plan.actualNeedGwh)}</strong>. Buying on the
              forecast left you {shortfallText(plan.shortfallForecastGwh)}
              {plan.shortfallLowWindGwh != null &&
                `; the low-wind plan was ${shortfallText(plan.shortfallLowWindGwh)}`}
              .
            </p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-muted">
          Enter the demand you have to cover to see how much to buy on top of wind.
        </p>
      )}
    </Card>
  );
}
