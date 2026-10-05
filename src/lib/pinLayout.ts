/** Rectangles are in any consistent unit (CSS px on screen, page px in an export). */
export interface Rect { l: number; t: number; r: number; b: number }

export interface PinBox {
  id: string;
  /** The rate pill where it would sit with no adjustment. */
  pill: Rect;
  /** The building name under it. */
  name: Rect;
  /** Lower number = placed first (and so keeps its spot). */
  order: number;
}

export interface PinPlacement {
  id: string;
  /** How far the pill is lifted straight up so it clears other pills. */
  lift: number;
  /** The name would land on something else, so it is not shown. */
  nameHidden: boolean;
}

const hits = (a: Rect, b: Rect, pad: number) => a.l < b.r + pad && a.r + pad > b.l && a.t < b.b + pad && a.b + pad > b.t;
const up = (r: Rect, dy: number): Rect => ({ l: r.l, r: r.r, t: r.t - dy, b: r.b - dy });

/**
 * Keeps crowded pins readable without moving any of them. Pills that would overlap are lifted straight up
 * in steps, and a building name that would land on something already placed is hidden. Pins are handled in
 * priority order, so the selected pin and the subject keep their natural place.
 */
export function layoutPins(items: PinBox[], gap = 3, maxLevels = 8): PinPlacement[] {
  const sorted = [...items].sort((a, b) => a.order - b.order);
  const taken: Rect[] = [];
  const lifts = new Map<string, number>();
  for (const it of sorted) {
    const h = it.pill.b - it.pill.t;
    let lift = 0;
    for (let level = 0; level <= maxLevels; level++) {
      if (!taken.some((t) => hits(up(it.pill, level * (h + gap)), t, 2))) {
        lift = level * (h + gap);
        break;
      }
    }
    lifts.set(it.id, lift);
    taken.push(up(it.pill, lift));
  }
  const hidden = new Set<string>();
  for (const it of sorted) {
    if (taken.some((t) => hits(it.name, t, 1))) hidden.add(it.id);
    else taken.push(it.name);
  }
  return items.map((it) => ({ id: it.id, lift: lifts.get(it.id) ?? 0, nameHidden: hidden.has(it.id) }));
}
