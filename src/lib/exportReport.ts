import type { Contact, Metric } from '../types';
import { formatMetric, METRIC_LABEL } from './format';
import { netDefinition, netOf } from './net';
import { appliedPills } from './choose';
import { fmtKm } from './scope';
import { buildReport, reportBuildings, type ReportBuilding, type ReportRow } from './report';
import { pageRegions, wrapText, type Box } from './exportLayout';
import { FONT, INK, LINE, MUTED, NAVY, drawFooter, drawHeader, ellipsize, loadImage, text, type ExportOptions } from './exportImage';

/**
 * The report's data pages, drawn the same way as the map page (a canvas at the page size), so they join it in one PDF:
 *  - "Market summary by rent type": base rent, rent PSF and net rent side by side, a plain-language line per unit
 *    type, and a contact box.
 *  - "Buildings in the comparison" (optional): every building with its suites, nearest first.
 */

export interface ReportOptions extends ExportOptions {
  /** Short plain-language lines under the table. */
  includeTakeaways: boolean;
  /** The building-by-building pages. */
  includeBuildings: boolean;
  /** Who to talk to, and the team's web page. No people leaves the box out. */
  contacts: Contact[];
  contactUrl: string;
}

const BELOW = '#c0322f';
const ABOVE = '#1f64c0';
const BAND = '#f1f4f9';
const money = (v: number | null, m: Metric) => (v == null ? '-' : formatMetric(v, m));

function pct(v: number | null): { s: string; color: string } {
  if (v == null) return { s: '-', color: MUTED };
  const p = v * 100;
  if (Math.abs(p) < 0.05) return { s: '0.0%', color: INK };
  return { s: `${p > 0 ? '+' : '-'}${Math.abs(p).toFixed(1)}%`, color: p > 0 ? ABOVE : BELOW };
}

function newPage(o: ReportOptions, scale: number) {
  const regions = pageRegions(o.page, false);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(regions.page.w * scale);
  canvas.height = Math.round(regions.page.h * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, regions.page.w, regions.page.h);
  return { canvas, ctx, regions };
}

function lines(ctx: CanvasRenderingContext2D, s: string, w: number, font: string): string[] {
  ctx.font = font;
  return s.split('\n').flatMap((part) => (part.trim() ? wrapText(part.trim(), w, (t) => ctx.measureText(t).width) : []));
}

const CONTACT_COLS = 3;
const CONTACT_CELL_H = 42;

/** Height the contact box takes, so the table above it knows how much room is left. */
function contactHeight(contacts: Contact[]): number {
  if (contacts.length === 0) return 0;
  return 30 + Math.ceil(contacts.length / CONTACT_COLS) * CONTACT_CELL_H + 10;
}

/** The team in a compact grid, three across, under one short heading with the web address on the right. */
function contactBox(ctx: CanvasRenderingContext2D, box: Box, contacts: Contact[], url: string) {
  if (contacts.length === 0) return;
  const h = contactHeight(contacts) - 10;
  const y = box.y + box.h - h - 10;
  ctx.fillStyle = '#eef3fb';
  ctx.beginPath();
  ctx.roundRect(box.x, y, box.w, h, 8);
  ctx.fill();
  ctx.strokeStyle = '#d3def2';
  ctx.lineWidth = 1;
  ctx.stroke();
  text(ctx, 'Questions, or a different comparison? Talk to our team.', box.x + 14, y + 21, `700 12px ${FONT}`, NAVY);
  if (url) {
    ctx.font = `400 10px ${FONT}`;
    const shown = ellipsize(ctx, url.replace(/^https?:\/\//, ''), box.w * 0.42);
    text(ctx, shown, box.x + box.w - 14, y + 21, `400 10px ${FONT}`, MUTED, 'right');
  }
  const colW = (box.w - 28) / CONTACT_COLS;
  contacts.forEach((c, i) => {
    const cx = box.x + 14 + (i % CONTACT_COLS) * colW;
    const cy = y + 42 + Math.floor(i / CONTACT_COLS) * CONTACT_CELL_H;
    ctx.font = `700 11.5px ${FONT}`;
    text(ctx, ellipsize(ctx, c.name, colW - 12), cx, cy, `700 11.5px ${FONT}`, INK);
    ctx.font = `400 10px ${FONT}`;
    text(ctx, ellipsize(ctx, c.title, colW - 12), cx, cy + 12, `400 10px ${FONT}`, MUTED);
    ctx.font = `400 10.5px ${FONT}`;
    text(ctx, ellipsize(ctx, c.email, colW - 12), cx, cy + 24, `400 10.5px ${FONT}`, NAVY);
  });
}

function drawSummaryPage(o: ReportOptions, scale: number, logo: HTMLImageElement | null): HTMLCanvasElement {
  const { canvas, ctx, regions } = newPage(o, scale);
  const report = buildReport(o.survey, o.view);
  drawHeader(ctx, regions.header, o, logo);
  const left = regions.header.x;
  const width = regions.header.w;
  let y = regions.header.y + regions.header.h + 26;

  text(ctx, 'Market summary by rent type', left, y, `700 16px ${FONT}`, NAVY);
  y += 18;
  const subject = report.hasSubject ? ', subject excluded' : '';
  const sub = `${o.view.summary.stat === 'avg' ? 'Average' : 'Median'} of ${report.marketBuildings} comparable building${report.marketBuildings === 1 ? '' : 's'}${subject}.`;
  text(ctx, sub, left, y, `400 11.5px ${FONT}`, MUTED);
  y += 16;
  const pills = appliedPills(o.view);
  text(ctx, `Based on: ${pills.length ? pills.join(', ') : 'every unit type, any distance'}.`, left, y, `400 11.5px ${FONT}`, MUTED);
  y += 22;

  // Columns: unit type, comps, then market / subject / difference for each rent type
  const metrics = report.metrics;
  const labelW = Math.max(150, Math.round(width * 0.2));
  const compsW = 54;
  const groupW = (width - labelW - compsW) / Math.max(metrics.length, 1);
  const subW = groupW / 3;
  const colX = (g: number, k: number) => left + labelW + compsW + g * groupW + (k + 1) * subW; // right edge of a sub-column

  const rowH = 27;
  const reserved = contactHeight(o.contacts);
  const bottom = regions.footer.y - 10 - reserved;
  const noteLines = o.includeTakeaways ? report.takeaways.length : 0;
  const takeawayH = noteLines ? 30 + noteLines * 17 : 0;
  const footnotes: string[] = [];
  if (metrics.includes('net')) footnotes.push(netDefinition(netOf(o.survey)) + '.');
  footnotes.push('Difference: the subject against the market figure for the same unit type, as a share of the market.');
  const footnoteLines = lines(ctx, footnotes.join(' '), width, `400 10px ${FONT}`);
  const footnoteH = footnoteLines.length * 13 + 8;
  const room = bottom - y - 44 - takeawayH - footnoteH;
  const maxRows = Math.max(1, Math.floor(room / rowH));
  const rows: ReportRow[] = report.rows.slice(0, maxRows);

  // Group headings
  metrics.forEach((m, g) => {
    const x0 = left + labelW + compsW + g * groupW;
    text(ctx, METRIC_LABEL[m], x0 + groupW / 2, y + 12, `700 12px ${FONT}`, NAVY, 'center');
    ctx.fillStyle = NAVY;
    ctx.fillRect(x0 + 6, y + 18, groupW - 12, 2);
  });
  y += 26;
  ctx.fillStyle = LINE;
  text(ctx, 'UNIT TYPE', left + 8, y + 12, `700 9.5px ${FONT}`, MUTED);
  text(ctx, 'COMPS', left + labelW + compsW - 8, y + 12, `700 9.5px ${FONT}`, MUTED, 'right');
  metrics.forEach((_, g) => {
    text(ctx, 'MARKET', colX(g, 0) - 8, y + 12, `700 9.5px ${FONT}`, MUTED, 'right');
    text(ctx, report.hasSubject ? 'SUBJECT' : '', colX(g, 1) - 8, y + 12, `700 9.5px ${FONT}`, MUTED, 'right');
    text(ctx, report.hasSubject ? 'DIFF.' : '', colX(g, 2) - 8, y + 12, `700 9.5px ${FONT}`, MUTED, 'right');
  });
  y += 18;
  ctx.fillStyle = '#cfd6e2';
  ctx.fillRect(left, y, width, 1);
  y += 1;

  rows.forEach((r, i) => {
    if (i % 2 === 1) {
      ctx.fillStyle = BAND;
      ctx.fillRect(left, y, width, rowH);
    }
    const base = y + rowH / 2 + 4.5;
    ctx.font = `600 12.5px ${FONT}`;
    text(ctx, ellipsize(ctx, r.label, labelW - 12), left + 8, base, `600 12.5px ${FONT}`, INK);
    text(ctx, r.comps ? String(r.comps) : '-', left + labelW + compsW - 8, base, `400 12px ${FONT}`, MUTED, 'right');
    metrics.forEach((m, g) => {
      const c = r.cells[m];
      text(ctx, money(c?.market ?? null, m), colX(g, 0) - 8, base, `400 12.5px ${FONT}`, INK, 'right');
      if (report.hasSubject) {
        text(ctx, money(c?.subject ?? null, m), colX(g, 1) - 8, base, `400 12.5px ${FONT}`, INK, 'right');
        const d = pct(c?.diffPct ?? null);
        text(ctx, d.s, colX(g, 2) - 8, base, `600 12.5px ${FONT}`, d.color, 'right');
      }
    });
    y += rowH;
    ctx.fillStyle = '#e1e6ef';
    ctx.fillRect(left, y, width, 1);
  });
  y += 14;
  if (rows.length < report.rows.length) {
    text(ctx, `${report.rows.length - rows.length} more unit type${report.rows.length - rows.length === 1 ? '' : 's'} not shown: narrow the unit filters.`, left, y + 4, `400 10.5px ${FONT}`, MUTED);
    y += 18;
  }

  if (noteLines) {
    text(ctx, 'What this says', left, y + 12, `700 12.5px ${FONT}`, NAVY);
    y += 30;
    report.takeaways.forEach((t) => {
      ctx.fillStyle = NAVY;
      ctx.beginPath();
      ctx.arc(left + 4, y - 4, 2.2, 0, Math.PI * 2);
      ctx.fill();
      text(ctx, ellipsize(ctx, t, width - 20), left + 14, y, `400 12px ${FONT}`, INK);
      y += 17;
    });
    y += 8;
  }
  footnoteLines.forEach((l, i) => text(ctx, l, left, bottom - footnoteH + 12 + i * 13, `400 10px ${FONT}`, MUTED));
  contactBox(ctx, { x: left, y: bottom, w: width, h: reserved }, o.contacts, o.contactUrl);
  drawFooter(ctx, regions.footer, o.sourceNote);
  return canvas;
}

function drawBuildingPages(o: ReportOptions, scale: number, logo: HTMLImageElement | null): HTMLCanvasElement[] {
  const report = buildReport(o.survey, o.view);
  const buildings = reportBuildings(o.survey, o.view);
  const showNet = report.metrics.includes('net');
  const pages: HTMLCanvasElement[] = [];
  let at = 0;

  type Row = { b: ReportBuilding; unitIndex: number };
  const all: Row[] = buildings.flatMap((b) => b.units.map((_, unitIndex) => ({ b, unitIndex })));
  if (all.length === 0) return pages;

  while (at < all.length) {
    const { canvas, ctx, regions } = newPage(o, scale);
    drawHeader(ctx, regions.header, o, logo);
    const left = regions.header.x;
    const width = regions.header.w;
    let y = regions.header.y + regions.header.h + 26;
    text(ctx, 'Buildings in the comparison', left, y, `700 16px ${FONT}`, NAVY);
    y += 16;
    text(ctx, `Nearest the subject first. Greyed buildings are switched off and not counted. ${pages.length ? '(continued)' : ''}`.trim(), left, y, `400 11px ${FONT}`, MUTED);
    y += 18;

    const numW = 30;
    const nameW = Math.round(width * 0.27);
    const distW = 56;
    const typeW = Math.round(width * 0.2);
    const numCols: { k: 'sf' | 'rate' | 'psf' | 'net'; label: string }[] = [
      { k: 'sf', label: 'SF' },
      { k: 'rate', label: 'RENT' },
      { k: 'psf', label: 'PSF' },
      ...(showNet ? [{ k: 'net' as const, label: 'NET' }] : []),
    ];
    const restX = left + numW + nameW + distW + typeW;
    const numW2 = 64;
    const incX = restX + numCols.length * numW2 + 10;
    const rowH = 23;
    const bottom = regions.footer.y - 10;

    text(ctx, '#', left + 8, y + 12, `700 9.5px ${FONT}`, MUTED);
    text(ctx, 'BUILDING', left + numW, y + 12, `700 9.5px ${FONT}`, MUTED);
    text(ctx, 'DISTANCE', left + numW + nameW + distW - 8, y + 12, `700 9.5px ${FONT}`, MUTED, 'right');
    text(ctx, 'UNIT', left + numW + nameW + distW + 8, y + 12, `700 9.5px ${FONT}`, MUTED);
    numCols.forEach((c, i) => text(ctx, c.label, restX + (i + 1) * numW2 - 8, y + 12, `700 9.5px ${FONT}`, MUTED, 'right'));
    text(ctx, 'INCENTIVE', incX, y + 12, `700 9.5px ${FONT}`, MUTED);
    y += 18;
    ctx.fillStyle = '#cfd6e2';
    ctx.fillRect(left, y, width, 1);
    y += 1;

    let band = false;
    let lastId = '';
    while (at < all.length && y + rowH <= bottom) {
      const { b, unitIndex } = all[at];
      const u = b.units[unitIndex];
      const first = unitIndex === 0;
      if (first) band = !band;
      if (first && lastId) {
        ctx.fillStyle = '#cfd6e2';
        ctx.fillRect(left, y, width, 1);
      }
      if (band) {
        ctx.fillStyle = BAND;
        ctx.fillRect(left, y + (first && lastId ? 1 : 0), width, rowH);
      }
      const base = y + rowH / 2 + 4.5;
      const ink = b.counted ? INK : '#98a2b3';
      if (first) {
        text(ctx, b.isSubject ? '*' : b.num != null ? String(b.num) : '', left + 8, base, `700 12px ${FONT}`, b.isSubject ? '#eb6834' : NAVY);
        ctx.font = `600 12px ${FONT}`;
        text(ctx, ellipsize(ctx, b.name, nameW - 10), left + numW, base, `600 12px ${FONT}`, ink);
        if (b.distKm != null) text(ctx, fmtKm(b.distKm), left + numW + nameW + distW - 8, base, `400 11.5px ${FONT}`, MUTED, 'right');
        else if (b.isSubject) text(ctx, 'Subject', left + numW + nameW + distW - 8, base, `400 11.5px ${FONT}`, MUTED, 'right');
      }
      ctx.font = `400 11.5px ${FONT}`;
      text(ctx, ellipsize(ctx, u.type || 'Unit', typeW - 12), left + numW + nameW + distW + 8, base, `400 11.5px ${FONT}`, ink);
      numCols.forEach((c, i) => {
        const v = c.k === 'sf' ? (u.sf != null ? u.sf.toLocaleString('en-CA') : '-') : money(u[c.k], c.k === 'psf' ? 'psf' : 'rate');
        text(ctx, v, restX + (i + 1) * numW2 - 8, base, `400 11.5px ${FONT}`, ink, 'right');
      });
      ctx.font = `400 10.5px ${FONT}`;
      text(ctx, ellipsize(ctx, u.incentive || '', left + width - incX - 6), incX, base, `400 10.5px ${FONT}`, MUTED);
      y += rowH + (first && lastId ? 1 : 0);
      lastId = b.id;
      at++;
    }
    ctx.fillStyle = '#e1e6ef';
    ctx.fillRect(left, y, width, 1);
    drawFooter(ctx, regions.footer, o.sourceNote);
    pages.push(canvas);
  }
  return pages;
}

/** The data pages that follow the map page: the summary by rent type, then (optionally) the building table. */
export async function renderReportPages(o: ReportOptions): Promise<HTMLCanvasElement[]> {
  const scale = o.dpi / 96;
  const logo = await loadImage(o.logoUrl);
  const pages = [drawSummaryPage(o, scale, logo)];
  if (o.includeBuildings) pages.push(...drawBuildingPages(o, scale, logo));
  return pages;
}
