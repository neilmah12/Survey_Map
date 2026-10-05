import type { Building, Survey, Unit } from '../types';
import { parseBeds } from './unitText';

/**
 * Unit filters. Each detail (bedrooms, bathrooms, renovation) is its own multi-select;
 * choices within one detail are OR, and the details combine with AND. An empty selection means "any".
 */
export interface UnitFilters {
  beds: string[];
  baths: string[];
  reno: string[];
}
export const NO_FILTERS: UnitFilters = { beds: [], baths: [], reno: [] };

export const BED_CATS = ['Studio', '1 Bed', '1 + Den', '2 Beds', '2 + Den', '3 Beds', '3 + Den', '4+'] as const;
export const BATH_CATS = ['1', '1.5', '2', '2.5', '3+'] as const;

export type Kind = 'Townhome' | 'Apartment';

const TOWNHOME = /town\s?home|townhouse/i;
const DEN = /\bden\b/i;
const RENO_WORD = /\b(basic|partial|full|original|un-?renovated|renovated|reno|upgraded|updated|classic|premium)\b/i;

export function unitBeds(u: Unit): number | null {
  const n = parseBeds(u.type);
  if (n != null) return n;
  const m = u.type.match(/^\s*(\d+)\s*\+\s*den/i); // "1 + Den" without the word bed
  if (m) return parseInt(m[1], 10);
  return u.beds ?? null;
}

export const unitHasDen = (u: Unit): boolean => DEN.test(u.type);

/** Bedroom category as shown on the filter chips, for example "1 + Den" or "4+". */
export function unitBedCat(u: Unit): string | null {
  const n = unitBeds(u);
  if (n == null) return null;
  if (n === 0) return 'Studio';
  if (n >= 4) return '4+';
  const den = unitHasDen(u);
  if (n === 1) return den ? '1 + Den' : '1 Bed';
  return `${n}${den ? ' + Den' : n === 1 ? ' Bed' : ' Beds'}`;
}

export function unitBaths(u: Unit): number | null {
  const m = u.type.match(/(\d+(?:\.\d+)?)\s*-?\s*bath/i);
  if (m) return parseFloat(m[1]);
  return unitBeds(u) === 0 ? 1 : null; // a studio has one bathroom even when the sheet does not say so
}

/** Bathroom category as shown on the filter chips: 1, 1.5, 2, 2.5 or 3+. */
export function unitBathCat(u: Unit): string | null {
  const n = unitBaths(u);
  if (n == null) return null;
  if (n >= 3) return '3+';
  if (n <= 1) return '1';
  return String(n);
}

/** Renovation level, read from a trailing " - Partial Reno" style segment. */
export function unitReno(u: Unit): string | null {
  const parts = u.type.split(/\s+-\s+/);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1].trim();
  return RENO_WORD.test(last) ? last.replace(/\s+/g, ' ') : null;
}

export interface KindContext {
  title: string;
  /** True when at least one unit or building is explicitly a townhome. */
  anyTownhome: boolean;
}

function explicitKind(u: Unit | null, b: Building): Kind | null {
  if (b.propertyType) return b.propertyType;
  if (u && /^\s*(th\b|town\s?home|townhouse)/i.test(u.type)) return 'Townhome';
  if (u && /^\s*(apt\b|apartment)/i.test(u.type)) return 'Apartment';
  if (TOWNHOME.test(b.name)) return 'Townhome';
  return null;
}

export function kindContext(s: Survey): KindContext {
  return {
    title: s.title,
    anyTownhome: s.buildings.some((b) => explicitKind(null, b) === 'Townhome' || b.units.some((u) => explicitKind(u, b) === 'Townhome')),
  };
}

/**
 * Townhome or apartment for a unit. Order: the building's own setting, a marker in the unit type
 * ("TH 2 Bedroom"), the building name, the survey title, then (if the survey mixes both) apartment.
 * Returns null when nothing indicates a type. Used only to decide whether Stacked / non-stacked shows.
 */
export function unitKind(u: Unit, b: Building, ctx: KindContext): Kind | null {
  const explicit = explicitKind(u, b);
  if (explicit) return explicit;
  if (TOWNHOME.test(ctx.title)) return 'Townhome';
  if (/apartment/i.test(ctx.title)) return 'Apartment';
  return ctx.anyTownhome ? 'Apartment' : null;
}

export interface UnitFilter {
  filters: UnitFilters;
  ctx: KindContext;
}

export const isFiltering = (f: UnitFilters) => f.beds.length + f.baths.length + f.reno.length > 0;

export function unitMatches(u: Unit, _b: Building, { filters: f }: UnitFilter): boolean {
  if (f.beds.length && !f.beds.includes(unitBedCat(u) ?? '')) return false;
  if (f.baths.length && !f.baths.includes(unitBathCat(u) ?? '')) return false;
  if (f.reno.length && !f.reno.includes(unitReno(u) ?? '')) return false;
  return true;
}

export function visibleUnits(b: Building, f: UnitFilter): Unit[] {
  return isFiltering(f.filters) ? b.units.filter((u) => unitMatches(u, b, f)) : b.units;
}

export interface FilterOptions {
  beds: string[];
  baths: string[];
  reno: string[];
}

/** The choices present in the survey, in display order. A detail with fewer than two choices is left out. */
export function filterOptions(s: Survey): FilterOptions {
  const beds = new Set<string>();
  const baths = new Set<string>();
  const reno = new Set<string>();
  for (const b of s.buildings)
    for (const u of b.units) {
      const bc = unitBedCat(u);
      if (bc) beds.add(bc);
      const ba = unitBathCat(u);
      if (ba) baths.add(ba);
      const r = unitReno(u);
      if (r) reno.add(r);
    }
  const ordered = (all: readonly string[], have: Set<string>) => all.filter((x) => have.has(x));
  const two = (xs: string[]) => (xs.length > 1 ? xs : []);
  return {
    beds: two(ordered(BED_CATS, beds)),
    baths: two(ordered(BATH_CATS, baths)),
    reno: two([...reno].sort()),
  };
}

/** Extra details the summary rows are split by. */
export interface SplitDims {
  baths: boolean;
  reno: boolean;
}
export const NO_SPLIT: SplitDims = { baths: false, reno: false };

/** Row label for a unit: bedrooms, then optionally bathrooms and renovation level. */
export function groupLabel(u: Unit, _b: Building, dims: SplitDims): string {
  let label = unitBedCat(u) ?? 'Other';
  if (dims.baths) {
    const ba = unitBathCat(u);
    if (ba) label += ` / ${ba} Bath`;
  }
  if (dims.reno) {
    const r = unitReno(u);
    if (r) label += ` · ${r}`;
  }
  return label;
}

/** Orders rows by bedrooms, then bathrooms, then renovation. "Other" goes last. */
export function groupSortKey(u: Unit, _b: Building, dims: SplitDims): string {
  const cat = unitBedCat(u);
  const bed = cat ? (BED_CATS as readonly string[]).indexOf(cat) : 99;
  const baths = dims.baths ? unitBaths(u) : null;
  const pad = (n: number, w: number) => String(Math.round(n)).padStart(w, '0');
  return `${pad(bed, 3)}|${pad((baths ?? 0) * 10, 4)}|${dims.reno ? unitReno(u) ?? '' : ''}`;
}
