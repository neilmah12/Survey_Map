import type { Building, Survey } from '../types';
import { unitBedCat, unitBeds } from './groups';
import { money } from './format';
import { norm } from './merge';

export type Severity = 'error' | 'warn' | 'info';
export type CheckGroup = 'Map' | 'Data' | 'Comparison' | 'Excel';

export interface Check {
  id: string;
  severity: Severity;
  group: CheckGroup;
  title: string;
  detail?: string;
  /** Lets the checks list jump to the building. */
  buildingId?: string;
}

const PLACEHOLDER = /\b(tbc|tbd|to be confirmed|to be determined|pending)\b|^\s*\?+\s*$/i;
const UNFINISHED = /\b(need|needs|needed|confirm|verify|check|follow[ -]?up|call back|tbc|tbd)\b|\?/i;
const ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function km(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const snippet = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n).trim()}...` : s);

/**
 * Things worth fixing before a survey goes to a client. Errors stop an export, warnings are likely
 * mistakes, and info is worth knowing. Nothing here changes the survey.
 */
export function runChecks(survey: Survey, now: Date = new Date()): Check[] {
  const out: Check[] = [];
  const add = (c: Check) => out.push(c);
  const placed = survey.buildings.filter((b) => b.lngLat);
  const unplaced = survey.buildings.filter((b) => !b.lngLat);

  // ---- Map
  if (survey.buildings.length === 0) add({ id: 'empty', severity: 'error', group: 'Map', title: 'The survey has no buildings' });
  else if (placed.length === 0) add({ id: 'no-pins', severity: 'error', group: 'Map', title: 'No building has a pin yet', detail: 'Drag buildings from the list onto the map.' });

  if (placed.length > 0) {
    if (unplaced.length > 0 && unplaced.length <= 5)
      for (const b of unplaced) add({ id: `unplaced-${b.id}`, severity: 'warn', group: 'Map', title: `${b.name} has no pin yet`, detail: 'It will be left out of the client file and the summary.', buildingId: b.id });
    else if (unplaced.length > 5)
      add({ id: 'unplaced', severity: 'warn', group: 'Map', title: `${unplaced.length} buildings have no pin yet`, detail: `${unplaced.slice(0, 6).map((b) => b.name).join(', ')}... They will be left out of the client file and the summary.` });

    if (!survey.buildings.some((b) => b.isSubject))
      add({ id: 'no-subject', severity: 'warn', group: 'Map', title: 'No subject property is marked', detail: 'The summary will show the market only, and distance rings are unavailable.' });
    else if (!placed.some((b) => b.isSubject))
      add({ id: 'subject-unplaced', severity: 'warn', group: 'Map', title: 'The subject property has no pin yet', detail: 'Distance rings and the comparison need it on the map.' });

    // two buildings on the same spot, or a pin far from everything else
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++)
        if (km(placed[i].lngLat!, placed[j].lngLat!) < 0.005)
          add({ id: `same-pin-${placed[i].id}-${placed[j].id}`, severity: 'warn', group: 'Map', title: `${placed[i].name} and ${placed[j].name} share a pin location`, detail: 'One of them is probably misplaced.', buildingId: placed[j].id });
    if (placed.length >= 4)
      for (const b of placed) {
        const others = placed.filter((o) => o !== b).map((o) => o.lngLat!);
        const centre: [number, number] = [median(others.map((p) => p[0])), median(others.map((p) => p[1]))];
        const d = km(b.lngLat!, centre);
        if (d > 40) add({ id: `far-pin-${b.id}`, severity: 'warn', group: 'Map', title: `${b.name} is ${Math.round(d)} km from the other buildings`, detail: 'Check that its pin is in the right place.', buildingId: b.id });
      }
  }

  // ---- Data
  const seenName = new Map<string, Building>();
  const seenAddr = new Map<string, Building>();
  for (const b of survey.buildings) {
    const n = norm(b.name);
    const a = norm(b.address);
    const dupName = n ? seenName.get(n) : undefined;
    const dupAddr = a ? seenAddr.get(a) : undefined;
    if (dupName || dupAddr) add({ id: `dup-${b.id}`, severity: 'warn', group: 'Data', title: `${b.name} appears twice`, detail: `Same ${dupName ? 'name' : 'address'} as ${(dupName ?? dupAddr)!.name}.`, buildingId: b.id });
    if (n) seenName.set(n, b);
    if (a) seenAddr.set(a, b);

    if (!b.address.trim()) add({ id: `no-address-${b.id}`, severity: 'warn', group: 'Data', title: `${b.name} has no address`, buildingId: b.id });
    if (b.units.length === 0) add({ id: `no-units-${b.id}`, severity: 'warn', group: 'Data', title: `${b.name} has no units`, buildingId: b.id });

    const noRent = b.units.filter((u) => u.rate == null);
    if (noRent.length) add({ id: `no-rent-${b.id}`, severity: 'warn', group: 'Data', title: `${b.name}: ${plural(noRent.length, 'unit')} with no rent`, detail: 'They show as n/a and are not in the averages.', buildingId: b.id });
    for (const u of b.units) {
      const label = `${b.name}, ${u.type || 'a unit'}`;
      if (u.rate != null && (u.rate < 300 || u.rate > 10000))
        add({ id: `rent-${b.id}-${u.id}`, severity: 'warn', group: 'Data', title: `${label}: rent of ${money(u.rate)} looks like a typo`, buildingId: b.id });
      if (u.sf != null && (u.sf < 150 || u.sf > 5000))
        add({ id: `sf-${b.id}-${u.id}`, severity: 'warn', group: 'Data', title: `${label}: ${u.sf.toLocaleString('en-CA')} SF looks like a typo`, buildingId: b.id });
      if (u.type && unitBeds(u) == null)
        add({ id: `type-${b.id}-${u.id}`, severity: 'warn', group: 'Data', title: `${label}: bedroom count not recognised`, detail: 'It will appear as "Other" in filters and the summary.', buildingId: b.id });
      for (const [field, v] of [['Parking', u.parking], ['Utilities', u.utilities], ['Incentive', u.incentive], ['Unit type', u.type]] as const)
        if (v && PLACEHOLDER.test(v))
          add({ id: `todo-${b.id}-${u.id}-${field}`, severity: 'warn', group: 'Data', title: `${label}: ${field.toLowerCase()} says "${snippet(v, 40)}"`, detail: 'This text will be visible to the client.', buildingId: b.id });
    }
    // Unfinished notes, one line per building even when every suite repeats the same note.
    const notes = [...new Set(b.units.map((u) => u.notes).filter((n) => n && UNFINISHED.test(n)))];
    if (notes.length)
      add({ id: `note-${b.id}`, severity: 'warn', group: 'Data', title: `${b.name}: a note looks unfinished`, detail: `${notes.map((n) => `"${snippet(n)}"`).join(' | ')} (internal, not shown to the client)`, buildingId: b.id });
    if (b.propertyNotes && UNFINISHED.test(b.propertyNotes))
      add({ id: `pnote-${b.id}`, severity: 'warn', group: 'Data', title: `${b.name}: a property note looks unfinished`, detail: `"${snippet(b.propertyNotes)}" (internal, not shown to the client)`, buildingId: b.id });
  }

  const noSf = survey.buildings.reduce((n, b) => n + b.units.filter((u) => u.rate != null && !u.sf).length, 0);
  if (noSf > 0) add({ id: 'no-sf', severity: 'info', group: 'Data', title: `${plural(noSf, 'unit')} with no SF`, detail: 'Rent PSF is blank for them and they are left out of PSF averages.' });

  const photoBytes = survey.buildings.reduce((n, b) => n + (b.imageUrl?.startsWith('data:') ? b.imageUrl.length : 0), 0);
  if (photoBytes > 8_000_000) add({ id: 'big-photos', severity: 'warn', group: 'Data', title: 'Uploaded photos make the client file large', detail: `${(photoBytes / 1e6).toFixed(1)} MB of photos. Use image links for some of them.` });

  const asOf = new Date(`${survey.asOf}T12:00:00`);
  if (Number.isNaN(asOf.getTime())) add({ id: 'asof-missing', severity: 'warn', group: 'Data', title: 'The "as of" date is missing or invalid' });
  else {
    const days = Math.round((now.getTime() - asOf.getTime()) / 86_400_000);
    if (days > 60) add({ id: 'asof-old', severity: 'warn', group: 'Data', title: `The "as of" date is ${days} days old`, detail: 'Update it if the rents were refreshed.' });
    else if (days < -1) add({ id: 'asof-future', severity: 'warn', group: 'Data', title: 'The "as of" date is in the future' });
  }

  // ---- Comparison: rents far from the rest of the market for the same bedroom count
  const comps = survey.buildings.filter((b) => !b.isSubject && !b.excluded);
  const byCat = new Map<string, { b: Building; v: number }[]>();
  for (const b of comps) {
    const perCat = new Map<string, number[]>();
    for (const u of b.units) {
      const cat = unitBedCat(u);
      if (!cat || u.excluded || u.rate == null) continue;
      perCat.set(cat, [...(perCat.get(cat) ?? []), u.rate]);
    }
    for (const [cat, rs] of perCat) byCat.set(cat, [...(byCat.get(cat) ?? []), { b, v: rs.reduce((a, c) => a + c, 0) / rs.length }]);
  }
  let outliers = 0;
  for (const [cat, rows] of byCat) {
    if (rows.length < 4) continue;
    const m = median(rows.map((r) => r.v));
    for (const { b, v } of rows) {
      const off = (v - m) / m;
      if (Math.abs(off) > 0.35 && outliers < 6) {
        outliers++;
        add({
          id: `outlier-${b.id}-${cat}`, severity: 'info', group: 'Comparison', buildingId: b.id,
          title: `${b.name}: ${cat} rent of ${money(v)} is ${Math.round(Math.abs(off) * 100)}% ${off > 0 ? 'above' : 'below'} the median`,
          detail: `Market median is ${money(m)}. If it is an outlier, switch it off in the summary's property list.`,
        });
      }
    }
  }
  const off = survey.buildings.reduce((n, b) => n + (b.excluded ? b.units.length : b.units.filter((u) => u.excluded).length), 0);
  if (off > 0) add({ id: 'switched-off', severity: 'info', group: 'Comparison', title: `${plural(off, 'unit')} switched off in the summary`, detail: 'Clients see them greyed and they are not in the averages.' });

  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

export const countBySeverity = (checks: Check[]) => ({
  error: checks.filter((c) => c.severity === 'error').length,
  warn: checks.filter((c) => c.severity === 'warn').length,
  info: checks.filter((c) => c.severity === 'info').length,
});

