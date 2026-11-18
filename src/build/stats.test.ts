import { describe, it, expect } from 'vitest';
import { designStats, viewerCameraDistance } from './stats';
import type { BuildingDesign } from './geoParse';

const d = (min: [number, number, number], max: [number, number, number], cubes = 3): BuildingDesign => ({
  id: 'x', name: 'x', bounds: { min, max }, cubes: Array.from({ length: cubes }, () => ({ m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], color: 'wall' })),
});

describe('designStats', () => {
  it('sizesInVoxelsRoundedToTenths', () => {
    expect(designStats(d([-1.5, 0, -1.25], [1.5, 3.8264, 1.25], 11))).toEqual({ width: 3, depth: 2.5, height: 3.8, cubes: 11, label: '幅 3 × 奥行 2.5 × 高さ 3.8 マス・直方体 11 個' });
  });
});

describe('viewerCameraDistance', () => {
  it('fitsTheBiggerBuilding', () => {
    const small = viewerCameraDistance(d([-0.5, 0, -0.5], [0.5, 1, 0.5]), 35);
    const big = viewerCameraDistance(d([-4, 0, -4], [4, 12, 4]), 35);
    expect(big).toBeGreaterThan(small * 5);
    expect(small).toBeGreaterThan(1);
  });
});
