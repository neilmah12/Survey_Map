import { describe, expect, it } from 'vitest';
import { joinSurvey, referencedFileIds, splitSurvey, MAX_DOC_BYTES, PHOTO_MARK } from '../src/lib/cloudSplit';
import type { Building, Survey } from '../src/types';

const photo = (n: number) => `data:image/jpeg;base64,${'A'.repeat(n)}`;
const b = (id: string, imageUrl = ''): Building => ({
  id, name: id, address: '', yearBuilt: '', yearRenovated: '', configuration: '', isSubject: false,
  lngLat: [-113.5, 53.5], propertyNotes: 'internal', contact: 'a@b.c', url: '', imageUrl, units: [],
});
const survey = (over: Partial<Survey> = {}): Survey => ({
  title: 'T', location: 'Edmonton', asOf: '2026-01-01',
  buildings: [b('b1', photo(500)), b('b2', 'https://example.com/x.jpg'), b('b3', photo(500)), b('b4', photo(900))],
  source: { name: 'book.xlsx', data: 'QUJD'.repeat(1000) },
  ...over,
});

describe('splitSurvey / joinSurvey', () => {
  it('moves workbook and photos out of the main document', async () => {
    const parts = await splitSurvey(survey());
    expect(parts.main).not.toContain('data:image');
    expect(parts.main).not.toContain('QUJDQUJD');
    expect(parts.main).toContain('https://example.com/x.jpg');
    expect(parts.files.filter((f) => f.kind === 'photo')).toHaveLength(2); // b1 and b3 share content
    expect(parts.files.filter((f) => f.kind === 'workbook')).toHaveLength(1);
    expect(parts.meta).toEqual({ title: 'T', location: 'Edmonton', asOf: '2026-01-01', buildings: 4 });
  });

  it('round-trips exactly', async () => {
    const s = survey();
    const parts = await splitSurvey(s);
    const files = new Map(parts.files.map((f) => [f.id, { data: f.data, name: f.name }]));
    expect(joinSurvey(parts.main, files)).toEqual(s);
  });

  it('names files by content so unchanged photos get the same id', async () => {
    const a = await splitSurvey(survey());
    const c = await splitSurvey(survey({ title: 'Other title' }));
    expect(a.files.map((f) => f.id).sort()).toEqual(c.files.map((f) => f.id).sort());
  });

  it('lists the files a main document needs', async () => {
    const parts = await splitSurvey(survey());
    expect(referencedFileIds(parts.main).sort()).toEqual(parts.files.map((f) => f.id).sort());
  });

  it('drops a photo whose file is missing instead of leaving a marker', async () => {
    const parts = await splitSurvey(survey());
    const out = joinSurvey(parts.main, new Map());
    expect(out.buildings.every((x) => !x.imageUrl?.startsWith(PHOTO_MARK))).toBe(true);
    expect(out.source).toBeUndefined();
  });

  it('works without a workbook', async () => {
    const parts = await splitSurvey(survey({ source: undefined }));
    expect(parts.files.some((f) => f.kind === 'workbook')).toBe(false);
  });

  it('refuses a file that would break the 1 MB document limit', async () => {
    await expect(splitSurvey(survey({ buildings: [b('big', photo(MAX_DOC_BYTES + 10))] }))).rejects.toThrow(/too large/);
    await expect(splitSurvey(survey({ source: { name: 'x.xlsx', data: 'A'.repeat(MAX_DOC_BYTES + 10) } }))).rejects.toThrow(/too large/);
  });

  it('keeps every document under the limit for a realistic survey', async () => {
    const many = Array.from({ length: 40 }, (_, i) => b(`b${i}`, photo(100_000 + i)));
    const parts = await splitSurvey(survey({ buildings: many, source: { name: 'x.xlsx', data: 'A'.repeat(70_000) } }));
    const size = (s: string) => new TextEncoder().encode(s).length;
    expect(size(parts.main)).toBeLessThan(MAX_DOC_BYTES);
    for (const f of parts.files) expect(size(f.data)).toBeLessThan(MAX_DOC_BYTES);
  });
});
