import type { Metric, Stat, Survey, SummarySettings } from '../types';
import { groupLabel, groupSortKey, kindContext, visibleUnits, type UnitFilters } from './groups';
import { metricValue } from './format';
import { netOf } from './net';

export interface Party {
  /** The average or median, or null when nothing in the group has a value. */
  value: number | null;
  /** Buildings (or units, when each unit counts) behind the value. */
  n: number;
}

/** One comparable building's own figure for a row (the dot on the chart). */
export interface CompValue {
  id: string;
  name: string;
  value: number;
  /** How many of the building's suites are averaged into the value. */
  units: number;
}

export interface SummaryRow {
  key: string;
  label: string;
  market: Party;
  subject: Party;
  /** Each comparable building's own average for this row. */
  comps: CompValue[];
  /** Net rent view only: the same market and subject before parking, utilities, incentives and misc. */
  marketBase: number | null;
  subjectBase: number | null;
  /** Subject minus market, and as a share of the market figure. */
  diff: number | null;
  diffPct: number | null;
}

export interface SummaryResult {
  rows: SummaryRow[];
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

interface Extras {
  baseMarket?: Bucket;
  baseSubject?: Bucket;
  names: Map<string, string>;
}

function row(key: string, label: string, market: Bucket, subject: Bucket, o: SummaryOptions, x: Extras): SummaryRow {
  const m = party(market, o.settings.stat, o.settings.perBuilding);
  const s = party(subject, o.settings.stat, o.settings.perBuilding);
  const diff = m.value != null && s.value != null ? s.value - m.value : null;
  const base = (b?: Bucket) => (b && b.size ? party(b, o.settings.stat, o.settings.perBuilding).value : null);
  return {
    key, label, market: m, subject: s,
    comps: [...market].map(([id, vals]) => ({ id, name: x.names.get(id) ?? '', value: mean(vals), units: vals.length })),
    marketBase: base(x.baseMarket),
    subjectBase: base(x.baseSubject),
    diff, diffPct: diff != null && m.value ? diff / m.value : null,
  };
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
  const net = netOf(survey);

  const market = new Map<string, Bucket>();
  const subject = new Map<string, Bucket>();
  const sortKeys = new Map<string, string>();
  // For net rent, the same units' base rent, so the chart can show what the extras and incentives did.
  const baseMarket = new Map<string, Bucket>();
  const baseSubject = new Map<string, Bucket>();
  const names = new Map(survey.buildings.map((b) => [b.id, b.name] as const));
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
      const v = metricValue(u, o.metric, net);
      if (v == null) continue;
      const key = groupLabel(u, b, dims, ctx);
      if (!sortKeys.has(key)) sortKeys.set(key, groupSortKey(u, b, dims, ctx));
      const side = asSubject ? subject : market;
      if (!side.has(key)) side.set(key, new Map());
      push(side.get(key)!, b.id, v);
      if (o.metric === 'net' && u.rate != null) {
        const baseSide = asSubject ? baseSubject : baseMarket;
        if (!baseSide.has(key)) baseSide.set(key, new Map());
        push(baseSide.get(key)!, b.id, u.rate);
      }
      (asSubject ? subjectIds : marketIds).add(b.id);
    }
  }

  const keys = [...sortKeys.keys()].sort((a, b) => (sortKeys.get(a)! < sortKeys.get(b)! ? -1 : sortKeys.get(a)! > sortKeys.get(b)! ? 1 : a.localeCompare(b)));
  const empty: Bucket = new Map();
  return {
    rows: keys.map((k) => row(k, k, market.get(k) ?? empty, subject.get(k) ?? empty, o, { baseMarket: baseMarket.get(k), baseSubject: baseSubject.get(k), names })),
    hasSubject: survey.buildings.some((b) => b.isSubject),
    marketBuildings: marketIds.size,
    subjectBuildings: subjectIds.size,
    excludedUnits,
    excludedBuildings: excludedBuildings.size,
  };
}
