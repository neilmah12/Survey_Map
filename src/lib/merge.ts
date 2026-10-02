import type { Building, Survey } from '../types';
import { money } from './format';
import { normalizeUnitType } from './parse';

const WORDS: Record<string, string> = {
  street: 'st', avenue: 'ave', road: 'rd', drive: 'dr', boulevard: 'blvd', crescent: 'cres', lane: 'ln',
  northwest: 'nw', northeast: 'ne', southwest: 'sw', southeast: 'se', place: 'pl', court: 'ct', terrace: 'terr',
};

/** Lowercase, drop punctuation, and unify common street words so "12006 125 Street NW" matches "12006 125 St. NW". */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => WORDS[w] ?? w)
    .join(' ');
}

export interface MergeSummary {
  matched: number;
  added: string[];
  removed: string[];
  /** Per-building description of what changed in the sheet. */
  changed: { name: string; details: string[] }[];
  /** Buildings added in the app that are not in the sheet yet; they are kept. */
  keptLocal: string[];
  /** Matched buildings whose pin came from the sheet's own coordinates. */
  repositioned: string[];
  pinsKept: number;
  photosKept: number;
  /** True when so few buildings matched that this is probably a different survey. */
  looksDifferent: boolean;
}

function describeUnitChanges(oldB: Building, newB: Building): string[] {
  const out: string[] = [];
  const oldByType = new Map(oldB.units.map((u) => [norm(normalizeUnitType(u.type)), u]));
  const newByType = new Map(newB.units.map((u) => [norm(normalizeUnitType(u.type)), u]));
  for (const [k, nu] of newByType) {
    const ou = oldByType.get(k);
    if (!ou) {
      out.push(`new unit: ${nu.type}`);
      continue;
    }
    const diffs: string[] = [];
    if (ou.rate !== nu.rate) diffs.push(`rent ${ou.rate != null ? money(ou.rate) : '-'} to ${nu.rate != null ? money(nu.rate) : '-'}`);
    if (ou.sf !== nu.sf) diffs.push(`SF ${ou.sf ?? '-'} to ${nu.sf ?? '-'}`);
    if (ou.incentive !== nu.incentive) diffs.push('incentive');
    if (ou.parking !== nu.parking) diffs.push('parking');
    if (ou.utilities !== nu.utilities) diffs.push('utilities');
    if (diffs.length) out.push(`${nu.type}: ${diffs.join(', ')}`);
  }
  for (const [k, ou] of oldByType) if (!newByType.has(k)) out.push(`unit removed: ${ou.type}`);
  return out;
}

function describeBuildingChanges(oldB: Building, newB: Building): string[] {
  const out: string[] = [];
  if (oldB.name !== newB.name) out.push(`renamed from "${oldB.name}"`);
  if (oldB.address !== newB.address) out.push(`address was ${oldB.address}`);
  if (oldB.yearBuilt !== newB.yearBuilt) out.push('year built');
  if (oldB.isSubject !== newB.isSubject) out.push(newB.isSubject ? 'now the subject' : 'no longer the subject');
  return [...out, ...describeUnitChanges(oldB, newB)];
}

/**
 * Applies a freshly parsed workbook to an existing survey. The sheet is the source of truth for
 * names, units and rents; the app keeps what only it knows: pin positions and photos.
 * Buildings are matched by name plus address, then address alone, then name alone.
 */
export function mergeSurvey(existing: Survey, incoming: Survey): { survey: Survey; summary: MergeSummary } {
  const free = new Set(existing.buildings.map((b) => b.id));
  const byId = new Map(existing.buildings.map((b) => [b.id, b]));
  const take = (pred: (b: Building) => boolean): Building | null => {
    for (const id of free) {
      const b = byId.get(id)!;
      if (pred(b)) {
        free.delete(id);
        return b;
      }
    }
    return null;
  };

  const pairs = incoming.buildings.map((nb) => {
    const n = norm(nb.name);
    const a = norm(nb.address);
    const old =
      take((b) => norm(b.name) === n && norm(b.address) === a) ??
      (a ? take((b) => norm(b.address) === a) : null) ??
      (n ? take((b) => norm(b.name) === n) : null);
    return { nb, old };
  });

  let nextId = Math.max(0, ...existing.buildings.map((b) => Number(b.id.replace(/\D/g, '')) || 0));
  const summary: MergeSummary = {
    matched: 0, added: [], removed: [], keptLocal: [], changed: [], repositioned: [], pinsKept: 0, photosKept: 0, looksDifferent: false,
  };

  const subjectInSheet = incoming.buildings.some((b) => b.isSubject);
  const buildings: Building[] = pairs.map(({ nb, old }) => {
    if (!old) {
      summary.added.push(nb.name);
      return { ...nb, id: `b${++nextId}` };
    }
    summary.matched++;
    const details = describeBuildingChanges(old, nb);
    if (details.length) summary.changed.push({ name: nb.name, details });

    let lngLat = old.lngLat;
    if (nb.lngLat) {
      // The sheet stores 6 decimals (about 10 cm), so only a real difference counts as a move.
      const moved = !old.lngLat || Math.abs(old.lngLat[0] - nb.lngLat[0]) > 1e-5 || Math.abs(old.lngLat[1] - nb.lngLat[1]) > 1e-5;
      if (moved) {
        if (old.lngLat) summary.repositioned.push(nb.name);
        lngLat = nb.lngLat;
      }
    }
    if (lngLat) summary.pinsKept++;

    const imageUrl = nb.imageUrl || old.imageUrl || '';
    if (imageUrl) summary.photosKept++;

    return {
      ...nb,
      id: old.id,
      lngLat,
      imageUrl,
      propertyType: nb.propertyType ?? old.propertyType,
      // The sheet marks the subject by fill colour; if it marks none, keep the app's choice.
      isSubject: subjectInSheet ? nb.isSubject : old.isSubject,
    };
  });

  // Buildings created in the app are not expected to be in the sheet yet, so they are kept, not removed.
  const leftover = [...free].map((id) => byId.get(id)!);
  const keep = leftover.filter((b) => b.addedInApp);
  summary.keptLocal = keep.map((b) => b.name);
  summary.removed = leftover.filter((b) => !b.addedInApp).map((b) => b.name);
  for (const b of keep) if (b.lngLat) summary.pinsKept++;
  buildings.push(...keep);
  const denom = Math.max(existing.buildings.length, incoming.buildings.length, 1);
  summary.looksDifferent = existing.buildings.length > 2 && summary.matched / denom < 0.4;

  return {
    summary,
    survey: {
      ...existing,
      title: incoming.title || existing.title,
      location: incoming.location || existing.location,
      buildings,
      source: incoming.source ?? existing.source,
    },
  };
}
