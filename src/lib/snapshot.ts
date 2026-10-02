import type { LngLat, Metric, Survey, ViewSettings } from '../types';
import { kindContext, unitKind } from './groups';
import { safeUrl } from './safeUrl';

/**
 * What a client is allowed to see. A snapshot is built by copying an explicit allow-list of fields,
 * never by spreading the editor's objects, so a field added to the editor later stays private until
 * it is deliberately added here. Left out on purpose: notes, contact details, the uploaded workbook,
 * unrecognised columns, source rows and editor flags.
 */
export interface ClientUnit {
  id: string;
  type: string;
  sf: number | null;
  rate: number | null;
  netRate: number | null;
  parking: string;
  utilities: string;
  incentive: string;
}

export interface ClientBuilding {
  id: string;
  name: string;
  address: string;
  yearBuilt: string;
  yearRenovated: string;
  /** Stacked / non-stacked: only kept for townhomes. */
  configuration: string;
  isSubject: boolean;
  propertyType?: 'Townhome' | 'Apartment';
  lngLat: LngLat;
  /** Public listing page. */
  url: string;
  imageUrl: string;
  units: ClientUnit[];
}

export interface ClientView {
  metric: Metric;
  rings: boolean;
  ringsKm: number[];
  filters: ViewSettings['filters'];
}

export interface ClientSnapshot {
  version: 1;
  title: string;
  location: string;
  asOf: string;
  publishedAt: string;
  view: ClientView;
  buildings: ClientBuilding[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export interface SnapshotResult {
  snapshot: ClientSnapshot;
  /** Buildings left out because they have no pin yet. */
  unplaced: string[];
}

export function toClientSnapshot(survey: Survey, view: ViewSettings, now: Date = new Date()): SnapshotResult {
  const ctx = kindContext(survey);
  const unplaced: string[] = [];
  const buildings: ClientBuilding[] = [];
  for (const b of survey.buildings) {
    if (!b.lngLat) {
      unplaced.push(b.name);
      continue;
    }
    const isTownhome = b.units.some((u) => unitKind(u, b, ctx) === 'Townhome');
    buildings.push({
      id: b.id,
      name: str(b.name),
      address: str(b.address),
      yearBuilt: str(b.yearBuilt),
      yearRenovated: str(b.yearRenovated),
      configuration: isTownhome ? str(b.configuration) : '',
      isSubject: Boolean(b.isSubject),
      ...(b.propertyType ? { propertyType: b.propertyType } : {}),
      lngLat: [b.lngLat[0], b.lngLat[1]],
      url: safeUrl(b.url),
      imageUrl: safeUrl(b.imageUrl, true),
      units: b.units.map((u) => ({
        id: u.id,
        type: str(u.type),
        sf: numOrNull(u.sf),
        rate: numOrNull(u.rate),
        netRate: numOrNull(u.netRate),
        parking: str(u.parking),
        utilities: str(u.utilities),
        incentive: str(u.incentive),
      })),
    });
  }
  return {
    unplaced,
    snapshot: {
      version: 1,
      title: str(survey.title),
      location: str(survey.location),
      asOf: str(survey.asOf),
      publishedAt: now.toISOString(),
      view: {
        metric: view.metric,
        rings: Boolean(view.rings),
        ringsKm: view.ringsKm.filter((n) => Number.isFinite(n) && n > 0),
        filters: {
          beds: strings(view.filters.beds),
          baths: strings(view.filters.baths),
          reno: strings(view.filters.reno),
          kind: strings(view.filters.kind),
        },
      },
      buildings,
    },
  };
}

/** Rebuilds the shape the map components expect, with every private field empty. */
export function snapshotToSurvey(s: ClientSnapshot): Survey {
  return {
    title: s.title,
    location: s.location,
    asOf: s.asOf,
    buildings: s.buildings.map((b) => ({
      id: b.id,
      name: b.name,
      address: b.address,
      yearBuilt: b.yearBuilt,
      yearRenovated: b.yearRenovated,
      configuration: b.configuration,
      isSubject: b.isSubject,
      propertyType: b.propertyType,
      lngLat: b.lngLat,
      propertyNotes: '',
      contact: '',
      url: b.url,
      imageUrl: b.imageUrl,
      units: b.units.map((u) => ({ ...u, beds: null, notes: '', extras: {} })),
    })),
  };
}

export function snapshotToView(s: ClientSnapshot): ViewSettings {
  return { ...s.view };
}

/** Looks like a snapshot this version of the viewer can show. */
export function isSnapshot(x: unknown): x is ClientSnapshot {
  const s = x as Partial<ClientSnapshot> | null;
  return Boolean(s && s.version === 1 && Array.isArray(s.buildings) && s.view && typeof s.title === 'string');
}

export const SNAPSHOT_TOKEN = '__SNAPSHOT_JSON__';

/** JSON that is safe inside a <script> element: "<" is escaped so "</script>" and "<!--" cannot appear. */
export function snapshotJson(snapshot: ClientSnapshot): string {
  return JSON.stringify(snapshot).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** Puts a snapshot into the client viewer template (a single HTML file). */
export function embedSnapshot(template: string, snapshot: ClientSnapshot): string {
  if (!template.includes(SNAPSHOT_TOKEN)) throw new Error('The client viewer template has no snapshot slot');
  return template.replace(SNAPSHOT_TOKEN, () => snapshotJson(snapshot));
}

export interface ExportSummary {
  buildings: number;
  units: number;
  photos: number;
  unplaced: string[];
  hasSubject: boolean;
  unitsWithoutRate: number;
}

export function summarizeSnapshot(r: SnapshotResult): ExportSummary {
  const bs = r.snapshot.buildings;
  return {
    buildings: bs.length,
    units: bs.reduce((n, b) => n + b.units.length, 0),
    photos: bs.filter((b) => b.imageUrl).length,
    unplaced: r.unplaced,
    hasSubject: bs.some((b) => b.isSubject),
    unitsWithoutRate: bs.reduce((n, b) => n + b.units.filter((u) => u.rate == null).length, 0),
  };
}
