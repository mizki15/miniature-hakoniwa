import { describe, it, expect } from 'vitest';
import { countEnvironment, habitatCols, fitsHabitat, type EnvInput } from './environment';
import { testWorld } from './testWorld';
import { FRAME } from '../world/plots';

const input = (): EnvInput => ({ world: testWorld(), flowerCols: [1, 2, 3], treeCols: new Set([5, 6]), farmland: new Set([7]), crops: 4 });

describe('countEnvironment', () => {
  it('counts grass, waterside and deep water in open plots only', () => {
    const e = countEnvironment(input());
    expect(e.grass).toBe(64 * 64 - 5 * 64);
    // 浅い水の両側（x=69, 74）と深い水の両側（x=79, 81）
    expect(e.waterside).toBe(4 * 64);
    expect(e.deepWater).toBe(64);
  });
  it('passes through flowers, trees, farmland and crops', () => {
    const e = countEnvironment(input());
    expect([e.flowers, e.trees, e.farmland, e.crops]).toEqual([3, 2, 1, 4]);
  });
  it('does not count closed plots as water', () => {
    const i = input();
    // 区画の外（高さ 0）は水でも草地でもない：x=63 は区画の外で、x=64 は区画の端の草地
    expect(habitatCols(i, 'waterside').some((c) => c % FRAME === 64)).toBe(false);
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
