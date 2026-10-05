import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseSurvey } from '../src/lib/parse';
import { toBase64 } from '../src/lib/base64';
import { exportWithCoordinates, pendingEdits } from '../src/lib/exportXlsx';
import type { Survey } from '../src/types';

function buf(name: string): ArrayBuffer {
  const b = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}
async function load(name: string): Promise<Survey> {
  const data = buf(name);
  return { ...(await parseSurvey(data)), source: { name, data: toBase64(data) } };
}
const part = async (data: ArrayBuffer, re: RegExp) => (await JSZip.loadAsync(data)).file(re)[0].async('string');

describe('edits made in the app are written back into the sheet', () => {
  it('lists nothing when nothing changed, and leaves the workbook settings alone', async () => {
    const s = await load('clareview-townhomes.xlsx');
    expect(await pendingEdits(s)).toEqual([]);
    const out = await exportWithCoordinates(s);
    expect(out.editsWritten).toBe(0);
    expect(await part(out.data, /xl\/workbook\.xml$/)).not.toContain('fullCalcOnLoad');
  });

  it('writes a changed rent, SF and parking, and the re-read sheet has them', async () => {
    const s = await load('clareview-townhomes.xlsx');
    const pilot = s.buildings[0].units[0];
    pilot.rate = 2350;
    pilot.sf = 1520;
    pilot.parking = '$150 garage';
    const edits = await pendingEdits(s);
    expect(edits.map((e) => [e.row, e.field, e.value])).toEqual([[3, 'sf', 1520], [3, 'rate', 2350], [3, 'parking', '$150 garage']]);
    const out = await exportWithCoordinates(s);
    expect(out.editsWritten).toBe(3);
    expect(out.editsSkipped).toEqual([]);
    const again = await parseSurvey(out.data);
    expect(again.buildings[0].units[0]).toMatchObject({ rate: 2350, sf: 1520, parking: '$150 garage' });
    // nothing else moved
    expect(again.buildings.slice(1).map((b) => b.units.map((u) => u.rate))).toEqual(s.buildings.slice(1).map((b) => b.units.map((u) => u.rate)));
  });

  it('keeps the rent PSF formula and makes Excel recalculate it', async () => {
    const s = await load('clareview-townhomes.xlsx');
    s.buildings[0].units[0].rate = 2350;
    const out = await exportWithCoordinates(s);
    const xml = await part(out.data, /worksheets\/sheet\d+\.xml$/);
    expect(xml).toMatch(/<f t="shared" ref="H3:H14" si="0">G3\/F3<\/f>/); // still a live (shared) formula, not a pasted value
    expect(await part(out.data, /xl\/workbook\.xml$/)).toContain('fullCalcOnLoad="1"');
  });

  it('changes only the sheet and the workbook settings file', async () => {
    const s = await load('river-valley-townhomes.xlsx');
    s.buildings[0].units[0].rate = 1700;
    const out = await exportWithCoordinates(s);
    const a = await JSZip.loadAsync(buf('river-valley-townhomes.xlsx'));
    const b = await JSZip.loadAsync(out.data);
    expect(Object.keys(b.files).sort()).toEqual(Object.keys(a.files).sort()); // pivot tables and printer settings all still there
    const changed: string[] = [];
    for (const n of Object.keys(a.files)) {
      if (a.files[n].dir) continue;
      const [x, y] = await Promise.all([a.file(n)!.async('uint8array'), b.file(n)!.async('uint8array')]);
      if (Buffer.compare(Buffer.from(x), Buffer.from(y)) !== 0) changed.push(n);
    }
    expect(changed.filter((n) => !/^xl\/worksheets\/sheet\d+\.xml$/.test(n))).toEqual(['xl/workbook.xml']);
    expect(changed.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))).toHaveLength(1);
  });

  it('writes building details into the merged cells (name, address, year built)', async () => {
    const s = await load('clareview-townhomes.xlsx');
    const pc = s.buildings[1]; // Prince Charles: three unit rows, merged building cells
    pc.name = 'Prince Charles Towns';
    pc.address = '12006 125 St NW';
    pc.yearBuilt = '2027';
    const out = await exportWithCoordinates(s);
    const again = await parseSurvey(out.data);
    expect(again.buildings[1]).toMatchObject({ name: 'Prince Charles Towns', address: '12006 125 St NW', yearBuilt: '2027' });
    expect(again.buildings[1].units).toHaveLength(3);
    expect(again.buildings).toHaveLength(7);
  });

  it('never overwrites a formula cell, and says so', async () => {
    const s = await load('churchill-apartments.xlsx');
    s.buildings[0].units[0].netRate = 1800; // Net Rental rate there is =G3+225
    const out = await exportWithCoordinates(s);
    expect(out.editsWritten).toBe(0);
    expect(out.editsSkipped).toEqual([{ building: 'Connect Residences', field: 'netRate', reason: 'that cell holds a formula' }]);
    expect(await part(out.data, /worksheets\/sheet\d+\.xml$/)).toContain('<f>G3+225</f>');
  });

  it('clears a cell when a value is removed', async () => {
    const s = await load('clareview-townhomes.xlsx');
    s.buildings[3].units[0].parking = ''; // Idylwylde "Single Garage, Included"
    const out = await exportWithCoordinates(s);
    expect((await parseSurvey(out.data)).buildings[3].units[0].parking).toBe('');
  });

  it('leaves Glenora\'s incentive alone, because that column is a formula', async () => {
    const s = await load('glenora-townhomes.xlsx');
    s.buildings[0].units[0].incentive = '-$200';
    const out = await exportWithCoordinates(s);
    expect(out.editsWritten).toBe(0);
    expect(out.editsSkipped).toEqual([{ building: 'Inglewood Townhomes', field: 'incentive', reason: 'that cell holds a formula' }]);
    expect((await parseSurvey(out.data)).buildings[0].units[0].incentive).toBe('-$158');
  });

  it('writes a typed number as a number, and refuses text where the sheet keeps a number', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    ws.getCell('A1').value = 'Rental Market Survey\nTest\nEdmonton, AB';
    ws.addRow(['Building Name', 'Address', 'Year Built', 'Unit Type', 'Base Rental Rate', 'Incentives']);
    ws.addRow(['Alpha', '1 Main St', 2020, '2 Bed/1 Bath', 1800, -100]);
    ws.addRow(['Beta', '2 Main St', 2021, '2 Bed/1 Bath', 1900, -50]);
    const b = Buffer.from(await wb.xlsx.writeBuffer());
    const data = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    const s: Survey = { ...(await parseSurvey(data)), source: { name: 'x.xlsx', data: toBase64(data) } };
    s.buildings[0].units[0].incentive = '-$200';
    s.buildings[1].units[0].incentive = '1 month free';
    s.buildings[0].yearBuilt = '2022';
    const out = await exportWithCoordinates(s);
    expect(out.editsWritten).toBe(2); // the incentive number and the year, both kept as numbers
    expect(out.editsSkipped).toEqual([{ building: 'Beta', field: 'incentive', reason: 'the sheet keeps a number there' }]);
    const xml = await part(out.data, /worksheets\/sheet\d+\.xml$/);
    expect(xml).toContain('<v>-200</v>');
    expect(xml).toContain('<v>2022</v>');
    const again = await parseSurvey(out.data);
    expect(again.buildings[0].units[0].incentive).toBe('-$200');
    expect(again.buildings[0].yearBuilt).toBe('2022');
    expect(again.buildings[1].units[0].incentive).toBe('-$50');
  });

  it('does not count the Studio wording as an edit', async () => {
    const s = await load('castle-harbour-apartments.xlsx');
    expect(s.buildings[4].units[0].type).toBe('Studio'); // the sheet says Bachelor
    expect(await pendingEdits(s)).toEqual([]);
  });

  it('works together with an added building and pins', async () => {
    const s = await load('clareview-townhomes.xlsx');
    s.buildings[0].units[0].rate = 2350;
    s.buildings[0].lngLat = [-113.4, 53.6];
    s.buildings.push({
      id: 'n1', name: 'Maple Court', address: '99 New St NW', yearBuilt: '2024', yearRenovated: '', configuration: '', isSubject: false, addedInApp: true,
      lngLat: [-113.5, 53.5], propertyNotes: '', contact: '', url: '', imageUrl: '',
      units: [{ id: 'nu', type: '2 Bed/1 Bath', beds: null, sf: 900, rate: 1700, netRate: null, parking: '', utilities: '', incentive: '', notes: '', extras: {} }],
    });
    const out = await exportWithCoordinates(s);
    expect(out.editsWritten).toBe(1);
    expect(out.addedBuildings).toBe(1);
    const again = await parseSurvey(out.data);
    expect(again.buildings).toHaveLength(8);
    expect(again.buildings[0].units[0].rate).toBe(2350);
    expect(again.buildings[0].lngLat).toEqual([-113.4, 53.6]);
  });
});
