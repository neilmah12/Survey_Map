import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSurvey } from '../src/lib/parse';
import { toBase64 } from '../src/lib/base64';
import { NO_FILTERS } from '../src/lib/groups';
import { SNAPSHOT_TOKEN, embedSnapshot, isSnapshot, snapshotToSurvey, snapshotToView, summarizeSnapshot, toClientSnapshot } from '../src/lib/snapshot';
import { DEFAULT_SUMMARY, type Building, type Survey, type ViewSettings } from '../src/types';

const FILES = [
  'clareview-townhomes.xlsx', 'churchill-apartments.xlsx', 'river-valley-townhomes.xlsx',
  'castle-harbour-apartments.xlsx', 'glenora-townhomes.xlsx', 'boardwalk-portfolio.xlsx',
];
const VIEW: ViewSettings = { metric: 'rate', summary: DEFAULT_SUMMARY, filters: NO_FILTERS, rings: true, ringsKm: [0.5, 1, 2] };

async function load(name: string): Promise<Survey> {
  const b = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  const data = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  const s = await parseSurvey(data);
  return {
    ...s,
    source: { name, data: toBase64(data) },
    buildings: s.buildings.map((x, i) => ({ ...x, lngLat: [-113.5 + i * 0.01, 53.5 + i * 0.01] as [number, number] })),
  };
}

function allKeys(x: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(x)) x.forEach((v) => allKeys(v, out));
  else if (x && typeof x === 'object')
    for (const [k, v] of Object.entries(x)) {
      out.add(k);
      allKeys(v, out);
    }
  return out;
}
function allStrings(x: unknown, out: string[] = []): string[] {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) x.forEach((v) => allStrings(v, out));
  else if (x && typeof x === 'object') Object.values(x).forEach((v) => allStrings(v, out));
  return out;
}

describe('client snapshot never contains internal data', () => {
  it('has exactly the allowed keys and no others', async () => {
    const { snapshot } = toClientSnapshot(await load('clareview-townhomes.xlsx'), VIEW);
    expect([...allKeys(snapshot)].sort()).toEqual(
      [
        'address', 'asOf', 'baths', 'beds', 'buildings', 'configuration', 'filters', 'id', 'imageUrl', 'incentive', 'isSubject', 'kind',
        'lngLat', 'location', 'metric', 'name', 'netRate', 'open', 'parking', 'perBuilding', 'publishedAt', 'rate', 'reno', 'rings', 'ringsKm',
        'sf', 'split', 'stat', 'summary', 'title', 'type', 'units', 'url', 'utilities', 'version', 'view', 'yearBuilt', 'yearRenovated',
      ].sort(),
    );
  });

  it.each(FILES)('leaks no notes, contact details, extra columns or workbook data: %s', async (file) => {
    const s = await load(file);
    const { snapshot } = toClientSnapshot(s, VIEW);
    const json = JSON.stringify(snapshot);
    const allowed = new Set(allStrings(snapshot));
    const internal: string[] = [];
    for (const b of s.buildings) {
      internal.push(b.propertyNotes, b.contact);
      for (const u of b.units) internal.push(u.notes, ...Object.values(u.extras));
    }
    for (const t of internal.filter((v) => v && v.length >= 6 && !allowed.has(v))) expect(json).not.toContain(t);
    expect(json).not.toContain('UEsDB'); // base64 of a zip: the uploaded workbook
    expect(json).not.toContain(s.source!.data.slice(0, 40));
  });

  it('really has internal data to leak in the sample sheets (the test above is meaningful)', async () => {
    let count = 0;
    for (const f of FILES) {
      const s = await load(f);
      for (const b of s.buildings) {
        count += [b.propertyNotes, b.contact].filter(Boolean).length;
        for (const u of b.units) count += [u.notes, ...Object.values(u.extras)].filter(Boolean).length;
      }
    }
    expect(count).toBeGreaterThan(30);
  });

  it('drops fields it does not know about', async () => {
    const s = await load('clareview-townhomes.xlsx');
    const dirty = { ...s.buildings[0], secret: 'TOP-SECRET', internalFlag: true, units: s.buildings[0].units.map((u) => ({ ...u, margin: 'MARGIN-42' })) } as Building;
    const { snapshot } = toClientSnapshot({ ...s, buildings: [dirty], source: { name: 'x', data: 'WORKBOOK-BYTES' } }, VIEW);
    const json = JSON.stringify(snapshot);
    for (const t of ['TOP-SECRET', 'internalFlag', 'MARGIN-42', 'WORKBOOK-BYTES', 'srcRow', 'extras', 'propertyNotes', 'contact']) expect(json).not.toContain(t);
  });

  it('leaves out buildings with no pin and lists them', async () => {
    const s = await load('clareview-townhomes.xlsx');
    s.buildings[2].lngLat = null;
    const r = toClientSnapshot(s, VIEW);
    expect(r.unplaced).toEqual(['Albany Townhomes']);
    expect(r.snapshot.buildings).toHaveLength(6);
    expect(summarizeSnapshot(r)).toMatchObject({ buildings: 6, units: 11, hasSubject: true, unplaced: ['Albany Townhomes'] });
  });

  it('keeps configuration (stacked / non-stacked) for townhomes only', async () => {
    const th = toClientSnapshot(await load('clareview-townhomes.xlsx'), VIEW).snapshot.buildings;
    expect(th.filter((b) => b.configuration).length).toBeGreaterThan(0);
    const apt = await load('churchill-apartments.xlsx');
    apt.buildings[0].configuration = 'Stacked';
    expect(toClientSnapshot(apt, VIEW).snapshot.buildings.every((b) => b.configuration === '')).toBe(true);
  });

  it('only passes http(s) links and embedded images', async () => {
    const s = await load('clareview-townhomes.xlsx');
    s.buildings[0].url = 'javascript:alert(1)';
    s.buildings[0].imageUrl = 'data:text/html;base64,AAAA';
    s.buildings[1].imageUrl = 'data:image/jpeg;base64,AAAA';
    s.buildings[2].url = 'https://example.com/ok';
    const b = toClientSnapshot(s, VIEW).snapshot.buildings;
    expect([b[0].url, b[0].imageUrl, b[1].imageUrl, b[2].url]).toEqual(['', '', 'data:image/jpeg;base64,AAAA', 'https://example.com/ok']);
  });
});

describe('summary settings and exclusions in the snapshot', () => {
  it('carries switched-off buildings and suites, and whether clients may toggle', async () => {
    const s = await load('clareview-townhomes.xlsx');
    s.buildings[0].excluded = true;
    s.buildings[1].units[2].excluded = true;
    s.clientCanToggle = true;
    const { snapshot } = toClientSnapshot(s, VIEW);
    expect(snapshot.clientCanToggle).toBe(true);
    expect(snapshot.buildings[0].excluded).toBe(true);
    expect(snapshot.buildings[1].units.map((u) => u.excluded)).toEqual([undefined, undefined, true]);
    const back = snapshotToSurvey(snapshot);
    expect(back.buildings[0].excluded).toBe(true);
    expect(back.clientCanToggle).toBe(true);
    // default is that clients cannot toggle
    expect(toClientSnapshot(await load('clareview-townhomes.xlsx'), VIEW).snapshot.clientCanToggle).toBeUndefined();
  });

  it('fills in summary settings for older snapshots', async () => {
    const { snapshot } = toClientSnapshot(await load('clareview-townhomes.xlsx'), VIEW);
    const old = JSON.parse(JSON.stringify(snapshot));
    delete old.view.summary;
    expect(snapshotToView(old).summary).toEqual(DEFAULT_SUMMARY);
  });
});

describe('snapshot to survey and embedding', () => {
  it('rebuilds a survey for the map with every private field empty', async () => {
    const s = await load('churchill-apartments.xlsx');
    const { snapshot } = toClientSnapshot(s, VIEW);
    const back = snapshotToSurvey(snapshot);
    expect(back.buildings.map((b) => b.units.map((u) => u.rate))).toEqual(s.buildings.map((b) => b.units.map((u) => u.rate)));
    expect(back.buildings.every((b) => !b.contact && !b.propertyNotes && b.units.every((u) => !u.notes && Object.keys(u.extras).length === 0))).toBe(true);
  });

  it('carries the starting view', async () => {
    const summary = { open: false, stat: 'median' as const, split: { baths: true, reno: false, kind: false }, perBuilding: false };
    const view: ViewSettings = { metric: 'psf', summary, filters: { ...NO_FILTERS, beds: ['2 Beds'] }, rings: false, ringsKm: [1, 3] };
    const { snapshot } = toClientSnapshot(await load('churchill-apartments.xlsx'), view);
    expect(snapshot.view).toEqual({ metric: 'psf', summary, rings: false, ringsKm: [1, 3], filters: { beds: ['2 Beds'], baths: [], reno: [], kind: [] } });
  });

  it('embeds safely even when text contains script tags or line separators', async () => {
    const s = await load('clareview-townhomes.xlsx');
    s.buildings[0].name = '</script><script>alert(1)</script> <!-- x   y';
    const { snapshot } = toClientSnapshot(s, VIEW);
    const html = embedSnapshot(`<html><body><script id="survey-snapshot" type="application/json">${SNAPSHOT_TOKEN}</script></body></html>`, snapshot);
    expect(html).not.toContain('<script>alert');
    expect((html.match(/<\/script>/g) ?? []).length).toBe(1);
    const json = html.match(/<script id="survey-snapshot"[^>]*>([\s\S]*)<\/script>/)![1];
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(snapshot)));
    expect(isSnapshot(JSON.parse(json))).toBe(true);
  });

  it('does not treat "$&" in text as a replacement pattern, and rejects templates without a slot', async () => {
    const s = await load('clareview-townhomes.xlsx');
    s.buildings[0].name = "Price $& $1 $` $'";
    const { snapshot } = toClientSnapshot(s, VIEW);
    const html = embedSnapshot(`<script>${SNAPSHOT_TOKEN}</script>`, snapshot);
    expect(JSON.parse(html.slice(8, -9)).buildings[0].name).toBe("Price $& $1 $` $'");
    expect(() => embedSnapshot('<html></html>', snapshot)).toThrow();
  });

  it('recognises only version 1 snapshots', () => {
    expect(isSnapshot(null)).toBe(false);
    expect(isSnapshot({ version: 2, buildings: [], view: {}, title: '' })).toBe(false);
    expect(isSnapshot({ version: 1, buildings: [], view: {}, title: 'x' })).toBe(true);
  });
});
