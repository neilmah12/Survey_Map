import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSurvey } from '../src/lib/parse';
import { NO_FILTERS, filterOptions, kindContext, visibleUnits } from '../src/lib/groups';
import { includedTag, pinBadges, utilStatus } from '../src/lib/utilities';
import { filterCaption, legendItems } from '../src/lib/exportLayout';
import { DEFAULT_SUMMARY, type Unit, type ViewSettings } from '../src/types';

const unit = (utilities: string, extra: Partial<Unit> = {}): Unit => ({
  id: utilities, type: '2 Bed', beds: 2, sf: null, rate: 1300, netRate: null, parking: '', utilities, incentive: '', notes: '', extras: {}, ...extra,
});

async function load(name: string) {
  const b = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  return parseSurvey(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

describe('utilities status', () => {
  it('reads included, a known charge, and tenant-paid from the sheet wording', () => {
    expect(utilStatus(unit('Heat + Water included'))).toBe('included');
    expect(utilStatus(unit('Water Included'))).toBe('included');
    expect(utilStatus(unit('All utilities included'))).toBe('included');
    expect(utilStatus(unit('$300 includes all utilities'))).toBe('charged');
    expect(utilStatus(unit('$295 Additional $100/occupant Does not include power'))).toBe('charged');
    expect(utilStatus(unit('Not Included'))).toBe('tenant');
    expect(utilStatus(unit('Not included'))).toBe('tenant');
    expect(utilStatus(unit('Tenant responsible for servicing their unit'))).toBe('tenant');
    expect(utilStatus(unit(''))).toBeNull();
    expect(utilStatus(unit('TBC'))).toBeNull();
    expect(utilStatus(unit('', { utilitiesAmt: 150 }))).toBe('charged'); // an amount typed in the app
  });

  it('names what is included on the pin tag', () => {
    expect(includedTag('Heat + Water included')).toBe('Heat + water incl.');
    expect(includedTag('Water Included')).toBe('Water incl.');
    expect(includedTag('All utilities included')).toBe('Utils incl.');
    expect(includedTag('Heat, water and power included')).toBe('Utils incl.');
    expect(includedTag('Utilities included')).toBe('Utils incl.');
  });

  it('tags a pin for an incentive and for utilities in the rent, never for tenant-paid', () => {
    expect(pinBadges([unit('Heat + Water included', { incentive: '1 month free' })])).toEqual([
      { kind: 'incentive', text: 'Incentive' },
      { kind: 'utils', text: 'Heat + water incl.' },
    ]);
    expect(pinBadges([unit('Not Included')])).toEqual([]);
    expect(pinBadges([unit('Not Included', { incentive: 'TBC' })])).toEqual([]); // a placeholder is not an offer
    expect(pinBadges([unit('$300 includes all utilities')])).toEqual([]);
  });
});

describe('utilities filter', () => {
  it('offers Extra charge and Not included on the Clareview wording, and filters by them', async () => {
    const s = await load('clareview-townhomes.xlsx'); // "$300 includes all utilities" and "Not included"
    expect(filterOptions(s).utils).toEqual(['Extra charge', 'Not included']);
    const ctx = kindContext(s);
    const shown = (utils: string[]) => s.buildings.filter((b) => visibleUnits(b, { filters: { ...NO_FILTERS, utils }, ctx }).length).map((b) => b.name);
    expect(shown(['Extra charge'])).toEqual(['Pilot Townhomes', 'Prince Charles Townhomes', 'Idylwylde Townhomes']);
    expect(shown(['Not included'])).toEqual(['Albany Townhomes', 'Strathern 8-Plex Townhomes', 'Eastwood Townhomes', 'Clareview Townhomes']);
  });

  it('captions the filter and adds a legend line when a pin carries the utilities tag', () => {
    expect(filterCaption({ ...NO_FILTERS, utils: ['Included'] })).toBe('Showing Utilities: Included');
    const s = {
      title: 'T', location: '', asOf: '2026-10-30',
      buildings: [{
        id: 'a', name: 'A', address: '', yearBuilt: '', yearRenovated: '', configuration: '', isSubject: false, lngLat: [0, 0] as [number, number],
        propertyNotes: '', contact: '', url: '', units: [unit('Heat + Water included')],
      }],
    };
    const view: ViewSettings = { metric: 'rate', summary: DEFAULT_SUMMARY, filters: NO_FILTERS, rings: false, ringsKm: [] };
    expect(legendItems(s, view).map((x) => x.kind)).toContain('utils');
  });
});
