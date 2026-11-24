import { describe, it, expect } from 'vitest';
import { countEnvironment, habitatCols, fitsHabitat, sharePct, wildness, type EnvInput } from './environment';
import { testWorld } from './testWorld';
import { FRAME } from '../world/plots';

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
  it('shore wins over farm, farm wins over forest', () => {
    const i = input();
    const e = countEnvironment({ ...i, farmland: new Set([at(69, 100), at(100, 100)]), treeCols: new Set([at(100, 100)]) });
    expect(e.farm).toBe(1);
    expect(e.forest).toBe(24);
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
