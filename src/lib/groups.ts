import type { Building, Survey, Unit } from '../types';
import { parseBeds } from './parse';

/** Which extra details unit groups are split by. Bedrooms always apply. */
export interface Dims {
  baths: boolean;
  reno: boolean;
  kind: boolean;
}
export const NO_DIMS: Dims = { baths: false, reno: false, kind: false };

export type Kind = 'Townhome' | 'Apartment';

const TOWNHOME = /town\s?home|townhouse/i;
const RENO_WORD = /\b(basic|partial|full|original|un-?renovated|renovated|reno|upgraded|updated|classic|premium)\b/i;

export const unitBeds = (u: Unit): number | null => parseBeds(u.type) ?? u.beds ?? null;

export function unitBaths(u: Unit): number | null {
  const m = u.type.match(/(\d+(?:\.\d+)?)\s*-?\s*bath/i);
  return m ? parseFloat(m[1]) : null;
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
 * Returns null when nothing indicates a type, so no split is offered.
 */
export function unitKind(u: Unit, b: Building, ctx: KindContext): Kind | null {
  const explicit = explicitKind(u, b);
  if (explicit) return explicit;
  if (TOWNHOME.test(ctx.title)) return 'Townhome';
  if (/apartment/i.test(ctx.title)) return 'Apartment';
  return ctx.anyTownhome ? 'Apartment' : null;
}

export function groupLabel(u: Unit, b: Building, dims: Dims, ctx: KindContext): string {
  const beds = unitBeds(u);
  let label = beds == null ? 'Other' : beds === 0 ? 'Studio' : `${beds} Bed`;
  if (dims.baths) {
    const ba = unitBaths(u);
    if (ba != null) label += ` / ${ba} Bath`;
  }
  if (dims.kind) {
    const k = unitKind(u, b, ctx);
    if (k) label += ` · ${k}`;
  }
  if (dims.reno) {
    const r = unitReno(u);
    if (r) label += ` · ${r}`;
  }
  return label;
}

function sortKey(u: Unit, b: Building, dims: Dims, ctx: KindContext): string {
  const beds = unitBeds(u);
  const baths = dims.baths ? unitBaths(u) : null;
  const pad = (n: number | null, w: number) => String(Math.round((n ?? 99) * 10)).padStart(w, '0');
  return `${pad(beds, 4)}|${pad(baths, 4)}|${dims.kind ? unitKind(u, b, ctx) ?? '' : ''}|${dims.reno ? unitReno(u) ?? '' : ''}`;
}

export interface UnitFilter {
  dims: Dims;
  /** Selected group labels; empty means every unit. */
  groups: string[];
  ctx: KindContext;
}

export function visibleUnits(b: Building, f: UnitFilter): Unit[] {
  if (f.groups.length === 0) return b.units;
  return b.units.filter((u) => f.groups.includes(groupLabel(u, b, f.dims, f.ctx)));
}

/** All unit groups present in the survey, ordered by bedrooms then bathrooms. */
export function listGroups(s: Survey, dims: Dims): string[] {
  const ctx = kindContext(s);
  const seen = new Map<string, string>();
  for (const b of s.buildings)
    for (const u of b.units) {
      const label = groupLabel(u, b, dims, ctx);
      if (!seen.has(label)) seen.set(label, sortKey(u, b, dims, ctx));
    }
  return [...seen.entries()].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[0].localeCompare(b[0]))).map(([l]) => l);
}

/** Which splits are worth offering: each needs at least two distinct values in the data. */
export function availableDims(s: Survey): Dims {
  const ctx = kindContext(s);
  const baths = new Set<number>();
  const renos = new Set<string>();
  const kinds = new Set<string>();
  for (const b of s.buildings)
    for (const u of b.units) {
      const ba = unitBaths(u);
      if (ba != null) baths.add(ba);
      const r = unitReno(u);
      if (r) renos.add(r);
      const k = unitKind(u, b, ctx);
      if (k) kinds.add(k);
    }
  return { baths: baths.size > 1, reno: renos.size > 1, kind: kinds.size > 1 };
}
