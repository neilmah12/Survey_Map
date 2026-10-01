import type { LngLat } from '../types';

/** Closed ring of points around a centre at a given radius, for drawing distance rings. */
export function circleCoords(center: LngLat, km: number, steps = 96): LngLat[] {
  const [lng, lat] = center;
  const dLat = km / 111.32;
  const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  const pts: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    pts.push([lng + dLng * Math.sin(a), lat + dLat * Math.cos(a)]);
  }
  return pts;
}

export function ringTop(center: LngLat, km: number): LngLat {
  return [center[0], center[1] + km / 111.32];
}
