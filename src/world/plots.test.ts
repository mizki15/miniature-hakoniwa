import { describe, it, expect } from 'vitest';
import * as P from './plots';

describe('plots', () => {
  it('plotOfCol', () => {
    // 5×5 の枠（v0.14〜）：区画の番号は px + pz*5
    expect(P.plotOfCol(64, 64)).toBe(6);
    expect(P.plotOfCol(319, 319)).toBe(24);
    expect(P.plotOfCol(-1, 0)).toBe(-1);
    expect(P.plotOfCol(320, 0)).toBe(-1);
  });
  it('openable from start (the middle plot)', () => {
    expect(P.START_PLOT).toBe(12);
    expect(P.openable(1 << P.START_PLOT)).toEqual([7, 11, 13, 17]);
  });
  it('the whole 5×5 around the start can be opened, and nothing more', () => {
    let m = 1 << P.START_PLOT;
    for (let k = 0; k < 30; k++) for (const p of P.openable(m)) m |= 1 << p;
    expect(m).toBe(P.ALL_PLOTS);
    expect(P.countOpen(m)).toBe(25);
    expect(P.openable(m)).toEqual([]);
  });
  it('canOpen needs 30 discovery points and adjacency', () => {
    const m = 1 << 6;
    expect(P.OPEN_PLOT_POINTS).toBe(30);
    expect(P.canOpen(m, 7, 30)).toBe(true);
    expect(P.canOpen(m, 7, 29)).toBe(false);
    expect(P.canOpen(m, 24, 99)).toBe(false); // 離れている
    expect(P.canOpen(m, 6, 99)).toBe(false); // もう開いている
  });
  it('boundsOf', () => {
    expect(P.boundsOf((1 << 6) | (1 << 7))).toMatchObject({ x0: 64, z0: 64, x1: 192, z1: 128, w: 128, d: 64, cx: 128, cz: 96 });
  });
  it('chunks', () => {
    // チャンクは区画と同じ 64×64（描画するメッシュの数を減らすため）
    expect(P.chunksOfPlot(6)).toEqual([[1, 1]]);
    // 区画 6 が開いていて区画 7 を足す：区画 6 のチャンクを作り直す
    expect(P.borderChunks(1 << 6, 7)).toEqual([[1, 1]]);
    expect(P.borderChunks((1 << 6) | (1 << 12), 7)).toEqual([[1, 1], [2, 2]]);
  });
  it('isOpenCol', () => {
    expect(P.isOpenCol(1 << 6, 100, 100)).toBe(true);
    expect(P.isOpenCol(1 << 6, 10, 100)).toBe(false);
    expect(P.countOpen(0b1011)).toBe(3);
  });
});
