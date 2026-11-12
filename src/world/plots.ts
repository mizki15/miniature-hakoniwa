/**
 * 区画：256×256 の枠を 64×64 の区画 4×4 に分ける。開いた区画は 16 ビットのマスクで持つ。
 * 区画の番号は px + pz*4（px, pz は 0〜3）。座標はすべて枠の座標（0〜255）。
 */
import { CHUNK } from './mesher';

export const FRAME = 256;
export const PLOT = 64;
export const PLOTS_PER_SIDE = FRAME / PLOT;
/** 最初に開いている区画 (1,1)：4 方向どこへでも広げられる */
export const START_PLOT = 1 + 1 * PLOTS_PER_SIDE;
export const ALL_PLOTS = 0xffff;

export interface Rect { x0: number; z0: number; x1: number; z1: number }

export const plotOfCol = (x: number, z: number) =>
  x < 0 || z < 0 || x >= FRAME || z >= FRAME ? -1 : Math.floor(x / PLOT) + Math.floor(z / PLOT) * PLOTS_PER_SIDE;

export const isOpen = (mask: number, plot: number) => plot >= 0 && plot < 16 && (mask & (1 << plot)) !== 0;

export const isOpenCol = (mask: number, x: number, z: number) => isOpen(mask, plotOfCol(x, z));

export function countOpen(mask: number) {
  let n = 0;
  for (let p = 0; p < 16; p++) if (mask & (1 << p)) n++;
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
  for (let p = 0; p < 16; p++) if (!isOpen(mask, p) && neighbours(p).some((q) => isOpen(mask, q))) out.push(p);
  return out;
}

export const canOpen = (mask: number, plot: number, rightsLeft: number) => rightsLeft > 0 && openable(mask).includes(plot);

export function plotRect(plot: number): Rect {
  const x0 = (plot % PLOTS_PER_SIDE) * PLOT, z0 = Math.floor(plot / PLOTS_PER_SIDE) * PLOT;
  return { x0, z0, x1: x0 + PLOT, z1: z0 + PLOT };
}

/** 開いた区画を囲む四角（枠の座標）。何も開いていなければ枠全体 */
export function boundsOf(mask: number) {
  let x0 = FRAME, z0 = FRAME, x1 = 0, z1 = 0;
  for (let p = 0; p < 16; p++) {
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

export const rightsLeft = (points: number, rightsUsed: number) => Math.max(0, Math.floor(points / 3) - rightsUsed);
