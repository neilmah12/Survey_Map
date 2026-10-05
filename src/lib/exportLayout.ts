import type { Survey, ViewSettings } from '../types';
import { isFiltering, visibleUnits, kindContext, type UnitFilters } from './groups';
import { METRIC_LABEL } from './format';
import type { SummaryResult } from './summary';

/** All page geometry is in CSS pixels (96 per inch); the renderer scales to the chosen resolution. */
export type PageKind = 'letter-landscape' | 'letter-portrait' | 'slide';

export const PAGES: Record<PageKind, { label: string; wIn: number; hIn: number }> = {
  'letter-landscape': { label: 'Letter, landscape', wIn: 11, hIn: 8.5 },
  'letter-portrait': { label: 'Letter, portrait', wIn: 8.5, hIn: 11 },
  slide: { label: 'Slide, 16:9', wIn: 13.333, hIn: 7.5 },
};

export interface Box { x: number; y: number; w: number; h: number }

export interface Regions {
  page: { w: number; h: number };
  header: Box;
  map: Box;
  /** The summary and legend. Beside the map in landscape, under it in portrait; null when neither is wanted. */
  panel: Box | null;
  footer: Box;
}

const MARGIN = 24;
const GUTTER = 16;

export function pageRegions(kind: PageKind, wantsPanel: boolean): Regions {
  const { wIn, hIn } = PAGES[kind];
  const w = Math.round(wIn * 96);
  const h = Math.round(hIn * 96);
  const headerH = kind === 'slide' ? 72 : 84;
  const footerH = 34;
  const header: Box = { x: MARGIN, y: MARGIN, w: w - 2 * MARGIN, h: headerH };
  const footer: Box = { x: MARGIN, y: h - MARGIN - footerH, w: w - 2 * MARGIN, h: footerH };
  const top = header.y + header.h + 10;
  const bottom = footer.y - 8;

  if (kind === 'letter-portrait') {
    if (!wantsPanel) return { page: { w, h }, header, footer, panel: null, map: { x: MARGIN, y: top, w: w - 2 * MARGIN, h: bottom - top } };
    const mapH = Math.round((bottom - top) * 0.56);
    const map = { x: MARGIN, y: top, w: w - 2 * MARGIN, h: mapH };
    return { page: { w, h }, header, footer, map, panel: { x: MARGIN, y: top + mapH + GUTTER, w: w - 2 * MARGIN, h: bottom - (top + mapH + GUTTER) } };
  }
  const panelW = kind === 'slide' ? 400 : 340;
  if (!wantsPanel) return { page: { w, h }, header, footer, panel: null, map: { x: MARGIN, y: top, w: w - 2 * MARGIN, h: bottom - top } };
  const mapW = w - 2 * MARGIN - panelW - GUTTER;
  return {
    page: { w, h }, header, footer,
    map: { x: MARGIN, y: top, w: mapW, h: bottom - top },
    panel: { x: MARGIN + mapW + GUTTER, y: top, w: panelW, h: bottom - top },
  };
}

/** A scale bar length that reads well: 100 m, 200 m, 500 m, 1 km, 2 km, 5 km ... that fits in maxPx. */
export function niceScale(metersPerPx: number, maxPx: number): { meters: number; px: number; label: string } {
  const steps = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000];
  let best = steps[0];
  for (const s of steps) if (s / metersPerPx <= maxPx) best = s;
  return { meters: best, px: best / metersPerPx, label: best >= 1000 ? `${best / 1000} km` : `${best} m` };
}

export interface LegendItem {
  kind: 'subject' | 'comp' | 'excluded' | 'incentive' | 'rings';
  label: string;
}

/** Only the symbols that actually appear on the map. */
export function legendItems(survey: Survey, view: ViewSettings): LegendItem[] {
  const ctx = kindContext(survey);
  const shown = survey.buildings
    .filter((b) => b.lngLat)
    .map((b) => ({ b, units: visibleUnits(b, { filters: view.filters, ctx }) }))
    .filter((x) => x.units.length > 0);
  const items: LegendItem[] = [];
  if (shown.some((x) => x.b.isSubject)) items.push({ kind: 'subject', label: 'Subject property' });
  if (shown.some((x) => !x.b.isSubject)) items.push({ kind: 'comp', label: 'Comparable property' });
  if (shown.some((x) => x.b.excluded || x.units.every((u) => u.excluded))) items.push({ kind: 'excluded', label: 'Not counted in the averages' });
  if (shown.some((x) => x.units.some((u) => u.incentive))) items.push({ kind: 'incentive', label: 'Incentive offered' });
  if (view.rings && shown.some((x) => x.b.isSubject)) items.push({ kind: 'rings', label: `Distance from subject (${view.ringsKm.join(', ')} km)` });
  return items;
}

/** What each pin shows, in words. */
export function metricCaption(view: ViewSettings): string {
  const m = METRIC_LABEL[view.metric];
  return `Pins show ${m.toLowerCase()} per month; a range where a building has several suites.`;
}

/** "Bedrooms: 2 Beds, 2 + Den   Bathrooms: 1, 2", or '' when nothing is filtered. */
export function filterCaption(f: UnitFilters): string {
  if (!isFiltering(f)) return '';
  const parts: string[] = [];
  if (f.beds.length) parts.push(`Bedrooms: ${f.beds.join(', ')}`);
  if (f.baths.length) parts.push(`Bathrooms: ${f.baths.join(', ')}`);
  if (f.reno.length) parts.push(`Renovation: ${f.reno.join(', ')}`);
  return `Showing ${parts.join('; ')}`;
}

/** Wraps text to a width using a measuring function, breaking on spaces only. */
export function wrapText(text: string, maxW: number, measure: (s: string) => number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && measure(next) > maxW) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/** The footnote under the summary table. */
export function summaryFootnotes(result: SummaryResult, perBuilding: boolean, subjectCount: number): string[] {
  const out = [perBuilding ? 'Each building counts once, using its own average for that unit type.' : 'Every unit counts.'];
  if (subjectCount > 1) out.push(`The subject figure is the average of ${subjectCount} properties.`);
  if (result.excludedUnits > 0) out.push(`${result.excludedUnits} unit${result.excludedUnits === 1 ? ' is' : 's are'} switched off and not counted.`);
  return out;
}
