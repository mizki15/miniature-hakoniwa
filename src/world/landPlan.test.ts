import { describe, it, expect } from 'vitest';
import { V0161_PARAMS } from './testParams';
import { landWeight, plotLands } from './landPlan';
import { createWorld, generatePlot, DEFAULT_PARAMS } from './terrain';
import { FIELD_SHIFT, FRAME, PLOT, PLOT_COUNT, START_PLOT, plotRect } from './plots';
import { MUD, SAND, STONE } from './blocks';

describe('plotLands', () => {
  it('the first plot is plain, and the other 24 get 6 rock, 6 wetland, 5 beach, 7 plain', () => {
    for (const seed of [1, 42, 1234]) {
      const l = plotLands(seed);
      expect(l[START_PLOT]).toBe('plain');
      const count = (k: string) => l.filter((x, i) => i !== START_PLOT && x === k).length;
      expect([count('rock'), count('wetland'), count('beach'), count('plain')]).toEqual([6, 6, 5, 7]);
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
function tops(seed: number, plot: number, land = 2) {
  const w = createWorld(64);
  generatePlot(w, plot, seed, { ...V0161_PARAMS, land });
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
  // v0.13 までの枠（256×256、最初の区画が (1,1)）の範囲を、同じ順に読んで比べる。
  // いまの枠では、その範囲は FIELD_SHIFT だけずれた所にある
  it('matches the terrain made by v0.12 (the old 4×4 frame, shifted by one plot)', () => {
    const S = FIELD_SHIFT, F = FRAME, OLD = 256;
    let h = 0x811c9dc5;
    for (const seed of [1234, 42]) {
      const w = createWorld(64);
      for (let p = 0; p < PLOT_COUNT; p++) { const r = plotRect(p); if (r.x0 >= S && r.z0 >= S && r.x1 <= S + OLD && r.z1 <= S + OLD) generatePlot(w, p, seed, { ...V0161_PARAMS, land: 1 }); }
      for (let y = 0; y < 64; y++) for (let z = 0; z < OLD; z++) for (let x = 0; x < OLD; x++) { h ^= w.voxels[x + S + (z + S) * F + y * F * F]; h = Math.imul(h, 0x01000193) >>> 0; }
      for (const t of [...w.trees, ...w.flowers]) { h ^= Math.round((t.x - S) * 100 + (t.z - S) * 7 + t.variant); h = Math.imul(h, 0x01000193) >>> 0; }
      for (let z = 0; z < OLD; z++) for (let x = 0; x < OLD; x++) { h ^= w.walkable[x + S + (z + S) * F]; h = Math.imul(h, 0x01000193) >>> 0; }
    }
    expect(h.toString(16)).toBe('d1da051c');
  });
});

describe('terrain factors (debug window)', () => {
  it('plot counts can be changed, and are capped at the 24 plots around the start', () => {
    const count = (l: string[], k: string) => l.filter((x, i) => i !== START_PLOT && x === k).length;
    const a = plotLands(42, { rock: 10, wetland: 2, beach: 0 });
    expect([count(a, 'rock'), count(a, 'wetland'), count(a, 'beach'), count(a, 'plain')]).toEqual([10, 2, 0, 12]);
    const b = plotLands(42, { rock: 20, wetland: 20, beach: 20 });
    expect([count(b, 'rock'), count(b, 'wetland'), count(b, 'beach'), count(b, 'plain')]).toEqual([20, 4, 0, 0]);
    expect(b[START_PLOT]).toBe('plain');
  });
  it('each factor changes the terrain, and the default keeps it as it was', () => {
    const lands = plotLands(42);
    const sig = (extra: Record<string, number>, plot = START_PLOT) => {
      const w = createWorld(64);
      generatePlot(w, plot, 42, { ...V0161_PARAMS, land: 2, ...extra });
      let h = 0;
      for (let i = 0; i < w.voxels.length; i += 7) h = (h * 31 + w.voxels[i]) >>> 0;
      return h + ':' + w.trees.map((t) => t.variant).join('');
    };
    const base = sig({});
    expect(sig({ lakes: 1, river: 1, bare: 1, shoreSand: 1, conifer: 1 })).toBe(base);
    for (const k of ['lakes', 'river', 'bare', 'shoreSand', 'conifer']) expect(sig({ [k]: 0 }), k).not.toBe(base);
    const rockPlot = lands.findIndex((x) => x === 'rock'), wetPlot = lands.findIndex((x) => x === 'wetland'), beachPlot = lands.findIndex((x) => x === 'beach');
    expect(sig({ cliffs: 2 }, rockPlot)).not.toBe(sig({}, rockPlot));
    expect(sig({ wetland: 2 }, wetPlot)).not.toBe(sig({}, wetPlot));
    expect(sig({ pools: 2 }, wetPlot)).not.toBe(sig({}, wetPlot));
    expect(sig({ beachWidth: 2 }, beachPlot)).not.toBe(sig({}, beachPlot));
  });
});
