import { describe, it, expect } from 'vitest';
import { parseBuilding, type BuildingDesign } from './geoParse';
import { buildingCharacter, lightStars, natureStars, sizeStars } from './character';

/** Blockbench の単位（16 = 1 マス）で、グループ名（＝素材）ごとの直方体を並べる */
type C = { origin: number[]; size: number[]; rotation?: number[]; pivot?: number[] };
const design = (groups: Record<string, C[]>, extra: Record<string, unknown> = {}): BuildingDesign => {
  const bones = Object.entries(groups).map(([name, cubes]) => ({ name, cubes, ...extra }));
  const r = parseBuilding(JSON.stringify({ format_version: '1.12.0', 'minecraft:geometry': [{ description: { identifier: 'geometry.t', ...extra }, bones }], ...extra }));
  if (!r.ok) throw new Error(r.issues.map((i) => i.message).join('\n'));
  return r.design;
};
const block = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): C => ({ origin: [x * 16, y * 16, z * 16], size: [sx * 16, sy * 16, sz * 16] });

describe('buildingCharacter: counting', () => {
  it('a single block shows 5 faces (the bottom sits on the ground)', () => {
    const c = buildingCharacter(design({ stone: [block(0, 0, 0)] }));
    expect(c.totalArea).toBeCloseTo(5);
    expect(c.areas.stone).toBeCloseTo(5);
    expect(c.footprint).toBe(1);
    expect(c.height).toBe(1);
    expect(c.volume).toBeCloseTo(1);
    expect(c.nature).toBe(3);
    expect(c.light).toBe(0);
  });
  it('a 3×2×4 box', () => {
    const c = buildingCharacter(design({ wall: [block(-1, 0, -2, 3, 2, 4)] }));
    expect(c.totalArea).toBeCloseTo(3 * 4 + 2 * (3 * 2 + 4 * 2));
    expect(c.footprint).toBe(12);
    expect(c.height).toBe(2);
  });
  it('glass hidden inside a wall adds nothing', () => {
    const plain = buildingCharacter(design({ stone: [block(0, 0, 0, 3, 3, 3)] }));
    const hidden = buildingCharacter(design({ stone: [block(0, 0, 0, 3, 3, 3)], glass: [block(1, 1, 1)] }));
    expect(hidden).toEqual(plain);
  });
  it('glass inside a closed hollow room is not seen either', () => {
    const shell = [block(0, 0, 0, 5, 1, 5), block(0, 4, 0, 5, 1, 5), block(0, 1, 0, 1, 3, 5), block(4, 1, 0, 1, 3, 5), block(1, 1, 0, 3, 3, 1), block(1, 1, 4, 3, 3, 1)];
    const empty = buildingCharacter(design({ brick: shell }));
    const withGlass = buildingCharacter(design({ brick: shell, glass: [block(2, 1, 2)] }));
    expect(withGlass.areas).toEqual(empty.areas);
    expect(withGlass.light).toBe(0);
  });
  it('the same shape split or overlapped differently gives the same result', () => {
    const one = buildingCharacter(design({ plank: [block(0, 0, 0, 4, 2, 2)] }));
    const split = buildingCharacter(design({ plank: [block(0, 0, 0, 1, 2, 2), block(1, 0, 0, 3, 1, 2), block(1, 1, 0, 3, 1, 2)] }));
    const overlapped = buildingCharacter(design({ plank: [block(0, 0, 0, 3, 2, 2), block(1, 0, 0, 3, 2, 2), block(2, 0, 0, 2, 2, 2)] }));
    expect(split).toEqual(one);
    expect(overlapped).toEqual(one);
  });
  it('overlapping materials resolve the same way whatever the order', () => {
    const a = buildingCharacter(design({ stone: [block(0, 0, 0, 2, 1, 1)], brick: [block(1, 0, 0, 2, 1, 1)] }));
    const b = buildingCharacter(design({ brick: [block(1, 0, 0, 2, 1, 1)], stone: [block(0, 0, 0, 2, 1, 1)] }));
    expect(a).toEqual(b);
  });
  it('extra keys in the JSON change nothing', () => {
    const plain = buildingCharacter(design({ wall: [block(0, 0, 0, 2, 2, 2)] }));
    const extra = buildingCharacter(design({ wall: [block(0, 0, 0, 2, 2, 2)] }, { cost: 0, material: 'diamond', color: '#ffd700', texture: 'gold.png' }));
    expect(extra).toEqual(plain);
  });
  it('tiny parts (smaller than a quarter block in two directions) are dropped', () => {
    const plain = buildingCharacter(design({ wall: [block(0, 0, 0, 2, 2, 2)] }));
    const specks = Array.from({ length: 50 }, (_, i) => ({ origin: [i % 8, 32, Math.floor(i / 8)], size: [1, 1, 1] }));
    expect(buildingCharacter(design({ wall: [block(0, 0, 0, 2, 2, 2)], glass: specks }))).toEqual(plain);
  });
  it('a thin door (1/16 block) is still counted', () => {
    const c = buildingCharacter(design({ wall: [block(0, 0, 0, 2, 2, 2)], glass: [{ origin: [0, 0, -1], size: [32, 32, 1] }] }));
    expect(c.glass).toBeGreaterThan(3);
    expect(c.light).toBeGreaterThan(0);
  });
  it('parts floating in the air are not counted', () => {
    const plain = buildingCharacter(design({ wall: [block(0, 0, 0, 2, 2, 2)] }));
    const floating = buildingCharacter(design({ wall: [block(0, 0, 0, 2, 2, 2)], glass: [block(5, 4, 5, 2, 2, 2)] }));
    expect(floating).toEqual(plain);
  });
  it('the footprint counts only columns touching the ground (a wide roof on a post is small)', () => {
    const c = buildingCharacter(design({ wood: [block(2, 0, 2, 1, 3, 1)], roof: [block(0, 3, 0, 5, 1, 5)] }));
    expect(c.footprint).toBe(1);
    expect(c.height).toBe(4);
  });
  it('a rotated cube is counted roughly like the same cube unrotated', () => {
    const flat = buildingCharacter(design({ stone: [block(0, 0, 0, 4, 2, 4)] }));
    const turned = buildingCharacter(design({ stone: [{ ...block(0, 0, 0, 4, 2, 4), pivot: [32, 0, 32], rotation: [0, 45, 0] }] }));
    expect(turned.volume).toBeGreaterThan(flat.volume * 0.85);
    expect(turned.volume).toBeLessThan(flat.volume * 1.4);
  });
  it('the largest allowed building stays fast enough', () => {
    const cubes = Array.from({ length: 512 }, (_, i) => ({ ...block(-6, 0, -6, 12, 20, 12), pivot: [0, 0, 0], rotation: [0, (i * 7) % 90, 0] }));
    // 回して外へはみ出すと幅の上限を超えるので、少し小さくする
    for (const c of cubes) { c.origin = [-64, 0, -64]; c.size = [128, 320, 128]; }
    const d = design({ stone: cubes });
    buildingCharacter(d);
    const t = performance.now();
    buildingCharacter(d);
    const ms = performance.now() - t;
    console.log(`worst case: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1000);
  });
});

describe('buildingCharacter: stars', () => {
  it('nature is the area-weighted average of material naturalness', () => {
    expect(buildingCharacter(design({ thatch: [block(0, 0, 0, 2, 2, 2)] })).nature).toBe(5);
    expect(buildingCharacter(design({ dark: [block(0, 0, 0, 2, 2, 2)] })).nature).toBe(1);
    expect(natureStars({ fiber: 1, mineral: 1 })).toBe(3);
    expect(natureStars({})).toBe(3);
  });
  it('light steps with the visible glass area', () => {
    expect([0, 0.5, 1, 2, 4, 8, 20].map(lightStars)).toEqual([0, 1, 2, 3, 4, 5, 5]);
  });
  it('size steps with the footprint', () => {
    expect([1, 4, 5, 9, 10, 25, 26, 49, 50, 144].map(sizeStars)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });
});

describe('buildingCharacter: thin parts on a wall', () => {
  it('a 1/16 glass pane laid on a wall shows as a window', () => {
    const c = buildingCharacter(design({ white: [block(0, 0, 0, 4, 3, 4)], glass: [{ origin: [16, 16, -1], size: [14, 14, 1] }] }));
    expect(c.glass).toBeGreaterThan(0.5);
    expect(c.light).toBeGreaterThan(0);
  });
  it('a pane inside the wall (not on its surface) still does not count', () => {
    const c = buildingCharacter(design({ white: [block(0, 0, 0, 4, 3, 4)], glass: [{ origin: [16, 16, 8], size: [14, 14, 1] }] }));
    expect(c.glass).toBe(0);
  });
});
