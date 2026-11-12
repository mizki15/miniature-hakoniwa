import { describe, it, expect } from 'vitest';
import { canSetCol, floodAllowed } from './edgeRules';

describe('edge edits stay inside open plots', () => {
  const m = 1 << 5;
  it('canSetCol', () => {
    expect(canSetCol(m, 64, 64)).toBe(true);
    expect(canSetCol(m, 63, 64)).toBe(false);
    expect(canSetCol(m, 128, 100)).toBe(false);
  });
  it('flood stops at closed plots', () => {
    expect(floodAllowed(m, 127, 90)).toBe(true);
    expect(floodAllowed(m, 128, 90)).toBe(false);
  });
});
