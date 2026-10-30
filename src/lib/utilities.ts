import type { Unit } from '../types';

/**
 * How a suite's utilities are paid, read from the Utilities text. Nothing is estimated: a suite whose
 * tenant pays the utility company has no cost in the survey, so it is only marked, never priced.
 * - included: in the rent ("Heat + Water included")
 * - charged: a known charge on top of rent ("$300 includes all utilities")
 * - tenant: not included and no amount ("Not Included", "Tenant pays")
 */
export type UtilStatus = 'included' | 'charged' | 'tenant';

export const UTIL_LABEL: Record<UtilStatus, string> = { included: 'Included', charged: 'Extra charge', tenant: 'Not included' };
export const UTIL_CATS = [UTIL_LABEL.included, UTIL_LABEL.charged, UTIL_LABEL.tenant] as const;

const AMOUNT = /\$\s*\d|\d+\s*\/\s*(?:mo|month)\b/i;
const TENANT = /\bnot\s+incl|\bexcl|\btenant|\bextra\b|\bseparate|\bresponsib|does\s+not\s+include|\bn\/?a\b|^\s*(?:no|none)\s*$/i;
const INCLUDED = /\bincl|\bin rent\b/i;

export function utilStatus(u: Unit): UtilStatus | null {
  if (u.utilitiesAmt != null && u.utilitiesAmt > 0) return 'charged';
  const t = u.utilities.trim();
  if (!t) return null;
  if (AMOUNT.test(t)) return 'charged';
  if (TENANT.test(t)) return 'tenant';
  if (INCLUDED.test(t)) return 'included';
  return null;
}

/** Filter chip category for a suite, for example "Included". */
export const utilCat = (u: Unit): string | null => {
  const s = utilStatus(u);
  return s ? UTIL_LABEL[s] : null;
};

const PARTS: [RegExp, string][] = [
  [/\bheat|\bgas\b/i, 'Heat'],
  [/\bwater|\bsewer/i, 'Water'],
  [/\bpower|\belectric|\bhydro/i, 'Power'],
];

/** Short pin tag for utilities in the rent: "Utils incl." when all (or unstated), otherwise the parts, "Heat + water incl.". */
export function includedTag(text: string): string {
  if (/\ball\b|\beverything/i.test(text)) return 'Utils incl.';
  const parts = PARTS.filter(([re]) => re.test(text)).map(([, p]) => p);
  if (parts.length === 0 || parts.length === PARTS.length) return 'Utils incl.';
  return `${parts.map((p, i) => (i ? p.toLowerCase() : p)).join(' + ')} incl.`;
}

/** Text that stands in for a value still to be found ("TBC"). Checks lists it; a pin does not show it as an offer. */
export const PLACEHOLDER = /\b(tbc|tbd|to be confirmed|to be determined|pending)\b|^\s*\?+\s*$/i;

export interface PinBadge {
  kind: 'incentive' | 'utils';
  text: string;
}

/** The tags on a building's pin, for the suites on show: an incentive, and utilities in the rent. */
export function pinBadges(units: Unit[]): PinBadge[] {
  const out: PinBadge[] = [];
  if (units.some((u) => u.incentive.trim() && !PLACEHOLDER.test(u.incentive))) out.push({ kind: 'incentive', text: 'Incentive' });
  const incl = units.find((u) => utilStatus(u) === 'included');
  if (incl) out.push({ kind: 'utils', text: includedTag(incl.utilities) });
  return out;
}
