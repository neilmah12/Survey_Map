import type { Metric } from '../types';
import { formatMetric } from './format';
import type { Party, SummaryRow } from './summary';

/** Shared by the summary panel and the exported page, so they print exactly the same figures. */
export const fmtValue = (p: Party, m: Metric) => (p.value == null ? '-' : formatMetric(p.value, m));

export function fmtDiff(r: SummaryRow, m: Metric): string {
  if (r.diff == null) return '-';
  const sign = r.diff > 0 ? '+' : r.diff < 0 ? '-' : '';
  const pct = r.diffPct == null ? '' : ` (${sign}${Math.abs(r.diffPct * 100).toFixed(1)}%)`;
  return `${sign}${formatMetric(Math.abs(r.diff), m)}${pct}`;
}
