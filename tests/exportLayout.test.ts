import { describe, expect, it } from 'vitest';
import { PAGES, filterCaption, legendItems, niceScale, pageRegions, summaryFootnotes, wrapText, type Box, type PageKind } from '../src/lib/exportLayout';
import { NO_FILTERS } from '../src/lib/groups';
import { DEFAULT_SUMMARY, type Building, type Survey, type Unit, type ViewSettings } from '../src/types';

const KINDS = Object.keys(PAGES) as PageKind[];
const inside = (b: Box, p: { w: number; h: number }) => b.x >= 0 && b.y >= 0 && b.x + b.w <= p.w && b.y + b.h <= p.h;
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe('page regions', () => {
  it.each(KINDS)('%s: everything fits on the page and nothing overlaps, with and without a panel', (kind) => {
    for (const panel of [true, false]) {
      const r = pageRegions(kind, panel);
      const boxes = [r.header, r.map, r.footer, ...(r.panel ? [r.panel] : [])];
      for (const b of boxes) {
        expect(inside(b, r.page)).toBe(true);
        expect(b.w).toBeGreaterThan(100);
        expect(b.h).toBeGreaterThan(30);
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
      expect(Boolean(r.panel)).toBe(panel);
    }
  });

  it('has the right page sizes at 96 pixels per inch', () => {
    expect(pageRegions('letter-landscape', true).page).toEqual({ w: 1056, h: 816 });
    expect(pageRegions('letter-portrait', true).page).toEqual({ w: 816, h: 1056 });
    expect(pageRegions('slide', true).page).toEqual({ w: 1280, h: 720 });
  });

  it('puts the panel beside the map in landscape and under it in portrait', () => {
    const l = pageRegions('letter-landscape', true);
    expect(l.panel!.x).toBeGreaterThan(l.map.x + l.map.w - 1);
    const p = pageRegions('letter-portrait', true);
    expect(p.panel!.y).toBeGreaterThan(p.map.y + p.map.h - 1);
  });

  it('gives the map the full width when there is no panel', () => {
    const r = pageRegions('letter-landscape', false);
    expect(r.map.w).toBe(r.page.w - 48);
  });
});

describe('scale bar', () => {
  it('picks a round length that fits', () => {
    const s = niceScale(8, 120); // 8 m per pixel, at most 120 px = 960 m
    expect(s.meters).toBe(500);
    expect(s.label).toBe('500 m');
    expect(s.px).toBeCloseTo(62.5, 6);
    expect(niceScale(20, 120).label).toBe('2 km');
    expect(niceScale(60, 120).label).toBe('5 km');
    expect(niceScale(1, 120).meters).toBe(100);
  });
  it('never exceeds the room it is given', () => {
    for (const mpp of [0.5, 3, 10, 40, 150, 400]) expect(niceScale(mpp, 120).px).toBeLessThanOrEqual(120 + 1e-9);
  });
});

const unit = (extra: Partial<Unit> = {}): Unit => ({ id: 'u', type: '2 Bed/1 Bath', beds: null, sf: 800, rate: 1500, netRate: null, parking: '', utilities: '', incentive: '', notes: '', extras: {}, ...extra });
const bld = (id: string, extra: Partial<Building> = {}, units: Unit[] = [unit()]): Building => ({
  id, name: id, address: '', yearBuilt: '', yearRenovated: '', configuration: '', isSubject: false, lngLat: [-113.5, 53.5],
  propertyNotes: '', contact: '', url: '', imageUrl: '', units, ...extra,
});
const view: ViewSettings = { metric: 'rate', summary: DEFAULT_SUMMARY, filters: NO_FILTERS, rings: false, ringsKm: [0.5, 1, 2] };
const survey = (bs: Building[]): Survey => ({ title: 'T', location: 'Edmonton', asOf: '2026-10-01', buildings: bs });

describe('legend', () => {
  it('lists only what appears on the map', () => {
    expect(legendItems(survey([bld('a', { isSubject: true }), bld('b')]), view).map((i) => i.kind)).toEqual(['subject', 'comp']);
    expect(legendItems(survey([bld('b')]), view).map((i) => i.kind)).toEqual(['comp']);
    const full = survey([
      bld('s', { isSubject: true }),
      bld('c', { excluded: true }, [unit({ incentive: '1 month free' })]),
    ]);
    expect(legendItems(full, { ...view, rings: true }).map((i) => i.kind)).toEqual(['subject', 'comp', 'excluded', 'incentive', 'rings']);
  });
  it('ignores buildings with no pin, and skips rings when there is no subject', () => {
    expect(legendItems(survey([bld('a', { lngLat: null }), bld('b')]), view).map((i) => i.kind)).toEqual(['comp']);
    expect(legendItems(survey([bld('b')]), { ...view, rings: true }).map((i) => i.kind)).toEqual(['comp']);
  });
  it('leaves out symbols for buildings the unit filter hides', () => {
    const s = survey([bld('a', {}, [unit({ type: '1 Bed/1 Bath', incentive: 'free month' })]), bld('b', {}, [unit()])]);
    const filtered = legendItems(s, { ...view, filters: { ...NO_FILTERS, beds: ['2 Beds'] } });
    expect(filtered.map((i) => i.kind)).toEqual(['comp']); // a's incentive is on a 1 bed that is filtered out
  });
});

describe('captions and text', () => {
  it('describes the unit filters, or says nothing', () => {
    expect(filterCaption(NO_FILTERS)).toBe('');
    expect(filterCaption({ beds: ['2 Beds', '2 + Den'], baths: ['1', '2'], reno: [] })).toBe('Showing Bedrooms: 2 Beds, 2 + Den; Bathrooms: 1, 2');
  });
  it('wraps text on spaces to a width', () => {
    const m = (s: string) => s.length * 6;
    expect(wrapText('2 Beds / 1.5 Bath · Partial Reno', 120, m)).toEqual(['2 Beds / 1.5 Bath ·', 'Partial Reno']);
    expect(wrapText('short', 120, m)).toEqual(['short']);
    expect(wrapText('', 120, m)).toEqual(['']);
    expect(wrapText('Unbreakable-word-that-is-too-long', 60, m)).toEqual(['Unbreakable-word-that-is-too-long']);
  });
  it('writes the footnotes under the table', () => {
    const r = { excludedUnits: 2 } as never;
    expect(summaryFootnotes(r, true, 1)).toEqual(['Each building counts once, using its own average for that unit type.', '2 units are switched off and not counted.']);
    expect(summaryFootnotes({ excludedUnits: 0 } as never, false, 3)).toEqual(['Every unit counts.', 'The subject figure is the average of 3 properties.']);
  });
});
