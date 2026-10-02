import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseSurvey } from '../src/lib/parse';
import { toBase64 } from '../src/lib/base64';
import { exportWithCoordinates } from '../src/lib/exportXlsx';
import { mergeSurvey } from '../src/lib/merge';
import type { Building, Survey, Unit } from '../src/types';

function buf(name: string): ArrayBuffer {
  const b = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}
async function load(name: string): Promise<Survey> {
  const data = buf(name);
  return { ...(await parseSurvey(data)), source: { name, data: toBase64(data) } };
}

const unit = (type: string, sf: number | null, rate: number | null, extra: Partial<Unit> = {}): Unit => ({
  id: `new-${type}`, type, beds: null, sf, rate, netRate: null, parking: '', utilities: '', incentive: '', notes: '', extras: {}, ...extra,
});
const added = (name: string, units: Unit[], extra: Partial<Building> = {}): Building => ({
  id: `app-${name}`, name, address: '99 New St NW', yearBuilt: '2024', yearRenovated: '', configuration: '', isSubject: false,
  addedInApp: true, lngLat: [-113.4, 53.55], propertyNotes: '', contact: '', url: '', imageUrl: '', units, ...extra,
});
const two = () => [
  unit('2 Bed/1 Bath', 900, 1700, { parking: '$100 surface', utilities: 'Not included', incentive: '1 month free' }),
  unit('3 Bed/1.5 Bath', 1100, 1950),
];
const withBuildings = (s: Survey, ...bs: Building[]): Survey => ({ ...s, buildings: [...s.buildings, ...bs] });

async function sheetXml(data: ArrayBuffer): Promise<string> {
  return (await (await JSZip.loadAsync(data)).file(/worksheets\/sheet\d+\.xml$/)[0].async('string'));
}

describe('adding a building in the app, then exporting to Excel', () => {
  it('writes a multi-unit building into the empty rows under the table', async () => {
    const s = withBuildings(await load('clareview-townhomes.xlsx'), added('Maple Court', two()));
    const out = await exportWithCoordinates(s);
    expect(out.addedBuildings).toBe(1);
    expect(out.needRows).toBeUndefined();

    const again = await parseSurvey(out.data);
    expect(again.buildings).toHaveLength(8);
    const b = again.buildings[7];
    expect(b.name).toBe('Maple Court');
    expect(b.address).toBe('99 New St NW');
    expect(b.yearBuilt).toBe('2024');
    expect(b.lngLat).toEqual([-113.4, 53.55]);
    expect(b.units.map((u) => [u.type, u.sf, u.rate, u.parking, u.utilities, u.incentive])).toEqual([
      ['2 Bed/1 Bath', 900, 1700, '$100 surface', 'Not included', '1 month free'],
      ['3 Bed/1.5 Bath', 1100, 1950, '', '', ''],
    ]);
    // existing buildings are untouched
    expect(again.buildings.slice(0, 7).map((x) => [x.name, x.units.map((u) => u.rate)])).toEqual(
      s.buildings.slice(0, 7).map((x) => [x.name, x.units.map((u) => u.rate)]),
    );
  });

  it('changes nothing in the workbook except the sheet, and merges the new building like the others', async () => {
    const s = withBuildings(await load('clareview-townhomes.xlsx'), added('Maple Court', two()));
    const out = await exportWithCoordinates(s);
    const a = await JSZip.loadAsync(buf('clareview-townhomes.xlsx'));
    const b = await JSZip.loadAsync(out.data);
    expect(Object.keys(b.files).sort()).toEqual(Object.keys(a.files).sort());
    const changed: string[] = [];
    for (const n of Object.keys(a.files)) {
      if (a.files[n].dir) continue;
      const [x, y] = await Promise.all([a.file(n)!.async('uint8array'), b.file(n)!.async('uint8array')]);
      if (Buffer.compare(Buffer.from(x), Buffer.from(y)) !== 0) changed.push(n);
    }
    expect(changed).toHaveLength(1);

    const before = (await sheetXml(buf('clareview-townhomes.xlsx'))).match(/<mergeCell /g)!.length;
    const xml = await sheetXml(out.data);
    const after = xml.match(/<mergeCell /g)!.length;
    expect(after).toBe(before + 4); // name, configuration, year built and address are merged across the unit rows, as in the template building
    expect(xml).toMatch(/<mergeCells count="\d+"/);
    expect(xml).toContain('<f>G15/F15</f>'); // rent PSF is a live formula like the other rows
  });

  it('copies the subject style when the new building is a subject', async () => {
    const s = withBuildings(await load('clareview-townhomes.xlsx'), added('Subject Two', [unit('3 Bed/2.5 Bath', 1200, 2100)], { isSubject: true }));
    const again = await parseSurvey((await exportWithCoordinates(s)).data);
    expect(again.buildings.filter((b) => b.isSubject).map((b) => b.name)).toEqual(['Clareview Townhomes', 'Subject Two']);
    const plain = withBuildings(await load('clareview-townhomes.xlsx'), added('Plain One', [unit('3 Bed/2.5 Bath', 1200, 2100)]));
    expect((await parseSurvey((await exportWithCoordinates(plain)).data)).buildings[7].isSubject).toBe(false);
  });

  it('writes several new buildings in order, one after another', async () => {
    const s = withBuildings(
      await load('churchill-apartments.xlsx'),
      added('First', [unit('1 Bedroom/1 Bath', 600, 1500), unit('2 Bedroom/1 Bath', 800, 1900), unit('3 Bedroom/2 Bath', 1000, 2300)], { address: '1 A St' }),
      added('Second', [unit('1 Bedroom/1 Bath', 620, 1550)], { address: '2 B St' }),
    );
    const out = await exportWithCoordinates(s);
    expect(out.addedBuildings).toBe(2);
    const again = await parseSurvey(out.data);
    expect(again.buildings.slice(6).map((b) => [b.name, b.units.length])).toEqual([['First', 3], ['Second', 1]]);
  });

  it('is repeatable: exporting twice gives the same sheet', async () => {
    const s = withBuildings(await load('clareview-townhomes.xlsx'), added('Maple Court', two()));
    expect(await sheetXml((await exportWithCoordinates(s)).data)).toBe(await sheetXml((await exportWithCoordinates(s)).data));
  });
});

describe('when the sheet has no room', () => {
  it('reports how many rows to insert and leaves the table alone (Glenora has 1 empty row)', async () => {
    const s = withBuildings(await load('glenora-townhomes.xlsx'), added('Maple Court', two()));
    const out = await exportWithCoordinates(s);
    expect(out.addedBuildings).toBe(0);
    expect(out.needRows).toEqual({ buildings: ['Maple Court'], rows: 1, afterRow: 9 });
    const again = await parseSurvey(out.data);
    expect(again.buildings).toHaveLength(6);
    // pins for the existing buildings are still written
    const placed = { ...s, buildings: s.buildings.map((b, i) => (i < 6 ? { ...b, lngLat: [-113.5 + i * 0.01, 53.5] as [number, number] } : b)) };
    expect((await parseSurvey((await exportWithCoordinates(placed)).data)).buildings.map((b) => b.lngLat?.[1])).toEqual(Array(6).fill(53.5));
  });

  it('needs the full count when there is no space at all (Boardwalk)', async () => {
    const s = withBuildings(await load('boardwalk-portfolio.xlsx'), added('Maple Court', two()));
    const out = await exportWithCoordinates(s);
    expect(out.needRows).toEqual({ buildings: ['Maple Court'], rows: 2, afterRow: 41 });
    expect((await parseSurvey(out.data)).buildings).toHaveLength(20);
  });

  it('fits exactly into three empty rows but not four (River Valley)', async () => {
    const fits = withBuildings(await load('river-valley-townhomes.xlsx'), added('Three Units', [unit('2 Bed/1 Bath', 900, 1700), unit('3 Bed/1 Bath', 1000, 1800), unit('4 Bed/1 Bath', 1200, 2100)]));
    const ok = await exportWithCoordinates(fits);
    expect(ok.addedBuildings).toBe(1);
    expect((await parseSurvey(ok.data)).buildings.at(-1)!.units).toHaveLength(3);
    const tooMany = withBuildings(await load('river-valley-townhomes.xlsx'), added('Four Units', [unit('2 Bed', 1, 1), unit('3 Bed', 1, 1), unit('4 Bed', 1, 1), unit('5 Bed', 1, 1)]));
    expect((await exportWithCoordinates(tooMany)).needRows).toMatchObject({ rows: 1, afterRow: 16 });
  });
});

describe('re-uploading with buildings added in the app', () => {
  it('keeps an added building that is not in the sheet yet', async () => {
    const base = await load('clareview-townhomes.xlsx');
    const existing = withBuildings(base, added('Maple Court', two()));
    const { survey, summary } = mergeSurvey(existing, await load('clareview-townhomes.xlsx'));
    expect(summary.keptLocal).toEqual(['Maple Court']);
    expect(summary.removed).toEqual([]);
    expect(survey.buildings.map((b) => b.name)).toContain('Maple Court');
    expect(survey.buildings.find((b) => b.name === 'Maple Court')!.addedInApp).toBe(true);
  });

  it('matches the building once it is in the sheet, and the app-only flag goes away', async () => {
    const existing = withBuildings(await load('clareview-townhomes.xlsx'), added('Maple Court', two(), { lngLat: [-113.40000049, 53.55000051] }));
    const exported = await exportWithCoordinates(existing);
    const incoming = { ...(await parseSurvey(exported.data)), source: { name: 'exported.xlsx', data: toBase64(exported.data) } };
    const { survey, summary } = mergeSurvey(existing, incoming);
    expect(summary.keptLocal).toEqual([]);
    expect(summary.added).toEqual([]);
    expect(summary.matched).toBe(8);
    expect(survey.buildings).toHaveLength(8);
    const b = survey.buildings.find((x) => x.name === 'Maple Court')!;
    expect(b.addedInApp).toBeUndefined();
    expect(b.units.every((u) => u.srcRow)).toBe(true);

    // the sheet stores rounded coordinates, which must not read as a moved pin
    expect(summary.repositioned).toEqual([]);

    // exporting the updated survey again must not add the building a second time
    const second = await exportWithCoordinates(survey);
    expect(second.addedBuildings).toBe(0);
    expect((await parseSurvey(second.data)).buildings).toHaveLength(8);
  });
});
