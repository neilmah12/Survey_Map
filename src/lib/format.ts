import type { Building, Metric, Unit } from '../types';
import { visibleUnits, type UnitFilter } from './groups';
import { parseCharge } from './parse';

export const money = (n: number) => `$${Math.round(n).toLocaleString('en-CA')}`;
export const psf = (n: number) => `$${n.toFixed(2)}`;

export function unitPsf(u: Unit): number | null {
  return u.rate != null && u.sf ? u.rate / u.sf : null;
}

/** Net rent: the sheet's value if present, else base rent plus a dollar parking charge. */
export function unitNet(u: Unit): number | null {
  if (u.netRate != null) return u.netRate;
  const parking = parseCharge(u.parking);
  return u.rate != null && parking ? u.rate + parking : null;
}

export function metricValue(u: Unit, m: Metric): number | null {
  return m === 'rate' ? u.rate : m === 'psf' ? unitPsf(u) : unitNet(u);
}

export const METRIC_LABEL: Record<Metric, string> = {
  rate: 'Base rent',
  psf: 'Rent PSF',
  net: 'Net rent',
};

export function formatMetric(v: number, m: Metric): string {
  return m === 'psf' ? psf(v) : money(v);
}

/** Pin label: a single value or "min - max" over the visible units. */
export function pinLabel(b: Building, f: UnitFilter, m: Metric): string {
  const vals = visibleUnits(b, f)
    .map((u) => metricValue(u, m))
    .filter((v): v is number => v != null);
  if (vals.length === 0) return 'n/a';
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  return lo === hi ? formatMetric(lo, m) : `${formatMetric(lo, m)} - ${formatMetric(hi, m)}`;
}

/** Accepts "53.5461, -113.4938" (Google Maps copy format) and returns [lng, lat]. */
export function parseLatLng(s: string): [number, number] | null {
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lng, lat] : null;
}
