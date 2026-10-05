import { describe, expect, it } from 'vitest';
import { layoutPins, type PinBox, type Rect } from '../src/lib/pinLayout';

const pillAt = (x: number, y: number, w = 80, h = 26): Rect => ({ l: x - w / 2, r: x + w / 2, t: y - h, b: y });
const pin = (id: string, x: number, y: number, order: number): PinBox => ({
  id, order, pill: pillAt(x, y), name: { l: x - 40, r: x + 40, t: y + 2, b: y + 16 },
});
const overlap = (a: Rect, b: Rect) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
const placed = (p: PinBox, lift: number): Rect => ({ l: p.pill.l, r: p.pill.r, t: p.pill.t - lift, b: p.pill.b - lift });

describe('pin layout', () => {
  it('leaves pins that are far apart where they are', () => {
    const r = layoutPins([pin('a', 100, 200, 0), pin('b', 400, 200, 1), pin('c', 100, 500, 2)]);
    expect(r.map((x) => x.lift)).toEqual([0, 0, 0]);
    expect(r.every((x) => !x.nameHidden)).toBe(true);
  });

  it('lifts pills that would overlap so that none overlap, and never moves the first', () => {
    const items = [pin('a', 100, 200, 0), pin('b', 105, 202, 1), pin('c', 98, 199, 2), pin('d', 110, 205, 3)];
    const r = layoutPins(items);
    expect(r.find((x) => x.id === 'a')!.lift).toBe(0);
    const boxes = items.map((it) => placed(it, r.find((x) => x.id === it.id)!.lift));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
    expect(r.filter((x) => x.lift > 0)).toHaveLength(3);
  });

  it('gives the highest priority pin its natural place, whatever the list order', () => {
    const items = [pin('a', 100, 200, 5), pin('subject', 104, 201, -1), pin('c', 96, 199, 6)];
    const r = layoutPins(items);
    expect(r.find((x) => x.id === 'subject')!.lift).toBe(0);
    expect(r.find((x) => x.id === 'a')!.lift).toBeGreaterThan(0);
  });

  it('hides a name that would land on another pin, keeps one that is clear', () => {
    const items = [pin('a', 100, 200, 0), pin('b', 102, 232, 1)]; // b's pill sits where a's name would be
    const r = layoutPins(items);
    expect(r.find((x) => x.id === 'a')!.nameHidden).toBe(true);
    expect(layoutPins([pin('a', 100, 200, 0), pin('b', 400, 200, 1)]).every((x) => !x.nameHidden)).toBe(true);
  });

  it('is repeatable and does not change its input', () => {
    const items = [pin('a', 100, 200, 0), pin('b', 105, 202, 1)];
    const copy = JSON.stringify(items);
    expect(layoutPins(items)).toEqual(layoutPins(items));
    expect(JSON.stringify(items)).toBe(copy);
  });
});
