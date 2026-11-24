import { describe, it, expect } from 'vitest';
import { buildingWildWeight, countEnvironment, habitatCols, fitsHabitat, lightReach, sharePct, wildness, type EnvInput } from './environment';
import { testWorld } from './testWorld';
import { FRAME } from '../world/plots';
import { MUD, SAND, STONE } from '../world/blocks';

const input = (): EnvInput => ({ world: testWorld(), flowerCols: [1, 2, 3], treeCols: new Set([5, 6]), farmland: new Set([7]), crops: 4 });

const at = (x: number, z: number) => x + z * FRAME;

describe('countEnvironment', () => {
  it('splits the open plot into water, shore and meadow', () => {
    const e = countEnvironment(input());
    expect(e.ground).toBe(64 * 64);
    // 水面 5 列幅は土地の型に入らない。水から 2 列以内（x=68,69,74,75,78,79,81,82）が水辺
    expect(e.waterside).toBe(8 * 64);
    expect(e.deepWater).toBe(64);
    expect(e.meadow).toBe(64 * 64 - 5 * 64 - 8 * 64);
    expect([e.forest, e.flowerField, e.farm, e.human]).toEqual([0, 0, 0, 0]);
    expect(e.wild).toBe(5);
  });
  it('ignores trees, flowers and farmland in closed plots', () => {
    const e = countEnvironment({ ...input(), flowerCols: [1, 2, 3], treeCols: new Set([5, 6]), farmland: new Set([7]) });
    expect([e.forest, e.flowerField, e.farm]).toEqual([0, 0, 0]);
  });
  it('a tree makes a 5×5 forest', () => {
    const e = countEnvironment({ ...input(), treeCols: new Set([at(100, 100)]) });
    expect(e.forest).toBe(25);
  });
  it('a flower field needs two flower columns in 3×3', () => {
    expect(countEnvironment({ ...input(), flowerCols: [at(100, 100)] }).flowerField).toBe(0);
    // 隣り合う 2 列：両方を含む 3×3 の中心は 2×3 = 6 列
    expect(countEnvironment({ ...input(), flowerCols: [at(100, 100), at(101, 100)] }).flowerField).toBe(6);
  });
  it('farm, paths and building footprints lower wildness', () => {
    const farmland = new Set(Array.from({ length: 64 }, (_, i) => at(90 + (i % 8), 90 + Math.floor(i / 8))));
    const buildingCols = new Set(Array.from({ length: 64 }, (_, i) => at(110 + (i % 8), 90 + Math.floor(i / 8))));
    const e = countEnvironment({ ...input(), farmland, buildingCols });
    expect([e.farm, e.human]).toEqual([64, 64]);
    // 128 / 4096 = 3.1% → ★4
    expect(e.wild).toBe(4);
  });
  it('farm on the shore is farm (counts for wildness), farm wins over forest', () => {
    const i = input();
    const e = countEnvironment({ ...i, farmland: new Set([at(69, 100), at(100, 100)]), treeCols: new Set([at(100, 100)]) });
    expect(e.farm).toBe(2);
    expect(e.waterside).toBe(8 * 64 - 1);
    expect(e.forest).toBe(24);
  });
  it('mud is wetland, sand away from water is beach, stone away from water is rock', () => {
    const i = input();
    const w = i.world;
    const setTop = (x: number, z: number, t: number) => { const col = at(x, z); w.voxels[col + (w.heights[col] - 1) * FRAME * FRAME] = t; };
    setTop(100, 100, MUD); setTop(101, 100, SAND); setTop(102, 100, STONE);
    setTop(69, 100, SAND); // 水辺の砂は水辺
    const e = countEnvironment(i);
    expect([e.wetland, e.beach, e.rock]).toEqual([1, 1, 1]);
    expect(e.waterside).toBe(8 * 64);
  });
  it('does not count closed plots as water', () => {
    const i = input();
    // 区画の外（高さ 0）は水でも草地でもない：x=63 は区画の外で、x=64 は区画の端の草地
    expect(habitatCols(i, 'waterside').some((c) => c % FRAME === 64)).toBe(false);
  });
});

describe('wildness', () => {
  it('steps at 2, 5, 10 and 20 percent', () => {
    expect([0, 1.9, 2, 4.9, 5, 9.9, 10, 19.9, 20, 80].map(wildness)).toEqual([5, 5, 4, 4, 3, 3, 2, 2, 1, 1]);
  });
  it('share is a percent of the open ground', () => {
    expect(sharePct({ ...countEnvironment(input()) }, 'deepWater')).toBeCloseTo(100 / 64);
  });
});

describe('habitatCols', () => {
  it('waterside columns are walkable and next to water', () => {
    const i = input();
    const cols = habitatCols(i, 'waterside');
    expect(cols.length).toBe(4 * 64);
    for (const c of cols) {
      expect(i.world.walkable[c]).toBe(1);
      const x = c % FRAME;
      expect([69, 74, 79, 81]).toContain(x);
    }
  });
  it('deep water columns are in the deep strip', () => {
    expect(habitatCols(input(), 'deepWater').every((c) => c % FRAME === 80)).toBe(true);
  });
});

describe('fitsHabitat', () => {
  it('a deep water column stops fitting once it is filled', () => {
    const i = input();
    const col = 80 + 90 * FRAME;
    expect(fitsHabitat(i, 'deepWater', col)).toBe(true);
    i.world.heights[col] = 12; i.world.walkable[col] = 1;
    expect(fitsHabitat(i, 'deepWater', col)).toBe(false);
  });
  it('waterside stops fitting when the water next to it is gone', () => {
    const i = input();
    const col = 79 + 90 * FRAME;
    expect(fitsHabitat(i, 'waterside', col)).toBe(true);
    i.world.heights[80 + 90 * FRAME] = 12;
    expect(fitsHabitat(i, 'waterside', col)).toBe(false);
  });
  it('flower column stops fitting when the flower is gone', () => {
    const i = input();
    const col = 90 + 90 * FRAME; // 開いた区画の草地
    i.flowerCols = [col];
    expect(fitsHabitat(i, 'flower', col)).toBe(true);
    i.flowerCols = [];
    expect(fitsHabitat(i, 'flower', col)).toBe(false);
  });
});

describe('buildings: weighted wildness and lights (v0.12)', () => {
  const block = (x0: number, z0: number, n: number) => new Set(Array.from({ length: n * n }, (_, i) => at(x0 + (i % n), z0 + Math.floor(i / n))));
  it('a natural building counts for less wildness than its footprint', () => {
    const buildingCols = block(100, 100, 12); // 144 列 = 3.5%
    expect(countEnvironment({ ...input(), buildingCols }).wild).toBe(4);
    // かやぶき（★5）なら 2 割だけ数える：0.7% → ★5
    expect(countEnvironment({ ...input(), buildingCols, buildingWildCols: 144 * buildingWildWeight(5) }).wild).toBe(5);
    expect(buildingWildWeight(1)).toBe(1);
  });
  it('light reach grows with the light stars', () => {
    expect([0, 1, 3, 5].map(lightReach)).toEqual([0, 4, 8, 12]);
  });
  it('waterside and forest under a light are not dark', () => {
    const i = { ...input(), treeCols: new Set([at(100, 100)]) };
    const dark = countEnvironment(i);
    expect(dark.darkWaterside).toBe(dark.waterside);
    expect(dark.darkForest).toBe(25);
    const lit = countEnvironment({ ...i, lights: [{ x: 100, z: 100, r: 4 }, { x: 69, z: 90, r: 4 }] });
    expect(lit.darkForest).toBe(0);
    expect(lit.darkWaterside).toBeLessThan(lit.waterside);
    expect(lit.waterside).toBe(dark.waterside);
  });
  it('fireflies and owls do not appear under a light', () => {
    const i = { ...input(), treeCols: new Set([at(100, 100), at(120, 120)]), lights: [{ x: 100, z: 100, r: 4 }] };
    expect(habitatCols(i, 'darkTree')).toEqual([at(120, 120)]);
    expect(fitsHabitat(i, 'darkTree', at(100, 100))).toBe(false);
    expect(fitsHabitat(i, 'tree', at(100, 100))).toBe(true);
    const near = { ...input(), lights: [{ x: 69, z: 90, r: 4 }] };
    expect(fitsHabitat(near, 'grassNearWater', at(68, 90))).toBe(false);
    expect(fitsHabitat(near, 'grassNearWater', at(68, 120))).toBe(true);
  });
});
