import type { Stat } from '../types';
import { CHART_COLORS as C, type ChartModel } from './chartLayout';

/** Draws a chart model onto the export canvas at (ox, oy). The same shapes the on-screen chart draws. */
export function drawChartModel(ctx: CanvasRenderingContext2D, m: ChartModel, ox: number, oy: number, font: string) {
  ctx.save();
  ctx.translate(ox, oy);
  for (const s of m.shapes) {
    if (s.k === 'path') {
      ctx.fillStyle = s.fill;
      ctx.fill(new Path2D(s.d));
    } else if (s.k === 'line') {
      ctx.strokeStyle = s.stroke;
      ctx.lineWidth = s.w;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
    } else {
      ctx.save();
      ctx.font = `${s.bold ? 700 : 400} ${s.size}px ${font}`;
      ctx.fillStyle = s.color;
      ctx.textAlign = s.anchor === 'middle' ? 'center' : s.anchor === 'end' ? 'right' : 'left';
      ctx.textBaseline = 'alphabetic';
      if (s.rotate) {
        ctx.translate(s.x, s.y);
        ctx.rotate((s.rotate * Math.PI) / 180);
        ctx.fillText(s.s, 0, 0);
      } else ctx.fillText(s.s, s.x, s.y);
      ctx.restore();
    }
  }
  ctx.restore();
}

export interface ChartKey { color: string; label: string }

export function chartKeys(mode: 'compare' | 'diff', o: { stat: Stat; hasSubject: boolean }): ChartKey[] {
  if (mode === 'diff') return [{ color: C.below, label: 'Subject below market' }, { color: C.above, label: 'Subject above market' }];
  const keys: ChartKey[] = [{ color: C.market, label: `Market (${o.stat === 'median' ? 'median' : 'average'} of comps)` }];
  if (o.hasSubject) keys.push({ color: C.subject, label: 'Subject' });
  return keys;
}

/** The key above the chart, wrapping to a second line when it runs out of width. Returns the height used. */
export function drawChartKeys(ctx: CanvasRenderingContext2D, keys: ChartKey[], x: number, y: number, maxW: number, font: string): number {
  let cx = x;
  let cy = y;
  ctx.font = `400 10px ${font}`;
  for (const k of keys) {
    const w = 14 + ctx.measureText(k.label).width + 12;
    if (cx > x && cx + w > x + maxW) {
      cx = x;
      cy += 14;
    }
    ctx.fillStyle = k.color;
    ctx.fillRect(cx, cy - 8, 9, 9);
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(k.label, cx + 14, cy);
    cx += w;
  }
  return cy - y + 8;
}
