// Small text helpers for unit types. Kept apart from the spreadsheet parser so the client viewer can use
// them without bundling the Excel-reading code.

/** One wording for the same thing: "Bachelor", "Bach" and "Bachelor/Studio" all become "Studio". */
export function normalizeUnitType(s: string): string {
  return s
    .replace(/\b(?:bachelor|bach)s?\s*\/\s*studio\b|\bstudio\s*\/\s*(?:bachelor|bach)s?\b/gi, 'Studio')
    .replace(/\b(?:bachelor|bach)s?\b/gi, 'Studio');
}

export function parseBeds(unitType: string): number | null {
  if (/studio|bachelor/i.test(unitType)) return 0;
  const m = unitType.match(/(\d+(?:\.\d+)?)\s*-?\s*(?:bed|bdrm|br\b)/i);
  return m ? Math.floor(parseFloat(m[1])) : null;
}

/** Pulls a dollar amount out of text such as "$225 underground". Returns 0 for included/free. */
export function parseCharge(s: string): number | null {
  if (!s) return null;
  const m = s.match(/\$\s*([\d,]+(?:\.\d+)?)/) ?? s.match(/^\s*([\d,]+(?:\.\d+)?)\s*$/);
  if (m) return parseFloat(m[1].replace(/,/g, ''));
  if (/included|free|n\/a|none/i.test(s)) return 0;
  return null;
}
