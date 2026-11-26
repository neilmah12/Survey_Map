import type { Metric, Survey, ViewSettings } from '../types';
import { availableMetrics } from './choose';
import { metricValue } from './format';
import { kindContext, visibleUnits } from './groups';
import { netOf } from './net';
import { pinNumbers } from './pinNumbers';
import { scopeSurvey } from './scope';
import { computeSummary } from './summary';

/**
 * The figures behind the PDF report's data pages, kept apart from the drawing so they can be tested: the market
 * and the subject for every rent type side by side, a plain-language line for each unit type, and a
 * building-by-building list. It follows the same scope as the map (the subject being compared, the distance, anything
 * switched off), so the report can never disagree with the screen.
 */

export interface ReportCell {
  market: number | null;
  subject: number | null;
  /** Subject against the market, as a fraction (0.05 is 5% above). */
  diffPct: number | null;
}

export interface ReportRow {
  label: string;
  /** Buildings (or units, when each unit counts) behind the market figure, from the base rent column. */
  comps: number;
  cells: Partial<Record<Metric, ReportCell>>;
}

export interface Report {
  /** The rent types that can be shown, in order. Net rent only when something changes a rent. */
  metrics: Metric[];
  rows: ReportRow[];
  hasSubject: boolean;
  marketBuildings: number;
}

export function buildReport(survey: Survey, view: ViewSettings): Report {
  const scoped = scopeSurvey(survey, view);
  const avail = availableMetrics(scoped);
  // Net rent only earns a column when it can differ from base rent: it is on, and something counts toward it.
  const n = netOf(scoped);
  const netDiffers = n.enabled && (n.parking || n.utilities || n.incentives || n.misc);
  const metrics = (['rate', 'psf', 'net'] as Metric[]).filter((m) => avail[m] && (m !== 'net' || netDiffers));
  const rows = new Map<string, ReportRow>();
  let hasSubject = false;
  let marketBuildings = 0;
  for (const m of metrics) {
    const r = computeSummary(scoped, { metric: m, filters: view.filters, settings: view.summary });
    hasSubject = r.hasSubject;
    if (m === 'rate') marketBuildings = r.marketBuildings;
    for (const row of r.rows) {
      const into = rows.get(row.key) ?? { label: row.label, comps: 0, cells: {} };
      into.cells[m] = { market: row.market.value, subject: row.subject.value, diffPct: row.diffPct };
      if (m === 'rate') into.comps = row.market.n;
      rows.set(row.key, into);
    }
  }
  const list = [...rows.values()];
  return { metrics, rows: list, hasSubject, marketBuildings };
}

export interface ReportUnit {
  type: string;
  sf: number | null;
  rate: number | null;
  psf: number | null;
  net: number | null;
  incentive: string;
}

export interface ReportBuilding {
  id: string;
  num?: number;
  name: string;
  isSubject: boolean;
  /** Kilometres from the subject being compared. */
  distKm?: number;
  /** False when the building is switched off. */
  counted: boolean;
  units: ReportUnit[];
}

/** The subject first, then the comparables nearest first. Buildings beyond the chosen distance are left out. */
export function reportBuildings(survey: Survey, view: ViewSettings): ReportBuilding[] {
  const scoped = scopeSurvey(survey, view);
  const ctx = kindContext(scoped);
  const net = netOf(scoped);
  const numbers = pinNumbers(scoped.buildings);
  const rows: ReportBuilding[] = [];
  for (const b of scoped.buildings) {
    if (!b.lngLat || b.out) continue;
    const units = visibleUnits(b, { filters: view.filters, ctx });
    if (units.length === 0) continue;
    rows.push({
      id: b.id,
      num: numbers.get(b.id),
      name: b.name,
      isSubject: b.isSubject,
      distKm: b.distKm,
      counted: !b.excluded,
      units: units.map((u) => ({
        type: u.type,
        sf: u.sf,
        rate: u.rate,
        psf: metricValue(u, 'psf', net),
        net: metricValue(u, 'net', net),
        incentive: u.incentive,
      })),
    });
  }
  return rows.sort((a, b) => (a.isSubject === b.isSubject ? (a.num ?? 9999) - (b.num ?? 9999) : a.isSubject ? -1 : 1));
}
