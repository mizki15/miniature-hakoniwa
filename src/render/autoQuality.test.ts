import { describe, it, expect } from 'vitest';
import { nextQuality } from './autoQuality';

describe('nextQuality', () => {
  it('stays when fast enough', () => {
    expect(nextQuality('high', [60, 58, 61, 59])).toBeNull();
  });
  it('drops one step when a little slow', () => {
    expect(nextQuality('high', [33, 35, 34, 36])).toBe('medium');
    expect(nextQuality('medium', [33, 35, 34, 36])).toBe('low');
  });
  it('goes straight to low when very slow (under 25 fps)', () => {
    expect(nextQuality('high', [20, 21, 19, 22])).toBe('low');
  });
  it('ignores a single hitch (uses the median)', () => {
    expect(nextQuality('high', [60, 5, 61, 59])).toBeNull();
  });
  it('never goes below low', () => {
    expect(nextQuality('low', [10, 10, 10, 10])).toBeNull();
  });
});
