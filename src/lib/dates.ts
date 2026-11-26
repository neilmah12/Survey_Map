/** Today's date as yyyy-mm-dd in the computer's own time zone (toISOString would give the UTC date, a day ahead in the evening). */
export function localDate(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * The As of date offered when publishing. A link with nothing new to publish keeps its date (the editor can still
 * choose today); a first publish, or a link with changes behind it, offers today, so a link sent today does not read
 * as an old update.
 */
export function offeredAsOf(published: boolean, upToDate: boolean | null, current: string, today: string): string {
  return !published || upToDate === false ? today : current;
}
