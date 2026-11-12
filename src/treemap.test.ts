import { describe, expect, it } from 'vitest';
import { squarify } from './treemap';

describe('squarify', () => {
  it('tiles the area exactly, each rect proportional to its value, nothing outside', () => {
    const values = [500, 300, 120, 50, 20, 10];
    const area = { x: 0, y: 0, w: 1000, h: 500 };
    const rects = squarify(values, area);
    const total = values.reduce((a, v) => a + v, 0);
    expect(rects).toHaveLength(values.length);
    rects.forEach((r, i) => {
      expect(r.w * r.h).toBeCloseTo((values[i] / total) * area.w * area.h, 3);
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.y).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(area.w + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(area.h + 1e-6);
    });
  });

  it('handles a single value and an all-zero list', () => {
    expect(squarify([7], { x: 0, y: 0, w: 10, h: 5 })).toEqual([{ x: 0, y: 0, w: 10, h: 5 }]);
    expect(squarify([0, 0], { x: 0, y: 0, w: 10, h: 5 }).every((r) => r.w === 0)).toBe(true);
  });
});
