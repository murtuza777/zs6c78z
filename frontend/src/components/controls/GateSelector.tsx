import { useState } from 'react';

import type { GatePreset } from '../../api/types';
import { isValidGate } from '../../lib/params';

const CUSTOM = 'custom';
const control =
  'rounded-md bg-raised px-2 py-1.5 text-sm text-ink ring-1 ring-inset ring-edge [color-scheme:dark] focus:outline-none focus:ring-accent/70';

interface Props {
  presets: GatePreset[];
  value: string;
  onChange: (gate: string) => void;
}

/** Gate-closure time (UK): an exchange preset or a custom HH:MM. */
export function GateSelector({ presets, value, onChange }: Props) {
  const isPreset = presets.some((p) => p.gate === value);
  const [custom, setCustom] = useState(!isPreset);
  const showCustom = custom || !isPreset;

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="gate" className="whitespace-nowrap text-xs text-ink-muted">
        Gate closure
      </label>
      <select
        id="gate"
        className={control}
        value={showCustom ? CUSTOM : value}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true);
          } else {
            setCustom(false);
            onChange(e.target.value);
          }
        }}
      >
        {presets.map((p) => (
          <option key={p.id} value={p.gate}>
            {p.gate} · {p.label}
          </option>
        ))}
        <option value={CUSTOM}>Custom time…</option>
      </select>
      {showCustom && (
        <input
          type="time"
          step={60}
          aria-label="Custom gate closure time, UK"
          value={value}
          onChange={(e) => isValidGate(e.target.value) && onChange(e.target.value)}
          className={control}
        />
      )}
    </div>
  );
}
