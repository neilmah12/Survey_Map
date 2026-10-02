import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSurvey } from '../src/lib/parse';
import { NO_DIMS, availableDims, kindContext, listGroups, unitBaths, unitKind, unitReno, visibleUnits } from '../src/lib/groups';
import { pinLabel } from '../src/lib/format';
import type { Survey } from '../src/types';

async function load(name: string): Promise<Survey> {
  const b = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  return parseSurvey(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

describe('unit attributes', () => {
  const u = (type: string) => ({ id: 'x', type, beds: null, sf: null, rate: null, netRate: null, parking: '', utilities: '', incentive: '', notes: '', extras: {} });
  it('reads bathrooms including halves', () => {
    expect(unitBaths(u('3 Bed/2.5 Bath -Main Floor Rear'))).toBe(2.5);
    expect(unitBaths(u('2 Bedroom / 1 Bath'))).toBe(1);
    expect(unitBaths(u('2 Bedroom/1.5 Bath + unfinished basement'))).toBe(1.5);
    expect(unitBaths(u('Bachelor - Basic'))).toBeNull();
  });
  it('reads renovation level only from a trailing renovation word', () => {
    expect(unitReno(u('2 Bedroom/1 Bath - Partial Reno'))).toBe('Partial Reno');
    expect(unitReno(u('1 Bedroom/1 Bath - Basic'))).toBe('Basic');
    expect(unitReno(u('3 Bed/2.5 Bath Lower - Interior'))).toBeNull();
    expect(unitReno(u('3 Bed/2.5 Bath -Main Floor Rear'))).toBeNull();
    expect(unitReno(u('2 Bed/1 Bath'))).toBeNull();
  });
});

describe('unit groups', () => {
  it('groups by bedrooms by default', async () => {
    const s = await load('boardwalk-portfolio.xlsx');
    expect(listGroups(s, NO_DIMS)).toEqual(['Studio', '1 Bed', '2 Bed', '3 Bed']);
  });

  it('offers only the splits that exist in the data', async () => {
    expect(availableDims(await load('boardwalk-portfolio.xlsx'))).toEqual({ baths: false, reno: true, kind: true });
    expect(availableDims(await load('glenora-townhomes.xlsx'))).toEqual({ baths: true, reno: false, kind: false });
    expect(availableDims(await load('river-valley-townhomes.xlsx')).kind).toBe(false); // whole survey is townhomes
    expect(availableDims(await load('churchill-apartments.xlsx')).kind).toBe(false); // whole survey is apartments
  });

  it('splits 2 bed by bathrooms and sorts them', async () => {
    const s = await load('glenora-townhomes.xlsx');
    expect(listGroups(s, { ...NO_DIMS, baths: true })).toEqual(['2 Bed / 1 Bath', '2 Bed / 1.5 Bath', '2 Bed / 2 Bath', '2 Bed / 2.5 Bath']);
    expect(listGroups(s, NO_DIMS)).toEqual(['2 Bed']);
  });

  it('splits by renovation level and by townhome versus apartment', async () => {
    const s = await load('boardwalk-portfolio.xlsx');
    expect(listGroups(s, { ...NO_DIMS, reno: true })).toEqual([
      'Studio · Basic', '1 Bed · Basic', '1 Bed · Partial Reno', '2 Bed · Basic', '2 Bed · Partial Reno', '3 Bed · Basic', '3 Bed · Partial Reno',
    ]);
    const kinds = listGroups(s, { ...NO_DIMS, kind: true });
    expect(kinds).toContain('2 Bed · Townhome');
    expect(kinds).toContain('2 Bed · Apartment');
    expect(kinds).toContain('Studio · Apartment');
  });

  it('filters buildings and pin labels to the selected group', async () => {
    const s = await load('boardwalk-portfolio.xlsx');
    const ctx = kindContext(s);
    const hermitage = s.buildings.find((b) => b.name === 'Hermitage Village Apartments')!;
    const f = { dims: NO_DIMS, groups: ['2 Bed'], ctx };
    expect(visibleUnits(hermitage, f).map((u) => u.rate)).toEqual([1299]);
    expect(pinLabel(hermitage, f, 'rate')).toBe('$1,299');
    expect(pinLabel(hermitage, { ...f, groups: [] }, 'rate')).toBe('$1,149 - $1,499');
    // A building with no unit in the group drops out of the map (no visible units).
    const beacon = s.buildings.find((b) => b.name === 'Beacon Heights')!;
    expect(visibleUnits(beacon, { ...f, groups: ['Studio'] })).toHaveLength(0);
  });

  it('infers property type: survey title, building override, then explicit markers', async () => {
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
