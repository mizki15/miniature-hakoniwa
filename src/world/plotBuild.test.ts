import { describe, it, expect } from 'vitest';
import { initWorld, addPlot, applyDelta } from './plotBuild';
import { DEFAULT_PARAMS } from './terrain';
import { FRAME } from './plots';

const init = (gen = 1) => initWorld({ type: 'init', gen, height: 64, seed: 7, detail: 3, params: { ...DEFAULT_PARAMS, land: 2 }, plots: 1 << 6 });

describe('plotBuild', () => {
  it('init meshes only open plots', () => {
    const { result } = init();
    expect(result.chunks.map((c) => `${c.cx},${c.cz}`)).toEqual(['1,1']);
    expect(result.placements.map((p) => p.plot)).toEqual([6]);
  });
  it('addPlot returns new + border chunks and the region', () => {
    const { state } = init();
    const r = addPlot(state, 7, [], 1)!;
    expect(r.chunks.map((c) => `${c.cx},${c.cz}`)).toEqual(['2,1', '1,1']);
    expect(r.voxels.length).toBe(64 * 64 * 64);
    expect(r.heights.length).toBe(64 * 64);
    expect(state.world.plots).toBe((1 << 6) | (1 << 7));
  });
  it('edits sent before addPlot are kept', () => {
    const { state } = init();
    const i = 100 + 100 * FRAME + 30 * FRAME * FRAME;
    applyDelta(state, [i, 3], [], 1);
    addPlot(state, 7, [], 1);
    expect(state.world.voxels[i]).toBe(3);
  });
  it('addPlot applies saved edits inside the new plot', () => {
    const { state } = init();
    const i = 130 + 70 * FRAME + 40 * FRAME * FRAME;
    const r = addPlot(state, 7, [i, 3], 1)!;
    expect(state.world.voxels[i]).toBe(3);
    // 切り出した区画の中でも同じ位置にある（lx + lz*64 + y*64*64）
    expect(r.voxels[(130 - 128) + (70 - 64) * 64 + 40 * 64 * 64]).toBe(3);
  });

  it('addPlot on an already open plot is a no-op', () => {
    const { state } = init();
    const i = 100 + 100 * FRAME + 30 * FRAME * FRAME;
    applyDelta(state, [i, 3], [], 1);
    const trees = state.world.trees.length;
    expect(addPlot(state, 6, [], 1)).toBeNull();
    expect(state.world.voxels[i]).toBe(3);
    expect(state.world.trees.length).toBe(trees);
  });
  it('requests from an older world generation are ignored', () => {
    const { state } = init(2);
    const i = 100 + 100 * FRAME + 30 * FRAME * FRAME;
    const before = state.world.voxels[i];
    expect(applyDelta(state, [i, 3], [[1, 1]], 1)).toBeNull();
    expect(state.world.voxels[i]).toBe(before);
    expect(addPlot(state, 7, [], 1)).toBeNull();
    expect(state.world.plots).toBe(1 << 6);
  });
});
