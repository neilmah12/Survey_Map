import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSurvey } from '../src/lib/parse';
import { toBase64 } from '../src/lib/base64';
import { countBySeverity, runChecks, type Check } from '../src/lib/checks';
import { excelChecks } from '../src/lib/excelChecks';
import type { Building, Survey, Unit } from '../src/types';

async function load(name: string): Promise<Survey> {
  const b = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  const data = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  const s = await parseSurvey(data);
  return {
    ...s,
    source: { name, data: toBase64(data) },
    buildings: s.buildings.map((x, i) => ({ ...x, lngLat: [-113.5 + i * 0.01, 53.5 + i * 0.008] as [number, number] })),
  };
}
const NOW = new Date();
const titles = (cs: Check[]) => cs.map((c) => c.title);

const unit = (type: string, rate: number | null, sf: number | null = 800, extra: Partial<Unit> = {}): Unit => ({
  id: `${type}-${rate}-${sf}`, type, beds: null, sf, rate, netRate: null, parking: '', utilities: '', incentive: '', notes: '', extras: {}, ...extra,
});
const bld = (name: string, units: Unit[], extra: Partial<Building> = {}): Building => ({
  id: name, name, address: `${name} Rd`, yearBuilt: '2020', yearRenovated: '', configuration: '', isSubject: false, lngLat: [-113.5, 53.5],
  propertyNotes: '', contact: '', url: '', imageUrl: '', units, ...extra,
});
const survey = (buildings: Building[], over: Partial<Survey> = {}): Survey => ({
  title: 'T', location: 'Edmonton, AB', asOf: NOW.toISOString().slice(0, 10), buildings, ...over,
});
const spread = (n: number) => Array.from({ length: n }, (_, i) => [-113.5 + i * 0.01, 53.5] as [number, number]);

describe('checks on the sample sheets', () => {
  it('Clareview: finds the TBC parking, the unfinished notes and the missing SF', async () => {
    const cs = runChecks(await load('clareview-townhomes.xlsx'), NOW);
    expect(titles(cs)).toContain('Strathern 8-Plex Townhomes, 3 Bed/2.5 Bath: parking says "TBC"');
    const notes = cs.filter((c) => c.id.startsWith('note-'));
    expect(notes.map((c) => c.title.split(':')[0]).sort()).toEqual(['Albany Townhomes', 'Pilot Townhomes', 'Prince Charles Townhomes']);
    expect(notes.find((c) => c.title.startsWith('Prince Charles'))!.detail).toContain('need sf, parking charge');
    expect(cs.find((c) => c.id === 'no-sf')!.title).toBe('4 units with no SF');
    expect(cs.some((c) => c.severity === 'error')).toBe(false);
    expect(cs.some((c) => c.id === 'no-subject')).toBe(false);
  });

  it('Boardwalk: warns that no subject is marked', async () => {
    const cs = runChecks(await load('boardwalk-portfolio.xlsx'), NOW);
    expect(cs.map((c) => c.id)).toContain('no-subject');
  });

  it('every survey in the samples is free of errors once pins are placed', async () => {
    for (const f of ['clareview-townhomes', 'churchill-apartments', 'river-valley-townhomes', 'castle-harbour-apartments', 'glenora-townhomes', 'boardwalk-portfolio'])
      expect(countBySeverity(runChecks(await load(`${f}.xlsx`), NOW)).error).toBe(0);
  });

  it('puts errors first, then warnings, then information', async () => {
    const s = await load('clareview-townhomes.xlsx');
    s.buildings.forEach((b) => (b.lngLat = null));
    const cs = runChecks(s, NOW);
    expect(cs[0]).toMatchObject({ id: 'no-pins', severity: 'error' });
    const order = cs.map((c) => c.severity);
    expect(order).toEqual([...order].sort((a, b) => ['error', 'warn', 'info'].indexOf(a) - ['error', 'warn', 'info'].indexOf(b)));
  });
});

describe('map checks', () => {
  it('lists up to five unplaced buildings one by one, then groups them', () => {
    const mk = (n: number) => survey([bld('Placed', [unit('2 Bed/1 Bath', 1500)], { isSubject: true }), ...Array.from({ length: n }, (_, i) => bld(`B${i}`, [unit('2 Bed/1 Bath', 1500)], { lngLat: null }))]);
    expect(runChecks(mk(3), NOW).filter((c) => c.id.startsWith('unplaced-')).length).toBe(3);
    const many = runChecks(mk(8), NOW);
    expect(many.filter((c) => c.id.startsWith('unplaced-')).length).toBe(0);
    expect(many.find((c) => c.id === 'unplaced')!.title).toBe('8 buildings have no pin yet');
  });

  it('flags buildings on the same spot and a pin that is far from the rest', () => {
    const pts = spread(5);
    const bs = pts.map((p, i) => bld(`B${i}`, [unit('2 Bed/1 Bath', 1500)], { lngLat: p, isSubject: i === 0 }));
    bs[1].lngLat = [...bs[0].lngLat!] as [number, number];
    bs[4].lngLat = [-111.0, 53.5]; // about 160 km away
    const cs = runChecks(survey(bs), NOW);
    expect(titles(cs)).toContain('B0 and B1 share a pin location');
    expect(titles(cs).find((t) => t.startsWith('B4 is'))).toMatch(/^B4 is \d+ km from the other buildings$/);
  });

  it('warns when the subject has no pin, and flags a survey with no pins as an error', () => {
    const s = survey([bld('Sub', [unit('2 Bed/1 Bath', 1500)], { isSubject: true, lngLat: null }), bld('Comp', [unit('2 Bed/1 Bath', 1500)])]);
    expect(runChecks(s, NOW).map((c) => c.id)).toContain('subject-unplaced');
    expect(runChecks(survey([bld('A', [unit('2 Bed', 1)], { lngLat: null })]), NOW)[0].id).toBe('no-pins');
    expect(runChecks(survey([]), NOW)[0].id).toBe('empty');
  });
});

describe('data checks', () => {
  const one = (u: Unit, extra: Partial<Building> = {}) => runChecks(survey([bld('A', [u], { isSubject: true, ...extra })]), NOW);

  it('catches rent and SF that look like typos, and an unrecognised bedroom count', () => {
    expect(titles(one(unit('2 Bed/1 Bath', 150)))).toContain('A, 2 Bed/1 Bath: rent of $150 looks like a typo');
    expect(titles(one(unit('2 Bed/1 Bath', 15000)))).toContain('A, 2 Bed/1 Bath: rent of $15,000 looks like a typo');
    expect(titles(one(unit('2 Bed/1 Bath', 1500, 90)))).toContain('A, 2 Bed/1 Bath: 90 SF looks like a typo');
    expect(titles(one(unit('Loft', 1500)))).toContain('A, Loft: bedroom count not recognised');
    expect(titles(one(unit('2 Bed/1 Bath', 1500)))).toEqual([]);
  });

  it('flags placeholder text the client would see, but not harmless text', () => {
    expect(titles(one(unit('2 Bed/1 Bath', 1500, 800, { parking: 'TBC' })))).toContain('A, 2 Bed/1 Bath: parking says "TBC"');
    expect(titles(one(unit('2 Bed/1 Bath', 1500, 800, { utilities: 'to be confirmed' })))).toHaveLength(1);
    expect(titles(one(unit('2 Bed/1 Bath', 1500, 800, { parking: 'Surface Parking, Included' })))).toEqual([]);
  });

  it('flags units with no rent, buildings with no address or units, and duplicate buildings', () => {
    const cs = runChecks(survey([
      bld('A', [unit('2 Bed/1 Bath', null)], { isSubject: true, address: '' }),
      bld('B', []),
      bld('A', [unit('2 Bed/1 Bath', 1500)], { address: 'Other Rd' }),
    ]), NOW);
    const t = titles(cs);
    expect(t).toContain('A: 1 unit with no rent');
    expect(t).toContain('A has no address');
    expect(t).toContain('B has no units');
    expect(t).toContain('A appears twice');
  });

  it('checks the as-of date', () => {
    const base = [bld('A', [unit('2 Bed/1 Bath', 1500)], { isSubject: true })];
    expect(runChecks(survey(base, { asOf: '2026-05-01' }), new Date('2026-10-05T12:00:00')).map((c) => c.id)).toContain('asof-old');
    expect(runChecks(survey(base, { asOf: '' }), NOW).map((c) => c.id)).toContain('asof-missing');
    expect(runChecks(survey(base, { asOf: '2026-12-25' }), new Date('2026-10-05T12:00:00')).map((c) => c.id)).toContain('asof-future');
    expect(runChecks(survey(base, { asOf: '2026-09-20' }), new Date('2026-10-05T12:00:00')).map((c) => c.id)).not.toContain('asof-old');
  });
});

describe('comparison checks', () => {
  const comps = (rents: number[]) => rents.map((r, i) => bld(`C${i}`, [unit('2 Bed/1 Bath', r)]));

  it('points out a rent far from the market median and says what to do', () => {
    const cs = runChecks(survey([bld('Sub', [unit('2 Bed/1 Bath', 1500)], { isSubject: true }), ...comps([1500, 1520, 1480, 1510, 2300])]), NOW);
    const o = cs.filter((c) => c.id.startsWith('outlier-'));
    expect(o).toHaveLength(1);
    expect(o[0].title).toBe('C4: 2 Beds rent of $2,300 is 52% above the median');
    expect(o[0].severity).toBe('info');
    expect(o[0].detail).toContain('switch it off');
  });

  it('needs at least four comparable buildings, and ignores what is already switched off', () => {
    const few = runChecks(survey([bld('Sub', [unit('2 Bed/1 Bath', 1500)], { isSubject: true }), ...comps([1500, 1520, 2300])]), NOW);
    expect(few.some((c) => c.id.startsWith('outlier-'))).toBe(false);
    const bs = comps([1500, 1520, 1480, 1510, 2300]);
    bs[4].excluded = true;
    const switched = runChecks(survey([bld('Sub', [unit('2 Bed/1 Bath', 1500)], { isSubject: true }), ...bs]), NOW);
    expect(switched.some((c) => c.id.startsWith('outlier-'))).toBe(false);
    expect(switched.find((c) => c.id === 'switched-off')!.title).toBe('1 unit switched off in the summary');
  });
});

describe('checks about the Excel workbook', () => {
  it('says nothing when the app and the sheet agree', async () => {
    expect(await excelChecks(await load('clareview-townhomes.xlsx'))).toEqual([]);
  });

  it('counts edits not yet written, and buildings added in the app', async () => {
    const s = await load('clareview-townhomes.xlsx');
    s.buildings[0].units[0].rate = 2400;
    s.buildings[0].units[0].parking = '$150 garage';
    s.buildings.push(bld('Maple Court', [unit('2 Bed/1 Bath', 1700)], { addedInApp: true }));
    const cs = await excelChecks(s);
    expect(cs.map((c) => c.title)).toEqual(['1 building added in the app is not in your Excel yet', '2 edits made in the app are not in your Excel yet']);
    expect(cs[1].detail).toContain('Pilot Townhomes');
  });

  it('notes when there is no stored workbook', async () => {
    const s = await load('clareview-townhomes.xlsx');
    delete s.source;
    expect((await excelChecks(s))[0].id).toBe('no-source');
  });
});
