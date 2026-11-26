import type { Metric, Survey, ViewSettings } from '../types';
import { METRIC_LABEL } from './format';
import { netAvailable } from './net';
import { fmtKm } from './scope';
import { NO_FILTERS, isFiltering, kindContext, visibleUnits, type UnitFilters } from './groups';

/**
 * The logic behind "Choose what to compare": what can be chosen, what each choice would show, and the one
 * sentence that says what is being shown now. Kept apart from the screen so it can be tested.
 */

/** Only offer a measure the data can show: no net rent without parking, utilities, incentive or misc amounts, no PSF without SF. */
export function availableMetrics(survey: Pick<Survey, 'buildings' | 'net'>): Record<Metric, boolean> {
  const units = survey.buildings.flatMap((b) => b.units);
  return { rate: true, psf: units.some((u) => u.rate != null && u.sf), net: netAvailable(survey) };
}

/** The filters in the order they are offered, with the plain words used for them. */
export const FILTER_SECTIONS: { k: keyof UnitFilters; label: string; all: string }[] = [
  { k: 'beds', label: 'Bedrooms', all: 'All bedrooms' },
  { k: 'baths', label: 'Bathrooms', all: 'All bathrooms' },
  { k: 'kind', label: 'Property type', all: 'All types' },
  { k: 'reno', label: 'Renovation', all: 'All levels' },
  { k: 'utils', label: 'Utilities', all: 'All' },
];

/**
 * How many comparable buildings would still show if this option were chosen, given the other choices already
 * made. Choosing within one filter adds (it is "or"), so the filter's own current choice is ignored. The subject
 * is not counted: it is not part of the market.
 */
export function optionCount(survey: Survey, filters: UnitFilters, k: keyof UnitFilters, value: string): number {
  const ctx = kindContext(survey);
  const f: UnitFilters = { ...filters, [k]: [value] };
  return survey.buildings.filter((b) => !b.isSubject && !b.out && b.lngLat && visibleUnits(b, { filters: f, ctx }).length > 0).length;
}

/** Comparable buildings with at least one suite that matches the filters and the distance, and how many there are in all. */
export function matching(survey: Survey, filters: UnitFilters): { shown: number; total: number } {
  const ctx = kindContext(survey);
  const placed = survey.buildings.filter((b) => b.lngLat && !b.isSubject); // comparables only: a subject is not part of the market
  return { shown: placed.filter((b) => !b.out && visibleUnits(b, { filters, ctx }).length > 0).length, total: placed.length };
}

const list = (xs: string[]) => xs.join(' or ');

/**
 * How many comparable buildings sit within this distance of the subject, given the unit filters already chosen.
 * Needs the scoped survey (it carries each building's distance).
 */
export function withinCount(survey: Survey, filters: UnitFilters, km: number): number {
  const ctx = kindContext(survey);
  return survey.buildings.filter((b) => !b.isSubject && b.lngLat && b.distKm != null && b.distKm <= km && visibleUnits(b, { filters, ctx }).length > 0).length;
}

/**
 * The sentence that says what is on screen, in pieces so the screen can bold them: the rent measure, what is
 * being looked at, and how many buildings that leaves. "Showing base rent for 2 Beds, in 4 of 5 buildings".
 */
export function viewSentence(view: ViewSettings, shown: number, total: number): { rent: string; what: string; near: string; where: string } {
  const f = view.filters;
  const bits: string[] = [];
  if (f.beds.length) bits.push(list(f.beds));
  if (f.baths.length) bits.push(`${list(f.baths)} bath`);
  if (f.kind.length) bits.push(list(f.kind));
  if (f.reno.length) bits.push(list(f.reno));
  if (f.utils.length) bits.push(`utilities ${list(f.utils).toLowerCase()}`);
  return {
    rent: METRIC_LABEL[view.metric].toLowerCase(),
    what: bits.length ? bits.join(', ') : 'all unit types',
    near: view.within != null && view.within > 0 ? ` within ${fmtKm(view.within)} of the subject` : '',
    where: `${shown} of ${total} building${total === 1 ? '' : 's'}`,
  };
}

/** True when nothing has been chosen, so there is nothing to reset. */
export const isDefaultChoice = (view: ViewSettings): boolean => view.metric === 'rate' && !isFiltering(view.filters) && !view.rings && !(view.within != null && view.within > 0);

/** Back to where a visitor starts: base rent, every unit type, no rings, any distance. The summary's own settings are left alone. */
export const resetChoice = (view: ViewSettings): ViewSettings => ({ ...view, metric: 'rate', filters: NO_FILTERS, rings: false, within: null });

/** How many choices are active, for a badge: a measure other than base rent, each filter with a selection, rings. */
export function activeChoices(view: ViewSettings): number {
  const f = view.filters;
  return (view.metric !== 'rate' ? 1 : 0) + [f.beds, f.baths, f.kind, f.reno, f.utils].filter((x) => x.length > 0).length + (view.rings ? 1 : 0) + (view.within != null && view.within > 0 ? 1 : 0);
}

/** The choices that narrow the figures, as short labels for the "applied" strip over the summary. Empty when nothing narrows them. */
export function appliedPills(view: ViewSettings): string[] {
  const f = view.filters;
  const pills = [...f.beds, ...f.baths.map((x) => `${x} bath`), ...f.kind, ...f.reno, ...f.utils.map((x) => `Utilities ${x.toLowerCase()}`)];
  if (view.within != null && view.within > 0) pills.push(`Within ${fmtKm(view.within)}`);
  return pills;
}
