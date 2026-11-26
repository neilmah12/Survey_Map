import type { Building, Survey, ViewSettings } from '../types';
import { haversineKm } from './geo';

/**
 * Who is being compared with whom. One subject drives everything: the rings, the distances, the numbers on the
 * pins. With several subjects (a portfolio) the chosen one is "active" and the others are set aside: they stay on
 * the map, greyed, and never count as comparables. A distance choice sets aside every comparable beyond it.
 *
 * This works on a copy and marks buildings (Building.out, Building.distKm). The marks are never saved or published.
 */

/** The subject being compared: the chosen one if it is placed, else the first placed subject, else none. */
export function activeSubject(buildings: Building[], subjectId?: string | null): Building | null {
  const subjects = buildings.filter((b) => b.isSubject && b.lngLat);
  return subjects.find((b) => b.id === subjectId) ?? subjects[0] ?? null;
}

/** The radii to draw: the one chosen, else every offered distance when the rings are switched on, else none. */
export function ringRadii(view: Pick<ViewSettings, 'rings' | 'ringsKm' | 'within'>): number[] {
  if (view.within != null && view.within > 0) return [view.within];
  return view.rings ? view.ringsKm : [];
}

/** Largest distance worth fitting on the map. */
export const maxRingKm = (view: Pick<ViewSettings, 'rings' | 'ringsKm' | 'within'>): number => Math.max(0, ...ringRadii(view));

export function scopeSurvey(survey: Survey, view: Pick<ViewSettings, 'within' | 'subjectId'>): Survey {
  const subject = activeSubject(survey.buildings, view.subjectId);
  const within = view.within != null && view.within > 0 ? view.within : null;
  if (!subject) return survey; // nothing to measure from
  let changed = false;
  const buildings = survey.buildings.map((b) => {
    let out: Building['out'];
    let distKm: number | undefined;
    if (b.id !== subject.id && b.lngLat) distKm = haversineKm(subject.lngLat!, b.lngLat);
    if (b.isSubject && b.id !== subject.id) out = 'subject';
    else if (!b.isSubject && within != null && distKm != null && distKm > within) out = 'far';
    if (b.out === out && b.distKm === distKm) return b;
    changed = true;
    const { out: _o, distKm: _d, ...rest } = b;
    void _o;
    void _d;
    return { ...rest, ...(out ? { out } : {}), ...(distKm !== undefined ? { distKm } : {}) };
  });
  return changed ? { ...survey, buildings } : survey; // unchanged marks keep the same object, so nothing rebuilds
}

/** "0.4 km", "1.2 km", "12 km". */
export const fmtKm = (km: number): string => `${km < 10 ? Math.round(km * 10) / 10 : Math.round(km)} km`;
