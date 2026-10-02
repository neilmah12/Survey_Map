import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCharge, parseBeds, parseSurvey } from '../src/lib/parse';

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
