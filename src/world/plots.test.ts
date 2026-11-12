import { describe, it, expect } from 'vitest';
import * as P from './plots';

describe('plots', () => {
  it('plotOfCol', () => {
    expect(P.plotOfCol(64, 64)).toBe(5);
    expect(P.plotOfCol(255, 255)).toBe(15);
    expect(P.plotOfCol(-1, 0)).toBe(-1);
    expect(P.plotOfCol(256, 0)).toBe(-1);
  });
  it('openable from start', () => {
    expect(P.openable(1 << P.START_PLOT)).toEqual([1, 4, 6, 9]);
  });
  it('canOpen needs a right and adjacency', () => {
    const m = 1 << 5;
    expect(P.canOpen(m, 6, 1)).toBe(true);
    expect(P.canOpen(m, 6, 0)).toBe(false);
    expect(P.canOpen(m, 15, 1)).toBe(false); // 離れている
    expect(P.canOpen(m, 5, 1)).toBe(false); // もう開いている
  });
  it('boundsOf', () => {
    expect(P.boundsOf((1 << 5) | (1 << 6))).toMatchObject({ x0: 64, z0: 64, x1: 192, z1: 128, w: 128, d: 64, cx: 128, cz: 96 });
  });
  it('chunks', () => {
    // チャンクは区画と同じ 64×64（描画するメッシュの数を減らすため）
    expect(P.chunksOfPlot(5)).toEqual([[1, 1]]);
    // 区画 5 が開いていて区画 6 を足す：区画 5 のチャンクを作り直す
    expect(P.borderChunks(1 << 5, 6)).toEqual([[1, 1]]);
    expect(P.borderChunks((1 << 5) | (1 << 10), 6)).toEqual([[1, 1], [2, 2]]);
  });
  it('rightsLeft', () => {
    expect(P.rightsLeft(7, 1)).toBe(1);
    expect(P.rightsLeft(2, 0)).toBe(0);
  });
  it('isOpenCol', () => {
    expect(P.isOpenCol(1 << 5, 100, 100)).toBe(true);
    expect(P.isOpenCol(1 << 5, 10, 100)).toBe(false);
    expect(P.countOpen(0b1011)).toBe(3);
  });
});
