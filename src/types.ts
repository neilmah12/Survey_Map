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
  /** Townhome or apartment: from the sheet's Product / Property type column, or set in the app. Beats the guess from names. */
  propertyType?: 'Townhome' | 'Apartment';
  lngLat: LngLat | null;
  propertyNotes: string;
  contact: string;
  url: string;
  /** Photo shown in the popup: an http(s) image address or an embedded data URL. */
  imageUrl?: string;
  units: Unit[];
  /**
   * Set by the scope step (lib/scope.ts), never saved or published. 'far' is outside the chosen distance;
   * 'subject' is a subject property that is not the one being compared right now. Either way the building stays
   * on the map, greyed, and is left out of the figures.
   */
  out?: 'far' | 'subject';
  /** Set by the scope step: kilometres from the subject being compared. */
  distKm?: number;
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
  split: { kind?: boolean; baths: boolean; reno: boolean };
  /** True: each building counts once per row (its own average first). False: every unit counts. */
  perBuilding: boolean;
  /** The chart under the summary controls: subject beside the market, the subject's difference from it, or hidden. */
  chart: ChartMode;
}

export type ChartMode = 'off' | 'compare' | 'diff';

export const DEFAULT_SUMMARY: SummarySettings = {
  open: true,
  stat: 'avg',
  split: { kind: false, baths: false, reno: false },
  perBuilding: true,
  chart: 'compare',
};

export interface ViewSettings {
  metric: Metric;
  summary: SummarySettings;
  /** Unit filters: property type, bedrooms, bathrooms, renovation, utilities. Empty means any. */
  filters: { kind: string[]; beds: string[]; baths: string[]; reno: string[]; utils: string[] };
  rings: boolean;
  /** The distances offered (and drawn as rings): set in the editor, the client starts from them and may pick another. */
  ringsKm: number[];
  /** Only buildings within this many km of the subject count. Empty means any distance. */
  within?: number | null;
  /** Which subject property is being compared, when there are several. Empty means the first one placed. */
  subjectId?: string | null;
}
