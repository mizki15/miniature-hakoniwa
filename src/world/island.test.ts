import { describe, it, expect } from 'vitest';
import { initWorld, addPlot } from './plotBuild';
import { DEFAULT_PARAMS } from './terrain';
import { WATER } from './blocks';
import { FRAME, START_PLOT, plotRect } from './plots';

/** 空島（地形の作り方の版 3） */
const P = { ...DEFAULT_PARAMS, land: 3 };
const init = (plots: number, seed = 7) => initWorld({ type: 'init', gen: 1, height: 64, seed, detail: 3, params: P, plots });
const key = (p: { x: number; z: number; variant: number }) => `${p.x.toFixed(3)},${p.z.toFixed(3)},${p.variant}`;
const unpack = (list: Float32Array[]) => list.flatMap((a, variant) => {
  const out: string[] = [];
  for (let i = 0; i < a.length; i += 5) out.push(key({ x: a[i], z: a[i + 2], variant }));
  return out;
});

describe('sky island (land 3)', () => {
  it('opening plots one by one gives the same world as making them all at once', () => {
    for (const seed of [7, 42]) {
      const order = [START_PLOT, START_PLOT + 1, START_PLOT - 5, START_PLOT - 4, START_PLOT + 4];
      const step = init(1 << order[0], seed);
      const trees = unpack(step.result.placements[0].trees), flowers = unpack(step.result.placements[0].flowers);
      let mask = 1 << order[0];
      for (const p of order.slice(1)) {
        const r = addPlot(step.state, p, [], 1)!;
        trees.push(...unpack(r.placements.trees));
        flowers.push(...unpack(r.placements.flowers));
        mask |= 1 << p;
      }
      const all = init(mask, seed);
      const a = step.state.world, b = all.state.world;
      let diff = 0;
      for (let i = 0; i < a.voxels.length; i++) if (a.voxels[i] !== b.voxels[i]) diff++;
      expect(diff, `seed ${seed}`).toBe(0);
      expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
      expect(Array.from(a.walkable)).toEqual(Array.from(b.walkable));
      // 送った小物を足し合わせると、全部作った時と同じ（重なりも抜けもない）
      expect(trees.sort()).toEqual(all.result.placements.flatMap((x) => unpack(x.trees)).sort());
      expect(flowers.sort()).toEqual(all.result.placements.flatMap((x) => unpack(x.flowers)).sort());
    }
  }, 30000);

  it('the edge of a single plot is sky, the middle is ground', () => {
    const w = init(1 << START_PLOT).state.world;
    const r = plotRect(START_PLOT);
    for (let i = 0; i < 64; i++) {
      for (const [x, z] of [[r.x0 + i, r.z0], [r.x0 + i, r.z1 - 1], [r.x0, r.z0 + i], [r.x1 - 1, r.z0 + i]]) expect(w.heights[x + z * FRAME]).toBe(0);
    }
    expect(w.heights[r.x0 + 32 + (r.z0 + 32) * FRAME]).toBeGreaterThan(0);
    // 角は丸い：角の近くの方が、辺の真ん中より多く削れる
    let corner = 0, mid = 0;
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) {
      if (w.heights[r.x0 + i + (r.z0 + j) * FRAME] > 0) corner++;
      if (w.heights[r.x0 + 24 + i + (r.z0 + j) * FRAME] > 0) mid++;
    }
    expect(corner).toBeLessThan(mid);
  });

  it('water never touches the sky (no spill over the edge)', () => {
    for (const seed of [1, 7, 42, 1234]) {
      const w = init((1 << START_PLOT) | (1 << (START_PLOT + 1)) | (1 << (START_PLOT + 5)), seed).state.world;
      const NN = FRAME * FRAME;
      for (let z = 1; z < FRAME - 1; z++) for (let x = 1; x < FRAME - 1; x++) {
        const c = x + z * FRAME;
        if (w.voxels[c + (w.waterLevel - 1) * NN] !== WATER) continue;
        for (const n of [c - 1, c + 1, c - FRAME, c + FRAME]) expect(w.heights[n], `seed ${seed} (${x}, ${z})`).toBeGreaterThan(0);
      }
    }
  });

  it('no trees or flowers float over the sky', () => {
    const { state } = init((1 << START_PLOT) | (1 << (START_PLOT + 1)));
    const w = state.world;
    for (const t of [...w.trees, ...w.flowers]) expect(w.heights[Math.floor(t.x) + Math.floor(t.z) * FRAME]).toBe(t.y);
  });
});
