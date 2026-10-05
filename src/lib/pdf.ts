/**
 * Minimal single-page PDF that shows one JPEG image filling the page. Enough for a print-ready map page
 * without a PDF library. Offsets in the cross-reference table are computed from the real byte positions.
 */
const enc = new TextEncoder();
const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

/** A PDF literal string: parentheses and backslashes escaped, non-Latin characters dropped to "?". */
export function pdfString(s: string): string {
  return `(${s.replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1')})`;
}

export function pdfFromJpeg(jpeg: Uint8Array, imgW: number, imgH: number, pageWpt: number, pageHpt: number, title = ''): Uint8Array {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (b: Uint8Array) => {
    chunks.push(b);
    pos += b.length;
  };
  const text = (s: string) => push(enc.encode(s));
  const obj = (n: number, body: () => void) => {
    offsets[n] = pos;
    text(`${n} 0 obj\n`);
    body();
    text('\nendobj\n');
  };
  const f = (n: number) => String(Math.round(n * 100) / 100);

  push(latin1('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'));
  obj(1, () => text('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => text('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  obj(3, () =>
    text(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(pageWpt)} ${f(pageHpt)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`),
  );
  obj(4, () => {
    text(`<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    push(jpeg);
    text('\nendstream');
  });
  const content = `q ${f(pageWpt)} 0 0 ${f(pageHpt)} 0 0 cm /Im0 Do Q`;
  obj(5, () => text(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  obj(6, () => text(`<< /Title ${pdfString(title)} /Producer ${pdfString('Avison Young Survey Map')} >>`));

  const xrefAt = pos;
  text(`xref\n0 7\n0000000000 65535 f \n`);
  for (let n = 1; n <= 6; n++) text(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  text(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(pos);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
