import { useState } from 'react';

import type { GatePreset } from '../../api/types';
import { isValidGate } from '../../lib/params';
import { cx } from '../../lib/cx';

interface Props {
  presets: GatePreset[];
  value: string;
  onChange: (gate: string) => void;
}

/** Market gate-closure scenario: documented presets or a custom UK-local time. */
export function GateSelector({ presets, value, onChange }: Props) {
  const isPreset = presets.some((p) => p.gate === value);
  const [customOpen, setCustomOpen] = useState(!isPreset);
  const showCustom = customOpen || !isPreset;

  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-xs text-ink-muted">Gate closure scenario (UK time)</legend>
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup">
        {presets.map((preset) => {
          const active = preset.gate === value && !customOpen;
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={active}
              title={`${preset.description} Source: ${preset.source} (verified ${preset.verified_on}).`}
              onClick={() => {
                setCustomOpen(false);
                onChange(preset.gate);
              }}
              className={cx(
                'rounded-md px-2.5 py-1.5 text-xs ring-1 ring-inset transition-colors',
                active
                  ? 'bg-accent-soft text-ink ring-accent/60'
                  : 'bg-raised text-ink-secondary ring-edge hover:text-ink',
              )}
            >
              <span className="font-semibold tabular-nums">{preset.gate}</span>{' '}
              <span className="hidden sm:inline">{preset.label}</span>
              <span className="sm:hidden">{preset.id.toUpperCase()}</span>
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={showCustom}
          onClick={() => setCustomOpen(true)}
          className={cx(
            'rounded-md px-2.5 py-1.5 text-xs ring-1 ring-inset',
            showCustom
              ? 'bg-accent-soft text-ink ring-accent/60'
              : 'bg-raised text-ink-secondary ring-edge hover:text-ink',
          )}
        >
          Custom
        </button>
        {showCustom && (
          <input
            type="time"
            step={60}
            aria-label="Custom gate closure time, UK local"
            value={value}
            onChange={(e) => isValidGate(e.target.value) && onChange(e.target.value)}
            className="rounded-md bg-raised px-2 py-1 text-xs text-ink ring-1 ring-inset ring-edge [color-scheme:dark]"
          />
        )}
      </div>
    </fieldset>
  );
}
