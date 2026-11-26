import { describe, expect, it } from 'vitest';
import { offeredAsOf } from '../src/lib/dates';

describe('the As of date offered when publishing', () => {
  const today = '2026-11-26';
  it('offers today for a first publish', () => {
    expect(offeredAsOf(false, null, '2026-11-23', today)).toBe(today);
  });
  it('offers today when the live link is behind the editor', () => {
    expect(offeredAsOf(true, false, '2026-11-23', today)).toBe(today);
  });
  it('keeps the link\'s date when nothing new is being published', () => {
    expect(offeredAsOf(true, true, '2026-11-23', today)).toBe('2026-11-23');
  });
  it('keeps the date while the state is still unknown', () => {
    expect(offeredAsOf(true, null, '2026-11-23', today)).toBe('2026-11-23');
  });
});
