import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Survey } from '../types';
import { fromBase64 } from './base64';
import { safeUrl } from './safeUrl';

/**
 * Writes pin coordinates and photo URLs back into the uploaded workbook.
 *
 * This edits the worksheet XML directly instead of loading the workbook into a spreadsheet library,
 * because a library round trip drops pivot tables, printer settings and other parts of the file.
 * Everything not touched here is carried over byte for byte.
 */

const HEADER_ROW = 2;
type Doc = ReturnType<DOMParser['parseFromString']>;
type El = ReturnType<Doc['createElement']>;

const colToIndex = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const indexToCol = (n: number) => {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const splitRef = (ref: string) => {
  const m = ref.match(/^([A-Z]+)(\d+)$/)!;
  return { col: colToIndex(m[1]), row: Number(m[2]) };
};
const children = (el: El, name: string): El[] =>
  Array.from(el.childNodes as unknown as ArrayLike<El>).filter((n) => n.nodeName === name || n.localName === name);

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return Array.from(doc.getElementsByTagName('si')).map((si) =>
    Array.from(si.getElementsByTagName('t')).map((t) => t.textContent ?? '').join(''),
  );
}

function cellText(c: El, strings: string[]): string {
  const t = c.getAttribute('t');
  if (t === 's') return strings[Number(c.getElementsByTagName('v')[0]?.textContent)] ?? '';
  if (t === 'inlineStr') return Array.from(c.getElementsByTagName('t')).map((x) => x.textContent ?? '').join('');
  return c.getElementsByTagName('v')[0]?.textContent ?? '';
}

const FIELD_ALIASES: Record<string, 'lat' | 'lng' | 'image'> = {
  latitude: 'lat', lat: 'lat',
  longitude: 'lng', lng: 'lng', long: 'lng', lon: 'lng',
  image: 'image', imageurl: 'image', photo: 'image', photourl: 'image', picture: 'image',
};

export async function exportWithCoordinates(survey: Survey): Promise<{ data: ArrayBuffer; name: string }> {
  if (!survey.source) throw new Error('No uploaded workbook is stored with this survey');
  const zip = await JSZip.loadAsync(fromBase64(survey.source.data));

  // Locate the first worksheet through workbook.xml and its relationships.
  const wbXml = await zip.file('xl/workbook.xml')!.async('string');
  const relXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
  const wbDoc = new DOMParser().parseFromString(wbXml, 'text/xml');
  const firstSheet = wbDoc.getElementsByTagName('sheet')[0];
  const rid = firstSheet.getAttribute('r:id') ?? firstSheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const relDoc = new DOMParser().parseFromString(relXml, 'text/xml');
  const rel = Array.from(relDoc.getElementsByTagName('Relationship')).find((r) => r.getAttribute('Id') === rid);
  if (!rel) throw new Error('Could not find the first worksheet');
  const target = rel.getAttribute('Target')!;
  const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;

  const strings = sharedStrings(await zip.file('xl/sharedStrings.xml')?.async('string'));
  const sheetXml = await zip.file(sheetPath)!.async('string');
  const doc = new DOMParser().parseFromString(sheetXml, 'text/xml');
  const root = doc.documentElement!;
  const ns = root.namespaceURI;
  const sheetData = doc.getElementsByTagName('sheetData')[0];
  const rows = new Map<number, El>();
  for (const r of Array.from(sheetData.getElementsByTagName('row'))) rows.set(Number(r.getAttribute('r')), r);

  // Widest used column anywhere in the sheet, so new columns never collide with notes or links.
  let maxCol = 0;
  for (const r of rows.values()) for (const c of children(r, 'c')) maxCol = Math.max(maxCol, splitRef(c.getAttribute('r')!).col);

  const headerRow = rows.get(HEADER_ROW);
  const colFor: Partial<Record<'lat' | 'lng' | 'image', number>> = {};
  let lastHeaderStyle: string | null = null;
  if (headerRow) {
    for (const c of children(headerRow, 'c')) {
      const key = cellText(c, strings).toLowerCase().replace(/[^a-z0-9]/g, '');
      const field = FIELD_ALIASES[key];
      if (field && colFor[field] == null) colFor[field] = splitRef(c.getAttribute('r')!).col;
      if (c.getAttribute('s')) lastHeaderStyle = c.getAttribute('s');
    }
  }

  const make = (name: string) => doc.createElementNS(ns, name);
  const rowEl = (n: number): El => {
    let r = rows.get(n);
    if (!r) {
      r = make('row');
      r.setAttribute('r', String(n));
      const after = [...rows.keys()].filter((k) => k < n).sort((a, b) => b - a)[0];
      const ref = after != null ? rows.get(after)!.nextSibling : sheetData.firstChild;
      sheetData.insertBefore(r, ref);
      rows.set(n, r);
    }
    r.removeAttribute('spans'); // a stale column-span hint can make Excel repair the file
    return r;
  };
  const setCell = (rowNum: number, col: number, value: string | number, style?: string | null) => {
    const r = rowEl(rowNum);
    const ref = `${indexToCol(col)}${rowNum}`;
    let cell = children(r, 'c').find((c) => c.getAttribute('r') === ref);
    if (!cell) {
      cell = make('c');
      cell.setAttribute('r', ref);
      const next = children(r, 'c').find((c) => splitRef(c.getAttribute('r')!).col > col) ?? null;
      r.insertBefore(cell, next);
    }
    while (cell.firstChild) cell.removeChild(cell.firstChild);
    cell.removeAttribute('t');
    if (style) cell.setAttribute('s', style);
    if (typeof value === 'number') {
      const v = make('v');
      v.appendChild(doc.createTextNode(String(value)));
      cell.appendChild(v);
    } else {
      cell.setAttribute('t', 'inlineStr');
      const is = make('is');
      const t = make('t');
      t.appendChild(doc.createTextNode(value));
      is.appendChild(t);
      cell.appendChild(is);
    }
  };

  const wantsImage = survey.buildings.some((b) => safeUrl(b.imageUrl));
  const wantsPins = survey.buildings.some((b) => b.lngLat);
  const added: number[] = [];
  const ensure = (field: 'lat' | 'lng' | 'image', title: string) => {
    if (colFor[field] != null) return;
    colFor[field] = ++maxCol;
    added.push(maxCol);
    setCell(HEADER_ROW, maxCol, title, lastHeaderStyle);
  };
  if (wantsPins) {
    ensure('lat', 'Latitude');
    ensure('lng', 'Longitude');
  }
  if (wantsImage) ensure('image', 'Image URL');

  for (const b of survey.buildings) {
    const img = safeUrl(b.imageUrl); // uploaded photos (data URLs) stay inside the app
    for (const u of b.units) {
      if (!u.srcRow) continue;
      if (b.lngLat && colFor.lat != null && colFor.lng != null) {
        setCell(u.srcRow, colFor.lat, Math.round(b.lngLat[1] * 1e6) / 1e6);
        setCell(u.srcRow, colFor.lng, Math.round(b.lngLat[0] * 1e6) / 1e6);
      }
      if (img && colFor.image != null) setCell(u.srcRow, colFor.image, img);
    }
  }

  // Keep the declared extent and column widths consistent with the new columns.
  const dim = doc.getElementsByTagName('dimension')[0];
  if (dim) {
    const [a, b = a] = dim.getAttribute('ref')!.split(':');
    const end = splitRef(b);
    dim.setAttribute('ref', `${a}:${indexToCol(Math.max(end.col, maxCol))}${end.row}`);
  }
  if (added.length) {
    let cols = doc.getElementsByTagName('cols')[0];
    const existingMax = cols ? Math.max(0, ...children(cols, 'col').map((c) => Number(c.getAttribute('max')))) : 0;
    if (added[0] > existingMax) {
      if (!cols) {
        cols = make('cols');
        root.insertBefore(cols, sheetData);
      }
      for (const n of added) {
        const col = make('col');
        col.setAttribute('min', String(n));
        col.setAttribute('max', String(n));
        col.setAttribute('width', '16');
        col.setAttribute('customWidth', '1');
        cols.appendChild(col);
      }
    }
  }

  let out = new XMLSerializer().serializeToString(doc);
  if (!out.startsWith('<?xml')) out = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${out}`;
  zip.file(sheetPath, out, { createFolders: false });
  const data = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  const base = survey.source.name.replace(/\.xlsx$/i, '');
  return { data, name: `${base} (with coordinates).xlsx` };
}
