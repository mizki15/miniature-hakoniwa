/**
 * 区画：320×320 の枠を 64×64 の区画 5×5 に分ける（v0.14〜。それまでは 256×256 の 4×4）。開いた区画は 25 ビットのマスクで持つ。
 * 区画の番号は px + pz*5（px, pz は 0〜4）。座標はすべて枠の座標（0〜319）。
 * 最初の区画は真ん中 (2,2)。開ける土地は、最初の区画を中心にした 5×5 まで。
 */
import { CHUNK } from './mesher';

export const FRAME = 320;
export const PLOT = 64;
export const PLOTS_PER_SIDE = FRAME / PLOT;
export const PLOT_COUNT = PLOTS_PER_SIDE * PLOTS_PER_SIDE;
/** 最初に開いている区画 (2,2)：真ん中から 4 方向へ 2 区画ずつ広げられる */
export const START_PLOT = 2 + 2 * PLOTS_PER_SIDE;
export const ALL_PLOTS = 2 ** PLOT_COUNT - 1;
/**
 * 地形の「場」の座標と枠の座標のずれ（列）。v0.13 までの枠（最初の区画が (1,1)）と同じ地形になるよう、
 * 場の座標 = 枠の座標 − FIELD_SHIFT にする
 */
export const FIELD_SHIFT = PLOT;
/** v0.13 までの枠の大きさ（保存データの移し替えと、版 1 の地形の境目に使う） */
export const OLD_FRAME = 256;

export interface Rect { x0: number; z0: number; x1: number; z1: number }

export const plotOfCol = (x: number, z: number) =>
  x < 0 || z < 0 || x >= FRAME || z >= FRAME ? -1 : Math.floor(x / PLOT) + Math.floor(z / PLOT) * PLOTS_PER_SIDE;

export const isOpen = (mask: number, plot: number) => plot >= 0 && plot < PLOT_COUNT && (mask & (1 << plot)) !== 0;

export const isOpenCol = (mask: number, x: number, z: number) => isOpen(mask, plotOfCol(x, z));

export function countOpen(mask: number) {
  let n = 0;
  for (let p = 0; p < PLOT_COUNT; p++) if (mask & (1 << p)) n++;
  return n;
}

/** 上下左右の隣（枠の外は除く） */
function neighbours(plot: number) {
  const px = plot % PLOTS_PER_SIDE, pz = Math.floor(plot / PLOTS_PER_SIDE);
  const out: number[] = [];
  if (px > 0) out.push(plot - 1);
  if (px < PLOTS_PER_SIDE - 1) out.push(plot + 1);
  if (pz > 0) out.push(plot - PLOTS_PER_SIDE);
  if (pz < PLOTS_PER_SIDE - 1) out.push(plot + PLOTS_PER_SIDE);
  return out;
}

/** 開いた区画に接していて、まだ開いていない区画（昇順） */
export function openable(mask: number): number[] {
  const out: number[] = [];
  for (let p = 0; p < PLOT_COUNT; p++) if (!isOpen(mask, p) && neighbours(p).some((q) => isOpen(mask, q))) out.push(p);
  return out;
}

/** 区画を開くのに使う発見ポイント（v0.14〜。土地の権利をなくし、発見ポイントに一本化した） */
export const OPEN_PLOT_POINTS = 30;

export const canOpen = (mask: number, plot: number, points: number) => points >= OPEN_PLOT_POINTS && openable(mask).includes(plot);

export function plotRect(plot: number): Rect {
  const x0 = (plot % PLOTS_PER_SIDE) * PLOT, z0 = Math.floor(plot / PLOTS_PER_SIDE) * PLOT;
  return { x0, z0, x1: x0 + PLOT, z1: z0 + PLOT };
}

/** 開いた区画を囲む四角（枠の座標）。何も開いていなければ枠全体 */
export function boundsOf(mask: number) {
  let x0 = FRAME, z0 = FRAME, x1 = 0, z1 = 0;
  for (let p = 0; p < PLOT_COUNT; p++) {
    if (!isOpen(mask, p)) continue;
    const r = plotRect(p);
    x0 = Math.min(x0, r.x0); z0 = Math.min(z0, r.z0); x1 = Math.max(x1, r.x1); z1 = Math.max(z1, r.z1);
  }
  if (x1 === 0) { x0 = 0; z0 = 0; x1 = FRAME; z1 = FRAME; }
  return { x0, z0, x1, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 };
}

/** 区画のチャンク（z→x の昇順） */
export function chunksOfPlot(plot: number): [number, number][] {
  const r = plotRect(plot);
  const out: [number, number][] = [];
  for (let z = r.z0; z < r.z1; z += CHUNK) for (let x = r.x0; x < r.x1; x += CHUNK) out.push([x / CHUNK, z / CHUNK]);
  return out;
}

/** 新しい区画に接する、開いた隣の区画のチャンク（左・右・上・下の順） */
export function borderChunks(mask: number, plot: number): [number, number][] {
  const r = plotRect(plot);
  const px = plot % PLOTS_PER_SIDE, pz = Math.floor(plot / PLOTS_PER_SIDE);
  const c0x = r.x0 / CHUNK, c0z = r.z0 / CHUNK, n = PLOT / CHUNK;
  const out: [number, number][] = [];
  const col = (cx: number) => { for (let i = 0; i < n; i++) out.push([cx, c0z + i]); };
  const row = (cz: number) => { for (let i = 0; i < n; i++) out.push([c0x + i, cz]); };
  if (px > 0 && isOpen(mask, plot - 1)) col(c0x - 1);
  if (px < PLOTS_PER_SIDE - 1 && isOpen(mask, plot + 1)) col(c0x + n);
  if (pz > 0 && isOpen(mask, plot - PLOTS_PER_SIDE)) row(c0z - 1);
  if (pz < PLOTS_PER_SIDE - 1 && isOpen(mask, plot + PLOTS_PER_SIDE)) row(c0z + n);
  return out;
}

