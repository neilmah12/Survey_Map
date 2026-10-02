export type LngLat = [number, number];

export interface Unit {
  id: string;
  /** Row in the source workbook, used to write coordinates back. */
  srcRow?: number;
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
  /** Created in the app and not yet found in the uploaded sheet; kept when the sheet is re-uploaded. */
  addedInApp?: boolean;
  /** Overrides the townhome/apartment guess used when splitting unit groups. */
  propertyType?: 'Townhome' | 'Apartment';
  lngLat: LngLat | null;
  propertyNotes: string;
  contact: string;
  url: string;
  /** Photo shown in the popup: an http(s) image address or an embedded data URL. */
  imageUrl?: string;
  units: Unit[];
}

export interface Survey {
  title: string;
  location: string;
  /** ISO date (yyyy-mm-dd) shown as "As of" in the header. */
  asOf: string;
  buildings: Building[];
  /** The uploaded workbook (base64), kept so coordinates can be written back to it. */
  source?: { name: string; data: string };
}

export type Metric = 'rate' | 'psf' | 'net';

export interface ViewSettings {
  metric: Metric;
  /** Unit filters: bedrooms, bathrooms, renovation, property type. Empty means any. */
  filters: { beds: string[]; baths: string[]; reno: string[]; kind: string[] };
  rings: boolean;
  ringsKm: number[];
}
