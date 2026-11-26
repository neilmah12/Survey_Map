import type { Building } from '../types';
import { haversineKm } from './geo';

/**
 * The number on each comparable building's pin: 1 is the one nearest the subject, then 2, 3 and so on. The
 * subject is not numbered. Numbers belong to the building, so they never change when a filter hides some pins,
 * or when a building is switched off: building 3 is building 3 on the map, in the popup, in the chart tooltip
 * and in the exported legend.
 *
 * With several subjects the one being compared (the others are marked out) is measured from. With no subject there is
 * nothing to measure from, so the numbers follow the order of the sheet. Buildings without a pin get no number.
 */
export function pinNumbers(buildings: Pick<Building, 'id' | 'isSubject' | 'lngLat' | 'out'>[]): Map<string, number> {
  const placed = buildings.filter((b) => b.lngLat);
  const subjects = placed.filter((b) => b.isSubject && !b.out); // a subject set aside is not measured from
  const away = (b: (typeof placed)[number]) => (subjects.length ? Math.min(...subjects.map((s) => haversineKm(s.lngLat!, b.lngLat!))) : 0);
  const ranked = placed
    .filter((b) => !b.isSubject)
    .map((b, order) => ({ id: b.id, km: away(b), order }))
    .sort((a, b) => a.km - b.km || a.order - b.order); // equal distances keep the order of the sheet
  return new Map(ranked.map((r, i) => [r.id, i + 1]));
}
