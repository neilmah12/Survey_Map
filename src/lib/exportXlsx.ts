import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Building, Survey } from '../types';
import { fieldForHeader, type Field } from './parse';
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

export interface ExportResult {
  data: ArrayBuffer;
  name: string;
  /** Buildings added in the app that were written into the sheet as new rows. */
  addedBuildings: number;
  /** Set when added buildings could not be written because the sheet has no room below its table. */
  needRows?: { buildings: string[]; rows: number; afterRow: number };
}

const isAppOnly = (b: Building) => Boolean(b.addedInApp) && b.units.every((u) => !u.srcRow);

export async function exportWithCoordinates(survey: Survey): Promise<ExportResult> {
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
  /** First column of every recognised field, using the parser's header names. */
  const fieldCol: Partial<Record<Field, number>> = {};
  let lastHeaderStyle: string | null = null;
  if (headerRow) {
    for (const c of children(headerRow, 'c')) {
      const text = cellText(c, strings);
      const key = text.toLowerCase().replace(/[^a-z0-9]/g, '');
      const field = FIELD_ALIASES[key];
      if (field && colFor[field] == null) colFor[field] = splitRef(c.getAttribute('r')!).col;
      const f = fieldForHeader(text);
      if (f && fieldCol[f] == null) fieldCol[f] = splitRef(c.getAttribute('r')!).col;
      if (c.getAttribute('s')) lastHeaderStyle = c.getAttribute('s');
    }
  }
  const origMaxCol = maxCol;

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

  const setStyle = (rowNum: number, col: number, style: string | null) => {
    const r = rowEl(rowNum);
    const ref = `${indexToCol(col)}${rowNum}`;
    let cell = children(r, 'c').find((c) => c.getAttribute('r') === ref);
    if (!cell) {
      cell = make('c');
      cell.setAttribute('r', ref);
      r.insertBefore(cell, children(r, 'c').find((c) => splitRef(c.getAttribute('r')!).col > col) ?? null);
    }
    while (cell.firstChild) cell.removeChild(cell.firstChild);
    cell.removeAttribute('t');
    if (style) cell.setAttribute('s', style);
    else cell.removeAttribute('s');
  };
  const setFormula = (rowNum: number, col: number, formula: string, cached: number) => {
    setCell(rowNum, col, cached);
    const cell = children(rowEl(rowNum), 'c').find((c) => c.getAttribute('r') === `${indexToCol(col)}${rowNum}`)!;
    const f = make('f');
    f.appendChild(doc.createTextNode(formula));
    cell.insertBefore(f, cell.firstChild);
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

  // ---- Buildings added in the app go into empty rows directly under the table.
  // Rows are never inserted: shifting rows would also have to move pivot tables, pictures, merged
  // ranges and formulas below, so when there is no room the caller is told how many rows to insert.
  let working = survey.buildings;
  let addedBuildings = 0;
  let needRows: ExportResult['needRows'];
  let lastNewRow = 0;
  const fresh = survey.buildings.filter(isAppOnly);
  if (fresh.length) {
    const inTable = survey.buildings
      .filter((b) => !isAppOnly(b) && b.units.some((u) => u.srcRow))
      .sort((a, b) => Math.min(...a.units.map((u) => u.srcRow ?? 1e9)) - Math.min(...b.units.map((u) => u.srcRow ?? 1e9)));
    const tableEnd = Math.max(HEADER_ROW, ...inTable.flatMap((b) => b.units.map((u) => u.srcRow ?? 0)));
    const mergeEl = doc.getElementsByTagName('mergeCells')[0];
    const merges = Array.from(doc.getElementsByTagName('mergeCell')).map((m) => {
      const [a, z = a] = m.getAttribute('ref')!.split(':');
      const p = splitRef(a);
      const q = splitRef(z);
      return { c1: p.col, r1: p.row, c2: q.col, r2: q.row };
    });
    const rowFree = (r: number) => {
      if (merges.some((m) => r >= m.r1 && r <= m.r2)) return false;
      const el = rows.get(r);
      if (!el) return true;
      return children(el, 'c').every((c) => !Array.from(c.childNodes as unknown as ArrayLike<El>).some((n) => ['v', 'is', 'f'].includes(n.nodeName)));
    };
    const need = fresh.reduce((n, b) => n + Math.max(1, b.units.length), 0);
    let free = 0;
    while (free < need && rowFree(tableEnd + 1 + free)) free++;

    if (free < need) {
      needRows = { buildings: fresh.map((b) => b.name), rows: need - free, afterRow: tableEnd };
    } else {
      const col = (f: Field) => fieldCol[f];
      const styleOf = (rowNum: number, c: number) => children(rows.get(rowNum) ?? sheetData, 'c').find((x) => x.getAttribute('r') === `${indexToCol(c)}${rowNum}`)?.getAttribute('s') ?? null;
      const starts = new Map<string, number>();
      let row = tableEnd + 1;
      fresh.forEach((nb, k) => {
        const n = Math.max(1, nb.units.length);
        // Copy the look of an existing building: same banding as the next row in sequence, or the subject style.
        const plain = inTable.filter((b) => !b.isSubject);
        const wantBand = (inTable.length + k) % 2;
        const template =
          (nb.isSubject ? inTable.find((b) => b.isSubject) : undefined) ??
          plain.find((b) => inTable.indexOf(b) % 2 === wantBand) ??
          plain[plain.length - 1] ??
          inTable[0];
        const tRows = template ? template.units.map((u) => u.srcRow!).sort((a, b) => a - b) : [];
        for (let i = 0; i < n; i++) {
          const rn = row + i;
          const tRow = tRows.length ? tRows[Math.min(i, tRows.length - 1)] : null;
          if (tRow != null) {
            const src = rows.get(tRow);
            const el = rowEl(rn);
            for (const a of ['ht', 'customHeight']) {
              const v = src?.getAttribute(a);
              if (v) el.setAttribute(a, v);
            }
            for (let c = 1; c <= origMaxCol; c++) setStyle(rn, c, styleOf(tRow, c));
          }
          const u = nb.units[i];
          const text = (f: Field, v: string | undefined) => {
            const c = col(f);
            if (c != null && v) setCell(rn, c, v, tRow != null ? styleOf(tRow, c) : null);
          };
          const num = (f: Field, v: number | null | undefined) => {
            const c = col(f);
            if (c != null && v != null) setCell(rn, c, v, tRow != null ? styleOf(tRow, c) : null);
          };
          if (i === 0) {
            text('name', nb.name);
            text('configuration', nb.configuration);
            text('address', nb.address);
            text('yearRenovated', nb.yearRenovated);
            text('propertyNotes', nb.propertyNotes);
            text('contact', nb.contact);
            text('url', safeUrl(nb.url));
            const yc = col('yearBuilt');
            if (yc != null && nb.yearBuilt) {
              const y = /^\d{4}$/.test(nb.yearBuilt) ? Number(nb.yearBuilt) : nb.yearBuilt;
              setCell(rn, yc, y, tRow != null ? styleOf(tRow, yc) : null);
            }
          }
          if (u) {
            text('unitType', u.type);
            num('sf', u.sf);
            num('rate', u.rate);
            text('parking', u.parking);
            text('utilities', u.utilities);
            text('incentive', u.incentive);
            num('netRate', u.netRate);
            text('notes', u.notes);
            const pc = col('psf');
            if (pc != null && col('rate') != null && col('sf') != null && u.rate != null && u.sf) {
              setFormula(rn, pc, `${indexToCol(col('rate')!)}${rn}/${indexToCol(col('sf')!)}${rn}`, u.rate / u.sf);
              const st = tRow != null ? styleOf(tRow, pc) : null;
              if (st) children(rowEl(rn), 'c').find((x) => x.getAttribute('r') === `${indexToCol(pc)}${rn}`)!.setAttribute('s', st);
            }
          }
        }
        // Merge building-level cells across the unit rows the same way the template building does.
        if (n > 1 && mergeEl && tRows.length > 1) {
          const cols = merges.filter((m) => m.c1 === m.c2 && m.r1 === tRows[0] && m.r2 === tRows[tRows.length - 1]).map((m) => m.c1);
          for (const c of cols) {
            const mc = make('mergeCell');
            mc.setAttribute('ref', `${indexToCol(c)}${row}:${indexToCol(c)}${row + n - 1}`);
            mergeEl.appendChild(mc);
          }
          mergeEl.setAttribute('count', String(children(mergeEl, 'mergeCell').length));
        }
        starts.set(nb.id, row);
        row += n;
        addedBuildings++;
      });
      lastNewRow = row - 1;
      working = survey.buildings.map((b) =>
        starts.has(b.id) ? { ...b, units: b.units.map((u, i) => ({ ...u, srcRow: starts.get(b.id)! + i })) } : b,
      );
    }
  }

  for (const b of working) {
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
    dim.setAttribute('ref', `${a}:${indexToCol(Math.max(end.col, maxCol))}${Math.max(end.row, lastNewRow)}`);
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
  return { data, name: `${base} (with coordinates).xlsx`, addedBuildings, needRows };
}
