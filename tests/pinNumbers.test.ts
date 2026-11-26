import { describe, expect, it } from 'vitest';
import { pinNumbers } from '../src/lib/pinNumbers';
import type { LngLat } from '../src/types';

const b = (id: string, lngLat: LngLat | null, isSubject = false) => ({ id, isSubject, lngLat });
// Distances from the subject at (-113.5, 53.5): east along the same latitude, 1 degree of longitude is about 66 km here.
const subject = b('s', [-113.5, 53.5], true);
const at = (id: string, km: number) => b(id, [-113.5 + km / 66, 53.5]);

describe('pin numbers', () => {
  it('numbers the comparables nearest-first from the subject, and does not number the subject', () => {
    const n = pinNumbers([at('far', 8), subject, at('near', 1), at('mid', 3)]);
    expect(n.get('near')).toBe(1);
    expect(n.get('mid')).toBe(2);
    expect(n.get('far')).toBe(3);
    expect(n.has('s')).toBe(false);
  });

  it('does not depend on the order of the sheet when there is a subject', () => {
    const a = pinNumbers([subject, at('x', 5), at('y', 2), at('z', 9)]);
    const c = pinNumbers([at('z', 9), at('y', 2), at('x', 5), subject]);
    for (const id of ['x', 'y', 'z']) expect(a.get(id)).toBe(c.get(id));
  });

  it('ranks by the nearest of several subjects', () => {
    const s2 = b('s2', [-113.5 + 10 / 66, 53.5], true);
    const n = pinNumbers([subject, s2, at('a', 9), at('b', 4)]); // a is 1 km from s2, b is 4 km from s
    expect(n.get('a')).toBe(1);
    expect(n.get('b')).toBe(2);
  });

  it('follows the order of the sheet when there is no subject', () => {
    const n = pinNumbers([at('p', 7), at('q', 1), at('r', 4)]);
    expect([n.get('p'), n.get('q'), n.get('r')]).toEqual([1, 2, 3]);
  });

  it('leaves out buildings without a pin, and keeps equal distances in sheet order', () => {
    const n = pinNumbers([subject, b('nopin', null), at('t1', 2), at('t2', 2)]);
    expect(n.has('nopin')).toBe(false);
    expect(n.get('t1')).toBe(1);
    expect(n.get('t2')).toBe(2);
  });

  it('is the same however many pins a filter or a switch-off hides, because it only looks at every placed building', () => {
    const all = [subject, at('a', 1), at('b', 2), at('c', 3)];
    const n = pinNumbers(all);
    expect([n.get('a'), n.get('b'), n.get('c')]).toEqual([1, 2, 3]);
  });
});
