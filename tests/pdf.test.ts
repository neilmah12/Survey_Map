import { describe, expect, it } from 'vitest';
import { pdfFromJpeg, pdfString } from '../src/lib/pdf';

// A 1x1 white JPEG (smallest valid baseline JPEG).
const JPEG = Uint8Array.from(
  Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
    'base64',
  ),
);
const str = (u: Uint8Array) => Buffer.from(u).toString('latin1');

describe('pdfFromJpeg', () => {
  const pdf = pdfFromJpeg(JPEG, 1, 1, 792, 612, 'Clareview (test)');
  const s = str(pdf);

  it('has the PDF header and end marker', () => {
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('has a page of the requested size that draws the image', () => {
    expect(s).toContain('/MediaBox [0 0 792 612]');
    expect(s).toContain('/Width 1 /Height 1');
    expect(s).toContain('/Filter /DCTDecode');
    expect(s).toContain('q 792 0 0 612 0 0 cm /Im0 Do Q');
  });

  it('records the exact byte offset of every object in the cross-reference table', () => {
    const xref = s.indexOf('xref\n0 7');
    const startxref = Number(s.match(/startxref\n(\d+)/)![1]);
    expect(startxref).toBe(xref);
    const entries = s.slice(xref).split('\n').slice(2, 9); // free entry + six objects
    expect(entries).toHaveLength(7);
    for (let n = 1; n <= 6; n++) {
      const off = Number(entries[n].slice(0, 10));
      expect(s.slice(off, off + `${n} 0 obj`.length)).toBe(`${n} 0 obj`);
    }
  });

  it('embeds the JPEG bytes unchanged and states their length', () => {
    const at = pdf.findIndex((_, i) => i + JPEG.length <= pdf.length && JPEG.every((b, k) => pdf[i + k] === b));
    expect(at).toBeGreaterThan(0);
    expect(s).toContain(`/Length ${JPEG.length} >>\nstream\n`);
  });

  it('escapes the title safely', () => {
    expect(pdfString('A (b) \\ c')).toBe('(A \\(b\\) \\\\ c)');
    expect(pdfString('Café – x')).toBe('(Caf? ? x)');
    expect(s).toContain('/Title (Clareview \\(test\\))');
  });
});
