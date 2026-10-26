/** Today's date as yyyy-mm-dd in the computer's own time zone (toISOString would give the UTC date, a day ahead in the evening). */
export function localDate(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
