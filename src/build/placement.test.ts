import { describe, it, expect } from 'vitest';
import { canPlace, footprintCols, rayHitPlaced, rotatedBounds } from './placement';
import type { BuildingDesign } from './geoParse';
import { PLOT, FRAME } from '../world/plots';

const d = (min: [number, number, number], max: [number, number, number]): BuildingDesign => ({ id: 'x', name: 'x', cubes: [], bounds: { min, max } });
const plotBit = (px: number, pz: number) => 1 << (px + pz * (FRAME / PLOT));

describe('placement', () => {
  it('rotatedBoundsQuarterTurn', () => {
    const b = rotatedBounds(d([-1, 0, -2], [3, 2, 2]), 1);
    expect(b.min).toEqual([-2, 0, -3]);
    expect(b.max).toEqual([2, 2, 1]);
    expect(rotatedBounds(d([-1, 0, -2], [3, 2, 2]), 2).min).toEqual([-3, 0, -2]);
  });
  it('footprintOneCube', () => {
    expect(footprintCols(d([-0.5, 0, -0.5], [0.5, 1, 0.5]), 0, 70, 80, FRAME)).toEqual([70 + 80 * FRAME]);
  });
  it('footprintTwoByThree', () => {
    // 原点は列の中心 (70.5, 80.5)。x は 69.5〜71.5 → 69〜71、z は 79〜82 → 79〜81 の列にかかる
    const cols = footprintCols(d([-1, 0, -1.5], [1, 1, 1.5]), 0, 70, 80, FRAME).sort((a, b) => a - b);
    expect(cols.length).toBe(9);
    expect(cols[0]).toBe(69 + 79 * FRAME);
  });
  it('footprintOutsideOpenPlots', () => {
    const plots = plotBit(1, 1);
    const house = d([-2, 0, -2], [2, 3, 2]);
    expect(canPlace(house, 0, 96, 96, FRAME, plots)).toEqual({ ok: true });
    expect(canPlace(house, 0, 64, 96, FRAME, plots)).toEqual({ ok: false, msg: '開いていない土地にかかっています' });
  });
  it('footprintOutsideFrame', () => {
    expect(canPlace(d([-2, 0, -2], [2, 3, 2]), 0, 0, 10, FRAME, 0xffff)).toEqual({ ok: false, msg: '箱庭の外にはみ出します' });
  });
  it('rayHitsNearest', () => {
    const house = d([-1, 0, -1], [1, 2, 1]);
    const placed = [
      { design: house, x: 150, z: 128, y: 10, rot: 0 as const },
      { design: house, x: 140, z: 128, y: 10, rot: 0 as const },
    ];
    // 箱庭の中心が原点なので、列 140 の中心は x = 140.5 − 128 = 12.5
    expect(rayHitPlaced(placed, [0, 11, 0.5], [1, 0, 0], 128)).toBe(1);
  });
  it('rayMisses', () => {
    const placed = [{ design: d([-1, 0, -1], [1, 2, 1]), x: 140, z: 128, y: 10, rot: 0 as const }];
    expect(rayHitPlaced(placed, [0, 30, 0.5], [1, 0, 0], 128)).toBe(-1);
    expect(rayHitPlaced(placed, [0, 11, 0.5], [-1, 0, 0], 128)).toBe(-1);
  });
});
