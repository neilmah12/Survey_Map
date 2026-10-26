export type LngLat = [number, number];

export interface Unit {
  id: string;
  /** Left out of the market summary (an outlier, for example). It still shows on the map, greyed. */
  excluded?: boolean;
  /** Row in the source workbook, used to write coordinates back. */
  srcRow?: number;
  type: string;
  /** Bedroom count parsed from the unit type, 0 for studio, null if unknown. */
  beds: number | null;
  sf: number | null;
  rate: number | null;
  /** Net rate as given in the sheet. Kept for reference and for writing back; the net rent shown is worked out from the net rent settings. */
  netRate: number | null;
  parking: string;
  utilities: string;
  incentive: string;
  notes: string;
  /** Monthly dollar amounts typed in the app. Empty means "work it out from the text above". */
  parkingAmt?: number | null;
  utilitiesAmt?: number | null;
  /** The monthly value of the incentive as a discount (positive), for example 100 for $100 off a month. */
  incentiveAmt?: number | null;
  /** Free rent typed in the app as months free over lease months (1/13). Spread over the term; follows the rent. Term null: the survey default. */
  incentiveFree?: { months: number; term: number | null } | null;
  /** Anything else that changes the real cost, signed: a fee is positive and a credit (a gift card, say) is negative. */
  miscAmt?: number | null;
  miscLabel?: string;
  /** A net rent entered by hand. It beats the settings. */
  netOverride?: number | null;
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
  /** The whole building is left out of the market summary. */
  excluded?: boolean;
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

/** What counts toward net rent. Saved with the survey; a client can change it only when clientCanChange is on. */
export interface NetSettings {
  /** Off hides net rent everywhere. */
  enabled: boolean;
  parking: boolean;
  utilities: boolean;
  incentives: boolean;
  misc: boolean;
  /** Lease length used to turn "1 month free" into a monthly figure. */
  termMonths: number;
  clientCanChange: boolean;
}

export interface Survey {
  net?: NetSettings;
  /** ISO time of the last change made in the app (any change, including pins). Shown in the editor only. */
  updatedAt?: string;
  /** The line shown under exports and on the client page, for example "Source: Avison Young Research". */
  sourceNote?: string;
  /** Clients may turn properties on and off in the summary (their changes are not saved). */
  clientCanToggle?: boolean;
  title: string;
  location: string;
  /** ISO date (yyyy-mm-dd) shown as "As of" in the header. */
  asOf: string;
  buildings: Building[];
  /** The uploaded workbook (base64), kept so coordinates can be written back to it. */
  source?: { name: string; data: string };
}

export type Metric = 'rate' | 'psf' | 'net';

export type Stat = 'avg' | 'median';

export interface SummarySettings {
  open: boolean;
  stat: Stat;
  /** Extra details the summary rows are split by (bedrooms always apply). */
  split: { baths: boolean; reno: boolean };
  /** True: each building counts once per row (its own average first). False: every unit counts. */
  perBuilding: boolean;
}

export const DEFAULT_SUMMARY: SummarySettings = {
  open: true,
  stat: 'avg',
  split: { baths: false, reno: false },
  perBuilding: true,
};

export interface ViewSettings {
  metric: Metric;
  summary: SummarySettings;
  /** Unit filters: bedrooms, bathrooms, renovation. Empty means any. */
  filters: { beds: string[]; baths: string[]; reno: string[] };
  rings: boolean;
  ringsKm: number[];
}
