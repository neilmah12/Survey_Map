import logoUrl from '../assets/avison-young-logo.png';
import type { Survey, ViewSettings } from '../types';
import { canvasToBlob, renderExport } from './exportImage';
import { renderReportPages } from './exportReport';
import { pdfFromJpegs } from './pdf';
import { contactLines } from './team';
import { PAGES } from './exportLayout';

/**
 * The PDF a client can download: always the report as published (the survey and view the link was made with), never
 * the visitor's own choices on screen. The map page, then the page with every rent type and the contact box.
 * Drawn in the browser from the link's own data, so it needs no server and no sign-in.
 */
export async function clientPdf(survey: Survey, view: ViewSettings): Promise<{ blob: Blob; name: string }> {
  const page = 'letter-landscape' as const;
  const base = {
    survey: { ...survey, buildings: survey.buildings.filter((b) => b.lngLat) },
    view,
    page,
    dpi: 150,
    extent: 'all' as const,
    includeSummary: true,
    includeChart: true,
    includeLegend: true,
    sourceNote: survey.sourceNote ?? '',
    logoUrl,
  };
  const map = await renderExport(base);
  const extra = await renderReportPages({ ...base, includeTakeaways: true, includeBuildings: false, contact: contactLines(survey.contacts ?? [], survey.contactUrl ?? '') });
  const pages = [];
  for (const c of [map.canvas, ...extra]) {
    pages.push({ jpeg: new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.92)).arrayBuffer()), w: c.width, h: c.height });
  }
  const { wIn, hIn } = PAGES[page];
  const pdf = pdfFromJpegs(pages, wIn * 72, hIn * 72, `${survey.title} - Rental Market Survey`);
  const name = (survey.title.replace(/[^\w.-]+/g, '_') || 'survey') + '_report.pdf';
  return { blob: new Blob([pdf as BlobPart], { type: 'application/pdf' }), name };
}

/** Saves a file from the page without touching browser storage. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
