/** Rectangles and points are in any consistent unit (CSS px on screen, page px in an export). */
export interface Rect { l: number; t: number; r: number; b: number }
export interface Point { x: number; y: number }
export interface Size { w: number; h: number }

export interface PinSpec {
  id: string;
  /** The building's real place on the map. */
  x: number;
  y: number;
  /** The pill's size at each level of detail, fullest first (number, name and price, then number and price). */
  sizes: Size[];
  /** Lower number = placed first, and so gets the best spot. */
  order: number;
}

export interface PinPlacement {
  id: string;
  /** Which of the pin's sizes was used: 0 is the fullest. */
  detail: number;
  /** Where the pill's centre is, relative to the building's place. */
  cx: number;
  cy: number;
  /** The pill, in absolute coordinates. */
  rect: Rect;
  /** Where the pointer from the building's place meets the pill. */
  attach: Point;
  /** Nothing free was found, so this pill overlaps something. Rare: a pile of buildings on one spot. */
  crowded: boolean;
}

export interface LayoutOptions {
  /** Keep pills inside this area where a free spot exists inside it. */
  bounds?: Rect;
  /** Clear space between the building's place and the nearest edge of its pill. */
  stem?: number;
  /** Clear space between pills. */
  pad?: number;
}

const DOT = 6; // a building's dot, so a pill never sits on top of one
const SAME_SPOT = 14; // buildings this close are one spot to the eye: a pointer may pass another's dot there

type Seg = { a: Point; b: Point };
interface Cand { detail: number; cx: number; cy: number; rect: Rect; attach: Point }

const hits = (a: Rect, b: Rect, pad: number) => a.l < b.r + pad && a.r + pad > b.l && a.t < b.b + pad && a.b + pad > b.t;
const inside = (a: Rect, b: Rect) => a.l >= b.l && a.r <= b.r && a.t >= b.t && a.b <= b.b;
const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Does the segment pass through the rectangle (grown by pad)? Liang-Barsky clipping. */
function segHitsRect(s: Seg, r: Rect, pad: number): boolean {
  const l = r.l - pad, t = r.t - pad, rr = r.r + pad, bb = r.b + pad;
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [s.a.x - l, rr - s.a.x, s.a.y - t, bb - s.a.y];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const u = q[i] / p[i];
      if (p[i] < 0) {
        if (u > t1) return false;
        if (u > t0) t0 = u;
      } else {
        if (u < t0) return false;
        if (u < t1) t1 = u;
      }
    }
  }
  return true;
}

const orient = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
/** Do two segments cross each other? Meeting at a shared end (two buildings on one spot) is not a crossing. */
function segsCross(s: Seg, u: Seg): boolean {
  const d1 = orient(u.a, u.b, s.a), d2 = orient(u.a, u.b, s.b), d3 = orient(s.a, s.b, u.a), d4 = orient(s.a, s.b, u.b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * The tries, in order: (level of detail, how far out). The fullest pill is tried close in and a notch further
 * out before a smaller one is, and a smaller one is tried at every distance before the fullest is allowed far
 * from its building. A pointer should stay short. With a third, number-only size (the screen has one; a printed
 * page does not, because a price must not go missing) it comes last, tucked in close.
 */
function attemptsFor(sizes: number): [number, number][] {
  if (sizes <= 1) return [0, 1, 2, 3, 4, 5, 6, 8].map((r) => [0, r]);
  if (sizes === 2) return [[0, 0], [0, 1], [1, 0], [1, 1], [0, 2], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7], [1, 8], [1, 10], [1, 12]];
  return [[0, 0], [0, 1], [1, 0], [1, 1], [0, 2], [1, 2], [2, 0], [1, 3], [2, 1], [1, 4], [2, 2], [2, 3], [2, 4], [2, 6], [2, 8]];
}

/**
 * Places each pin's pill near its building so that no pill covers another pill, another building's dot or
 * another pill's pointer, and no pointer crosses a pill or another pointer. A pill can sit above, beside or
 * below its building, not only above, so a crowd opens out instead of stacking into a tall column. When the
 * fullest pill does not fit, the compact one is used. Pins are handled in priority order, so the selected pin
 * and the subject keep the natural spot (straight above).
 */
export function layoutPins(pins: PinSpec[], o: LayoutOptions = {}): PinPlacement[] {
  const STEM = o.stem ?? 12;
  const PAD = o.pad ?? 3;
  const sorted = [...pins].sort((a, b) => a.order - b.order);
  const dots = pins.map((p) => ({ id: p.id, rect: { l: p.x - DOT, r: p.x + DOT, t: p.y - DOT, b: p.y + DOT } }));
  const taken: Rect[] = [];
  const pointers: Seg[] = [];
  const done = new Map<string, PinPlacement>();

  /** The spots a pill of this size could take, most natural first, at distance level r. */
  const candidates = (pin: PinSpec, detail: number, r: number): Cand[] => {
    const { w, h } = pin.sizes[Math.min(detail, pin.sizes.length - 1)];
    const m = STEM + r * (Math.ceil(h / 2) + PAD);
    const along = [0, w / 4, -w / 4, w / 2 - 10, -(w / 2 - 10)]; // slid along the pill's length: centred, then toward either end
    const across = [0, -(h / 2 + 4), h / 2 + 4]; // beside, slid up or down by half a pill
    const offsets: [number, number][] = [
      ...along.map((x): [number, number] => [x, -(h / 2 + m)]), // above
      [w / 2 + m, across[0]], [-(w / 2 + m), across[0]], // beside
      [w / 2 + m, across[1]], [-(w / 2 + m), across[1]], [w / 2 + m, across[2]], [-(w / 2 + m), across[2]],
      ...along.map((x): [number, number] => [x, h / 2 + m]), // below
    ];
    // Then every other direction, 15 degrees apart starting from straight up, so a crowd can fan out all the way round.
    for (let k = 0; k < 24; k++) {
      const a = (-90 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 15) * (Math.PI / 180);
      const ux = Math.cos(a), uy = Math.sin(a);
      const reach = Math.min(ux ? w / 2 / Math.abs(ux) : Infinity, uy ? h / 2 / Math.abs(uy) : Infinity); // centre to edge along this direction
      offsets.push([ux * (m + reach), uy * (m + reach)]);
    }
    return offsets.map(([cx, cy]) => {
      const rect = { l: pin.x + cx - w / 2, r: pin.x + cx + w / 2, t: pin.y + cy - h / 2, b: pin.y + cy + h / 2 };
      return { detail, cx, cy, rect, attach: { x: clamp(pin.x, rect.l, rect.r), y: clamp(pin.y, rect.t, rect.b) } };
    });
  };

  /**
   * How much to ask for. 0: everything. 1: let pointers cross each other and pass a neighbour's dot, and let a pill
   * sit on one. 2: also let a pointer run behind a pill. Pills never overlap at any level.
   */
  const free = (pin: PinSpec, c: Cand, withinBounds: boolean, level: number): boolean => {
    if (withinBounds && o.bounds && !inside(c.rect, o.bounds)) return false;
    if (taken.some((t) => hits(c.rect, t, PAD))) return false;
    if (level === 0 && dots.some((d) => d.id !== pin.id && hits(c.rect, d.rect, 0))) return false;
    const mine: Seg = { a: { x: pin.x, y: pin.y }, b: c.attach };
    if (level === 2) return true;
    if (pointers.some((p) => segHitsRect(p, c.rect, 1))) return false;
    if (taken.some((t) => segHitsRect(mine, t, 0))) return false;
    if (level === 1) return true;
    if (pointers.some((p) => segsCross(mine, p))) return false;
    if (dots.some((d) => d.id !== pin.id && Math.hypot(d.rect.l + DOT - pin.x, d.rect.t + DOT - pin.y) > SAME_SPOT && segHitsRect(mine, d.rect, 0))) return false;
    return true;
  };

  /** How badly a spot collides, for the rare pin that has nowhere clean to go. */
  const clash = (pin: PinSpec, c: Cand): number => {
    const mine: Seg = { a: { x: pin.x, y: pin.y }, b: c.attach };
    let score = c.cy * c.cy * 0.0001 + c.cx * c.cx * 0.0001;
    for (const t of taken) score += overlapArea(c.rect, t);
    for (const d of dots) if (d.id !== pin.id) score += overlapArea(c.rect, d.rect) * 4;
    for (const p of pointers) if (segHitsRect(p, c.rect, 1) || segsCross(mine, p)) score += 60;
    if (o.bounds && !inside(c.rect, o.bounds)) score += 40;
    return score;
  };

  for (const pin of sorted) {
    const attempts = attemptsFor(pin.sizes.length);
    let chosen: Cand | null = null;
    for (const level of [0, 1, 2]) {
      for (const withinBounds of o.bounds ? [true, false] : [false]) {
        for (const [detail, r] of attempts) {
          chosen = candidates(pin, detail, r).find((c) => free(pin, c, withinBounds, level)) ?? null;
          if (chosen) break;
        }
        if (chosen) break;
      }
      if (chosen) break;
    }
    let crowded = false;
    if (!chosen) {
      crowded = true;
      const last = pin.sizes.length - 1;
      let best = Infinity;
      for (let r = 0; r <= 4; r++)
        for (const c of candidates(pin, last, r)) {
          const score = clash(pin, c);
          if (score < best) {
            best = score;
            chosen = c;
          }
        }
    }
    const c = chosen!;
    taken.push(c.rect);
    pointers.push({ a: { x: pin.x, y: pin.y }, b: c.attach });
    done.set(pin.id, { id: pin.id, detail: c.detail, cx: c.cx, cy: c.cy, rect: c.rect, attach: c.attach, crowded });
  }
  return pins.map((p) => done.get(p.id)!);
}
