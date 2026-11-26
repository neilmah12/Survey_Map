import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isSnapshot, snapshotToSurvey, snapshotToView } from '../src/lib/snapshot';
import { computeSummary } from '../src/lib/summary';
import { layoutChart } from '../src/lib/chartLayout';
import { DEFAULT_SUMMARY } from '../src/types';

/**
 * A client link keeps working for as long as it is published, whatever the app becomes: the page is the
 * newest code, but the survey inside the link is the copy stored on the day it was published.
 *
 * tests/fixtures/snapshot-v1-legacy.json is that kind of stored copy, frozen in the shape an earlier version
 * published (a listing link on each building, a "show each comp" setting, no chart setting, filters without the
 * property type and utilities lists). Do not regenerate it when the shape changes. If this test fails, the change
 * has broken links that are already out in the world: make the code read the old shape instead.
 */
const stored = JSON.parse(readFileSync(new URL('./fixtures/snapshot-v1-legacy.json', import.meta.url), 'utf8'));

describe('a survey published by an earlier version still opens', () => {
  it('is accepted as a snapshot', () => {
    expect(isSnapshot(stored)).toBe(true);
  });

  it('builds a survey the client page can show, without the listing link', () => {
    const s = snapshotToSurvey(stored);
    expect(s.buildings.length).toBe(stored.buildings.length);
    expect(s.buildings.some((b) => b.isSubject)).toBe(true);
    expect(s.buildings.every((b) => b.url === '')).toBe(true); // an older link still holds one; the client never gets it
    expect(s.buildings.every((b) => b.lngLat && b.units.length > 0)).toBe(true);
  });

  it('fills in every view setting an older version did not have', () => {
    const v = snapshotToView(stored);
    expect(v.summary.chart).toBe(DEFAULT_SUMMARY.chart);
    expect(v.filters.kind).toEqual([]);
    expect(v.filters.utils).toEqual([]);
    expect((v.summary as unknown as { dots?: boolean }).dots).toBeUndefined(); // a setting that has since gone is dropped
    expect(v.summary.stat).toBe('avg');
  });

  it('feeds the summary, the chart and its notes, for every metric', () => {
    const s = snapshotToSurvey(stored);
    const v = snapshotToView(stored);
    for (const metric of ['rate', 'psf', 'net'] as const) {
      const r = computeSummary(s, { metric, filters: v.filters, settings: v.summary });
      expect(r.rows.length).toBeGreaterThan(0);
      for (const mode of ['compare', 'diff'] as const) {
        for (const W of [340, 700]) {
          const m = layoutChart(r, mode, { metric, W });
          expect(m.height).toBeGreaterThan(0);
          expect(m.shapes.every((x) => (x.k === 'text' ? Number.isFinite(x.x) && Number.isFinite(x.y) : true))).toBe(true);
        }
      }
    }
  });
});
