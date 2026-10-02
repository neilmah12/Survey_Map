import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSurvey } from '../src/lib/parse';
import {
  NO_FILTERS, filterOptions, kindContext, unitBathCat, unitBedCat, unitBaths, unitKind, unitReno, visibleUnits,
  type UnitFilter, type UnitFilters,
} from '../src/lib/groups';
import { pinLabel } from '../src/lib/format';
import type { Building, Survey, Unit } from '../src/types';

async function load(name: string): Promise<Survey> {
  const b = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  return parseSurvey(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

const unit = (type: string, rate = 1000): Unit => ({
  id: type, type, beds: null, sf: null, rate, netRate: null, parking: '', utilities: '', incentive: '', notes: '', extras: {},
});
const building = (name: string, units: Unit[]): Building => ({
  id: name, name, address: '', yearBuilt: '', yearRenovated: '', configuration: '', isSubject: false, lngLat: null,
  propertyNotes: '', contact: '', url: '', units,
});
const filter = (f: Partial<UnitFilters>, s?: Survey): UnitFilter => ({
  filters: { ...NO_FILTERS, ...f },
  ctx: s ? kindContext(s) : { title: '', anyTownhome: false },
});

describe('bedroom and bathroom categories', () => {
  it('names bedroom categories like the filter chips, including dens', () => {
    const cat = (t: string) => unitBedCat(unit(t));
    expect(cat('Studio')).toBe('Studio');
    expect(cat('Bachelor - Basic')).toBe('Studio');
    expect(cat('1 Bedroom/1 Bath')).toBe('1 Bed');
    expect(cat('1 Bed + Den')).toBe('1 + Den');
    expect(cat('1 Bedroom + Den / 1 Bath')).toBe('1 + Den');
    expect(cat('1 + Den')).toBe('1 + Den');
    expect(cat('2 Bed/1.5 Bath')).toBe('2 Beds');
    expect(cat('2BR + Den')).toBe('2 + Den');
    expect(cat('3 Bedroom/2 Bath')).toBe('3 Beds');
    expect(cat('3 Bed + Den')).toBe('3 + Den');
    expect(cat('4 Bed/1.5 Bath')).toBe('4+');
    expect(cat('5 Bedroom')).toBe('4+');
    expect(cat('Loft')).toBeNull();
  });

  it('names bathroom categories', () => {
    const cat = (t: string) => unitBathCat(unit(t));
    expect(cat('2 Bed/1 Bath')).toBe('1');
    expect(cat('2 Bed/1.5 Bath')).toBe('1.5');
    expect(cat('2 Bed/2 Bath')).toBe('2');
    expect(cat('3 Bed/2.5 Bath -Main Floor Rear')).toBe('2.5');
    expect(cat('4 Bed/3 Bath')).toBe('3+');
    expect(cat('Bachelor - Basic')).toBeNull();
    expect(unitBaths(unit('2 Bedroom/1.5 Bath + unfinished basement'))).toBe(1.5);
  });

  it('reads renovation only from a trailing renovation word', () => {
    expect(unitReno(unit('2 Bedroom/1 Bath - Partial Reno'))).toBe('Partial Reno');
    expect(unitReno(unit('3 Bed/2.5 Bath Lower - Interior'))).toBeNull();
    expect(unitReno(unit('3 Bed/2.5 Bath -Main Floor Rear'))).toBeNull();
    expect(unitReno(unit('2 Bed/1 Bath'))).toBeNull();
  });
});

describe('combining filters', () => {
  const b = building('Mix', [
    unit('1 Bed/1 Bath'),
    unit('2 Bed/1 Bath', 1500),
    unit('2 Bed/2 Bath', 1700),
    unit('2 Bed/2.5 Bath', 1800),
    unit('2 Bed + Den/2 Bath', 1900),
  ]);
  const rents = (f: Partial<UnitFilters>) => visibleUnits(b, filter(f)).map((u) => u.rate);

  it('shows everything with no filters', () => {
    expect(rents({})).toEqual([1000, 1500, 1700, 1800, 1900]);
  });
  it('a bedroom filter alone ignores bathrooms', () => {
    expect(rents({ beds: ['2 Beds'] })).toEqual([1500, 1700, 1800]);
  });
  it('several bathroom choices within one bedroom choice', () => {
    expect(rents({ beds: ['2 Beds'], baths: ['1', '2', '2.5'] })).toEqual([1500, 1700, 1800]);
    expect(rents({ beds: ['2 Beds'], baths: ['2', '2.5'] })).toEqual([1700, 1800]);
  });
  it('a bathroom filter alone spans bedroom types', () => {
    expect(rents({ baths: ['2'] })).toEqual([1700, 1900]);
  });
  it('dens are their own bedroom choice and combine with others', () => {
    expect(rents({ beds: ['2 + Den'] })).toEqual([1900]);
    expect(rents({ beds: ['2 Beds', '2 + Den'], baths: ['2'] })).toEqual([1700, 1900]);
    expect(rents({ beds: ['1 Bed', '2 + Den'] })).toEqual([1000, 1900]);
  });
  it('a combination with no match leaves nothing visible', () => {
    expect(rents({ beds: ['1 Bed'], baths: ['2.5'] })).toEqual([]);
  });
  it('pin labels follow the visible units', () => {
    expect(pinLabel(b, filter({ beds: ['2 Beds'], baths: ['1', '2', '2.5'] }), 'rate')).toBe('$1,500 - $1,800');
    expect(pinLabel(b, filter({ beds: ['2 Beds'], baths: ['2'] }), 'rate')).toBe('$1,700');
  });
});

describe('filter options from real surveys', () => {
  it('lists only choices present, in display order, and skips details with one choice', async () => {
    const glenora = filterOptions(await load('glenora-townhomes.xlsx'));
    expect(glenora.beds).toEqual([]); // all 2 bed, so nothing to filter
    expect(glenora.baths).toEqual(['1', '1.5', '2', '2.5']);

    const boardwalk = filterOptions(await load('boardwalk-portfolio.xlsx'));
    expect(boardwalk.beds).toEqual(['Studio', '1 Bed', '2 Beds', '3 Beds']);
    expect(boardwalk.baths).toEqual([]); // all 1 bath
    expect(boardwalk.reno).toEqual(['Basic', 'Partial Reno']);
    expect(boardwalk.kind).toEqual(['Townhome', 'Apartment']);

    const churchill = filterOptions(await load('churchill-apartments.xlsx'));
    expect(churchill.beds).toEqual(['1 Bed', '2 Beds', '3 Beds']);
    expect(churchill.baths).toEqual(['1', '2']);
    expect(churchill.kind).toEqual([]); // whole survey is apartments
    expect(filterOptions(await load('river-valley-townhomes.xlsx')).kind).toEqual([]); // whole survey is townhomes
  });

  it('filters a real survey: Churchill 2 bed with 2 baths', async () => {
    const s = await load('churchill-apartments.xlsx');
    const f = filter({ beds: ['2 Beds'], baths: ['2'] }, s);
    const shown = s.buildings.map((b) => [b.name, visibleUnits(b, f).map((u) => u.rate)]).filter(([, r]) => (r as number[]).length);
    expect(shown).toEqual([['Connect Residences', [1950]], ['Edmonton House', [2100]], ['Park Square Apartments', [1718]], ['E11even', [2129]], ['Churchill', [1953]]]);
  });

  it('filters Boardwalk to 2 bed townhomes', async () => {
    const s = await load('boardwalk-portfolio.xlsx');
    const f = filter({ beds: ['2 Beds'], kind: ['Townhome'] }, s);
    const names = s.buildings.filter((b) => visibleUnits(b, f).length).map((b) => b.name);
    expect(names).toEqual(['Cavell Ridge Townhomes', 'Hooke County Townhomes', 'Hartford County Townhomes', 'The Maples Townhomes']);
  });
});

describe('property type', () => {
  it('infers from survey title, building override, then explicit markers', async () => {
    const s = await load('boardwalk-portfolio.xlsx');
    const ctx = kindContext(s);
    const apt = s.buildings.find((b) => b.name === 'Bev Manor')!;
    const th = s.buildings.find((b) => b.name === 'Hooke County Townhomes')!;
    expect(unitKind(apt.units[0], apt, ctx)).toBe('Apartment');
    expect(unitKind(th.units[0], th, ctx)).toBe('Townhome');
    expect(unitKind(apt.units[0], { ...apt, propertyType: 'Townhome' }, ctx)).toBe('Townhome');
    const rv = await load('river-valley-townhomes.xlsx');
    const hooke = rv.buildings[0]; // "Hooke County" has no townhome in its name; the survey title does
    expect(unitKind(hooke.units[0], hooke, kindContext(rv))).toBe('Townhome');
  });
});
