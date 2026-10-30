import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeUnitType, parseCharge, parseBeds, parseSurvey } from '../src/lib/parse';

async function load(name: string) {
  const buf = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  return parseSurvey(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

describe('parseSurvey', () => {
  it('parses the townhome sheet with grouped units and a subject', async () => {
    const s = await load('clareview-townhomes.xlsx');
    expect(s.title).toBe('Clareview Townhomes');
    expect(s.location).toBe('Edmonton, AB');
    expect(s.buildings.map((b) => [b.name, b.units.length])).toEqual([
      ['Pilot Townhomes', 1],
      ['Prince Charles Townhomes', 3],
      ['Albany Townhomes', 1],
      ['Idylwylde Townhomes', 1],
      ['Strathern 8-Plex Townhomes', 1],
      ['Eastwood Townhomes', 1],
      ['Clareview Townhomes', 4],
    ]);
    expect(s.buildings.filter((b) => b.isSubject).map((b) => b.name)).toEqual(['Clareview Townhomes']);
    const pc = s.buildings[1];
    expect(pc.address).toBe('12006 125 Street NW');
    expect(pc.yearBuilt).toBe('2026');
    expect(pc.units.map((u) => u.rate)).toEqual([1665, 1995, 2195]);
    expect(pc.units[0].sf).toBeNull();
    expect(pc.units[0].incentive).toBe('$500 gift card');
    expect(pc.units[0].beds).toBe(3);
    expect(s.buildings[0].url).toContain('apartments.com');
  });

  it('parses the apartment sheet with merged cells, renovations and net rent', async () => {
    const s = await load('churchill-apartments.xlsx');
    expect(s.title).toBe('Churchill Apartments');
    expect(s.buildings.map((b) => [b.name, b.units.length])).toEqual([
      ['Connect Residences', 2],
      ['Edmonton House', 2],
      ['Park Square Apartments', 1],
      ['100 House', 2],
      ['E11even', 2],
      ['Churchill', 4],
    ]);
    expect(s.buildings.filter((b) => b.isSubject).map((b) => b.name)).toEqual(['Churchill']);
    const c = s.buildings[0];
    expect(c.yearRenovated).toBe('2025/2026');
    expect(c.units[0].netRate).toBe(1710);
    expect(c.units[0].parking).toBe('$225 underground');
    expect(s.buildings[5].units.map((u) => u.beds)).toEqual([1, 2, 2, 3]);
  });

  it('stops before summary tables and keeps unknown columns out of the way', async () => {
    const s = await load('river-valley-townhomes.xlsx');
    expect(s.title).toBe('Glenora Townhomes');
    expect(s.buildings.map((b) => [b.name, b.units.length])).toEqual([
      ['Hooke County', 3],
      ['Cavell Ridge Townhomes', 2],
      ['Greenwood Vilage - Sherwood Park', 3],
      ['Southwoods Village', 2],
      ['Garden Court', 1],
      ['River Valley Townhomes', 3],
    ]);
    expect(s.buildings.filter((b) => b.isSubject).map((b) => b.name)).toEqual(['River Valley Townhomes']);
    expect(s.buildings[5].yearBuilt).toBe('1964/1967');
    expect(s.buildings[0].propertyNotes).toContain('mix of renovated');
  });
});

describe('more survey layouts', () => {
  it('parses an apartment survey with a studio and a subject', async () => {
    const s = await load('castle-harbour-apartments.xlsx');
    expect(s.title).toBe('Castle Harbour');
    expect(s.buildings.map((b) => [b.name, b.units.length])).toEqual([
      ['Beau Mills Apartments', 2],
      ['Hampton Court', 2],
      ['Warwick Apartments', 1],
      ['Meadow Mews', 2],
      ['Castle Harbour', 3],
    ]);
    expect(s.buildings.filter((b) => b.isSubject).map((b) => b.name)).toEqual(['Castle Harbour']);
    expect(s.buildings[4].units.map((u) => u.beds)).toEqual([0, 1, 2]);
  });

  it('parses townhomes with fractional baths and a typo-ed subject name', async () => {
    const s = await load('glenora-townhomes.xlsx');
    expect(s.buildings).toHaveLength(6);
    expect(s.buildings.reduce((n, b) => n + b.units.length, 0)).toBe(7);
    expect(s.buildings.filter((b) => b.isSubject)).toHaveLength(1);
    expect(s.buildings.every((b) => b.units.every((u) => u.beds === 2))).toBe(true);
  });

  it('stops at a second table directly below the buildings (Boardwalk portfolio)', async () => {
    const s = await load('boardwalk-portfolio.xlsx');
    expect(s.title).toBe('Boardwalk Portfolio 2026');
    expect(s.buildings).toHaveLength(20);
    expect(s.buildings.reduce((n, b) => n + b.units.length, 0)).toBe(39);
    expect(s.buildings.some((b) => b.isSubject)).toBe(false); // the comparison header must not become a subject
    expect(s.buildings.map((b) => b.name)).not.toContain('Unit Type');
    expect(s.buildings[0].units.map((u) => u.type)).toEqual(['1 Bedroom/1 Bath - Basic', '2 Bedroom/1 Bath - Partial Reno']);
    const lou = s.buildings.find((b) => b.name === 'Lou Apartments')!;
    expect(lou.units.map((u) => u.beds)).toEqual([0, 1, 2]);
    const th = s.buildings.find((b) => b.name === 'Cavell Ridge Townhomes')!;
    expect(th.units.map((u) => u.beds)).toEqual([2, 3]);
  });
});

describe('studio wording', () => {
  it('uses Studio for every bachelor spelling', () => {
    expect(normalizeUnitType('Bachelor - Basic')).toBe('Studio - Basic');
    expect(normalizeUnitType('Bachelor')).toBe('Studio');
    expect(normalizeUnitType('Bachelor/Studio')).toBe('Studio');
    expect(normalizeUnitType('Studio/Bachelor')).toBe('Studio');
    expect(normalizeUnitType('Bach Suite')).toBe('Studio Suite');
    expect(normalizeUnitType('Studios')).toBe('Studios');
    expect(normalizeUnitType('2 Bed/1 Bath')).toBe('2 Bed/1 Bath');
  });
  it('applies when a sheet is read', async () => {
    const castle = await load('castle-harbour-apartments.xlsx');
    expect(castle.buildings[4].units[0].type).toBe('Studio');
    const bw = await load('boardwalk-portfolio.xlsx');
    expect(bw.buildings.find((b) => b.name === 'Lou Apartments')!.units[0].type).toBe('Studio - Basic');
  });
});

describe('helpers', () => {
  it('parses bedroom counts', () => {
    expect(parseBeds('3 Bed/2.5 Bath -Main Floor Rear')).toBe(3);
    expect(parseBeds('1 Bedroom / 1 Bath')).toBe(1);
    expect(parseBeds('Studio')).toBe(0);
    expect(parseBeds('Loft')).toBeNull();
  });
  it('parses parking charges', () => {
    expect(parseCharge('$225 underground')).toBe(225);
    expect(parseCharge('Single Garage, Included')).toBe(0);
    expect(parseCharge('TBC')).toBeNull();
    expect(parseCharge('100')).toBe(100);
  });
});

describe('image and link columns', () => {
  it('reads an Image URL column and prefers hyperlink targets for the listing link', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    ws.getCell('A1').value = 'Rental Market Survey\nTest Survey\nEdmonton, AB';
    ws.addRow(['Building Name', 'Address', 'Unit Type', 'Base Rental Rate', 'URL', 'Image URL']);
    ws.addRow(['Alpha', '1 Main St', '2 Bed/1 Bath', 1800, { text: 'Listing', hyperlink: 'https://example.com/alpha' }, 'https://img.example.com/a.jpg']);
    ws.addRow([null, null, '3 Bed/1 Bath', 2100]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const s = await parseSurvey(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    expect(s.buildings).toHaveLength(1);
    expect(s.buildings[0].url).toBe('https://example.com/alpha');
    expect(s.buildings[0].imageUrl).toBe('https://img.example.com/a.jpg');
    expect(s.buildings[0].units).toHaveLength(2);
  });
});

describe('safeUrl', () => {
  it('allows http(s) and embedded images only', async () => {
    const { safeUrl } = await import('../src/lib/safeUrl');
    expect(safeUrl('https://rf-images-prod-bcdn.rentfaster.ca/470242/slide.jpg')).toContain('https://');
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl('data:image/jpeg;base64,AAAA')).toBe('');
    expect(safeUrl('data:image/jpeg;base64,AAAA', true)).not.toBe('');
    expect(safeUrl('data:text/html;base64,AAAA', true)).toBe('');
    expect(safeUrl(undefined)).toBe('');
  });
});

describe('incentive column', () => {
  it('treats a numeric zero as no incentive and formats numeric discounts', async () => {
    const s = await load('glenora-townhomes.xlsx');
    const inc = Object.fromEntries(s.buildings.map((b) => [b.name, b.units[0].incentive]));
    expect(inc['North Glenora Townhomes']).toBe('');
    expect(inc['Sherwood Townhomes']).toBe('');
    expect(inc['Inglewood Townhomes']).toBe('-$158');
    expect(inc['Woodcroft Townhomes']).toBe('-$100');
  });
});

describe('product column', () => {
  it('reads Apartment / Townhouse into the property type, and Vintage as year built', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const { filterOptions, kindContext, visibleUnits, NO_FILTERS } = await import('../src/lib/groups');
    const { computeSummary } = await import('../src/lib/summary');
    const { DEFAULT_SUMMARY } = await import('../src/types');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    ws.getCell('A1').value = 'Rental Market Survey\nModern Purpose-Built Rentals\nFort Saskatchewan, AB';
    ws.addRow(['Building Name', 'Address', 'Product', 'Vintage', 'Unit Type', 'SF', 'Base Rent']);
    ws.addRow(['Birch Hills Landing', '8605 Southfort Blvd', 'Apartment', '2011-2014', '3 Bed/1 Bath', 971, 1928]);
    ws.addRow([null, null, 'Apartment', null, '2 Bed/1 Bath', 847, 1548]);
    ws.addRow(['Southfort Village', '8401 Southfort Blvd', 'Townhouse', 2018, '3 Bed/2.5 Bath', 1200, 1850]);
    ws.addRow(['Westpark Place', '60 Woodcrest Lane', 'Townhouse', 2025, '3 Bed/2.5 Bath', 1550, 2275]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const s = await parseSurvey(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    expect(s.buildings.map((b) => [b.name, b.propertyType, b.yearBuilt])).toEqual([
      ['Birch Hills Landing', 'Apartment', '2011-2014'],
      ['Southfort Village', 'Townhome', '2018'],
      ['Westpark Place', 'Townhome', '2025'],
    ]);
    expect(s.buildings[0].units[0].extras).toEqual({}); // Product is no longer an unrecognised column
    expect(filterOptions(s).kind).toEqual(['Apartment', 'Townhome']);

    const ctx = kindContext(s);
    const shown = (kind: string[]) => s.buildings.filter((b) => visibleUnits(b, { filters: { ...NO_FILTERS, kind }, ctx }).length).map((b) => b.name);
    expect(shown(['Townhome'])).toEqual(['Southfort Village', 'Westpark Place']);
    expect(shown(['Apartment'])).toEqual(['Birch Hills Landing']);

    // Split by property type: the 3 bed apartment and the 3 bed townhomes are separate rows, apartments first.
    const split = { ...DEFAULT_SUMMARY, split: { kind: true, baths: false, reno: false } };
    const rows = computeSummary(s, { metric: 'rate', filters: NO_FILTERS, settings: split }).rows;
    expect(rows.map((r) => [r.label, r.market.value])).toEqual([['2 Beds Apartment', 1548], ['3 Beds Apartment', 1928], ['3 Beds Townhome', 2062.5]]);
  });
});
