import { describe, expect, it } from 'vitest';
import { fileLabel, fileName } from '../src/lib/fileName';

describe('file names', () => {
  it('keeps the title\'s spaces and only replaces what a file name cannot hold', () => {
    expect(fileName('SE/SW New Build Townhomes', 'Rental Market Survey', 'pdf')).toBe('SE-SW New Build Townhomes - Rental Market Survey.pdf');
    expect(fileLabel('Clareview Townhomes')).toBe('Clareview Townhomes');
    expect(fileLabel('A: B? "C"')).toBe('A- B- -C');
  });
  it('tidies spaces and stray dots, and never returns nothing', () => {
    expect(fileLabel('  Mahogany   Lake . ')).toBe('Mahogany Lake');
    expect(fileLabel('///')).toBe('Rental Market Survey');
    expect(fileLabel('')).toBe('Rental Market Survey');
    expect(fileLabel('x'.repeat(300)).length).toBeLessThanOrEqual(110);
  });
});
