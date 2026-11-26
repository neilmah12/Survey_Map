import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSurvey } from '../src/lib/parse';
import { NO_FILTERS, filterOptions, unitBedCat } from '../src/lib/groups';
import { activeChoices, availableMetrics, isDefaultChoice, matching, optionCount, resetChoice, viewSentence } from '../src/lib/choose';
import { DEFAULT_SUMMARY, type Survey, type ViewSettings } from '../src/types';

async function load(name: string): Promise<Survey> {
  const b = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  const s = await parseSurvey(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  s.buildings.forEach((x, i) => { x.lngLat = [-113.5 + i * 0.01, 53.5]; }); // the pins a client page would have
  return s;
}
const view = (over: Partial<ViewSettings> = {}, filters = NO_FILTERS): ViewSettings => ({ metric: 'rate', summary: { ...DEFAULT_SUMMARY }, filters, rings: false, ringsKm: [1, 3], ...over });

describe('choose what to compare', () => {
  it('offers base rent always, and the others only when the data can show them', async () => {
    const s = await load('clareview-townhomes.xlsx');
    // strip everything that could change a rent, so net rent has nothing to show
    for (const b of s.buildings) for (const u of b.units) Object.assign(u, { incentive: '', parking: '', utilities: '', incentiveAmt: null, parkingAmt: null, utilitiesAmt: null, miscAmt: null, netOverride: undefined, incentiveFree: null });
    const a = availableMetrics(s);
    expect(a.rate).toBe(true);
    expect(a.psf).toBe(true); // the sheet lists square feet
    expect(a.net).toBe(false);
    s.buildings[0].units[0].incentiveAmt = 100;
    expect(availableMetrics(s).net).toBe(true);
    for (const b of s.buildings) for (const u of b.units) u.sf = null;
    expect(availableMetrics(s).psf).toBe(false); // no square feet, no rent per square foot
  });

  it('counts the comparable buildings behind each button, and never the subject', async () => {
    const s = await load('churchill-apartments.xlsx');
    const beds = filterOptions(s).beds;
    expect(beds.length).toBeGreaterThan(1);
    const comps = s.buildings.filter((b) => !b.isSubject);
    for (const v of beds) {
      const direct = comps.filter((b) => b.units.some((u) => unitBedCat(u) === v)).length;
      expect(optionCount(s, NO_FILTERS, 'beds', v)).toBe(direct);
    }
    expect(s.buildings.some((b) => b.isSubject)).toBe(true);
    // a building that is the subject adds nothing, whatever it offers
    const subject = s.buildings.find((b) => b.isSubject)!;
    const only = beds.find((v) => subject.units.some((u) => unitBedCat(u) === v) && !comps.some((b) => b.units.some((u) => unitBedCat(u) === v)));
    if (only) expect(optionCount(s, NO_FILTERS, 'beds', only)).toBe(0);
  });

  it('counts a button against the other choices already made, and ignores its own filter', async () => {
    const s = await load('churchill-apartments.xlsx');
    const f = { ...NO_FILTERS, beds: ['2 Beds'] };
    const both = optionCount(s, f, 'baths', '2');
    const alone = optionCount(s, NO_FILTERS, 'baths', '2');
    expect(both).toBeLessThanOrEqual(alone); // narrowed by bedrooms
    // choosing another bedroom button is "or": the count for 1 Bed does not depend on 2 Beds being ticked
    expect(optionCount(s, f, 'beds', '1 Bed')).toBe(optionCount(s, NO_FILTERS, 'beds', '1 Bed'));
  });

  it('says what is on screen in one sentence, in plain words', async () => {
    expect(viewSentence(view(), 5, 5)).toEqual({ rent: 'base rent', what: 'all unit types', near: '', where: '5 of 5 buildings' });
    const v = view({ metric: 'net' }, { ...NO_FILTERS, beds: ['2 Beds', '3 Beds'], baths: ['1.5'], kind: ['Townhome'] });
    expect(viewSentence(v, 3, 5)).toEqual({ rent: 'net rent', what: '2 Beds or 3 Beds, 1.5 bath, Townhome', near: '', where: '3 of 5 buildings' });
    expect(viewSentence(view({ metric: 'psf' }), 1, 1).where).toBe('1 of 1 building');
  });

  it('counts the buildings that still show', async () => {
    const s = await load('clareview-townhomes.xlsx');
    const comps = s.buildings.filter((b) => !b.isSubject).length; // the subject is not part of the market
    expect(matching(s, NO_FILTERS)).toEqual({ shown: comps, total: comps });
    const none = matching(s, { ...NO_FILTERS, beds: ['4+'] });
    expect(none.total).toBe(comps);
    expect(none.shown).toBeLessThan(none.total);
  });

  it('knows when there is nothing to reset, and resets only what the visitor chose', () => {
    expect(isDefaultChoice(view())).toBe(true);
    expect(isDefaultChoice(view({ metric: 'psf' }))).toBe(false);
    expect(isDefaultChoice(view({ rings: true }))).toBe(false);
    expect(isDefaultChoice(view({}, { ...NO_FILTERS, beds: ['1 Bed'] }))).toBe(false);
    const changed = view({ metric: 'net', rings: true, ringsKm: [2] }, { ...NO_FILTERS, beds: ['1 Bed'] });
    changed.summary = { ...DEFAULT_SUMMARY, stat: 'median', chart: 'diff' };
    const r = resetChoice(changed);
    expect(isDefaultChoice(r)).toBe(true);
    expect(r.summary.stat).toBe('median'); // how the figures are worked out is not part of the choice
    expect(r.summary.chart).toBe('diff');
    expect(r.ringsKm).toEqual([2]);
  });

  it('counts the active choices for a badge', () => {
    expect(activeChoices(view())).toBe(0);
    expect(activeChoices(view({ metric: 'net', rings: true }, { ...NO_FILTERS, beds: ['1 Bed', '2 Beds'], utils: ['Included'] }))).toBe(4);
  });
});
