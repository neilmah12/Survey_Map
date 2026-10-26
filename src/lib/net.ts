import type { NetSettings, Survey, Unit } from '../types';
import { parseCharge } from './unitText';

export type NetPart = 'parking' | 'utilities' | 'incentives' | 'misc';

export const NET_PARTS: { k: NetPart; label: string }[] = [
  { k: 'parking', label: 'Parking' },
  { k: 'utilities', label: 'Utilities' },
  { k: 'incentives', label: 'Incentives' },
  { k: 'misc', label: 'Misc' },
];

/** Nothing is added by default: net rent equals base rent until a part is ticked. */
export const DEFAULT_NET: NetSettings = {
  enabled: true,
  parking: false,
  utilities: false,
  incentives: false,
  misc: false,
  termMonths: 12,
  clientCanChange: false,
};

export function cleanNet(n: Partial<NetSettings> | undefined | null): NetSettings {
  const term = Number(n?.termMonths);
  return {
    enabled: n?.enabled ?? DEFAULT_NET.enabled,
    parking: Boolean(n?.parking),
    utilities: Boolean(n?.utilities),
    incentives: Boolean(n?.incentives),
    misc: Boolean(n?.misc),
    termMonths: Number.isFinite(term) && term >= 1 && term <= 60 ? term : DEFAULT_NET.termMonths,
    clientCanChange: Boolean(n?.clientCanChange),
  };
}

export const netOf = (s: { net?: Partial<NetSettings> }): NetSettings => cleanNet(s.net);

const WORD_NUM: Record<string, number> = { one: 1, a: 1, two: 2, three: 3, four: 4, six: 6 };

/**
 * The monthly value of an incentive as a positive discount. "1 month free" is spread over the lease
 * term; "-$158" (how the sheet writes an amortised discount) is already monthly. Anything else, such as
 * "$500 gift card", is not guessed at: it returns null so the person can enter a figure.
 */
export function parseIncentive(text: string, rate: number | null, termMonths: number): number | null {
  const t = text.trim();
  if (!t || /^[-+]?0+(\.0+)?$/.test(t)) return 0;
  const free = t.match(/\b(\d+(?:\.\d+)?|one|a|two|three|four|six)\s*(months?|mos?|weeks?|wks?)\b[^.\d]{0,14}?\bfree\b/i);
  // Text with more figures than the one phrase we understood ("1 month free, $500 move-in bonus") is not guessed at.
  if (free && /\d/.test(t.replace(free[0], ''))) return null;
  if (free) {
    if (rate == null) return null;
    const n = WORD_NUM[free[1].toLowerCase()] ?? parseFloat(free[1]);
    const months = /^w/i.test(free[2]) ? (n * 12) / 52 : n;
    return Math.round((rate * months) / termMonths);
  }
  const neg = t.match(/^-\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(?:\/\s*(?:mo|month)|per month|monthly|a month)?\s*$/i);
  if (neg) return parseFloat(neg[1].replace(/,/g, ''));
  const monthly = t.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(?:\/\s*(?:mo|month)|per month|monthly|a month|off (?:per|each|every) month)\b/i);
  if (monthly && !/\d/.test(t.replace(monthly[0], ''))) return parseFloat(monthly[1].replace(/,/g, ''));
  return null;
}

/**
 * One part's monthly dollar amount for a suite: the figure typed in the app, else read from the sheet's
 * text. 0 when there is nothing to add; null when there is text but no dollar amount could be read.
 * Incentives come back as a positive discount, and misc is signed.
 */
export function partAmount(u: Unit, part: NetPart, termMonths = DEFAULT_NET.termMonths): number | null {
  const manual = part === 'parking' ? u.parkingAmt : part === 'utilities' ? u.utilitiesAmt : part === 'incentives' ? u.incentiveAmt : u.miscAmt;
  if (typeof manual === 'number' && Number.isFinite(manual)) return manual;
  if (part === 'misc') return 0;
  const text = part === 'parking' ? u.parking : part === 'utilities' ? u.utilities : u.incentive;
  if (!text.trim()) return 0;
  return part === 'incentives' ? parseIncentive(text, u.rate, termMonths) : parseCharge(text);
}

/** Net rent for a suite under the given settings, or null when it has no base rent (and no override). */
export function unitNet(u: Unit, net: NetSettings): number | null {
  if (typeof u.netOverride === 'number' && Number.isFinite(u.netOverride)) return u.netOverride;
  if (u.rate == null) return null;
  let v = u.rate;
  if (net.parking) v += partAmount(u, 'parking', net.termMonths) ?? 0;
  if (net.utilities) v += partAmount(u, 'utilities', net.termMonths) ?? 0;
  if (net.incentives) v -= partAmount(u, 'incentives', net.termMonths) ?? 0;
  if (net.misc) v += partAmount(u, 'misc', net.termMonths) ?? 0;
  return v;
}

/** Which parts have a real amount somewhere in the survey (the client only sees tick boxes for these). */
export function partsWithData(survey: Pick<Survey, 'buildings' | 'net'>): Set<NetPart> {
  const term = netOf(survey).termMonths;
  const out = new Set<NetPart>();
  for (const b of survey.buildings)
    for (const u of b.units) for (const { k } of NET_PARTS) if (!out.has(k) && (partAmount(u, k, term) ?? 0) !== 0) out.add(k);
  return out;
}

/** True when net rent can differ from base rent, so showing it is worthwhile. */
export function netAvailable(survey: Pick<Survey, 'buildings' | 'net'>): boolean {
  if (!netOf(survey).enabled) return false;
  return partsWithData(survey).size > 0 || survey.buildings.some((b) => b.units.some((u) => typeof u.netOverride === 'number'));
}

/** The definition printed beside net rent, for example "Net rent = base rent + parking, less incentives". */
export function netDefinition(net: NetSettings): string {
  const adds = [net.parking && 'parking', net.utilities && 'utilities', net.misc && 'misc'].filter(Boolean) as string[];
  const base = adds.length ? `base rent + ${adds.join(' + ')}` : 'base rent';
  return `Net rent = ${base}${net.incentives ? ', less incentives' : ''}${!adds.length && !net.incentives ? ' (nothing added)' : ''}`;
}

/** The amount worked out from the text alone, ignoring anything typed in the app (shown as a hint beside the box). */
export function autoAmount(u: Unit, part: NetPart, termMonths = DEFAULT_NET.termMonths): number | null {
  return partAmount({ ...u, parkingAmt: null, utilitiesAmt: null, incentiveAmt: null, miscAmt: null }, part, termMonths);
}
