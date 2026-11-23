import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSurvey } from '../src/lib/parse';
import { NO_FILTERS } from '../src/lib/groups';
import { computeSummary, type SummaryResult } from '../src/lib/summary';
import { DEFAULT_NET } from '../src/lib/net';
import { DEFAULT_SUMMARY, type Metric, type Survey } from '../src/types';
import { chartNotes, compareScale, diffScale, exportNotes, layoutChart, layoutCompare, layoutDiff, pctText, wrapLabel, type ChartModel } from '../src/lib/chartLayout';

async function load(name: string): Promise<Survey> {
  const b = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  return parseSurvey(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}
const run = (s: Survey, metric: Metric = 'rate', split: Partial<typeof DEFAULT_SUMMARY.split> = {}): SummaryResult =>
  computeSummary(s, { metric, filters: NO_FILTERS, settings: { ...DEFAULT_SUMMARY, split: { ...DEFAULT_SUMMARY.split, ...split } } });
const texts = (m: ChartModel) => m.shapes.filter((s) => s.k === 'text').map((s) => (s as { s: string }).s);
const finite = (m: ChartModel) =>
  m.shapes.every((s) => (s.k === 'line' ? [s.x1, s.y1, s.x2, s.y2] : s.k === 'dot' || s.k === 'text' ? [s.x, s.y] : [0]).every(Number.isFinite));

describe('summary rows carry what the chart needs', () => {
  it('lists each comparable building behind a market figure, never the subject', async () => {
    const r = run(await load('clareview-townhomes.xlsx'));
    const row = r.rows.find((x) => x.label === '3 Beds')!;
    expect(row.comps).toHaveLength(6);
    expect(row.comps.map((c) => c.name)).not.toContain('Clareview');
    const mean = row.comps.reduce((a, c) => a + c.value, 0) / row.comps.length;
    expect(row.market.value).toBeCloseTo(mean, 6); // the average of the dots is the bar
  });

  it('says how many suites each comparable building contributes', async () => {
    const row = run(await load('clareview-townhomes.xlsx')).rows.find((x) => x.label === '3 Beds')!;
    expect(row.comps.find((c) => c.name.includes('Prince Charles'))!.units).toBe(3); // three suites averaged into one figure
    expect(row.comps.find((c) => c.name.includes('Pilot'))!.units).toBe(1);
  });

  it('gives base rent beside net rent only on the net view', async () => {
    const s = await load('clareview-townhomes.xlsx');
    s.buildings[1].units[0].incentiveAmt = 100; // one suite carries a $100 a month incentive
    s.net = { ...DEFAULT_NET, incentives: true };
    const net = run(s, 'net').rows.find((x) => x.label === '3 Beds')!;
    const base = run(s, 'rate').rows.find((x) => x.label === '3 Beds')!;
    expect(net.marketBase).toBeCloseTo(base.market.value!, 6);
    expect(net.market.value!).toBeLessThan(net.marketBase!);
    expect(base.marketBase).toBeNull();
  });
});

describe('scales', () => {
  it('starts at zero and reaches the tallest figure drawn, in the metric\'s own units', async () => {
    const s = await load('clareview-townhomes.xlsx');
    const rent = compareScale(run(s, 'rate').rows, 'rate');
    const psf = compareScale(run(s, 'psf').rows, 'psf');
    expect(rent.ticks[0]).toBe(0);
    expect(rent.max).toBeGreaterThan(2000);
    expect(psf.max).toBeLessThan(10); // dollars per square foot, not dollars a month
    expect(psf.ticks.at(-1)).toBe(psf.max);
  });

  it('makes room for a comp dot above the bar, and for the base tick on net rent', async () => {
    const r = run(await load('clareview-townhomes.xlsx'));
    const top = Math.max(...r.rows.flatMap((x) => x.comps.map((c) => c.value)));
    expect(compareScale(r.rows, 'rate').max).toBeGreaterThan(top);
  });

  it('is symmetric around zero for the difference view', async () => {
    const sc = diffScale(run(await load('clareview-townhomes.xlsx')).rows);
    expect(sc.ticks[0]).toBeCloseTo(-sc.maxAbs, 6);
    expect(sc.ticks.at(-1)).toBeCloseTo(sc.maxAbs, 6);
    expect(sc.ticks).toContain(0);
  });

  it('prints percentages without a sign on zero', () => {
    expect(pctText(0.003)).toBe('+0.3%');
    expect(pctText(-0.055)).toBe('-5.5%');
    expect(pctText(0.00001)).toBe('0.0%');
  });
});

describe('layout', () => {
  it('draws a gap as a gap, not as a zero bar (a type only the subject offers)', async () => {
    const r = run(await load('castle-harbour-apartments.xlsx'));
    const m = layoutCompare(r.rows, { metric: 'rate', W: 372, dots: true, hasSubject: true });
    expect(texts(m).some((t) => t === 'none' || t === 'no comps')).toBe(true);
    expect(finite(m)).toBe(true);
    const diff = layoutDiff(r.rows, { W: 372 });
    expect(texts(diff)).toContain('No market comps to compare');
  });

  it('uses columns for a few unit types and horizontal bars for many', async () => {
    const s = await load('boardwalk-portfolio.xlsx');
    const few = run(s);
    const many = run(s, 'rate', { baths: true, reno: true });
    expect(few.rows.length).toBeLessThanOrEqual(6);
    expect(many.rows.length).toBeGreaterThan(6);
    expect(layoutCompare(few.rows, { metric: 'rate', W: 372, dots: true, hasSubject: false }).layout).toBe('columns');
    const wide = layoutCompare(many.rows, { metric: 'rate', W: 372, dots: true, hasSubject: false });
    expect(wide.layout).toBe('rows');
    expect(wide.hits).toHaveLength(many.rows.length);
    expect(finite(wide)).toBe(true);
  });

  it('says how many comps are behind each group, and flags a single building', async () => {
    const r = run(await load('castle-harbour-apartments.xlsx'));
    const m = layoutChart(r, 'compare', { metric: 'rate', W: 560, dots: false });
    expect(texts(m).some((t) => /comps?( only)?$/.test(t))).toBe(true);
    const one = r.rows.find((x) => x.comps.length === 1);
    if (one) expect(chartNotes(r, 'compare').some((n) => n.startsWith('One building only') && n.includes(one.label) && n.includes(one.comps[0].name))).toBe(true);
  });

  it('fits a fixed height when the page has little room', async () => {
    const many = run(await load('boardwalk-portfolio.xlsx'), 'rate', { baths: true, reno: true });
    const m = layoutCompare(many.rows, { metric: 'rate', W: 340, H: 260, dots: true, hasSubject: false });
    expect(m.height).toBeLessThanOrEqual(260); // never taller than the room it was given
    const tight = layoutCompare(many.rows, { metric: 'rate', W: 340, H: 200, dots: true, hasSubject: false });
    expect(tight.height).toBeLessThan(m.height);
  });

  it('does not run past its width', async () => {
    const r = run(await load('churchill-apartments.xlsx'));
    for (const W of [260, 340, 400, 744]) {
      const m = layoutChart(r, 'compare', { metric: 'rate', W, dots: true });
      expect(m.width).toBe(W);
      const xs = m.shapes.filter((s) => s.k === 'line').flatMap((s) => [(s as { x1: number }).x1, (s as { x2: number }).x2]);
      expect(Math.max(...xs)).toBeLessThanOrEqual(W);
    }
  });
});

describe('notes', () => {
  it('groups unit types into one line per kind of gap, however many there are', async () => {
    const r = run(await load('boardwalk-portfolio.xlsx'), 'rate', { baths: true, reno: true });
    expect(chartNotes(r, 'compare').length).toBeLessThanOrEqual(3);
  });

  it('names the unit types left out of the comparison', async () => {
    const r = run(await load('castle-harbour-apartments.xlsx'));
    const notes = exportNotes(r);
    expect(notes.some((n) => n.includes('Studio'))).toBe(true);
    expect(chartNotes(r, 'diff').some((n) => n.includes('Studio') && n.includes('Left out of this view'))).toBe(true);
    expect(chartNotes(r, 'compare').every((n) => !n.includes('Left out'))).toBe(true);
  });

  it('wraps long labels to two lines and ends an overflow with ...', () => {
    const lines = wrapLabel('2 Beds / 1.5 Bath / Renovated Premium Finish Suites', 90, 11.5, 2);
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines.join(' ')).toContain('...');
    expect(wrapLabel('1 Bed', 90, 11.5)).toEqual(['1 Bed']);
  });
});
