import { describe, expect, it } from 'vitest';
import { formatDistance, mapDistance } from './placeMap';

describe('mapDistance', () => {
  it('computes the straight-line distance for a known 3-4-5 triangle', () => {
    expect(mapDistance({ mapX: 0, mapY: 0 }, { mapX: 300, mapY: 400 })).toBe(500);
  });

  it('returns 0 for the same point', () => {
    expect(mapDistance({ mapX: 10, mapY: 10 }, { mapX: 10, mapY: 10 })).toBe(0);
  });
});

describe('formatDistance', () => {
  it('shows an abstract unit label when no scale is set', () => {
    expect(formatDistance(500)).toBe('500 Einheiten (kein Maßstab gesetzt)');
  });

  it('converts to the configured scale and unit label', () => {
    expect(formatDistance(500, { unitsPer100px: 2, unitLabel: 'Meilen' })).toBe('10 Meilen');
  });

  it('rounds to two decimal places', () => {
    expect(formatDistance(333, { unitsPer100px: 1, unitLabel: 'km' })).toBe('3.33 km');
  });
});
