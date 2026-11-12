import { describe, it, expect } from 'vitest';
import { mulberry32 } from './noise';

describe('noise', () => {
  it('mulberry32 is deterministic', () => {
    const a = mulberry32(1), b = mulberry32(1);
    expect(a()).toBe(b());
  });
});

import { hash2 } from './noise';
describe('hash2', () => {
  it('is deterministic, in [0,1) and varies by coordinate and salt', () => {
    expect(hash2(1, 3, 4, 0)).toBe(hash2(1, 3, 4, 0));
    const vals = new Set<number>();
    for (let x = 0; x < 50; x++) {
      const v = hash2(1, x, 7, 0);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      vals.add(v);
    }
    expect(vals.size).toBe(50);
    expect(hash2(1, 3, 4, 0)).not.toBe(hash2(1, 3, 4, 1));
    expect(hash2(1, 3, 4, 0)).not.toBe(hash2(2, 3, 4, 0));
  });
});
