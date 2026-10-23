import { useCallback } from 'react';

import type { DecisionResponse } from '../api/types';
import { useDebouncedCommit } from '../hooks/useDebouncedCommit';
import { fmtGWh, fmtMW, fmtNumber, fmtUkTime } from '../lib/format';
import { DEMAND_MAX_MW, type ProcurementPlan, shortfallText } from '../lib/procurement';
import { Button, Card, StatTile, Tag } from './ui/primitives';

const inputClass =
  'w-36 rounded-md bg-raised px-2 py-1.5 text-sm text-ink ring-1 ring-inset ring-edge tabular-nums [color-scheme:dark] focus:outline-none focus:ring-accent/70';

interface Props {
  data: DecisionResponse;
  reveal: boolean;
  plan: ProcurementPlan | null;
  demand: string;
  share: string;
  onChange: (values: { demand?: string; share?: string }) => void;
}

/** Turns the wind forecast and its uncertainty into a volume to buy, for a demand you enter. */
export function ProcurementWhatIf({ data, reveal, plan, demand, share, onChange }: Props) {
  const commitDemand = useCallback((v: string) => onChange({ demand: v }), [onChange]);
  const commitShare = useCallback((v: string) => onChange({ share: v }), [onChange]);
  const [demandDraft, setDemandDraft] = useDebouncedCommit(demand, commitDemand, 400);
  const [shareDraft, setShareDraft] = useDebouncedCommit(share, commitShare, 400);
  const total = data.rows.length;

  return (
    <Card
      tone="decision"
      title="Procurement what-if: how much to buy beyond wind"
      subtitle="Enter the demand you must cover. WindDesk subtracts the wind you can count on, hour by hour, using only what was known at the gate."
    >
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <label className="text-xs text-ink-muted">
          <span className="mb-1.5 block">Your demand, MW (flat across the day)</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={DEMAND_MAX_MW}
            step={100}
            placeholder="e.g. 30000"
            value={demandDraft}
            onChange={(e) => setDemandDraft(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="text-xs text-ink-muted">
          <span className="mb-1.5 block">Share of national wind you can count on, %</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            step={1}
            value={shareDraft}
            onChange={(e) => setShareDraft(e.target.value)}
            className={inputClass}
          />
        </label>
        {!plan && (
          <Button
            onClick={() => setDemandDraft('30000')}
            aria-label="Try an example demand of 30,000 MW"
          >
            Try 30,000 MW
          </Button>
        )}
      </div>

      {plan ? (
        <>
          {plan.plannedHours < total && (
            <p className="mt-3 text-xs text-warning">
              The plan covers {plan.plannedHours} of {total} hours: no forecast was available for
              the rest at this gate.
            </p>
          )}
          <div
            className={`mt-4 grid grid-cols-2 gap-3 ${reveal ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}
          >
            <StatTile
              emphasis
              label="Buy if wind matches the forecast"
              value={fmtGWh(plan.forecastGwh)}
              detail={
                plan.peakForecastMw
                  ? `peak ${fmtMW(plan.peakForecastMw.mw)} at ${fmtUkTime(plan.peakForecastMw.start_time)} UK`
                  : undefined
              }
              hint="Sum over the delivery hours of demand − share × forecast (never below zero). This is the central case."
            />
            <StatTile
              label="Buy to cover low wind (P10)"
              value={fmtGWh(plan.lowWindGwh)}
              detail={
                plan.peakLowWindMw
                  ? `peak ${fmtMW(plan.peakLowWindMw.mw)} at ${fmtUkTime(plan.peakLowWindMw.start_time)} UK`
                  : 'hourly P10 band unavailable'
              }
              hint="Same sum using the hourly P10 wind: in about 9 of 10 similar January hours at least this much wind arrived. Pilot calibration, not a guarantee."
            />
            <StatTile
              label="Extra cover for uncertainty"
              value={fmtGWh(plan.uncertaintyCoverGwh)}
              detail="low-wind plan − forecast plan"
              hint="How much more you would buy to be covered in the low-wind case. This is what the forecast error costs you in volume."
            />
            {reveal && (
              <StatTile
                label="Actually needed"
                value={fmtGWh(plan.actualNeedGwh)}
                detail={`forecast plan ${shortfallText(plan.shortfallForecastGwh)} · P10 plan ${shortfallText(plan.shortfallLowWindGwh)}`}
                hint="Hindsight: demand − share × actual wind over the same hours. 'Short' means the plan bought too little and the gap had to be covered later (intraday or imbalance)."
              />
            )}
          </div>
          {reveal && (
            <div className="mt-2">
              <Tag tone="hindsight">
                “Actually needed” is hindsight, not available at decision time
              </Tag>
            </div>
          )}
        </>
      ) : (
        <p className="mt-3 text-sm text-ink-muted">
          Enter a demand to see the volume to buy if wind arrives as forecast and in a low-wind
          case, for each of the {fmtNumber(total)} delivery hours.
        </p>
      )}

      <p className="mt-3 text-xs text-ink-muted">
        Illustrative: demand and wind share are your inputs. WindDesk has no demand, contract or
        price data and does not recommend trades.
      </p>
    </Card>
  );
}
