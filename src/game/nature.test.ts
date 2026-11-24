import { describe, it, expect } from 'vitest';
import { DAY_MS, GRASS_GROW_MS, MAX_NATURE_DAYS, fadeFlowers, grassDue, natureDays, spreadTrees } from './nature';

/** 決まった順に値を返す乱数（テスト用） */
const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]; };
/** 線形合同法の乱数（何日もまわす時） */
const lcg = (s = 1) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);

describe('grassDue', () => {
  it('soil turns to grass after a day', () => {
    const bare = new Map([[10, 0], [11, 5 * 3600_000]]);
    expect(grassDue(bare, GRASS_GROW_MS - 1)).toEqual([]);
    expect(grassDue(bare, GRASS_GROW_MS)).toEqual([10]);
    expect(grassDue(bare, GRASS_GROW_MS + 5 * 3600_000)).toEqual([10, 11]);
  });
});

describe('natureDays', () => {
  it('starts counting from the first call and catches up to 60 days', () => {
    expect(natureDays(undefined, 3 * DAY_MS)).toEqual({ days: 0, today: 3 });
    expect(natureDays(3, 3 * DAY_MS + 5)).toEqual({ days: 0, today: 3 });
    expect(natureDays(3, 5 * DAY_MS)).toEqual({ days: 2, today: 5 });
    expect(natureDays(0, 500 * DAY_MS).days).toBe(MAX_NATURE_DAYS);
  });
});

describe('spreadTrees', () => {
  const N = 64;
  const tree = 30 + 30 * N;
  it('a sapling appears 2–3 columns from the tree when the chance hits', () => {
    // 確率に当たる（0）→ 距離 2（0）→ 上の辺（0）→ 辺の左端（0）
    const out = spreadTrees([tree], N, () => true, seq(0, 0, 0, 0));
    expect(out).toEqual([28 + 28 * N]);
  });
  it('nothing grows when the chance misses or the spot is not grass', () => {
    expect(spreadTrees([tree], N, () => true, seq(0.5))).toEqual([]);
    expect(spreadTrees([tree], N, () => false, seq(0, 0, 0, 0))).toEqual([]);
  });
  it('saplings of the same day do not touch each other', () => {
    const out = spreadTrees([tree, tree], N, () => true, seq(0, 0, 0, 0));
    expect(out).toHaveLength(1);
  });
  it('a meadow next to a forest visibly fills in over a month', () => {
    const rand = lcg(7);
    const trees = new Set<number>();
    for (let z = 10; z < 50; z += 3) for (let x = 10; x < 20; x += 3) trees.add(x + z * N); // 左の帯が森
    const before = trees.size;
    for (let day = 0; day < 30; day++) for (const c of spreadTrees(trees, N, (col) => !trees.has(col), rand)) trees.add(c);
    const grown = trees.size - before;
    expect(grown).toBeGreaterThan(before * 0.3);
    expect(grown).toBeLessThan(before * 3);
  });
});

describe('fadeFlowers', () => {
  it('about 1 in 100 flowers fade each day', () => {
    const rand = lcg(3);
    const cols = Array.from({ length: 10000 }, (_, i) => i);
    const n = fadeFlowers(cols, rand).length;
    expect(n).toBeGreaterThan(60);
    expect(n).toBeLessThan(140);
  });
});
