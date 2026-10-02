/** Returns the URL if it is an http(s) link (or, when allowed, an embedded image), else ''. */
export function safeUrl(u: string | undefined, allowData = false): string {
  const s = (u ?? '').trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (allowData && /^data:image\/(jpeg|png|webp|gif);base64,/i.test(s)) return s;
  return '';
}
