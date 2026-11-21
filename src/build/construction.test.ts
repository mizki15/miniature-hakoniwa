import { describe, it, expect } from 'vitest';
import { advanceProgress, buildMinutes, buildOrder, builtCount, cubeBox, minutesLeft } from './construction';
import type { BuildingCube } from './geoParse';

/** 原点 (x, y, z)、大きさ (w, h, d) の回転なしの直方体 */
const cube = (x: number, y: number, z: number, w = 1, h = 1, d = 1, color = 'wall'): BuildingCube => ({ m: [w, 0, 0, x, 0, h, 0, y, 0, 0, d, z], color });

describe('construction', () => {
  it('buildMinutesScalesWithSize', () => {
    expect(buildMinutes({ cubes: [] })).toBe(10);
    expect(buildMinutes({ cubes: Array.from({ length: 40 }, () => cube(0, 0, 0)) })).toBe(20);
    expect(buildMinutes({ cubes: Array.from({ length: 500 }, () => cube(0, 0, 0)) })).toBe(60);
  });
  it('cubeBoxOfTranslatedCube', () => {
    expect(cubeBox(cube(1, 2, 3, 2, 1, 4))).toEqual({ min: [1, 2, 3], max: [3, 3, 7] });
  });
  it('buildOrderBottomFirst', () => {
    const roof = cube(0, 3, 0, 4, 1, 4, 'roof');
    const wall = cube(0, 0, 0, 4, 3, 4);
    const floor = cube(0, 0, 0, 4, 0.2, 4, 'stone');
    const order = buildOrder({ cubes: [roof, wall, floor] });
    expect(order.map((c) => c.color)).toEqual(['stone', 'wall', 'roof']);
  });
  it('builtCountAndAdvance', () => {
    expect(builtCount(0, 10)).toBe(0);
    expect(builtCount(0.55, 10)).toBe(5);
    expect(builtCount(1, 10)).toBe(10);
    const d = { cubes: [] }; // 10 分
    expect(advanceProgress(0, 5 * 60_000, d)).toBeCloseTo(0.5);
    expect(advanceProgress(0.9, 60 * 60_000, d)).toBe(1);
    expect(minutesLeft(0.5, d)).toBe(5);
  });
});
