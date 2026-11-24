import { describe, it, expect } from 'vitest';
import { landWeight, plotLands } from './landPlan';
import { createWorld, generatePlot, DEFAULT_PARAMS, LAND_VERSION } from './terrain';
import { FRAME, PLOT, START_PLOT, plotRect } from './plots';
import { MUD, SAND, STONE } from './blocks';

describe('plotLands', () => {
  it('the first plot is plain, and the other 15 get 4 rock, 4 wetland, 3 beach, 4 plain', () => {
    for (const seed of [1, 42, 1234]) {
      const l = plotLands(seed);
      expect(l[START_PLOT]).toBe('plain');
      const count = (k: string) => l.filter((x, i) => i !== START_PLOT && x === k).length;
      expect([count('rock'), count('wetland'), count('beach'), count('plain')]).toEqual([4, 4, 3, 4]);
    }
  });
  it('is decided by the seed', () => {
    expect(plotLands(42)).toEqual(plotLands(42));
    expect(plotLands(42)).not.toEqual(plotLands(43));
  });
  it('weight is 1 in the middle of the plot and blends only near the edges', () => {
    const lands = plotLands(42);
    const p = lands.findIndex((x) => x === 'rock');
    const r = plotRect(p);
    expect(landWeight(lands, 'rock', r.x0 + PLOT / 2, r.z0 + PLOT / 2)).toBe(1);
    expect(landWeight(lands, 'rock', r.x0 + 20, r.z0 + 20)).toBe(1);
  });
});

/** 区画の中の、地表の種類ごとの割合 */
function tops(seed: number, plot: number, land = LAND_VERSION) {
  const w = createWorld(64);
  generatePlot(w, plot, seed, { ...DEFAULT_PARAMS, land });
  const r = plotRect(plot);
  const n: Record<number, number> = {};
  for (let z = r.z0; z < r.z1; z++) for (let x = r.x0; x < r.x1; x++) {
    const col = x + z * FRAME, h = w.heights[col];
    const t = w.voxels[col + (h - 1) * FRAME * FRAME];
    n[t] = (n[t] ?? 0) + 1;
  }
  return (t: number) => (n[t] ?? 0) / (PLOT * PLOT);
}

describe('land version 2 terrain', () => {
  for (const seed of [1, 42, 1234]) {
    it(`seed ${seed}: rock plots are rocky, wetland plots have mud, beach plots have sand`, () => {
      const lands = plotLands(seed);
      const first = (k: string) => lands.findIndex((x) => x === k);
      expect(tops(seed, first('rock'))(STONE)).toBeGreaterThan(0.15);
      expect(tops(seed, first('wetland'))(MUD)).toBeGreaterThan(0.15);
      expect(tops(seed, first('beach'))(SAND)).toBeGreaterThan(0.15);
    });
  }
  it('version 1 (saves made before v0.13) has no mud at all', () => {
    const lands = plotLands(42);
    expect(tops(42, lands.findIndex((x) => x === 'wetland'), 1)(MUD)).toBe(0);
  });
});

describe('land version 1 stays exactly the same (old saves rebuild the same terrain)', () => {
  it('matches the terrain made by v0.12', () => {
    let h = 0x811c9dc5;
    for (const seed of [1234, 42]) {
      const w = createWorld(64);
      for (let p = 0; p < 16; p++) generatePlot(w, p, seed, { ...DEFAULT_PARAMS, land: 1 });
      for (let i = 0; i < w.voxels.length; i++) { h ^= w.voxels[i]; h = Math.imul(h, 0x01000193) >>> 0; }
      for (const t of [...w.trees, ...w.flowers]) { h ^= Math.round(t.x * 100 + t.z * 7 + t.variant); h = Math.imul(h, 0x01000193) >>> 0; }
      for (let i = 0; i < w.walkable.length; i++) { h ^= w.walkable[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    }
    expect(h.toString(16)).toBe('d1da051c');
  });
});
