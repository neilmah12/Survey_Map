import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSurvey } from '../src/lib/parse';
import { NO_FILTERS } from '../src/lib/groups';
import { computeSummary, type SummaryResult } from '../src/lib/summary';
import { DEFAULT_SUMMARY, type Metric, type SummarySettings, type Survey } from '../src/types';

async function load(name: string): Promise<Survey> {
  const b = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  return parseSurvey(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

const settings = (over: Partial<SummarySettings> = {}, split: Partial<SummarySettings['split']> = {}): SummarySettings => ({
  ...DEFAULT_SUMMARY,
  ...over,
  split: { ...DEFAULT_SUMMARY.split, ...split },
});
const run = (s: Survey, o: { metric?: Metric; filters?: typeof NO_FILTERS; settings?: SummarySettings; subjectInMarket?: boolean } = {}): SummaryResult =>
  computeSummary(s, { metric: o.metric ?? 'rate', filters: o.filters ?? NO_FILTERS, settings: o.settings ?? DEFAULT_SUMMARY, subjectInMarket: o.subjectInMarket });
const byLabel = (r: SummaryResult, label: string) => r.rows.find((x) => x.label === label)!;

describe('matches the pivot tables in the sample sheets', () => {
  // Their pivots average every unit row (not building by building), so these use "each unit counts".
  const unitLevel = (split: Partial<SummarySettings['split']>) => settings({ perBuilding: false }, split);

  it('Glenora: market only, by bathrooms (pivot rows 46 to 50)', async () => {
    const r = run(await load('glenora-townhomes.xlsx'), { settings: unitLevel({ baths: true }) });
    expect(byLabel(r, '2 Beds / 1 Bath').market.value).toBeCloseTo(1575, 6);
    expect(byLabel(r, '2 Beds / 1.5 Bath').market.value).toBeCloseTo(1850, 6);
    expect(byLabel(r, '2 Beds / 2 Bath').market.value).toBeCloseTo(2050, 6);
    expect(byLabel(r, '2 Beds / 2.5 Bath').market.value).toBeCloseTo(1935, 6);
    expect(r.total.market.value).toBeCloseTo(1869, 6);
    expect(r.total.market.n).toBe(5); // the subject's two units are not in the market
  });

  it('Glenora: net rent and rent PSF totals', async () => {
    const s = await load('glenora-townhomes.xlsx');
    expect(run(s, { metric: 'net', settings: unitLevel({}) }).total.market.value).toBeCloseTo(1809.0833333, 5);
    expect(run(s, { metric: 'psf', settings: unitLevel({}) }).total.market.value).toBeCloseTo(1.7300935591627957, 9);
  });

  it('River Valley: subject counted with the market, by bathrooms (pivot rows 23 to 28)', async () => {
    const r = run(await load('river-valley-townhomes.xlsx'), { settings: unitLevel({ baths: true }), subjectInMarket: true });
    expect(byLabel(r, '2 Beds / 1.5 Bath').market.value).toBeCloseTo(1687.75, 6);
    expect(byLabel(r, '3 Beds / 1 Bath').market.value).toBeCloseTo(1668, 6);
    expect(byLabel(r, '3 Beds / 1.5 Bath').market.value).toBeCloseTo(1738.75, 6);
    expect(byLabel(r, '4+ / 1.5 Bath').market.value).toBeCloseTo(2124.5, 6);
    expect(byLabel(r, '2 Beds / 1 Bath').market.value).toBeCloseTo(1693.5, 6);
    expect(r.total.market.value).toBeCloseTo(1762.7142857142858, 9);
    expect(r.total.market.n).toBe(14);
    const psf = run(await load('river-valley-townhomes.xlsx'), { metric: 'psf', settings: unitLevel({ baths: true }), subjectInMarket: true });
    expect(byLabel(psf, '2 Beds / 1.5 Bath').market.value).toBeCloseTo(1.7329901480943803, 9);
    expect(psf.total.market.value).toBeCloseTo(1.7258506289273574, 9);
  });

  it('Boardwalk: split by type, bathrooms and renovation (pivot rows 44 to 54)', async () => {
    const r = run(await load('boardwalk-portfolio.xlsx'), { settings: unitLevel({ baths: true, kind: true, reno: true }) });
    expect(byLabel(r, '1 Bed / 1 Bath · Apartment · Basic').market.value).toBeCloseTo(1151.8, 6);
    expect(byLabel(r, '1 Bed / 1 Bath · Apartment · Partial Reno').market.value).toBeCloseTo(1181, 6);
    expect(byLabel(r, 'Studio / 1 Bath · Apartment · Basic').market.value).toBeCloseTo(895, 6);
    expect(byLabel(r, '2 Beds / 1 Bath · Townhome · Basic').market.value).toBeCloseTo(1405, 6);
    expect(byLabel(r, '3 Beds / 1 Bath · Townhome · Partial Reno').market.value).toBeCloseTo(1709.75, 6);
    expect(r.total.market.value).toBeCloseTo(1371.7179487, 5);
    expect(r.hasSubject).toBe(false);
  });
});

describe('the default method: each building counts once', () => {
  it('compares the subject with the market on a hand-worked example (Clareview 3 beds)', async () => {
    const r = run(await load('clareview-townhomes.xlsx'));
    const row = byLabel(r, '3 Beds');
    // Pilot 2275, Prince Charles (1665+1995+2195)/3, Albany 2000, Idylwylde 2250, Strathern 2300, Eastwood 1995
    expect(row.market.value).toBeCloseTo((2275 + (1665 + 1995 + 2195) / 3 + 2000 + 2250 + 2300 + 1995) / 6, 6);
    expect(row.market.n).toBe(6);
    expect(row.subject.value).toBeCloseTo((1696 + 1900 + 1950 + 2000) / 4, 6); // 1886.5
    expect(row.subject.n).toBe(1);
    expect(row.diff).toBeCloseTo(1886.5 - 2128.6111111, 5);
    expect(row.diffPct).toBeCloseTo((1886.5 - 2128.6111111) / 2128.6111111, 6);
    expect(r.marketBuildings).toBe(6);
    expect(r.subjectBuildings).toBe(1);
  });

  it('median across buildings', async () => {
    const r = run(await load('clareview-townhomes.xlsx'), { settings: settings({ stat: 'median' }) });
    // building values sorted: 1951.67, 1995, 2000, 2250, 2275, 2300 -> (2000 + 2250) / 2
    expect(byLabel(r, '3 Beds').market.value).toBeCloseTo(2125, 6);
  });

  it('the subject is never in its own market', async () => {
    const s = await load('clareview-townhomes.xlsx');
    const withSubject = run(s, { subjectInMarket: true }).total.market.n;
    expect(withSubject).toBe(7);
    expect(run(s).total.market.n).toBe(6);
  });

  it('leaves rent PSF blank for units with no square footage', async () => {
    const r = run(await load('clareview-townhomes.xlsx'), { metric: 'psf' });
    // only Pilot, Idylwylde, Strathern and Eastwood list SF
    expect(byLabel(r, '3 Beds').market.n).toBe(4);
    expect(byLabel(r, '3 Beds').market.value).toBeCloseTo((2275 / 1510 + 2250 / 1510 + 2300 / 1250 + 1995 / 1550) / 4, 9);
  });

  it('allows several subjects (a portfolio): they are compared against everything else', async () => {
    const s = await load('clareview-townhomes.xlsx');
    s.buildings[0].isSubject = true; // Pilot joins Clareview as a subject
    const r = run(s);
    expect(r.subjectBuildings).toBe(2);
    expect(byLabel(r, '3 Beds').subject.value).toBeCloseTo((2275 + 1886.5) / 2, 6);
    expect(byLabel(r, '3 Beds').market.n).toBe(5);
  });

  it('with no subject there is nothing to compare, but the market still shows', async () => {
    const r = run(await load('boardwalk-portfolio.xlsx'));
    expect(r.hasSubject).toBe(false);
    expect(byLabel(r, '2 Beds').market.value).not.toBeNull();
    expect(byLabel(r, '2 Beds').subject).toEqual({ value: null, n: 0 });
    expect(byLabel(r, '2 Beds').diff).toBeNull();
  });
});

describe('switching properties and suites off', () => {
  it('a whole building out of the averages (an outlier)', async () => {
    const s = await load('clareview-townhomes.xlsx');
    s.buildings[0].excluded = true; // Pilot
    const r = run(s);
    expect(byLabel(r, '3 Beds').market.value).toBeCloseTo(((1665 + 1995 + 2195) / 3 + 2000 + 2250 + 2300 + 1995) / 5, 6);
    expect(r.excludedBuildings).toBe(1);
    expect(r.excludedUnits).toBe(1);
    expect(r.marketBuildings).toBe(5);
  });

  it('one suite out, the building stays with its other suites', async () => {
    const s = await load('clareview-townhomes.xlsx');
    s.buildings[1].units[2].excluded = true; // Prince Charles second floor
    const r = run(s);
    expect(byLabel(r, '3 Beds').market.value).toBeCloseTo((2275 + (1665 + 1995) / 2 + 2000 + 2250 + 2300 + 1995) / 6, 6);
    expect(r.excludedUnits).toBe(1);
    expect(r.excludedBuildings).toBe(0);
  });

  it('removing only the 2 bed / 1 bath of a building keeps its 1 bed / 1 bath', async () => {
    const before = run(await load('churchill-apartments.xlsx'), { settings: settings({}, { baths: true }) });
    expect(byLabel(before, '2 Beds / 1 Bath').market).toEqual({ value: 1750, n: 1 }); // only 100 House offers one
    const s = await load('churchill-apartments.xlsx');
    const house = s.buildings.find((b) => b.name === '100 House')!;
    house.units.find((u) => u.type.startsWith('2 Bedroom'))!.excluded = true;
    const after = run(s, { settings: settings({}, { baths: true }) });
    expect(byLabel(after, '2 Beds / 1 Bath').market).toEqual({ value: null, n: 0 }); // that suite is out
    expect(byLabel(after, '2 Beds / 1 Bath').subject.value).toBe(1841); // the subject's own is untouched
    expect(byLabel(after, '1 Bed / 1 Bath').market.n).toBe(4); // 100 House's 1 bed still counts, with Connect, Edmonton House and E11even
    expect(byLabel(before, '1 Bed / 1 Bath').market.value).toBe(byLabel(after, '1 Bed / 1 Bath').market.value);
    expect(after.excludedUnits).toBe(1);
  });

  it('only counts exclusions that the current filter would have shown', async () => {
    const s = await load('clareview-townhomes.xlsx');
    s.buildings[0].excluded = true;
    expect(run(s, { filters: { ...NO_FILTERS, beds: ['2 Beds'] } }).excludedUnits).toBe(0); // no 2 beds in this survey
  });

  it('the unit filters narrow what is compared (Churchill 2 beds with 2 baths)', async () => {
    const r = run(await load('churchill-apartments.xlsx'), { filters: { ...NO_FILTERS, beds: ['2 Beds'], baths: ['2'] } });
    expect(byLabel(r, '2 Beds').market.value).toBeCloseTo((1950 + 2100 + 1718 + 2129) / 4, 6);
    expect(byLabel(r, '2 Beds').subject.value).toBe(1953);
    expect(r.rows).toHaveLength(1);
  });

  it('a unit type only the subject offers still gets a row, with no market figure', async () => {
    const r = run(await load('castle-harbour-apartments.xlsx'));
    const studio = byLabel(r, 'Studio');
    expect(studio.market).toEqual({ value: null, n: 0 });
    expect(studio.subject.value).toBe(1000);
    expect(studio.diff).toBeNull();
  });
});
