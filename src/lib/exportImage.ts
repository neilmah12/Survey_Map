import * as maplibregl from 'maplibre-gl';
import type { LngLat, Survey, ViewSettings } from '../types';
import { BLANK_STYLE, MAP_CREDIT, initialStyle } from './basemap';
import { circleCoords, haversineKm, ringTop } from './geo';
import { METRIC_LABEL, formatDate, pinLabel } from './format';
import { kindContext, visibleUnits } from './groups';
import { layoutPins, type PinBox } from './pinLayout';
import { computeSummary } from './summary';
import { fmtDiff, fmtValue } from './summaryFormat';
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
  if (o.view.rings) {
    const km = Math.max(...o.view.ringsKm, 0);
    for (const b of shown.filter((x) => x.isSubject)) {
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

interface PinDraw { b: Survey['buildings'][number]; label: string; badge: boolean; excluded: boolean; p: { x: number; y: number }; box: PinBox; pillW: number; nameW: number }

function drawPins(ctx: CanvasRenderingContext2D, mapBox: Box, map: maplibregl.Map, o: ExportOptions) {
  const kctx = kindContext(o.survey);
  const filter = { filters: o.view.filters, ctx: kctx };
  const pins: PinDraw[] = [];
  let order = 0;
  for (const b of o.survey.buildings) {
    if (!b.lngLat) continue;
    const units = visibleUnits(b, filter);
    if (units.length === 0) continue;
    const pt = map.project(b.lngLat);
    const p = { x: mapBox.x + pt.x, y: mapBox.y + pt.y };
    if (p.x < mapBox.x - 40 || p.x > mapBox.x + mapBox.w + 40 || p.y < mapBox.y - 10 || p.y > mapBox.y + mapBox.h + 60) continue;
    const label = pinLabel(b, filter, o.view.metric);
    const badge = units.some((u) => u.incentive);
    ctx.font = `700 13px ${FONT}`;
    const tw = ctx.measureText(label).width;
    ctx.font = `700 10px ${FONT}`;
    const badgeW = badge ? ctx.measureText('Inc').width + 12 : 0;
    const pillW = tw + 20 + (badge ? badgeW + 6 : 0);
    ctx.font = `600 11px ${FONT}`;
    const nameW = ctx.measureText(b.name).width;
    const tipTop = p.y - 8;
    const nameTop = tipTop - 14;
    const pillBottom = nameTop - 2;
    const box: PinBox = {
      id: b.id, order: b.isSubject ? -1 : order++,
      pill: { l: p.x - pillW / 2, r: p.x + pillW / 2, t: pillBottom - 26, b: pillBottom },
      name: { l: p.x - nameW / 2, r: p.x + nameW / 2, t: nameTop, b: tipTop },
    };
    pins.push({ b, label, badge, excluded: Boolean(b.excluded) || units.every((u) => u.excluded), p, box, pillW, nameW });
  }
  const plan = new Map(layoutPins(pins.map((x) => x.box)).map((x) => [x.id, x]));

  // Three passes, so a connector line or a name never lands on top of a pill: lines, then names, then pills.
  const ordered = [...pins].sort((a, b) => a.box.pill.t - b.box.pill.t);
  const place = (pin: PinDraw) => ({ ...plan.get(pin.b.id)!, top: pin.box.pill.t - plan.get(pin.b.id)!.lift });
  const faded = (pin: PinDraw) => (pin.excluded ? 0.55 : 1);

  for (const pin of ordered) {
    const { lift, nameHidden, top } = place(pin);
    if (lift <= 0) continue;
    ctx.save();
    ctx.globalAlpha = faded(pin) * 0.7;
    ctx.strokeStyle = NAVY;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pin.p.x, top + 26);
    ctx.lineTo(pin.p.x, nameHidden ? pin.p.y - 8 : pin.box.name.t);
    ctx.stroke();
    ctx.restore();
  }

  for (const pin of ordered) {
    if (place(pin).nameHidden) continue;
    ctx.save();
    ctx.globalAlpha = faded(pin);
    ctx.font = `600 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#fff';
    ctx.strokeText(pin.b.name, pin.p.x, pin.box.name.b - 3);
    ctx.fillStyle = INK;
    ctx.fillText(pin.b.name, pin.p.x, pin.box.name.b - 3);
    ctx.restore();
  }

  for (const pin of ordered) {
    const { p, pillW, b } = pin;
    const { top } = place(pin);
    ctx.save();
    ctx.globalAlpha = faded(pin);
    ctx.shadowColor = 'rgba(0,0,0,.25)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;
    roundRectPath(ctx, p.x - pillW / 2, top, pillW, 26, 13);
    ctx.fillStyle = b.isSubject ? NAVY : '#fff';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 2;
    ctx.strokeStyle = NAVY;
    if (pin.excluded) ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `700 13px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = b.isSubject ? '#fff' : NAVY;
    ctx.fillText(pin.label, p.x - pillW / 2 + 10, top + 13.5);
    if (pin.badge) {
      ctx.font = `700 10px ${FONT}`;
      const bw = ctx.measureText('Inc').width + 12;
      const bx = p.x + pillW / 2 - 10 - bw + 4;
      roundRectPath(ctx, bx, top + 5, bw, 16, 8);
      ctx.fillStyle = AMBER;
      ctx.fill();
      ctx.fillStyle = '#3a2a00';
      ctx.textAlign = 'center';
      ctx.fillText('Inc', bx + bw / 2, top + 13.5);
    }
    ctx.textBaseline = 'alphabetic';
    ctx.beginPath();
    ctx.moveTo(p.x - 6, p.y - 8);
    ctx.lineTo(p.x + 6, p.y - 8);
    ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fillStyle = NAVY;
    ctx.fill();
    ctx.restore();
  }
}

function drawRings(ctx: CanvasRenderingContext2D, mapBox: Box, map: maplibregl.Map, o: ExportOptions) {
  const subjects = o.survey.buildings.filter((b) => b.isSubject && b.lngLat);
  if (!o.view.rings || subjects.length === 0) return;
  ctx.save();
  ctx.strokeStyle = NAVY;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  for (const s of subjects)
    for (const km of o.view.ringsKm) {
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
  for (const km of o.view.ringsKm) {
    const top = map.project(ringTop(c, km));
    if (Math.abs(centre.y - top.y) < 50) continue;
    const label = `${km} km`;
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
  } else if (kind === 'incentive') {
    roundRectPath(ctx, x + 6, y + 1, 24, 15, 7.5);
    ctx.fillStyle = AMBER;
    ctx.fill();
    text(ctx, 'Inc', x + 18, y + 12, `700 10px ${FONT}`, '#3a2a00', 'center');
  } else {
    ctx.globalAlpha = kind === 'excluded' ? 0.55 : 1;
    roundRectPath(ctx, x, y + 1, 34, 15, 7.5);
    ctx.fillStyle = kind === 'subject' ? NAVY : '#fff';
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = NAVY;
    if (kind === 'excluded') ctx.setLineDash([3, 2]);
    ctx.stroke();
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
    const sub = `${METRIC_LABEL[o.view.metric]}, ${o.view.summary.stat === 'avg' ? 'average' : 'median'} of ${result.marketBuildings} comparable building${result.marketBuildings === 1 ? '' : 's'}${result.hasSubject ? ', subject excluded' : ''}`;
    ctx.font = `400 10.5px ${FONT}`;
    for (const line of wrapText(sub, box.w, (s) => ctx.measureText(s).width)) {
      text(ctx, line, box.x, y, `400 10.5px ${FONT}`, MUTED);
      y += 13;
    }
    const fc = filterCaption(o.view.filters);
    if (fc) for (const line of wrapText(fc, box.w, (s) => ctx.measureText(s).width)) { text(ctx, line, box.x, y, `400 10.5px ${FONT}`, MUTED); y += 13; }
    y += 6;

    const sj = result.hasSubject;
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
    const rows = [...result.rows, result.total];
    const foot = summaryFootnotes(result, o.view.summary.perBuilding, result.subjectBuildings);
    const reserve = foot.length * 13 + 10 + legendH + 8;
    let shown = 0;
    for (const r of rows) {
      const total = r.key === '__all__';
      const font = `${total ? 700 : 400} 11px ${FONT}`;
      ctx.font = font;
      const lines = wrapText(r.label, labelW - 4, (s) => ctx.measureText(s).width);
      const rowH = lines.length * 13 + 8;
      if (y + rowH > box.y + box.h - reserve && !total) break;
      if (total) {
        ctx.fillStyle = NAVY;
        ctx.fillRect(box.x, y - 2, box.w, 2);
        y += 4;
      }
      lines.forEach((l, i) => text(ctx, l, box.x, y + 10 + i * 13, font, INK));
      text(ctx, fmtValue(r.market, o.view.metric), xM, y + 10, font, INK, 'right');
      if (sj) {
        text(ctx, fmtValue(r.subject, o.view.metric), xS, y + 10, font, INK, 'right');
        text(ctx, fmtDiff(r, o.view.metric), xD, y + 10, font, INK, 'right');
      }
      y += rowH;
      if (!total) {
        ctx.fillStyle = '#eef1f6';
        ctx.fillRect(box.x, y - 3, box.w, 1);
      }
      shown++;
    }
    if (shown < rows.length - 1) {
      text(ctx, `${rows.length - 1 - shown} more unit types not shown`, box.x, y + 10, `400 10px ${FONT}`, MUTED);
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
    for (const line of wrapText(metricCaption(o.view), box.w, (s) => ctx.measureText(s).width)) {
      text(ctx, line, box.x, y + 8, `400 9.5px ${FONT}`, MUTED);
      y += 12;
    }
  }
}

/** Draws the finished page: header, map with pins, rings, scale bar and credit, summary, legend and source line. */
export async function renderExport(o: ExportOptions): Promise<ExportResult> {
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
