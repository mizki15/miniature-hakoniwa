import { describe, it, expect } from 'vitest';
import { pickNearestOnScreen } from './pick';

describe('pickNearestOnScreen', () => {
  it('returns the nearest point within the radius', () => {
    const pts = [{ x: 110, y: 100, id: 1 }, { x: 104, y: 100, id: 2 }, { x: 300, y: 300, id: 3 }];
    expect(pickNearestOnScreen(pts, 100, 100)).toBe(2);
  });
  it('returns null when every point is farther than 28px', () => {
    expect(pickNearestOnScreen([{ x: 129, y: 100, id: 1 }], 100, 100)).toBeNull();
  });
  it('returns null with no points', () => {
    expect(pickNearestOnScreen([], 100, 100)).toBeNull();
  });
});
