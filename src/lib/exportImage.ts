import * as maplibregl from 'maplibre-gl';
import type { LngLat, Survey, ViewSettings } from '../types';
import { BLANK_STYLE, MAP_CREDIT, initialStyle } from './basemap';
import { circleCoords, haversineKm, ringTop } from './geo';
import { METRIC_LABEL, formatDate, pinLabel } from './format';
import { netDefinition, netOf } from './net';
import { kindContext, visibleUnits } from './groups';
import { pinBadges, type PinBadge } from './utilities';
import { layoutPins, type Point, type Size } from './pinLayout';
import { pinNumbers } from './pinNumbers';
import { computeSummary } from './summary';
import { fmtKm, maxRingKm, ringRadii, scopeSurvey } from './scope';
import { fmtDiff, fmtValue } from './summaryFormat';
import { CHART_COLORS, exportNotes, layoutChart } from './chartLayout';
import { chartKeys, drawChartKeys, drawChartModel } from './exportChart';
import {
  filterCaption, legendItems, metricCaption, niceScale, pageRegions, summaryFootnotes, wrapText, type Box, type LegendItem, type PageKind,
} from './exportLayout';

export interface ExportOptions {
  /** Only buildings with a pin, so the page matches the client file. */
  survey: Survey;
  view: ViewSettings;
  page: PageKind;
  /** 150 for screens and Word, 300 for print. */
  dpi: number;
  extent: 'view' | 'all';
  viewBounds?: [LngLat, LngLat] | null;
  includeSummary: boolean;
  /** The chart inside the summary, when the view has one turned on. */
  includeChart?: boolean;
  includeLegend: boolean;
  sourceNote: string;
  logoUrl: string;
}

export interface ExportResult {
  canvas: HTMLCanvasElement;
  /** False when the street map could not load and the page uses a plain background. */
  basemapLoaded: boolean;
  /** Page size in CSS pixels (96 per inch). */
  size: { w: number; h: number };
}

const NAVY = '#002060';
const INK = '#1b2330';
const MUTED = '#667085';
const LINE = '#d9dee7';
const AMBER = '#f0a500';
const FONT = 'Arial, Helvetica, sans-serif';

function boundsFor(o: ExportOptions): [LngLat, LngLat] {
  if (o.extent === 'view' && o.viewBounds) return o.viewBounds;
  const ctx = kindContext(o.survey);
  const shown = o.survey.buildings.filter((b) => b.lngLat && visibleUnits(b, { filters: o.view.filters, ctx }).length > 0);
  const pts = shown.map((b) => b.lngLat!);
  if (pts.length === 0) return [[-113.7, 53.4], [-113.3, 53.7]];
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lng, lat] of pts) [w, s, e, n] = [Math.min(w, lng), Math.min(s, lat), Math.max(e, lng), Math.max(n, lat)];
  const km = maxRingKm(o.view);
  if (km > 0) {
    for (const b of shown.filter((x) => x.isSubject && !x.out)) {
      const [lng, lat] = b.lngLat!;
      const dLat = km / 111.32;
      const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180));
      [w, s, e, n] = [Math.min(w, lng - dLng), Math.min(s, lat - dLat), Math.max(e, lng + dLng), Math.max(n, lat + dLat)];
    }
  }
  const pad = 0.004; // a single pin still gets a sensible area
  return [[w - pad, s - pad], [e + pad, n + pad]];
}

/** Builds a map at the exact page size and waits until it has drawn. */
async function drawnMap(w: number, h: number, scale: number, bounds: [LngLat, LngLat]) {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;left:-10000px;top:0;width:${w}px;height:${h}px;`;
  document.body.appendChild(el);
  const map = new maplibregl.Map({
    container: el,
    style: initialStyle(),
    bounds,
    fitBoundsOptions: { padding: 40, maxZoom: 16 },
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    pixelRatio: scale,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  let fellBack = false;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    map.on('idle', () => map.loaded() && finish());
    setTimeout(() => {
      if (!map.isStyleLoaded()) {
        fellBack = true;
        map.setStyle(BLANK_STYLE); // the street map could not load; carry on with a plain background
      }
    }, 9000);
    setTimeout(finish, 30000);
  });
  return { map, el, basemapLoaded: !fellBack };
}

const loadImage = (url: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}...`).width > maxW) t = t.slice(0, -1);
  return `${t.trim()}...`;
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = 'left') {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
}

function drawHeader(ctx: CanvasRenderingContext2D, box: Box, o: ExportOptions, logo: HTMLImageElement | null) {
  if (logo) {
    const h = Math.min(60, box.h - 10);
    const w = (logo.naturalWidth / logo.naturalHeight) * h;
    ctx.drawImage(logo, box.x, box.y + (box.h - h) / 2 - 2, w, h);
  }
  const cx = box.x + box.w / 2;
  text(ctx, 'Rental Market Survey', cx, box.y + 24, `700 18px ${FONT}`, INK, 'center');
  text(ctx, o.survey.title, cx, box.y + 46, `400 16px ${FONT}`, INK, 'center');
  text(ctx, o.survey.location, cx, box.y + 65, `400 13px ${FONT}`, MUTED, 'center');
  text(ctx, `As of ${formatDate(o.survey.asOf)}`, box.x + box.w, box.y + 24, `400 12px ${FONT}`, MUTED, 'right');
  ctx.fillStyle = NAVY;
  ctx.fillRect(box.x, box.y + box.h - 3, box.w, 3);
}

function drawFooter(ctx: CanvasRenderingContext2D, box: Box, note: string) {
  ctx.fillStyle = LINE;
  ctx.fillRect(box.x, box.y, box.w, 1);
  ctx.font = `400 11px ${FONT}`;
  if (note.trim()) text(ctx, ellipsize(ctx, note.trim(), box.w), box.x, box.y + 20, `400 11px ${FONT}`, MUTED);
}

interface PinDraw {
  b: Survey['buildings'][number];
  num: number | undefined;
  label: string;
  badges: PinBadge[];
  excluded: boolean;
  p: Point;
  name: string;
  sizes: Size[];
}

// The pill's measurements, the same as the on-screen pin's (src/styles.css), so the page matches the map.
const PILL = { pad: 5, num: 22, gap: 8, right: 12, border: 3, fullH: 40, compactH: 33, nameMax: 205 };
const NAME_FONT = `600 12px ${FONT}`;
const RATE_FONT = `700 12.5px ${FONT}`;
const BADGE_FONT = `700 10px ${FONT}`;
const PIN_BLUE = CHART_COLORS.market;
const PIN_ORANGE = CHART_COLORS.subject;

function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
}

function drawPins(ctx: CanvasRenderingContext2D, mapBox: Box, map: maplibregl.Map, o: ExportOptions) {
  const kctx = kindContext(o.survey);
  const filter = { filters: o.view.filters, ctx: kctx };
  const numbers = pinNumbers(o.survey.buildings);
  const pins: PinDraw[] = [];
  for (const b of o.survey.buildings) {
    if (!b.lngLat) continue;
    const units = visibleUnits(b, filter);
    if (units.length === 0) continue;
    const pt = map.project(b.lngLat);
    const p = { x: mapBox.x + pt.x, y: mapBox.y + pt.y };
    if (p.x < mapBox.x - 40 || p.x > mapBox.x + mapBox.w + 40 || p.y < mapBox.y - 10 || p.y > mapBox.y + mapBox.h + 60) continue;
    const label = pinLabel(b, filter, o.view.metric, netOf(o.survey));
    const badges = pinBadges(units);
    ctx.font = NAME_FONT;
    const name = ellipsize(ctx, b.name, PILL.nameMax);
    const nameW = ctx.measureText(name).width;
    ctx.font = RATE_FONT;
    const rateW = ctx.measureText(label).width;
    ctx.font = BADGE_FONT;
    const tagsW = badges.reduce((w, x) => w + ctx.measureText(x.text).width + 12 + 6, 0);
    const lead = PILL.pad + PILL.num + PILL.gap;
    const full = { w: lead + Math.max(nameW, rateW + tagsW) + PILL.right + PILL.border, h: PILL.fullH };
    const compact = { w: lead + rateW + badges.length * 14 + PILL.right + PILL.border, h: PILL.compactH };
    pins.push({ b, num: numbers.get(b.id), label, badges, excluded: Boolean(b.excluded) || Boolean(b.out) || units.every((u) => u.excluded), p, name, sizes: [full, compact] });
  }
  // A page keeps the price on every pill, so there is no number-only size here: it falls back to the compact pill.
  const plan = new Map(
    layoutPins(
      pins.map((x) => ({ id: x.b.id, x: x.p.x, y: x.p.y, sizes: x.sizes, order: x.b.isSubject ? -1 : (x.num ?? 9999) })),
      { bounds: { l: mapBox.x + 4, t: mapBox.y + 4, r: mapBox.x + mapBox.w - 4, b: mapBox.y + mapBox.h - 4 } },
    ).map((x) => [x.id, x]),
  );
  const faded = (pin: PinDraw) => (pin.excluded ? 0.55 : 1);

  // Three passes, so a pointer never lands on top of a pill: pointers, then dots, then pills.
  for (const pin of pins) {
    const pl = plan.get(pin.b.id)!;
    ctx.save();
    ctx.globalAlpha = faded(pin);
    ctx.strokeStyle = pin.b.isSubject ? PIN_ORANGE : '#667085';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pin.p.x, pin.p.y);
    ctx.lineTo(pl.attach.x, pl.attach.y);
    ctx.stroke();
    ctx.restore();
  }
  for (const pin of pins) {
    ctx.save();
    ctx.globalAlpha = faded(pin);
    ctx.beginPath();
    ctx.arc(pin.p.x, pin.p.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = pin.b.isSubject ? PIN_ORANGE : PIN_BLUE;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.restore();
  }
  for (const pin of pins) {
    const pl = plan.get(pin.b.id)!;
    const { l, t, r, b: bottom } = pl.rect;
    const w = r - l;
    const h = bottom - t;
    const cy = t + h / 2;
    const subject = pin.b.isSubject;
    ctx.save();
    ctx.globalAlpha = faded(pin);
    ctx.shadowColor = 'rgba(16,24,40,.25)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    roundRectPath(ctx, l, t, w, h, h / 2);
    ctx.fillStyle = subject ? PIN_ORANGE : '#fff';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = subject ? PIN_ORANGE : '#98a2b3';
    if (pin.excluded) ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    // The number (a star for the subject)
    const nx = l + 1.5 + PILL.pad + PILL.num / 2;
    ctx.beginPath();
    ctx.arc(nx, cy, PILL.num / 2, 0, Math.PI * 2);
    ctx.fillStyle = subject ? 'rgba(255,255,255,.28)' : PIN_BLUE;
    ctx.fill();
    if (subject) {
      starPath(ctx, nx, cy, 6.5);
      ctx.fillStyle = '#fff';
      ctx.fill();
    } else if (pin.num != null) {
      ctx.font = `700 12px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(String(pin.num), nx, cy + 0.5);
    }
    const tx = l + 1.5 + PILL.pad + PILL.num + PILL.gap;
    const ink = subject ? '#fff' : INK;
    const priceInk = subject ? '#fff' : NAVY;
    ctx.textAlign = 'left';
    if (pl.detail === 0) {
      ctx.textBaseline = 'alphabetic';
      ctx.font = NAME_FONT;
      ctx.fillStyle = ink;
      ctx.fillText(pin.name, tx, cy - 3.5);
      ctx.font = RATE_FONT;
      ctx.fillStyle = priceInk;
      ctx.fillText(pin.label, tx, cy + 11);
      const rateW = ctx.measureText(pin.label).width;
      ctx.font = BADGE_FONT;
      ctx.textBaseline = 'middle';
      let bx = tx + rateW + 6;
      for (const x of pin.badges) {
        const bw = ctx.measureText(x.text).width + 12;
        drawBadge(ctx, x, bx, cy - 1.5, bw, 15);
        bx += bw + 6;
      }
    } else {
      ctx.textBaseline = 'middle';
      ctx.font = RATE_FONT;
      ctx.fillStyle = priceInk;
      ctx.fillText(pin.label, tx, cy + 0.5);
      let bx = tx + ctx.measureText(pin.label).width + 6;
      for (const x of pin.badges) {
        ctx.beginPath();
        ctx.arc(bx + 4, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = BADGE_STYLE[x.kind].bg;
        ctx.fill();
        bx += 14;
      }
    }
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }
}

function drawRings(ctx: CanvasRenderingContext2D, mapBox: Box, map: maplibregl.Map, o: ExportOptions) {
  const subjects = o.survey.buildings.filter((b) => b.isSubject && !b.out && b.lngLat);
  const radii = ringRadii(o.view);
  if (radii.length === 0 || subjects.length === 0) return;
  ctx.save();
  ctx.strokeStyle = NAVY;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  for (const s of subjects)
    for (const km of radii) {
      ctx.beginPath();
      circleCoords(s.lngLat!, km, 144).forEach((c, i) => {
        const pt = map.project(c);
        if (i === 0) ctx.moveTo(mapBox.x + pt.x, mapBox.y + pt.y);
        else ctx.lineTo(mapBox.x + pt.x, mapBox.y + pt.y);
      });
      ctx.stroke();
    }
  ctx.restore();
  // Label each ring once, at the top of the first subject's rings, when it is big enough to read
  const c = subjects[0].lngLat!;
  const centre = map.project(c);
  for (const km of radii) {
    const top = map.project(ringTop(c, km));
    if (Math.abs(centre.y - top.y) < 50) continue;
    const label = fmtKm(km);
    ctx.font = `600 10.5px ${FONT}`;
    const w = ctx.measureText(label).width + 8;
    const x = mapBox.x + top.x;
    const y = mapBox.y + top.y;
    ctx.fillStyle = 'rgba(255,255,255,.88)';
    ctx.fillRect(x - w / 2, y - 16, w, 15);
    text(ctx, label, x, y - 5, `600 10.5px ${FONT}`, NAVY, 'center');
  }
}

function drawMapFurniture(ctx: CanvasRenderingContext2D, mapBox: Box, map: maplibregl.Map, w: number, h: number) {
  // Scale bar from the real ground distance across 100 px at the middle of the map
  const a = map.unproject([w / 2, h / 2]);
  const b = map.unproject([w / 2 + 100, h / 2]);
  const mpp = (haversineKm([a.lng, a.lat], [b.lng, b.lat]) * 1000) / 100;
  const bar = niceScale(mpp, 130);
  const x = mapBox.x + 12;
  const y = mapBox.y + mapBox.h - 14;
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fillRect(x - 6, y - 22, bar.px + 12 + 8, 30);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y - 6);
  ctx.lineTo(x, y);
  ctx.lineTo(x + bar.px, y);
  ctx.lineTo(x + bar.px, y - 6);
  ctx.stroke();
  text(ctx, bar.label, x, y - 10, `600 10.5px ${FONT}`, INK);
  // The street map's required credit
  ctx.font = `400 8.5px ${FONT}`;
  const cw = ctx.measureText(MAP_CREDIT).width + 8;
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fillRect(mapBox.x + mapBox.w - cw, mapBox.y + mapBox.h - 14, cw, 14);
  text(ctx, MAP_CREDIT, mapBox.x + mapBox.w - 4, mapBox.y + mapBox.h - 4, `400 8.5px ${FONT}`, MUTED, 'right');
}

const BADGE_STYLE: Record<PinBadge['kind'], { bg: string; ink: string }> = {
  incentive: { bg: AMBER, ink: '#3a2a00' },
  utils: { bg: '#d3eef0', ink: '#0b4f5c' },
};

/** One pin tag. The caller sets the font and a middle text baseline. */
function drawBadge(ctx: CanvasRenderingContext2D, b: PinBadge, x: number, y: number, w: number, h = 16) {
  roundRectPath(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = BADGE_STYLE[b.kind].bg;
  ctx.fill();
  ctx.fillStyle = BADGE_STYLE[b.kind].ink;
  ctx.textAlign = 'center';
  ctx.fillText(b.text, x + w / 2, y + h / 2 + 0.5);
}

function legendGlyph(ctx: CanvasRenderingContext2D, kind: LegendItem['kind'], x: number, y: number) {
  ctx.save();
  if (kind === 'rings') {
    ctx.strokeStyle = NAVY;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(x, y + 8);
    ctx.lineTo(x + 34, y + 8);
    ctx.stroke();
  } else if (kind === 'incentive' || kind === 'utils') {
    // A sample tag, shrunk to the glyph column: the label beside it says what it means.
    ctx.font = `700 8px ${FONT}`;
    ctx.textBaseline = 'middle';
    drawBadge(ctx, { kind, text: kind === 'utils' ? 'Utils' : 'Inc.' }, x, y + 1, 34, 15);
  } else {
    // A small pill like the real ones: a number circle, then the rest of the pill
    ctx.globalAlpha = kind === 'excluded' ? 0.55 : 1;
    roundRectPath(ctx, x, y + 1, 34, 15, 7.5);
    ctx.fillStyle = kind === 'subject' ? PIN_ORANGE : '#fff';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = kind === 'subject' ? PIN_ORANGE : '#98a2b3';
    if (kind === 'excluded') ctx.setLineDash([3, 2]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x + 8.5, y + 8.5, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = kind === 'subject' ? 'rgba(255,255,255,.35)' : PIN_BLUE;
    ctx.fill();
    if (kind === 'subject') {
      starPath(ctx, x + 8.5, y + 8.5, 4);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawPanel(ctx: CanvasRenderingContext2D, box: Box, o: ExportOptions) {
  let y = box.y + 14;
  const result = computeSummary(o.survey, { metric: o.view.metric, filters: o.view.filters, settings: o.view.summary });
  const items = o.includeLegend ? legendItems(o.survey, o.view) : [];
  const legendH = items.length ? 22 + items.length * 21 : 0;

  if (o.includeSummary) {
    text(ctx, 'Market summary', box.x, y + 2, `700 15px ${FONT}`, NAVY);
    y += 18;
    const sub = `${METRIC_LABEL[o.view.metric]}, ${o.view.summary.stat === 'avg' ? 'average' : 'median'} of ${result.marketBuildings} comparable building${result.marketBuildings === 1 ? '' : 's'}${result.hasSubject ? ', subject excluded' : ''}${o.view.within != null && o.view.within > 0 ? `, within ${fmtKm(o.view.within)} of the subject` : ''}`;
    ctx.font = `400 10.5px ${FONT}`;
    const subFull = o.view.metric === 'net' ? `${sub}. ${netDefinition(netOf(o.survey))}` : sub;
    for (const line of wrapText(subFull, box.w, (s) => ctx.measureText(s).width)) {
      text(ctx, line, box.x, y, `400 10.5px ${FONT}`, MUTED);
      y += 13;
    }
    const fc = filterCaption(o.view.filters);
    if (fc) for (const line of wrapText(fc, box.w, (s) => ctx.measureText(s).width)) { text(ctx, line, box.x, y, `400 10.5px ${FONT}`, MUTED); y += 13; }
    y += 6;

    const sj = result.hasSubject;
    const rows = result.rows;
    const mode = o.view.summary.chart;
    const wantChart = o.includeChart !== false && mode !== 'off' && rows.length > 0 && (mode !== 'diff' || sj);
    const foot = [...summaryFootnotes(result, o.view.summary.perBuilding, result.subjectBuildings), ...(wantChart ? exportNotes(result) : [])];
    const reserve = foot.length * 13 + 10 + legendH + 8;

    if (wantChart) {
      const tableNeed = 30 + rows.length * 21; // the table keeps every row: the chart takes only what is left
      const avail = box.y + box.h - reserve - y - tableNeed - 22;
      const opts = { metric: o.view.metric, W: box.w };
      let model = layoutChart(result, mode, opts);
      if (model.height > avail) model = layoutChart(result, mode, { ...opts, H: avail });
      if (model.height <= avail && model.height >= 140) {
        const keys = chartKeys(mode, { stat: o.view.summary.stat, hasSubject: sj });
        y += drawChartKeys(ctx, keys, box.x, y + 8, box.w, FONT) + 6;
        drawChartModel(ctx, model, box.x, y, FONT);
        y += model.height + 10;
      } else {
        foot.push('The chart is left out: this page has no room for it with the table. Use a larger page or turn off the legend.');
      }
    }

    const colM = 58, colS = sj ? 58 : 0, colD = sj ? 104 : 0;
    const labelW = box.w - colM - colS - colD - 4;
    const xM = box.x + labelW + colM;
    const xS = xM + colS;
    const xD = box.x + box.w;
    text(ctx, 'UNIT TYPE', box.x, y, `700 9px ${FONT}`, MUTED);
    text(ctx, 'MARKET', xM, y, `700 9px ${FONT}`, MUTED, 'right');
    if (sj) {
      text(ctx, 'SUBJECT', xS, y, `700 9px ${FONT}`, MUTED, 'right');
      text(ctx, 'DIFFERENCE', xD, y, `700 9px ${FONT}`, MUTED, 'right');
    }
    y += 5;
    ctx.fillStyle = LINE;
    ctx.fillRect(box.x, y, box.w, 1);
    y += 5;
    let shown = 0;
    for (const r of rows) {
      const font = `400 11px ${FONT}`;
      ctx.font = font;
      const lines = wrapText(r.label, labelW - 4, (s) => ctx.measureText(s).width);
      const rowH = lines.length * 13 + 8;
      if (y + rowH > box.y + box.h - reserve) break;
      if (shown % 2 === 1) {
        ctx.fillStyle = '#edf1f8'; // soft banding on every second row, so the rows hold together on a screenshot
        ctx.fillRect(box.x - 3, y - 2, box.w + 6, rowH);
      }
      lines.forEach((l, i) => text(ctx, l, box.x, y + 10 + i * 13, font, INK));
      text(ctx, fmtValue(r.market, o.view.metric), xM, y + 10, font, INK, 'right');
      if (sj) {
        text(ctx, fmtValue(r.subject, o.view.metric), xS, y + 10, font, INK, 'right');
        text(ctx, fmtDiff(r, o.view.metric), xD, y + 10, font, INK, 'right');
      }
      y += rowH;
      ctx.fillStyle = '#d3dae6';
      ctx.fillRect(box.x, y - 3, box.w, 1);
      shown++;
    }
    if (shown < rows.length) {
      text(ctx, `${rows.length - shown} more unit types not shown`, box.x, y + 10, `400 10px ${FONT}`, MUTED);
      y += 14;
    }
    y += 6;
    for (const line of foot) {
      ctx.font = `400 9.5px ${FONT}`;
      for (const w of wrapText(line, box.w, (s) => ctx.measureText(s).width)) {
        text(ctx, w, box.x, y + 8, `400 9.5px ${FONT}`, MUTED);
        y += 12;
      }
    }
    y += 10;
  }

  if (items.length) {
    text(ctx, 'Legend', box.x, y + 4, `700 12px ${FONT}`, NAVY);
    y += 12;
    for (const it of items) {
      legendGlyph(ctx, it.kind, box.x, y);
      ctx.font = `400 10.5px ${FONT}`;
      text(ctx, ellipsize(ctx, it.label, box.w - 46), box.x + 44, y + 12, `400 10.5px ${FONT}`, INK);
      y += 21;
    }
    ctx.font = `400 9.5px ${FONT}`;
    for (const line of wrapText(metricCaption(o.view, netOf(o.survey)), box.w, (s) => ctx.measureText(s).width)) {
      text(ctx, line, box.x, y + 8, `400 9.5px ${FONT}`, MUTED);
      y += 12;
    }
  }
}

/** Draws the finished page: header, map with pins, rings, scale bar and credit, summary, legend and source line. */
export async function renderExport(options: ExportOptions): Promise<ExportResult> {
  // The same scope as the screen: who is compared with whom, and how far away.
  const o: ExportOptions = { ...options, survey: scopeSurvey(options.survey, options.view) };
  const regions = pageRegions(o.page, o.includeSummary || o.includeLegend);
  const scale = o.dpi / 96;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(regions.page.w * scale);
  canvas.height = Math.round(regions.page.h * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, regions.page.w, regions.page.h);

  const [logo, rendered] = await Promise.all([loadImage(o.logoUrl), drawnMap(regions.map.w, regions.map.h, scale, boundsFor(o))]);
  const { map, el, basemapLoaded } = rendered;
  try {
    drawHeader(ctx, regions.header, o, logo);
    const m = regions.map;
    ctx.save();
    ctx.beginPath();
    ctx.rect(m.x, m.y, m.w, m.h);
    ctx.clip();
    ctx.drawImage(map.getCanvas(), m.x, m.y, m.w, m.h); // 1:1, since the map canvas is m.w * scale wide
    drawRings(ctx, m, map, o);
    drawPins(ctx, m, map, o);
    drawMapFurniture(ctx, m, map, m.w, m.h);
    ctx.restore();
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.strokeRect(m.x + 0.5, m.y + 0.5, m.w - 1, m.h - 1);
    if (regions.panel) drawPanel(ctx, regions.panel, o);
    drawFooter(ctx, regions.footer, o.sourceNote);
  } finally {
    map.remove();
    el.remove();
  }
  return { canvas, basemapLoaded, size: regions.page };
}

export const canvasToBlob = (c: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image'))), type, quality));
