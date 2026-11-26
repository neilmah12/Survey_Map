import { describe, expect, it } from 'vitest';
import { layoutPins, type PinPlacement, type PinSpec, type Rect } from '../src/lib/pinLayout';

const FULL = { w: 170, h: 40 };
const COMPACT = { w: 74, h: 26 };
const TINY = { w: 26, h: 26 };
const pin = (id: string, x: number, y: number, order = 0, sizes = [FULL, COMPACT]): PinSpec => ({ id, x, y, sizes, order });
const overlap = (a: Rect, b: Rect) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
const get = (r: PinPlacement[], id: string) => r.find((x) => x.id === id)!;

/** Does the straight pointer from a building's place to its pill pass through another pill? */
const pointerThrough = (pin: PinSpec, p: PinPlacement, other: PinPlacement) => {
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const x = pin.x + (p.attach.x - pin.x) * t;
    const y = pin.y + (p.attach.y - pin.y) * t;
    if (x > other.rect.l && x < other.rect.r && y > other.rect.t && y < other.rect.b) return true;
  }
  return false;
};

/** n buildings scattered over a square of the given size, the same way every time. */
const crowd = (n: number, spread = 14, sizes = [FULL, COMPACT]): PinSpec[] => {
  let s = n * 7 + spread;
  const next = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  return Array.from({ length: n }, (_, i) => pin(`p${i}`, 400 + next() * spread, 300 + next() * spread, i, sizes));
};

describe('pin layout', () => {
  it('leaves pins that are far apart straight above their building, in full detail', () => {
    const r = layoutPins([pin('a', 100, 200), pin('b', 500, 200, 1), pin('c', 100, 600, 2)]);
    for (const p of r) {
      expect(p.detail).toBe(0);
      expect(p.cx).toBe(0);
      expect(p.cy).toBeLessThan(0);
      expect(p.crowded).toBe(false);
    }
  });

  it('gives the highest priority pin its natural place, whatever the list order', () => {
    const items = [pin('a', 400, 300, 5), pin('subject', 404, 301, -1), pin('c', 396, 299, 6)];
    const r = layoutPins(items);
    expect(get(r, 'subject').cx).toBe(0);
    expect(get(r, 'subject').detail).toBe(0);
    expect(get(r, 'a').cx !== 0 || get(r, 'a').cy !== get(r, 'subject').cy).toBe(true);
  });

  it('never drops a pin, however many there are', () => {
    for (const n of [2, 8, 14, 25]) for (const spread of [14, 100]) expect(layoutPins(crowd(n, spread))).toHaveLength(n);
  });

  it('keeps pills apart on a crowded map: ten pins in a hundred pixels, with the number-only size as a last resort', () => {
    for (const spread of [40, 100, 160]) {
      const r = layoutPins(crowd(10, spread, [FULL, COMPACT, TINY]));
      for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) expect(overlap(r[i].rect, r[j].rect), `spread ${spread}: ${i} and ${j}`).toBe(false);
    }
  });

  it('keeps pills apart for a small pile on one spot, and a printed page (no number-only size) still copes with a real crowd', () => {
    const pile = layoutPins(crowd(5, 14));
    for (let i = 0; i < pile.length; i++) for (let j = i + 1; j < pile.length; j++) expect(overlap(pile[i].rect, pile[j].rect)).toBe(false);
    const printed = layoutPins(crowd(8, 120)); // two sizes only, and every pill keeps its price
    for (let i = 0; i < printed.length; i++) for (let j = i + 1; j < printed.length; j++) expect(overlap(printed[i].rect, printed[j].rect)).toBe(false);
    expect(printed.every((p) => p.detail <= 1)).toBe(true);
  });

  it('says so when it could not avoid an overlap, instead of hiding a pin', () => {
    const r = layoutPins(crowd(60, 14, [FULL])); // sixty full-size pills around one spot: more than can fit
    expect(r).toHaveLength(60);
    expect(r.some((p) => p.crowded)).toBe(true);
    expect(layoutPins(crowd(40, 14)).every((p) => !p.crowded)).toBe(true); // with a smaller size to fall back on, forty still fit
  });

  it('keeps every pill off every other building\'s dot, and every pointer off every other pill', () => {
    const items = crowd(6, 160, [FULL, COMPACT, TINY]); // a busy but ordinary map: the strictest rules can all be met
    const r = layoutPins(items);
    for (const p of r) {
      for (const it of items) {
        if (it.id === p.id) continue;
        expect(overlap(p.rect, { l: it.x - 5, r: it.x + 5, t: it.y - 5, b: it.y + 5 })).toBe(false);
      }
      for (const other of r) if (other.id !== p.id) expect(pointerThrough(items.find((i) => i.id === p.id)!, p, other)).toBe(false);
    }
  });

  it('opens a crowd out sideways and below, instead of piling pills into one tall column', () => {
    const r = layoutPins(crowd(8, 60));
    const sides = new Set(r.map((p) => `${Math.sign(Math.round(p.cx / 20))}:${Math.sign(Math.round(p.cy / 20))}`));
    expect(sides.size).toBeGreaterThan(2);
    const tallest = Math.max(...r.map((p) => -p.cy));
    expect(tallest).toBeLessThan(8 * 40 * 0.75); // far less than a stack of eight lifted pills
  });

  it('uses a smaller pill, near the building, before sending a full pill far away', () => {
    const r = layoutPins(crowd(9, 40));
    expect(r.some((p) => p.detail === 1)).toBe(true);
    expect(get(r, 'p0').detail).toBe(0); // the first keeps full detail
    for (const p of r) expect(Math.hypot(p.cx, p.cy)).toBeLessThan(200); // no long pointers
    const lone = layoutPins([pin('lone', 100, 100)]);
    expect(lone[0].detail).toBe(0); // room to spare means no loss of detail
  });

  it('places buildings that share one spot (stacked on the same coordinates) without overlap', () => {
    const items = Array.from({ length: 5 }, (_, i) => pin(`s${i}`, 300, 300, i));
    const r = layoutPins(items);
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) expect(overlap(r[i].rect, r[j].rect)).toBe(false);
  });

  it('keeps pills inside the map where there is room, even beside an edge', () => {
    const bounds = { l: 0, t: 0, r: 800, b: 600 };
    const r = layoutPins([pin('edge', 780, 40), pin('corner', 20, 580, 1), pin('mid', 400, 300, 2)], { bounds });
    for (const p of r) {
      expect(p.rect.l).toBeGreaterThanOrEqual(0);
      expect(p.rect.r).toBeLessThanOrEqual(800);
      expect(p.rect.t).toBeGreaterThanOrEqual(0);
      expect(p.rect.b).toBeLessThanOrEqual(600);
    }
  });

  it('is repeatable and does not change its input', () => {
    const items = crowd(6);
    const copy = JSON.stringify(items);
    expect(layoutPins(items)).toEqual(layoutPins(items));
    expect(JSON.stringify(items)).toBe(copy);
  });

  it('handles a pin with a single size', () => {
    const r = layoutPins([pin('a', 100, 100, 0, [FULL]), pin('b', 104, 102, 1, [FULL])]);
    expect(overlap(r[0].rect, r[1].rect)).toBe(false);
    expect(r.every((p) => p.detail === 0)).toBe(true);
  });
});
