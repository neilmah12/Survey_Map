import type { Metric, Stat, Survey, SummarySettings } from '../types';
import { groupLabel, groupSortKey, kindContext, visibleUnits, type UnitFilters } from './groups';
import { metricValue } from './format';

export interface Party {
  /** The average or median, or null when nothing in the group has a value. */
  value: number | null;
  /** Buildings (or units, when each unit counts) behind the value. */
  n: number;
}

export interface SummaryRow {
  key: string;
  label: string;
  market: Party;
  subject: Party;
  /** Subject minus market, and as a share of the market figure. */
  diff: number | null;
  diffPct: number | null;
}

export interface SummaryResult {
  rows: SummaryRow[];
  /** Everything at once, regardless of unit type. */
  total: SummaryRow;
  hasSubject: boolean;
  marketBuildings: number;
  subjectBuildings: number;
  /** Units that would have counted but are switched off. */
  excludedUnits: number;
  excludedBuildings: number;
}

export interface SummaryOptions {
  metric: Metric;
  filters: UnitFilters;
  settings: SummarySettings;
  /** Pivot-style: count the subject with the market. Off by default, so the two can be compared. */
  subjectInMarket?: boolean;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const stat = (xs: number[], how: Stat): number => (how === 'median' ? median(xs) : mean(xs));

/** buildingId -> the metric values of its counted units. */
type Bucket = Map<string, number[]>;

function party(b: Bucket, how: Stat, perBuilding: boolean): Party {
  if (b.size === 0) return { value: null, n: 0 };
  if (perBuilding) {
    const per = [...b.values()].map(mean); // a building's own average first, so each building counts once
    return { value: stat(per, how), n: per.length };
  }
  const all = [...b.values()].flat();
  return { value: stat(all, how), n: all.length };
}

function row(key: string, label: string, market: Bucket, subject: Bucket, o: SummaryOptions): SummaryRow {
  const m = party(market, o.settings.stat, o.settings.perBuilding);
  const s = party(subject, o.settings.stat, o.settings.perBuilding);
  const diff = m.value != null && s.value != null ? s.value - m.value : null;
  return { key, label, market: m, subject: s, diff, diffPct: diff != null && m.value ? diff / m.value : null };
}

/**
 * Market versus subject by unit type. Units are first narrowed by the unit filters, then anything
 * switched off (a building or a single suite) is left out. The market is the buildings that are not
 * the subject, so a subject is never compared with itself.
 */
export function computeSummary(survey: Survey, o: SummaryOptions): SummaryResult {
  const ctx = kindContext(survey);
  const dims = o.settings.split;
  const filter = { filters: o.filters, ctx };

  const market = new Map<string, Bucket>();
  const subject = new Map<string, Bucket>();
  const sortKeys = new Map<string, string>();
  const allMarket: Bucket = new Map();
  const allSubject: Bucket = new Map();
  let excludedUnits = 0;
  const excludedBuildings = new Set<string>();
  const marketIds = new Set<string>();
  const subjectIds = new Set<string>();

  const push = (b: Bucket, id: string, v: number) => b.set(id, [...(b.get(id) ?? []), v]);

  for (const b of survey.buildings) {
    const asSubject = b.isSubject && !o.subjectInMarket;
    for (const u of visibleUnits(b, filter)) {
      if (b.excluded || u.excluded) {
        excludedUnits++;
        if (b.excluded) excludedBuildings.add(b.id);
        continue;
      }
      const v = metricValue(u, o.metric);
      if (v == null) continue;
      const key = groupLabel(u, b, dims, ctx);
      if (!sortKeys.has(key)) sortKeys.set(key, groupSortKey(u, b, dims, ctx));
      const side = asSubject ? subject : market;
      if (!side.has(key)) side.set(key, new Map());
      push(side.get(key)!, b.id, v);
      push(asSubject ? allSubject : allMarket, b.id, v);
      (asSubject ? subjectIds : marketIds).add(b.id);
    }
  }

  const keys = [...sortKeys.keys()].sort((a, b) => (sortKeys.get(a)! < sortKeys.get(b)! ? -1 : sortKeys.get(a)! > sortKeys.get(b)! ? 1 : a.localeCompare(b)));
  const empty: Bucket = new Map();
  return {
    rows: keys.map((k) => row(k, k, market.get(k) ?? empty, subject.get(k) ?? empty, o)),
    total: row('__all__', 'All unit types', allMarket, allSubject, o),
    hasSubject: survey.buildings.some((b) => b.isSubject),
    marketBuildings: marketIds.size,
    subjectBuildings: subjectIds.size,
    excludedUnits,
    excludedBuildings: excludedBuildings.size,
  };
}
