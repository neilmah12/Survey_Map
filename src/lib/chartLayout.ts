import type { ChartMode, Metric } from '../types';
import { formatMetric } from './format';
import type { SummaryResult, SummaryRow } from './summary';

/**
 * The summary chart as plain shapes. The on-screen chart (SVG) and the exported page (canvas) both draw
 * these, so they cannot drift apart, and every number comes from the same rows as the table beside them.
 * Bars start at zero, a gap is a gap (never a zero bar), and each group says how many comps are behind it.
 */

export const CHART_COLORS = {
  market: '#2a78d6',
  subject: '#eb6834',
  above: '#2a78d6',
  below: '#d03b3b',
  grid: '#e6e8ee',
  zero: '#aeb4c0',
  ink: '#1b2330',
  muted: '#667085',
  surface: '#ffffff',
} as const;

export type Shape =
  | { k: 'path'; d: string; fill: string }
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; w: number }
  | { k: 'dot'; x: number; y: number; r: number; fill: string; ring: string }
  | { k: 'text'; x: number; y: number; s: string; size: number; bold?: boolean; color: string; anchor: 'start' | 'middle' | 'end'; rotate?: number };

/** A region that reports hovering over one summary row. */
export interface Hit { row: number; x: number; y: number; w: number; h: number }

export interface ChartModel {
  width: number;
  height: number;
  shapes: Shape[];
  hits: Hit[];
  /** 'columns' for a few unit types, 'rows' (horizontal) when there are many or the space is narrow. */
  layout: 'columns' | 'rows';
}

export interface LayoutOptions {
  metric: Metric;
  /** Width to draw in. */
  W: number;
  /** Height to fit, when the page leaves a fixed amount of room. */
  H?: number;
  dots: boolean;
  hasSubject: boolean;
}

const EMPTY = (W: number): ChartModel => ({ width: W, height: 0, shapes: [], hits: [], layout: 'columns' });

// ---- scales ----------------------------------------------------------------------------------------------

export function niceStep(max: number, target: number): number {
  const raw = max / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

export interface CompareScale { max: number; step: number; ticks: number[] }

/** A zero-based axis that reaches the tallest figure drawn: bars, comp dots and, for net rent, the base tick. */
export function compareScale(rows: SummaryRow[], metric: Metric): CompareScale {
  let top = 0;
  for (const r of rows) {
    for (const v of [r.market.value, r.subject.value, ...r.comps.map((c) => c.value), metric === 'net' ? r.marketBase : null, metric === 'net' ? r.subjectBase : null]) {
      if (v != null && Number.isFinite(v)) top = Math.max(top, v);
    }
  }
  if (top <= 0) top = 1;
  const step = niceStep(top * 1.12, 4);
  const max = Math.ceil((top * 1.12) / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step / 1000; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { max, step, ticks };
}

export interface DiffScale { maxAbs: number; step: number; ticks: number[] }

/** A symmetric axis around zero, in fractions (0.05 is 5%). */
export function diffScale(rows: SummaryRow[]): DiffScale {
  let m = 0.06;
  for (const r of rows) if (r.diffPct != null) m = Math.max(m, Math.abs(r.diffPct));
  const step = m > 0.2 ? 0.1 : 0.05;
  const maxAbs = Math.ceil((m * 1.15) / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = -maxAbs; v <= maxAbs + step / 1000; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { maxAbs, step, ticks };
}

export const tickText = (v: number, metric: Metric) => formatMetric(v, metric);

export function pctText(p: number): string {
  const x = Math.abs(p * 100);
  const t = x < 0.05 ? '0.0' : x.toFixed(1);
  return `${p > 0 && x >= 0.05 ? '+' : p < 0 && x >= 0.05 ? '-' : ''}${t}%`;
}

/** The base-rent tick on a net rent bar, drawn only when net differs from base by more than a dollar. */
export const baseDiffers = (base: number | null, value: number | null): base is number => base != null && value != null && base - value > 1;

export function compsLabel(n: number, short = false): string {
  if (short) return `n=${n}`;
  return n === 0 ? '0 comps' : n === 1 ? '1 comp only' : `${n} comps`;
}

// ---- text helpers ----------------------------------------------------------------------------------------

const approxW = (s: string, size: number, bold = false) => s.length * size * (bold ? 0.6 : 0.55);

/** Wraps on spaces to at most maxLines lines of about maxPx, ending the last line with "..." when it overflows. */
export function wrapLabel(label: string, maxPx: number, size: number, maxLines = 2): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && approxW(next, size) > maxPx) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const keep = lines.slice(0, maxLines);
    keep[maxLines - 1] = `${keep[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`;
    lines.splice(0, lines.length, ...keep);
  }
  const fit = Math.max(3, Math.floor(maxPx / (size * 0.55)) - 3);
  return lines.map((l) => (approxW(l, size) <= maxPx ? l : `${l.slice(0, fit).trim()}...`));
}

function roundTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
function roundRight(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w, h / 2);
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
}
function roundLeft(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w, h / 2);
  const x2 = x - w;
  return `M${x},${y}H${x2 + rr}Q${x2},${y} ${x2},${y + rr}V${y + h - rr}Q${x2},${y + h} ${x2 + rr},${y + h}H${x}Z`;
}

const C = CHART_COLORS;
const txt = (x: number, y: number, s: string, size: number, color: string, anchor: 'start' | 'middle' | 'end', bold = false, rotate?: number): Shape =>
  ({ k: 'text', x, y, s, size, color, anchor, bold, rotate });

/** A row's name with how many comps are behind it, stacked and vertically centered in its band. */
function labelBlock(shapes: Shape[], r: SummaryRow, x: number, top: number, band: number, maxPx: number, anchor: 'start' | 'end') {
  const lines = wrapLabel(r.label, maxPx, 11.5, 2);
  const n = r.comps.length;
  const total = lines.length + 1;
  let y = top + (band - total * 13) / 2 + 10;
  for (const l of lines) {
    shapes.push(txt(x, y, l, 11.5, C.ink, anchor, true));
    y += 13;
  }
  shapes.push(txt(x, y, compsLabel(n), 10.5, n === 1 ? C.ink : C.muted, anchor, n === 1));
}

// ---- compare: market and subject side by side ------------------------------------------------------------

export function layoutCompare(rows: SummaryRow[], o: LayoutOptions): ChartModel {
  if (rows.length === 0) return EMPTY(o.W);
  const columns = rows.length <= 6 && (o.W - 60) / rows.length >= 52;
  return columns ? compareColumns(rows, o) : compareRows(rows, o);
}

function compareColumns(rows: SummaryRow[], o: LayoutOptions): ChartModel {
  const { W, metric } = o;
  const mL = 52, mR = 8, mT = 22, mB = 60;
  const H = o.H ?? (W >= 560 ? 340 : 300);
  const ph = Math.max(60, H - mT - mB);
  const base = mT + ph;
  const sc = compareScale(rows, metric);
  const y = (v: number) => mT + ph - (v / sc.max) * ph;
  const shapes: Shape[] = [];
  const hits: Hit[] = [];
  for (const t of sc.ticks) {
    shapes.push({ k: 'line', x1: mL, x2: W - mR, y1: y(t), y2: y(t), stroke: t === 0 ? C.zero : C.grid, w: 1 });
    shapes.push(txt(mL - 8, y(t) + 4, tickText(t, metric), 10.5, C.muted, 'end'));
  }
  const gw = (W - mL - mR) / rows.length;
  const bw = Math.min(24, gw * 0.3);
  const rotated = gw < 84;
  rows.forEach((r, i) => {
    const c = mL + i * gw + gw / 2;
    const mx = o.hasSubject ? c - 1 - bw : c - bw / 2;
    const sx = c + 1;
    const showBase = metric === 'net' && baseDiffers(r.marketBase, r.market.value);
    if (r.market.value != null) {
      const v = r.market.value;
      shapes.push({ k: 'path', d: roundTop(mx, y(v), bw, base - y(v), 4), fill: C.market });
      const dots = o.dots ? r.comps.map((k) => k.value) : [];
      const top = Math.max(v, ...dots, showBase ? r.marketBase! : 0);
      const ly = y(top) - (dots.length || showBase ? 11 : 6);
      if (showBase) shapes.push({ k: 'line', x1: mx - 2, x2: mx + bw + 2, y1: y(r.marketBase!), y2: y(r.marketBase!), stroke: C.ink, w: 2 });
      if (rotated) shapes.push(txt(mx + bw / 2 + 4, ly + 2, formatMetric(v, metric), 10.5, C.ink, 'start', false, -90));
      else shapes.push(txt(o.hasSubject ? c - 3 : c, ly, formatMetric(v, metric), 11, C.ink, o.hasSubject ? 'end' : 'middle'));
      if (o.dots) {
        const step = r.comps.length > 1 ? Math.min(7, bw / (r.comps.length - 1)) : 0;
        r.comps.forEach((k, j) => shapes.push({ k: 'dot', x: mx + bw / 2 + (j - (r.comps.length - 1) / 2) * step, y: y(k.value), r: 3.5, fill: C.ink, ring: C.surface }));
      }
    } else {
      shapes.push(txt(o.hasSubject ? c - 3 : c, base - 8, rotated ? 'none' : 'no comps', 10.5, C.muted, o.hasSubject ? 'end' : 'middle'));
    }
    if (o.hasSubject) {
      if (r.subject.value != null) {
        const v = r.subject.value;
        shapes.push({ k: 'path', d: roundTop(sx, y(v), bw, base - y(v), 4), fill: C.subject });
        let top = v;
        if (metric === 'net' && baseDiffers(r.subjectBase, v)) {
          shapes.push({ k: 'line', x1: sx - 2, x2: sx + bw + 2, y1: y(r.subjectBase), y2: y(r.subjectBase), stroke: C.ink, w: 2 });
          top = r.subjectBase;
        }
        if (rotated) shapes.push(txt(sx + bw / 2 + 4, y(top) - 4, formatMetric(v, metric), 10.5, C.ink, 'start', false, -90));
        else shapes.push(txt(c + 3, y(top) - 6, formatMetric(v, metric), 11, C.ink, 'start'));
      } else {
        shapes.push(txt(c + 3, base - 8, rotated ? 'none' : 'no subject', 10.5, C.muted, 'start'));
      }
    }
    const lines = wrapLabel(r.label, gw - 6, 12, 2);
    lines.forEach((l, li) => shapes.push(txt(c, base + 16 + li * 14, l, 12, C.ink, 'middle', true)));
    const n = r.comps.length;
    shapes.push(txt(c, base + 16 + lines.length * 14, compsLabel(n, rotated), 10.5, n === 1 ? C.ink : C.muted, 'middle', n === 1));
    hits.push({ row: i, x: c - gw / 2, y: mT, w: gw, h: ph + mB - 4 });
  });
  return { width: W, height: mT + ph + mB, shapes, hits, layout: 'columns' };
}

function compareRows(rows: SummaryRow[], o: LayoutOptions): ChartModel {
  const { W, metric } = o;
  const labelW = Math.min(150, Math.round(W * 0.36));
  const mR = 56, mT = 22;
  const n = rows.length;
  const rowH = o.H != null ? Math.max(24, Math.min(40, (o.H - mT - 6) / n)) : 40;
  const barH = rowH >= 34 ? 12 : 9;
  const pw = W - labelW - mR;
  const sc = compareScale(rows, metric);
  const x = (v: number) => labelW + (v / sc.max) * pw;
  const H = mT + n * rowH + 6;
  const shapes: Shape[] = [];
  const hits: Hit[] = [];
  for (const t of sc.ticks) {
    shapes.push({ k: 'line', x1: x(t), x2: x(t), y1: mT - 6, y2: H - 4, stroke: t === 0 ? C.zero : C.grid, w: 1 });
    shapes.push(txt(x(t), mT - 10, tickText(t, metric), 10.5, C.muted, 'middle'));
  }
  rows.forEach((r, i) => {
    const top = mT + i * rowH;
    const my = top + (rowH - (2 * barH + 2)) / 2;
    const sy = my + barH + 2;
    labelBlock(shapes, r, 0, top, rowH, labelW - 10, 'start');
    const none = (yy: number, s: string) => shapes.push(txt(labelW + 6, yy + barH - 1, s, 10.5, C.muted, 'start'));
    if (r.market.value != null) {
      const v = r.market.value;
      shapes.push({ k: 'path', d: roundRight(labelW, my, Math.max(1, x(v) - labelW), barH, 3), fill: C.market });
      let edge = x(v);
      if (metric === 'net' && baseDiffers(r.marketBase, v)) {
        shapes.push({ k: 'line', x1: x(r.marketBase), x2: x(r.marketBase), y1: my - 2, y2: my + barH + 2, stroke: C.ink, w: 2 });
        edge = Math.max(edge, x(r.marketBase));
      }
      if (o.dots) {
        for (const k of r.comps) {
          shapes.push({ k: 'dot', x: x(k.value), y: my + barH / 2, r: barH >= 12 ? 3.5 : 3, fill: C.ink, ring: C.surface });
          edge = Math.max(edge, x(k.value) + 4);
        }
      }
      shapes.push(txt(edge + 6, my + barH - 1.5, formatMetric(v, metric), 10.5, C.ink, 'start'));
    } else none(my, 'no comps');
    if (o.hasSubject) {
      if (r.subject.value != null) {
        const v = r.subject.value;
        shapes.push({ k: 'path', d: roundRight(labelW, sy, Math.max(1, x(v) - labelW), barH, 3), fill: C.subject });
        let edge = x(v);
        if (metric === 'net' && baseDiffers(r.subjectBase, v)) {
          shapes.push({ k: 'line', x1: x(r.subjectBase), x2: x(r.subjectBase), y1: sy - 2, y2: sy + barH + 2, stroke: C.ink, w: 2 });
          edge = Math.max(edge, x(r.subjectBase));
        }
        shapes.push(txt(edge + 6, sy + barH - 1.5, formatMetric(v, metric), 10.5, C.ink, 'start'));
      } else none(sy, 'no subject');
    }
    hits.push({ row: i, x: 0, y: top, w: W, h: rowH });
  });
  return { width: W, height: H, shapes, hits, layout: 'rows' };
}

// ---- difference: how far the subject sits from the market ------------------------------------------------

export function layoutDiff(rows: SummaryRow[], o: Pick<LayoutOptions, 'W' | 'H'>): ChartModel {
  if (rows.length === 0) return EMPTY(o.W);
  const { W } = o;
  const labelW = Math.min(130, Math.round(W * 0.32));
  const mR = 58, mT = 24; // the right column holds every row's percentage, so no value runs into a label
  const rowH = o.H != null ? Math.max(28, Math.min(46, (o.H - mT - 6) / rows.length)) : rows.length > 8 ? 36 : 46;
  const barH = rowH >= 40 ? 18 : 14;
  const H = mT + rows.length * rowH + 6;
  const sc = diffScale(rows);
  const pw = W - labelW - mR;
  const x = (v: number) => labelW + pw / 2 + (v / sc.maxAbs) * (pw / 2);
  const zx = x(0);
  const shapes: Shape[] = [];
  const hits: Hit[] = [];
  const zeroAt = sc.ticks.findIndex((t) => Math.abs(t) < 1e-9);
  const sparse = pw / Math.max(1, sc.ticks.length - 1) < 36; // label every other tick when they would touch
  sc.ticks.forEach((t, i) => {
    shapes.push({ k: 'line', x1: x(t), x2: x(t), y1: mT - 6, y2: H - 4, stroke: t === 0 ? C.zero : C.grid, w: 1 });
    if (!sparse || (i - zeroAt) % 2 === 0) shapes.push(txt(x(t), mT - 10, t === 0 ? '0%' : pctText(t).replace('.0%', '%'), 10.5, C.muted, 'middle'));
  });
  shapes.push(txt(W - 2, mT - 10, 'Difference', 10.5, C.muted, 'end'));
  rows.forEach((r, i) => {
    const top = mT + i * rowH;
    const cy = top + rowH / 2;
    labelBlock(shapes, r, labelW - 10, top, rowH, labelW - 14, 'end');
    if (r.diffPct == null) {
      shapes.push(txt(labelW + 8, cy + 4, r.market.value == null ? 'No market comps to compare' : 'No subject units of this type', 11, C.muted, 'start'));
    } else {
      const w = Math.max(2, Math.abs(x(r.diffPct) - zx));
      shapes.push(r.diffPct >= 0 ? { k: 'path', d: roundRight(zx, cy - barH / 2, w, barH, 4), fill: C.above } : { k: 'path', d: roundLeft(zx, cy - barH / 2, w, barH, 4), fill: C.below });
      shapes.push(txt(W - 2, cy + 4, pctText(r.diffPct), 11.5, C.ink, 'end', true));
    }
    hits.push({ row: i, x: 0, y: top, w: W, h: rowH });
  });
  return { width: W, height: H, shapes, hits, layout: 'rows' };
}

export function layoutChart(result: SummaryResult, mode: Exclude<ChartMode, 'off'>, o: Omit<LayoutOptions, 'hasSubject'>): ChartModel {
  return mode === 'diff' ? layoutDiff(result.rows, o) : layoutCompare(result.rows, { ...o, hasSubject: result.hasSubject });
}

// ---- notes under the chart -------------------------------------------------------------------------------

/** What the chart cannot show, said once per kind however many unit types are affected. */
export function chartNotes(result: SummaryResult, mode: Exclude<ChartMode, 'off'>): string[] {
  const out: string[] = [];
  const left = mode === 'diff' ? ' Left out of this view.' : '';
  const noComps = result.rows.filter((r) => r.market.value == null && r.subject.value != null).map((r) => r.label);
  const noSubject = result.hasSubject ? result.rows.filter((r) => r.subject.value == null && r.market.value != null).map((r) => r.label) : [];
  const one = result.rows.filter((r) => r.comps.length === 1 && r.market.value != null).map((r) => `${r.label} (${r.comps[0].name})`);
  if (noComps.length) out.push(`No comparable in the market: ${noComps.join(', ')}.${left}`);
  if (noSubject.length) out.push(`The subject has none of: ${noSubject.join(', ')}.${left}`);
  if (one.length) out.push(`One building only, so not an average: ${one.join(', ')}.`);
  return out;
}

/** The same notes for the printed page, where every line costs room. */
export const exportNotes = (result: SummaryResult): string[] => chartNotes(result, 'compare');
