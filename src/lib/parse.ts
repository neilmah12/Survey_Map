import ExcelJS from 'exceljs';
import type { Building, Survey, Unit } from '../types';
import { normalizeUnitType, parseBeds, parseCharge } from './unitText';

export { normalizeUnitType, parseBeds, parseCharge };

export type Field =
  | 'name' | 'configuration' | 'yearBuilt' | 'yearRenovated' | 'address'
  | 'unitType' | 'sf' | 'rate' | 'psf' | 'parking' | 'utilities'
  | 'incentive' | 'netRate' | 'netPsf' | 'notes' | 'propertyNotes'
  | 'contact' | 'url' | 'image' | 'lat' | 'lng';

/** Normalised header text -> canonical field. Add aliases here as sheets vary. */
const ALIASES: Record<string, Field> = {
  buildingname: 'name', building: 'name', property: 'name', propertyname: 'name',
  unitconfiguration: 'configuration', configuration: 'configuration',
  yearbuilt: 'yearBuilt',
  yearrenovated: 'yearRenovated', renovated: 'yearRenovated',
  address: 'address',
  unittype: 'unitType', type: 'unitType',
  unitsf: 'sf', sf: 'sf', size: 'sf',
  baserentalrate: 'rate', rentalrate: 'rate', grossrentalrate: 'rate', baserent: 'rate', rent: 'rate',
  rentpsf: 'psf',
  parkingcharge: 'parking', parking: 'parking',
  utilitycharge: 'utilities', utilities: 'utilities', ancillaryrevenue: 'utilities',
  incentives: 'incentive', incentive: 'incentive',
  netrentalrate: 'netRate', netrate: 'netRate', netrent: 'netRate',
  netrentpsf: 'netPsf',
  notes: 'notes', unitnotes: 'notes',
  propertynotes: 'propertyNotes',
  contact: 'contact', contactinfo: 'contact',
  url: 'url', link: 'url',
  image: 'image', imageurl: 'image', photo: 'image', photourl: 'image', picture: 'image',
  latitude: 'lat', lat: 'lat',
  longitude: 'lng', lng: 'lng', long: 'lng', lon: 'lng',
};

/** Canonical field for a header cell's text, or undefined when the column is not recognised. */
export function fieldForHeader(header: string): Field | undefined {
  return ALIASES[header.toLowerCase().replace(/[^a-z0-9]/g, '')];
}

const HEADER_ROW = 2;
const FIRST_DATA_ROW = 3;

/** True for the covered (non-top-left) cells of a merged range. */
function isMergedFollower(cell: ExcelJS.Cell): boolean {
  return cell.isMerged && cell.master.address !== cell.address;
}

function raw(cell: ExcelJS.Cell): unknown {
  // ExcelJS echoes the master's value on followers; treat them as empty so a
  // merged unit cell does not create a duplicate unit row.
  if (isMergedFollower(cell)) return null;
  const v = cell.value as unknown;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('result' in o) return o.result;
    if ('richText' in o) return (o.richText as { text: string }[]).map((t) => t.text).join('');
    if ('text' in o) return o.text;
    if ('error' in o) return null;
    if (v instanceof Date) return v;
  }
  return v;
}

/** Link target of a cell: its hyperlink if it has one, otherwise its text. */
function linkText(cell: ExcelJS.Cell): string {
  const v = cell.value as unknown;
  if (v && typeof v === 'object' && !isMergedFollower(cell)) {
    const h = (v as { hyperlink?: unknown }).hyperlink;
    if (typeof h === 'string' && h) return h;
  }
  return text(cell);
}

function text(cell: ExcelJS.Cell): string {
  const v = raw(cell);
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/\s*\n\s*/g, ' ').trim();
}

function num(cell: ExcelJS.Cell): number | null {
  const v = raw(cell);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}




/** Some sheets hold the incentive as a number (an amortised monthly discount); 0 means none. */
function incentiveText(cell: ExcelJS.Cell | null): string {
  if (!cell) return '';
  const v = raw(cell);
  if (typeof v === 'number') {
    const n = Math.round(Math.abs(v));
    return n === 0 ? '' : `${v < 0 ? '-' : ''}$${n.toLocaleString('en-CA')}`;
  }
  const t = text(cell);
  return /^[-+]?0+(\.0+)?$/.test(t) ? '' : t;
}

function isDarkFill(cell: ExcelJS.Cell): boolean {
  const fill = cell.fill as ExcelJS.FillPattern | undefined;
  if (!fill || fill.type !== 'pattern' || fill.pattern !== 'solid') return false;
  const argb = fill.fgColor?.argb;
  if (!argb || argb.length < 6) return false;
  const hex = argb.slice(-6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.3;
}

function parseTitle(ws: ExcelJS.Worksheet): { title: string; location: string } {
  // A1 reads "Rental Market Survey\n<Title>\n<City, Prov>".
  const parts = String(raw(ws.getCell(1, 1)) ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return { title: parts[1] ?? ws.name, location: parts[2] ?? '' };
}

/**
 * Parses a rental survey workbook. Layout assumptions (shared by all current templates):
 * row 1 is a title block, row 2 is headers, building-level cells are merged or blank
 * across a building's unit rows, the subject property row is filled with a dark colour,
 * and the table ends at the first fully blank row or the next header band (summary or
 * comparison tables below it are ignored).
 */
export async function parseSurvey(data: ArrayBuffer): Promise<Survey> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Workbook has no sheets');

  const colField = new Map<number, Field>();
  const colExtra = new Map<number, string>();
  ws.getRow(HEADER_ROW).eachCell({ includeEmpty: false }, (cell, col) => {
    const header = text(cell);
    const f = ALIASES[header.toLowerCase().replace(/[^a-z0-9]/g, '')];
    if (f && ![...colField.values()].includes(f)) colField.set(col, f);
    else if (header) colExtra.set(col, header);
  });
  const colOf = (f: Field) => [...colField.entries()].find(([, v]) => v === f)?.[0];
  const need = (f: Field) => {
    if (!colOf(f)) throw new Error(`Missing a "${f}" column in header row ${HEADER_ROW}`);
  };
  need('name'); need('unitType'); need('rate');

  const get = (r: number, f: Field) => {
    const c = colOf(f);
    return c ? ws.getCell(r, c) : null;
  };
  const getText = (r: number, f: Field) => {
    const c = get(r, f);
    return c ? text(c) : '';
  };
  const getLink = (r: number, f: Field) => {
    const c = get(r, f);
    return c ? linkText(c) : '';
  };
  const getNum = (r: number, f: Field) => {
    const c = get(r, f);
    return c ? num(c) : null;
  };

  const lastCol = Math.max(...colField.keys(), ...colExtra.keys());
  const rowIsBlank = (r: number) => {
    for (let c = 1; c <= lastCol; c++) {
      const cell = ws.getCell(r, c);
      if (text(cell) || cell.isMerged) return false;
    }
    return true;
  };

  /** A dark-filled row with text but no numbers is a second table's header, not a building (the subject row has rents). */
  const isHeaderBand = (r: number) => {
    let dark = false;
    let hasText = false;
    for (let c = 1; c <= lastCol; c++) {
      const cell = ws.getCell(r, c);
      if (c <= 4 && isDarkFill(cell)) dark = true;
      if (typeof raw(cell) === 'number') return false;
      if (text(cell)) hasText = true;
    }
    return dark && hasText;
  };

  const buildings: Building[] = [];
  let current: Building | null = null;
  let uid = 0;

  for (let r = FIRST_DATA_ROW; r <= ws.rowCount; r++) {
    if (rowIsBlank(r) || isHeaderBand(r)) break;

    const name = getText(r, 'name');
    if (name && (!current || name !== current.name)) {
      current = {
        id: `b${buildings.length + 1}`,
        name,
        address: getText(r, 'address'),
        yearBuilt: getText(r, 'yearBuilt'),
        yearRenovated: getText(r, 'yearRenovated'),
        configuration: getText(r, 'configuration'),
        isSubject: false,
        lngLat: null,
        propertyNotes: '',
        contact: '',
        url: '',
        imageUrl: '',
        units: [],
      };
      buildings.push(current);
    }
    if (!current) continue;

    const unitType = getText(r, 'unitType');
    const rate = getNum(r, 'rate');
    // Rows that only exist because a merged cell spans them carry no unit data.
    if (!unitType && rate == null) continue;

    // Subject property: dark-filled row.
    for (let c = 1; c <= 4; c++) if (isDarkFill(ws.getCell(r, c))) current.isSubject = true;

    // Building-level text may sit on any row of the group; keep the first non-empty value.
    current.propertyNotes ||= getText(r, 'propertyNotes');
    current.contact ||= getText(r, 'contact');
    current.url ||= getLink(r, 'url');
    current.imageUrl ||= getLink(r, 'image');
    if (!current.lngLat) {
      const lat = getNum(r, 'lat');
      const lng = getNum(r, 'lng');
      if (lat != null && lng != null) current.lngLat = [lng, lat];
    }

    const extras: Record<string, string> = {};
    for (const [col, header] of colExtra) {
      const v = text(ws.getCell(r, col));
      if (v) extras[header] = v;
    }

    const unit: Unit = {
      id: `u${++uid}`,
      srcRow: r,
      type: normalizeUnitType(unitType),
      beds: parseBeds(unitType),
      sf: getNum(r, 'sf'),
      rate,
      netRate: getNum(r, 'netRate'),
      parking: getText(r, 'parking'),
      utilities: getText(r, 'utilities'),
      incentive: incentiveText(get(r, 'incentive')),
      notes: getText(r, 'notes'),
      extras,
    };
    current.units.push(unit);
  }

  const { title, location } = parseTitle(ws);
  return {
    title,
    location,
    asOf: new Date().toISOString().slice(0, 10),
    buildings: buildings.filter((b) => b.units.length > 0),
  };
}
