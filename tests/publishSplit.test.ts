import { describe, expect, it } from 'vitest';
import { newPublishId, photoIdsOf, PUBLISH_ID, sameContent, splitSnapshot } from '../src/lib/publishSplit';
import { toClientSnapshot } from '../src/lib/snapshot';
import { DEFAULT_SUMMARY, type Building, type Survey, type ViewSettings } from '../src/types';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const b = (id: string, imageUrl: string): Building => ({
  id, name: id, address: 'x', yearBuilt: '', yearRenovated: '', configuration: '', isSubject: id === 'a',
  lngLat: [-113.5, 53.5], propertyNotes: 'INTERNAL NOTE', contact: 'secret@example.com', url: '', imageUrl,
  units: [{ id: 'u' + id, type: '1 Bed', beds: 1, sf: 700, rate: 1500, netRate: null, parking: '', utilities: '', incentive: '', notes: 'PRIVATE UNIT NOTE', extras: { Secret: 'EXTRA' } }],
});
const survey: Survey = {
  title: 'T', location: 'L', asOf: '2026-01-01', buildings: [b('a', PNG), b('c', 'https://example.com/p.jpg')],
  source: { name: 'wb.xlsx', data: 'WORKBOOKBYTES' },
};
const view: ViewSettings = { metric: 'rate', summary: DEFAULT_SUMMARY, filters: { beds: [], baths: [], reno: [] }, rings: false, ringsKm: [] };

describe('splitSnapshot', () => {
  it('moves embedded photos into their own documents', async () => {
    const { snapshot } = toClientSnapshot(survey, view);
    const parts = await splitSnapshot(snapshot);
    expect(parts.main).not.toContain('data:image');
    expect(parts.photos).toHaveLength(1);
    expect(photoIdsOf(parts.main)).toEqual([parts.photos[0].id]);
    expect(parts.main).toContain('https://example.com/p.jpg');
  });

  it('never carries private fields into the published documents', async () => {
    const { snapshot } = toClientSnapshot(survey, view);
    const parts = await splitSnapshot(snapshot);
    const everything = parts.main + parts.photos.map((p) => p.data).join('');
    for (const secret of ['INTERNAL NOTE', 'PRIVATE UNIT NOTE', 'secret@example.com', 'EXTRA', 'WORKBOOKBYTES', 'wb.xlsx', 'propertyNotes', 'contact']) {
      expect(everything).not.toContain(secret);
    }
  });

  it('compares content while ignoring the publish time', async () => {
    const a = await splitSnapshot(toClientSnapshot(survey, view, new Date('2026-01-01')).snapshot);
    const c = await splitSnapshot(toClientSnapshot(survey, view, new Date('2026-06-01')).snapshot);
    expect(sameContent(a.main, c.main)).toBe(true);
    const d = await splitSnapshot(toClientSnapshot({ ...survey, title: 'Changed' }, view).snapshot);
    expect(sameContent(a.main, d.main)).toBe(false);
  });

  it('makes unguessable ids', () => {
    const ids = new Set(Array.from({ length: 200 }, newPublishId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(PUBLISH_ID);
  });
});
