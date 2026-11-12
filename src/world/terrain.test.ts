import { describe, it, expect } from 'vitest';
import { createWorld, generatePlot, applyEdits, DEFAULT_PARAMS } from './terrain';
import { FRAME } from './plots';

const gen = (order: number[]) => {
  const w = createWorld(64);
  for (const p of order) generatePlot(w, p, 1234, DEFAULT_PARAMS);
  return w;
};
const key = (p: { x: number; z: number; variant: number }) => `${p.x.toFixed(3)},${p.z.toFixed(3)},${p.variant}`;

describe('generatePlot', () => {
  it('is independent of plot order', () => {
    const a = gen([5, 6, 9]), b = gen([9, 6, 5]);
    let same = a.voxels.length === b.voxels.length;
    for (let i = 0; same && i < a.voxels.length; i++) same = a.voxels[i] === b.voxels[i];
    expect(same).toBe(true);
    expect(a.trees.map(key).sort()).toEqual(b.trees.map(key).sort());
    expect(a.flowers.map(key).sort()).toEqual(b.flowers.map(key).sort());
  });
  it('leaves closed plots as air', () => {
    const w = gen([5]);
    // 区画 5（x, z = 64〜127）の外の列は、高さ 0・全部空気・歩けない
    for (const [x, z] of [[0, 0], [63, 64], [128, 100], [100, 128], [255, 255]]) {
      expect(w.heights[x + z * FRAME]).toBe(0);
      expect(w.walkable[x + z * FRAME]).toBe(0);
      for (let y = 0; y < 64; y++) expect(w.voxels[x + z * FRAME + y * FRAME * FRAME]).toBe(0);
    }
    expect(w.plots).toBe(1 << 5);
  });
  it('trees keep spacing across plot seams', () => {
    const w = gen([5, 6]);
    expect(w.trees.length).toBeGreaterThan(10);
    for (const a of w.trees) for (const b of w.trees) {
      if (a === b) continue;
      const d = Math.max(Math.abs(Math.floor(a.x) - Math.floor(b.x)), Math.abs(Math.floor(a.z) - Math.floor(b.z)));
      expect(d).toBeGreaterThan(2);
    }
  });
  it('has a river in the start plot with default params', () => {
    const w = gen([5]);
    let water = 0;
    for (let z = 64; z < 128; z++) for (let x = 64; x < 128; x++) if (w.heights[x + z * FRAME] < w.waterLevel) water++;
    expect(water).toBeGreaterThan(64);
  });
  it('applyEdits ignores closed plots', () => {
    const w = gen([5]);
    applyEdits(w, [0 + 0 * FRAME + 20 * FRAME * FRAME, 3]);
    expect(w.voxels[20 * FRAME * FRAME]).toBe(0);
  });
});
