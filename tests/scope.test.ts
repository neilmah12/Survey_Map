import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSurvey } from '../src/lib/parse';
import { NO_FILTERS } from '../src/lib/groups';
import { computeSummary } from '../src/lib/summary';
import { pinNumbers } from '../src/lib/pinNumbers';
import { activeSubject, fmtKm, maxRingKm, ringRadii, scopeSurvey } from '../src/lib/scope';
import { appliedPills, matching, resetChoice, withinCount } from '../src/lib/choose';
import { toClientSnapshot, snapshotToView, snapshotToSurvey } from '../src/lib/snapshot';
import { DEFAULT_SUMMARY, type Survey, type ViewSettings } from '../src/types';

async function load(): Promise<Survey> {
  const b = readFileSync(new URL('./fixtures/clareview-townhomes.xlsx', import.meta.url));
  const s = await parseSurvey(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  // About 0.0143 degrees of longitude is 1 km at this latitude: building i sits i km east of the first
  s.buildings.forEach((x, i) => { x.isSubject = i === 0; x.lngLat = [-113.5 + i * 0.01488, 53.5]; });
  return s;
}
const view = (over: Partial<ViewSettings> = {}): ViewSettings => ({ metric: 'rate', summary: { ...DEFAULT_SUMMARY }, filters: NO_FILTERS, rings: false, ringsKm: [1, 3, 5], ...over });

describe('scope: distance and the subject being compared', () => {
  it('with nothing chosen it only measures distances, sets nothing aside, and is stable when applied again', async () => {
    const s = await load();
    const a = scopeSurvey(s, view());
    expect(a.buildings.some((b) => b.out)).toBe(false);
    expect(a.buildings[1].distKm).toBeCloseTo(1, 0);
    expect(scopeSurvey(a, view())).toBe(a); // the same object, so the map does not rebuild its pins
    expect(scopeSurvey({ ...s, buildings: s.buildings.map((b) => ({ ...b, isSubject: false })) }, view()).buildings.some((b) => b.distKm !== undefined)).toBe(false);
  });

  it('marks comparables beyond the distance as far, and measures from the subject', async () => {
    const s = await load();
    const scoped = scopeSurvey(s, view({ within: 2.5 }));
    const far = scoped.buildings.filter((b) => b.out === 'far');
    expect(far.length).toBe(s.buildings.length - 3); // the subject and the buildings 1 km and 2 km away stay
    expect(scoped.buildings[0].out).toBeUndefined();
    expect(scoped.buildings[1].distKm).toBeCloseTo(1, 0);
    expect(scoped.buildings[0].distKm).toBeUndefined();
  });

  it('the market summary only counts buildings inside the distance', async () => {
    const s = await load();
    const all = computeSummary(scopeSurvey(s, view()), { metric: 'rate', filters: NO_FILTERS, settings: DEFAULT_SUMMARY });
    const near = computeSummary(scopeSurvey(s, view({ within: 2.5 })), { metric: 'rate', filters: NO_FILTERS, settings: DEFAULT_SUMMARY });
    expect(all.marketBuildings).toBe(s.buildings.length - 1);
    expect(near.marketBuildings).toBe(2);
    expect(near.excludedBuildings).toBe(0); // set aside by distance is not "switched off"
    expect(near.excludedUnits).toBe(0);
  });

  it('numbers do not change with the distance, and count from the subject', async () => {
    const s = await load();
    const a = pinNumbers(scopeSurvey(s, view()).buildings);
    const b = pinNumbers(scopeSurvey(s, view({ within: 1.5 })).buildings);
    expect([...b]).toEqual([...a]);
    expect(a.get(s.buildings[1].id)).toBe(1);
  });

  it('with several subjects only the chosen one drives the comparison; the others are never comparables', async () => {
    const s = await load();
    s.buildings[3].isSubject = true;
    const first = scopeSurvey(s, view());
    expect(first.buildings[3].out).toBe('subject'); // the first placed subject is the default
    expect(computeSummary(first, { metric: 'rate', filters: NO_FILTERS, settings: DEFAULT_SUMMARY }).subjectBuildings).toBe(1);
    const second = scopeSurvey(s, view({ subjectId: s.buildings[3].id }));
    expect(activeSubject(second.buildings, s.buildings[3].id)?.id).toBe(s.buildings[3].id);
    expect(second.buildings[0].out).toBe('subject');
    expect(second.buildings[3].out).toBeUndefined();
    expect(second.buildings[2].distKm).toBeCloseTo(1, 0); // measured from the chosen subject
    const m = computeSummary(second, { metric: 'rate', filters: NO_FILTERS, settings: DEFAULT_SUMMARY });
    expect(m.marketBuildings).toBe(s.buildings.length - 2); // the other subject is not in the market
    expect(pinNumbers(second.buildings).has(s.buildings[0].id)).toBe(false); // a subject set aside has no number
  });

  it('an unknown subject id falls back to the first subject', async () => {
    const s = await load();
    expect(activeSubject(s.buildings, 'nope')?.id).toBe(s.buildings[0].id);
  });

  it('the rings: the chosen distance only, else every offered one when switched on', () => {
    expect(ringRadii(view())).toEqual([]);
    expect(ringRadii(view({ rings: true }))).toEqual([1, 3, 5]);
    expect(ringRadii(view({ rings: true, within: 3 }))).toEqual([3]);
    expect(ringRadii(view({ within: 2 }))).toEqual([2]); // a chosen distance always shows its ring
    expect(maxRingKm(view({ rings: true }))).toBe(5);
    expect(maxRingKm(view())).toBe(0);
  });

  it('counts what each distance would leave, and says so in the sentence pieces', async () => {
    const s = await load();
    const scoped = scopeSurvey(s, view());
    expect(withinCount(scoped, NO_FILTERS, 1.5)).toBe(1);
    expect(withinCount(scoped, NO_FILTERS, 100)).toBe(s.buildings.length - 1);
    const near = scopeSurvey(s, view({ within: 2.5 }));
    expect(matching(near, NO_FILTERS)).toEqual({ shown: 2, total: s.buildings.length - 1 }); // comparables only
    expect(appliedPills(view({ within: 3 }))).toEqual(['Within 3 km']);
    expect(resetChoice(view({ within: 3 })).within).toBeNull();
    expect(fmtKm(0.46)).toBe('0.5 km');
    expect(fmtKm(12.4)).toBe('12 km');
  });

  it('the distance and the subject choice travel in the client link, and old links still open', async () => {
    const s = await load();
    const { snapshot } = toClientSnapshot(s, view({ within: 3, subjectId: s.buildings[0].id }));
    expect(snapshotToView(snapshot).within).toBe(3);
    expect(snapshotToView(snapshot).subjectId).toBe(s.buildings[0].id);
    // a link published before this feature has neither field
    const old = JSON.parse(JSON.stringify(toClientSnapshot(s, view()).snapshot));
    expect(old.view.within).toBeUndefined();
    const v = snapshotToView(old);
    expect(v.within).toBeNull();
    expect(v.subjectId).toBeNull();
    expect(scopeSurvey(snapshotToSurvey(old), v).buildings.some((b) => b.out)).toBe(false);
  });

  it('the scope marks never reach a published link', async () => {
    const s = await load();
    const { snapshot } = toClientSnapshot(scopeSurvey(s, view({ within: 1.5 })), view({ within: 1.5 }));
    expect(JSON.stringify(snapshot)).not.toMatch(/distKm|"out"/);
  });
});
