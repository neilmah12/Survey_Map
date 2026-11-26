import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSurvey } from '../src/lib/parse';
import { NO_FILTERS } from '../src/lib/groups';
import { buildReport, reportBuildings, takeaways, type ReportRow } from '../src/lib/report';
import { computeSummary } from '../src/lib/summary';
import { scopeSurvey } from '../src/lib/scope';
import { DEFAULT_SUMMARY, type Survey, type ViewSettings } from '../src/types';

async function load(): Promise<Survey> {
  const b = readFileSync(new URL('./fixtures/clareview-townhomes.xlsx', import.meta.url));
  const s = await parseSurvey(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  s.buildings.forEach((x, i) => { x.isSubject = i === 0; x.lngLat = [-113.5 + i * 0.01488, 53.5]; }); // building i is about i km east
  return s;
}
const view = (over: Partial<ViewSettings> = {}): ViewSettings => ({ metric: 'rate', summary: { ...DEFAULT_SUMMARY }, filters: NO_FILTERS, rings: false, ringsKm: [1, 3, 5], ...over });

describe('the PDF report figures', () => {
  it('shows every rent type the data can support, side by side, matching the summary table', async () => {
    const s = await load();
    const r = buildReport(s, view());
    expect(r.metrics[0]).toBe('rate');
    expect(r.metrics).toContain('psf');
    const rate = computeSummary(scopeSurvey(s, view()), { metric: 'rate', filters: NO_FILTERS, settings: DEFAULT_SUMMARY });
    for (const row of rate.rows) {
      const mine = r.rows.find((x) => x.label === row.label)!;
      expect(mine.cells.rate!.market).toBe(row.market.value);
      expect(mine.cells.rate!.subject).toBe(row.subject.value);
      expect(mine.comps).toBe(row.market.n);
    }
    const psf = computeSummary(scopeSurvey(s, view()), { metric: 'psf', filters: NO_FILTERS, settings: DEFAULT_SUMMARY });
    for (const row of psf.rows) expect(r.rows.find((x) => x.label === row.label)!.cells.psf!.market).toBe(row.market.value);
  });

  it('leaves net rent out when nothing changes a rent', async () => {
    const s = await load();
    for (const b of s.buildings) for (const u of b.units) Object.assign(u, { incentive: '', parking: '', utilities: '', incentiveAmt: null, parkingAmt: null, utilitiesAmt: null, miscAmt: null, netOverride: undefined, incentiveFree: null });
    expect(buildReport(s, view()).metrics).not.toContain('net');
  });

  it('leaves net rent out when none of its parts is switched on, and includes it when one is', async () => {
    const s = await load();
    s.buildings[1].units[0].incentiveAmt = 100;
    s.net = { enabled: true, parking: false, utilities: false, incentives: false, misc: false, termMonths: 12, clientCanChange: false };
    expect(buildReport(s, view()).metrics).not.toContain('net'); // net would equal base rent
    s.net = { ...s.net, incentives: true };
    expect(buildReport(s, view()).metrics).toContain('net');
  });

  it('follows the distance: far buildings leave the market behind the figures', async () => {
    const s = await load();
    const all = buildReport(s, view());
    const near = buildReport(s, view({ within: 2.5 }));
    expect(near.marketBuildings).toBeLessThan(all.marketBuildings);
    expect(near.marketBuildings).toBe(2);
  });

  it('writes one plain line per unit type, with the right words', () => {
    const rows: ReportRow[] = [
      { label: '1 Bed', comps: 3, cells: { rate: { market: 1253, subject: 1200, diffPct: -0.0423 } } },
      { label: '2 Beds', comps: 1, cells: { rate: { market: 2094, subject: 2100, diffPct: 0.0029 } } },
      { label: '3 Beds', comps: 4, cells: { rate: { market: 2525, subject: 2800, diffPct: 0.1089 } } },
      { label: '4+', comps: 1, cells: { rate: { market: 2350, subject: null, diffPct: null } } },
    ];
    expect(takeaways(rows, true, true)).toEqual([
      '1 Bed: the subject is 4.2% below the market (3 comps).',
      '2 Beds: the subject is in line with the market (1 comp only).',
      '3 Beds: the subject is 10.9% above the market (4 comps).', // a unit type the subject does not have is skipped
    ]);
    expect(takeaways(rows, false, true)).toEqual([]); // no subject, nothing to say
    expect(takeaways(rows.slice(0, 1), true, false)[0]).toContain('(3 units)');
  });

  it('lists the subject first, then comparables nearest first, with their suites and distances', async () => {
    const s = await load();
    const list = reportBuildings(s, view());
    expect(list[0].isSubject).toBe(true);
    const comps = list.filter((b) => !b.isSubject);
    expect(comps.map((b) => b.num)).toEqual(comps.map((_, i) => i + 1));
    expect(comps[0].distKm).toBeLessThan(comps[1].distKm!);
    expect(comps[0].units.length).toBeGreaterThan(0);
    expect(comps[0].units[0]).toHaveProperty('psf');
  });

  it('leaves out buildings beyond the chosen distance, and marks switched-off ones', async () => {
    const s = await load();
    s.buildings[1].excluded = true;
    const list = reportBuildings(s, view({ within: 2.5 }));
    expect(list.length).toBe(3); // the subject and the buildings 1 km and 2 km away
    expect(list.find((b) => b.id === s.buildings[1].id)!.counted).toBe(false);
  });
});
