import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Patch URL search params in place (replace history) so every view is shareable. */
export function useUrlPatch() {
  const [params, setParams] = useSearchParams();
  const patch = useCallback(
    (values: Record<string, string | null>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(values)) {
            if (value === null) next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [params, patch] as const;
}
