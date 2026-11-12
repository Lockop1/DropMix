/** Nearest-rank percentile of `values` (0 < p ≤ 100). `null` for an empty list. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? null;
}

export interface RttSummary {
  last: number | null;
  p50: number | null;
  p95: number | null;
  n: number;
}

export function summarize(samples: readonly number[]): RttSummary {
  return {
    last: samples.at(-1) ?? null,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    n: samples.length,
  };
}

export function formatMs(ms: number | null): string {
  return ms === null ? '–' : `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;
}
