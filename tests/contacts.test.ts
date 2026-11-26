import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSurvey } from '../src/lib/parse';
import { NO_FILTERS } from '../src/lib/groups';
import { TEAM, TEAM_URL, contactLines, resolveContacts } from '../src/lib/team';
import { snapshotToSurvey, toClientSnapshot } from '../src/lib/snapshot';
import { DEFAULT_SUMMARY, type Survey, type ViewSettings } from '../src/types';

async function load(): Promise<Survey> {
  const b = readFileSync(new URL('./fixtures/clareview-townhomes.xlsx', import.meta.url));
  const s = await parseSurvey(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  s.buildings.forEach((x, i) => { x.lngLat = [-113.5 + i * 0.01, 53.5]; });
  return s;
}
const view: ViewSettings = { metric: 'rate', summary: { ...DEFAULT_SUMMARY }, filters: NO_FILTERS, rings: false, ringsKm: [1, 3, 5] };

describe('team contacts and the client PDF switch', () => {
  it('shows the whole team until a survey chooses, then only the chosen, in the team order', () => {
    expect(resolveContacts({}).length).toBe(TEAM.length);
    const some = resolveContacts({ contactIds: ['neil-mah', 'amit-grover'] });
    expect(some.map((c) => c.name)).toEqual(['Amit Grover', 'Neil Mah']);
    expect(resolveContacts({ contactIds: [] })).toEqual([]);
    expect(TEAM.every((p) => /^[^\s@]+@avisonyoung\.com$/.test(p.email))).toBe(true);
  });

  it('prints one line per person and the web address in the PDF box', () => {
    const text = contactLines(resolveContacts({ contactIds: ['neil-mah'] }), TEAM_URL);
    expect(text).toBe(`Neil Mah, Analyst: neil.mah@avisonyoung.com\nMore from our team: ${TEAM_URL}`);
  });

  it('puts the contacts and the download switch in the client link by default', async () => {
    const { snapshot } = toClientSnapshot(await load(), view);
    expect(snapshot.team?.length).toBe(TEAM.length);
    expect(snapshot.teamUrl).toBe(TEAM_URL);
    expect(snapshot.clientCanDownload).toBe(true);
    const viewer = snapshotToSurvey(snapshot);
    expect(viewer.contacts?.length).toBe(TEAM.length);
    expect(viewer.canDownloadPdf).toBe(true);
  });

  it('leaves the contacts out when none are chosen, and the download out when the editor turned it off', async () => {
    const s = await load();
    s.contactIds = [];
    s.noClientPdf = true;
    const { snapshot } = toClientSnapshot(s, view);
    expect(snapshot.team).toBeUndefined();
    expect(snapshot.clientCanDownload).toBeUndefined();
    const viewer = snapshotToSurvey(snapshot);
    expect(viewer.contacts).toBeUndefined();
    expect(viewer.canDownloadPdf).toBeUndefined();
  });

  it('old links (published before contacts and downloads) open with neither', async () => {
    const old = JSON.parse(JSON.stringify(toClientSnapshot(await load(), view).snapshot));
    delete old.team;
    delete old.teamUrl;
    delete old.clientCanDownload;
    const viewer = snapshotToSurvey(old);
    expect(viewer.contacts).toBeUndefined();
    expect(viewer.canDownloadPdf).toBeUndefined();
  });

  it('drops a contact that is not a plausible email, and a web address that is not http(s)', async () => {
    const { snapshot } = toClientSnapshot(await load(), view);
    const bad = JSON.parse(JSON.stringify(snapshot));
    bad.team = [{ name: 'A', title: 'T', email: 'not an email' }, { name: 'B', title: 'T', email: 'b@avisonyoung.com' }];
    bad.teamUrl = 'javascript:alert(1)';
    const viewer = snapshotToSurvey(bad);
    expect(viewer.contacts).toEqual([{ name: 'B', title: 'T', email: 'b@avisonyoung.com' }]);
    expect(viewer.contactUrl).toBeUndefined();
  });
});
