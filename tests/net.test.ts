import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSurvey } from '../src/lib/parse';
import { DEFAULT_NET, autoAmount, explainIncentive, netAvailable, netDefinition, parseIncentive, partsWithData, unitNet } from '../src/lib/net';
import { mergeSurvey } from '../src/lib/merge';
import { runChecks } from '../src/lib/checks';
import { embedSnapshot, snapshotToSurvey, toClientSnapshot } from '../src/lib/snapshot';
import { localDate } from '../src/lib/dates';
import { DEFAULT_SUMMARY, type Survey, type Unit, type ViewSettings } from '../src/types';
import { NO_FILTERS } from '../src/lib/groups';

const unit = (extra: Partial<Unit> = {}): Unit => ({
  id: 'u1', type: '2 Bed/1 Bath', beds: 2, sf: 900, rate: 1700, netRate: null, parking: '', utilities: '', incentive: '', notes: '', extras: {}, ...extra,
});
const VIEW: ViewSettings = { metric: 'net', summary: DEFAULT_SUMMARY, filters: NO_FILTERS, rings: false, ringsKm: [] };

async function load(name: string): Promise<Survey> {
  const b = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  return parseSurvey(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

describe('net rent', () => {
  it('adds nothing by default', () => {
    expect(unitNet(unit({ parking: '$225 underground', incentive: '-$100' }), DEFAULT_NET)).toBe(1700);
  });

  it('adds parking and utilities, subtracts incentives, adds misc, each only when ticked', () => {
    const u = unit({ parking: '$225 underground', utilities: '$75', incentive: '-$100', miscAmt: -20 });
    expect(unitNet(u, { ...DEFAULT_NET, parking: true })).toBe(1925);
    expect(unitNet(u, { ...DEFAULT_NET, parking: true, utilities: true })).toBe(2000);
    expect(unitNet(u, { ...DEFAULT_NET, incentives: true })).toBe(1600);
    expect(unitNet(u, { ...DEFAULT_NET, misc: true })).toBe(1680);
    expect(unitNet(u, { ...DEFAULT_NET, parking: true, utilities: true, incentives: true, misc: true })).toBe(1880);
  });

  it('treats included, free and empty as zero, and unreadable text as zero too', () => {
    const net = { ...DEFAULT_NET, parking: true, utilities: true };
    expect(unitNet(unit({ parking: 'Included', utilities: '' }), net)).toBe(1700);
    expect(unitNet(unit({ parking: 'TBC' }), net)).toBe(1700);
  });

  it('typed amounts beat the text, and an override beats everything', () => {
    const net = { ...DEFAULT_NET, parking: true, incentives: true };
    const u = unit({ parking: '$225', parkingAmt: 150, incentive: '-$100' });
    expect(unitNet(u, net)).toBe(1700 + 150 - 100);
    expect(autoAmount(u, 'parking')).toBe(225);
    expect(unitNet({ ...u, netOverride: 1500 }, net)).toBe(1500);
    expect(unitNet(unit({ rate: null }), net)).toBeNull();
  });

  it('turns "1 month free" into a monthly figure over the lease term', () => {
    expect(parseIncentive('1 month free', 1800, 12)).toBe(150);
    expect(parseIncentive('2 months rent free', 1800, 12)).toBe(300);
    expect(parseIncentive('One month free', 1800, 13)).toBe(138);
    expect(parseIncentive('4 weeks free', 1800, 12)).toBe(Math.round((1800 * (48 / 52)) / 12));
    expect(parseIncentive('-$158', 1800, 12)).toBe(158);
    expect(parseIncentive('$100/month off', 1800, 12)).toBe(100);
    expect(parseIncentive('', 1800, 12)).toBe(0);
    expect(parseIncentive('$500 gift card', 1800, 12)).toBeNull();
    expect(parseIncentive('1 month free rent, 500 move in bonus', 1800, 12)).toBeNull(); // two offers: not guessed
  });

  it('spreads free rent over the lease term the text gives, else the default term', () => {
    // 1 month free on a 13 month lease at $1,499: 1,499 x 1 / 13 = 115 a month off
    expect(explainIncentive('1 month free on a 13 month lease', 1499, 12)).toEqual({ amount: 115, freeMonths: 1, term: 13, termFromText: true });
    expect(parseIncentive('1 Month Free Rent (amortized over 13-month lease)', 1499, 12)).toBe(115);
    expect(parseIncentive('2 months free rent on 15 month lease', 1500, 12)).toBe(200);
    expect(parseIncentive('One month free on 1 year lease', 1200, 14)).toBe(100);
    expect(parseIncentive('1 free month rent', 1200, 12)).toBe(100);
    expect(parseIncentive('0.5 months free rent', 1200, 12)).toBe(50);
    expect(explainIncentive('1 month free', 1200, 12)).toEqual({ amount: 100, freeMonths: 1, term: 12, termFromText: false });
    // a second offer beside the free rent is still not guessed at
    expect(parseIncentive('2 months free rent on 14 month lease, 3 months free parking', 1500, 12)).toBeNull();
    expect(parseIncentive('1 month free on 14 month lease (1 bedroom only), 1 week early move in', 1500, 12)).toBeNull();
    expect(parseIncentive('1 Month free + 500 gift card on 1 yr lease', 1500, 12)).toBeNull();
    expect(parseIncentive('3 months free on a 2 month lease', 1500, 12)).toBeNull();
  });

  it('describes exactly what is ticked', () => {
    expect(netDefinition(DEFAULT_NET)).toBe('Net rent = base rent (nothing added)');
    expect(netDefinition({ ...DEFAULT_NET, parking: true })).toBe('Net rent = base rent + parking');
    expect(netDefinition({ ...DEFAULT_NET, parking: true, utilities: true, incentives: true })).toBe('Net rent = base rent + parking + utilities, less incentives');
    expect(netDefinition({ ...DEFAULT_NET, incentives: true })).toBe('Net rent = base rent, less incentives');
  });

  it('is available only when something can change it', () => {
    const s = { buildings: [{ units: [unit()] }] } as unknown as Survey;
    expect(netAvailable(s)).toBe(false);
    s.buildings[0].units[0].parking = '$225';
    expect(netAvailable(s)).toBe(true);
    expect([...partsWithData(s)]).toEqual(['parking']);
    s.net = { ...DEFAULT_NET, enabled: false };
    expect(netAvailable(s)).toBe(false);
  });
});

describe('net rent in the client file', () => {
  it('carries the settings and worked-out amounts, but not the sheet net rent or internal text', async () => {
    const s = await load('churchill-apartments.xlsx');
    s.net = { ...DEFAULT_NET, parking: true, clientCanChange: true };
    const { snapshot } = toClientSnapshot(s.buildings.some((b) => b.lngLat) ? s : { ...s, buildings: s.buildings.map((b) => ({ ...b, lngLat: [-113.5, 53.5] as [number, number] })) }, VIEW);
    expect(snapshot.net).toMatchObject({ parking: true, clientCanChange: true, enabled: true });
    const first = snapshot.buildings[0].units[0];
    expect(first.parkingAmt).toBe(225);
    expect(JSON.stringify(snapshot)).not.toContain('netRate');
    const back = snapshotToSurvey(snapshot);
    expect(back.net?.clientCanChange).toBe(true);
    // The client works out the same net rent from what it was sent.
    const live = unitNet(back.buildings[0].units[0], back.net!);
    expect(live).toBe(first.parkingAmt + (first.rate ?? 0));
    expect(embedSnapshot('<script>__SNAPSHOT_JSON__</script>', snapshot)).toContain('"parkingAmt":225');
  });
});

describe('merging keeps amounts typed in the app', () => {
  it('carries per-suite net amounts to the matching unit type and flags rent changes', async () => {
    const a = await load('churchill-apartments.xlsx');
    a.buildings[0].units[0].parkingAmt = 99;
    a.buildings[0].units[0].miscLabel = 'Telus';
    const b = await load('churchill-apartments.xlsx');
    const same = mergeSurvey(a, b);
    expect(same.survey.buildings[0].units[0].parkingAmt).toBe(99);
    expect(same.survey.buildings[0].units[0].miscLabel).toBe('Telus');
    expect(same.summary.dataChanged).toBe(false);
    const c = await load('churchill-apartments.xlsx');
    c.buildings[0].units[0].rate = (c.buildings[0].units[0].rate ?? 0) + 50;
    const changed = mergeSurvey(a, c);
    expect(changed.summary.dataChanged).toBe(true);
    // The As of date only moves when told to.
    expect(changed.survey.asOf).toBe(a.asOf);
    expect(mergeSurvey(a, c, '2026-09-01').survey.asOf).toBe('2026-09-01');
  });
});

describe('checks for net rent', () => {
  it('warns when a ticked part has text but no dollar amount, and stays quiet otherwise', () => {
    const s = { title: 't', location: '', asOf: localDate(), buildings: [{ id: 'b1', name: 'A', address: '1 St', yearBuilt: '', yearRenovated: '', configuration: '', isSubject: false, lngLat: [-113.5, 53.5], propertyNotes: '', contact: '', url: '', units: [unit({ incentive: '$500 gift card' })] }] } as unknown as Survey;
    expect(runChecks(s).some((c) => c.id.startsWith('net-'))).toBe(false);
    s.net = { ...DEFAULT_NET, incentives: true };
    expect(runChecks(s).some((c) => c.id === 'net-incentives-b1')).toBe(true);
    s.buildings[0].units[0].incentiveAmt = 40; // typed in: now readable
    expect(runChecks(s).some((c) => c.id === 'net-incentives-b1')).toBe(false);
  });
});

describe('dates', () => {
  it('uses the local date, not the UTC date', () => {
    const d = new Date(2026, 9, 26, 22, 30); // 10:30 PM local
    expect(localDate(d)).toBe('2026-10-26');
  });
});
