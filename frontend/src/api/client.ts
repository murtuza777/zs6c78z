import type { AccuracyResponse, DecisionResponse, MetaResponse, Problem } from './types';

const BASE = `${import.meta.env.VITE_API_BASE ?? ''}/api/v1`;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem | null,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function getJson<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const query = params
    ? `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`
    : '';
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}${query}`, { headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiError(0, null, 'Could not reach the WindDesk API. Check your connection.');
  }
  if (!response.ok) {
    let problem: Problem | null = null;
    try {
      problem = (await response.json()) as Problem;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(
      response.status,
      problem,
      problem?.detail ?? `Request failed with HTTP ${response.status}`,
    );
  }
  return (await response.json()) as T;
}

export const api = {
  meta: () => getJson<MetaResponse>('/meta'),
  decision: (date: string, gate: string) =>
    getJson<DecisionResponse>(`/decisions/${date}`, { gate }),
  accuracy: (from: string, to: string, gate: string) =>
    getJson<AccuracyResponse>('/accuracy', { from, to, gate }),
};
