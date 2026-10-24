import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from './client';

// Historical data is immutable per snapshot, so cached results never go stale.
const immutable = { staleTime: Infinity, gcTime: 30 * 60 * 1000 } as const;

export const useMeta = () => useQuery({ queryKey: ['meta'], queryFn: api.meta, ...immutable });

export const useDecision = (date: string, gate: string) =>
  useQuery({
    queryKey: ['decision', date, gate],
    queryFn: () => api.decision(date, gate),
    placeholderData: keepPreviousData,
    ...immutable,
  });

export const useAccuracy = (from: string, to: string, gate: string) =>
  useQuery({
    queryKey: ['accuracy', from, to, gate],
    queryFn: () => api.accuracy(from, to, gate),
    placeholderData: keepPreviousData,
    ...immutable,
  });
