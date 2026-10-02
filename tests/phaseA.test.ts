import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseSurvey } from '../src/lib/parse';
import { toBase64, fromBase64 } from '../src/lib/base64';
import { exportWithCoordinates } from '../src/lib/exportXlsx';
import { mergeSurvey, norm } from '../src/lib/merge';
import type { Survey } from '../src/types';

const FILES = ['clareview-townhomes.xlsx', 'churchill-apartments.xlsx', 'river-valley-townhomes.xlsx'];

function buf(name: string): ArrayBuffer {
  const b = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

async function load(name: string): Promise<Survey> {
  const data = buf(name);
  const s = await parseSurvey(data);
  return { ...s, source: { name, data: toBase64(data) } };
}

/** Places every building at a distinct fake coordinate and gives the first one a photo URL. */
function place(s: Survey): Survey {
  return {
    ...s,
    buildings: s.buildings.map((b, i) => ({
      ...b,
      lngLat: [-113.5 + i * 0.0123, 53.5 + i * 0.0071] as [number, number],
      imageUrl: i === 0 ? 'https://img.example.com/first.jpg' : b.imageUrl,
    })),
  };
}

describe.each(FILES)('Excel write-back: %s', (file) => {
  it('keeps every other part of the workbook byte for byte', async () => {
    const s = place(await load(file));
    const out = await exportWithCoordinates(s);
    const a = await JSZip.loadAsync(buf(file));
    const b = await JSZip.loadAsync(out.data);
    expect(Object.keys(b.files).sort()).toEqual(Object.keys(a.files).sort());
    const changed: string[] = [];
    for (const name of Object.keys(a.files)) {
      if (a.files[name].dir) continue;
      const [x, y] = await Promise.all([a.file(name)!.async('uint8array'), b.file(name)!.async('uint8array')]);
      if (Buffer.compare(Buffer.from(x), Buffer.from(y)) !== 0) changed.push(name);
    }
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatch(/^xl\/worksheets\/sheet\d+\.xml$/);
  });

  it('round trips: re-reading the exported file restores pins and photos', async () => {
    const s = place(await load(file));
    const out = await exportWithCoordinates(s);
    const again = await parseSurvey(out.data);
    expect(again.buildings.map((b) => [b.name, b.units.length])).toEqual(s.buildings.map((b) => [b.name, b.units.length]));
    expect(again.buildings.map((b) => b.lngLat)).toEqual(s.buildings.map((b) => b.lngLat));
    expect(again.buildings[0].imageUrl).toBe('https://img.example.com/first.jpg');
    // Original data is untouched.
    expect(again.buildings.map((b) => b.units.map((u) => u.rate))).toEqual(s.buildings.map((b) => b.units.map((u) => u.rate)));
    expect(again.buildings.map((b) => b.isSubject)).toEqual(s.buildings.map((b) => b.isSubject));
  });

  it('is idempotent: exporting an export updates the same columns', async () => {
    const s = place(await load(file));
    const first = await exportWithCoordinates(s);
    const moved: Survey = {
      ...s,
      source: { name: 'x.xlsx', data: toBase64(first.data) },
      buildings: s.buildings.map((b) => ({ ...b, lngLat: [b.lngLat![0] + 0.5, b.lngLat![1]] as [number, number] })),
    };
    const second = await exportWithCoordinates(moved);
    const again = await parseSurvey(second.data);
    expect(again.buildings.map((b) => b.lngLat)).toEqual(moved.buildings.map((b) => b.lngLat));
    const sheetXml = await (await JSZip.loadAsync(second.data)).file(/worksheets\/sheet\d+\.xml$/)[0].async('string');
    expect(sheetXml.match(/>Latitude</g)).toHaveLength(1);
  });
});

describe('re-upload merge', () => {
  it('keeps every pin and photo when the same sheet is uploaded again', async () => {
    const placed = place(await load('clareview-townhomes.xlsx'));
    const fresh = await load('clareview-townhomes.xlsx');
    const { survey, summary } = mergeSurvey(placed, fresh);
    expect(summary).toMatchObject({ matched: 7, added: [], removed: [], changed: [], pinsKept: 7, photosKept: 1, looksDifferent: false });
    expect(survey.buildings.map((b) => b.lngLat)).toEqual(placed.buildings.map((b) => b.lngLat));
    expect(survey.buildings.map((b) => b.id)).toEqual(placed.buildings.map((b) => b.id));
  });

  it('reports changed rents, new and removed buildings, and keeps pins on matches', async () => {
    const placed = place(await load('clareview-townhomes.xlsx'));
    const incoming = structuredClone(await load('clareview-townhomes.xlsx'));
    incoming.buildings[0].units[0].rate = 2350; // Pilot rent changes
    const removed = incoming.buildings.splice(2, 1)[0]; // Albany leaves the sheet
    incoming.buildings.push({ ...structuredClone(incoming.buildings[0]), id: 'b99', name: 'Brand New Place', address: '1 New Rd NW', lngLat: null });
    const { survey, summary } = mergeSurvey(placed, incoming);
    expect(removed.name).toBe('Albany Townhomes');
    expect(summary.removed).toEqual(['Albany Townhomes']);
    expect(summary.added).toEqual(['Brand New Place']);
    expect(summary.changed).toEqual([{ name: 'Pilot Townhomes', details: ['3 Bed/2.5 Bath: rent $2,275 to $2,350'] }]);
    expect(summary.pinsKept).toBe(6);
    const pilot = survey.buildings.find((b) => b.name === 'Pilot Townhomes')!;
    expect(pilot.lngLat).toEqual(placed.buildings[0].lngLat);
    expect(pilot.units[0].rate).toBe(2350);
    const added = survey.buildings.find((b) => b.name === 'Brand New Place')!;
    expect(added.lngLat).toBeNull();
    expect(new Set(survey.buildings.map((b) => b.id)).size).toBe(survey.buildings.length);
  });

  it('matches renamed buildings by address and ignores street-word differences', async () => {
    expect(norm('12006 125 Street NW')).toBe(norm('12006 125 St. NW'));
    expect(norm('10015 103 Avenue Northwest')).toBe(norm('10015 103 Ave NW'));
    const placed = place(await load('clareview-townhomes.xlsx'));
    const incoming = structuredClone(await load('clareview-townhomes.xlsx'));
    incoming.buildings[1].name = 'Prince Charles Towns';
    incoming.buildings[1].address = '12006 125 St. NW';
    const { summary, survey } = mergeSurvey(placed, incoming);
    expect(summary.matched).toBe(7);
    expect(summary.changed[0].details[0]).toContain('renamed');
    expect(survey.buildings[1].lngLat).toEqual(placed.buildings[1].lngLat);
  });

  it('lets coordinates in the sheet win and says so', async () => {
    const placed = place(await load('clareview-townhomes.xlsx'));
    const incoming = structuredClone(await load('clareview-townhomes.xlsx'));
    incoming.buildings[0].lngLat = [-113.1, 53.1];
    const { summary, survey } = mergeSurvey(placed, incoming);
    expect(summary.repositioned).toEqual(['Pilot Townhomes']);
    expect(survey.buildings[0].lngLat).toEqual([-113.1, 53.1]);
  });

  it('flags an unrelated survey', async () => {
    const placed = place(await load('clareview-townhomes.xlsx'));
    const { summary } = mergeSurvey(placed, await load('churchill-apartments.xlsx'));
    expect(summary.matched).toBe(0);
    expect(summary.looksDifferent).toBe(true);
  });

  it('keeps the subject from the app when the new sheet marks none', async () => {
    const placed = place(await load('clareview-townhomes.xlsx'));
    const incoming = structuredClone(await load('clareview-townhomes.xlsx'));
    incoming.buildings.forEach((b) => (b.isSubject = false));
    const { survey } = mergeSurvey(placed, incoming);
    expect(survey.buildings.filter((b) => b.isSubject).map((b) => b.name)).toEqual(['Clareview Townhomes']);
  });
});

describe('base64', () => {
  it('round trips bytes', () => {
    const src = new Uint8Array([0, 1, 2, 250, 255, 128]);
    expect(Array.from(new Uint8Array(fromBase64(toBase64(src.buffer))))).toEqual(Array.from(src));
  });
});
