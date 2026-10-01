export type LngLat = [number, number];

export interface Unit {
  id: string;
  type: string;
  /** Bedroom count parsed from the unit type, 0 for studio, null if unknown. */
  beds: number | null;
  sf: number | null;
  rate: number | null;
  /** Net rate as given in the sheet (not computed). */
  netRate: number | null;
  parking: string;
  utilities: string;
  incentive: string;
  notes: string;
  /** Any sheet columns we do not recognise, keyed by header text. */
  extras: Record<string, string>;
}

export interface Building {
  id: string;
  name: string;
  address: string;
  yearBuilt: string;
  yearRenovated: string;
  configuration: string;
  isSubject: boolean;
  lngLat: LngLat | null;
  propertyNotes: string;
  contact: string;
  url: string;
  units: Unit[];
}

export interface Survey {
  title: string;
  location: string;
  /** ISO date (yyyy-mm-dd) shown as "As of" in the header. */
  asOf: string;
  buildings: Building[];
}

export type Metric = 'rate' | 'psf' | 'net';

export interface ViewSettings {
  metric: Metric;
  beds: number[];
  rings: boolean;
  ringsKm: number[];
}
