/**
 * 区画ごとの土地の型（設計メモ 0 章「岩場・湿地・砂浜の出方：区画ごとにシードで決まる」）。
 * 最初の区画はふつう（森・草原・水）。残りの 15 区画に、岩場 4・湿地 4・砂浜 3・ふつう 4 をシードで並べる。
 * three.js に頼らない（地形の生成とテストと画面から使う）。
 */
import { hash2 } from './noise';
import { PLOT, PLOTS_PER_SIDE, START_PLOT } from './plots';

export type PlotLand = 'plain' | 'rock' | 'wetland' | 'beach';
export const PLOT_LAND_KINDS: PlotLand[] = ['rock', 'wetland', 'beach'];

/** 区画を開く前に見せるアイコンと一言 */
export const PLOT_LAND_INFO: Record<PlotLand, { icon: string; text: string }> = {
  plain: { icon: '🌳', text: '森と草原' },
  rock: { icon: '🪨', text: '岩場が多い' },
  wetland: { icon: '🪷', text: '湿地がある' },
  beach: { icon: '🏖', text: '砂浜がある' },
};

const BAG: PlotLand[] = ['rock', 'rock', 'rock', 'rock', 'wetland', 'wetland', 'wetland', 'wetland', 'beach', 'beach', 'beach', 'plain', 'plain', 'plain', 'plain'];

const cache = new Map<number, PlotLand[]>();
/** 16 区画の土地の型（番号は plots.ts の区画番号） */
export function plotLands(seed: number): PlotLand[] {
  const hit = cache.get(seed);
  if (hit) return hit;
  const bag = [...BAG];
  // シードで決まる並べ替え（Fisher–Yates）
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(hash2(seed, i, 7, 31) * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  const out: PlotLand[] = [];
  for (let p = 0, k = 0; p < PLOTS_PER_SIDE * PLOTS_PER_SIDE; p++) out.push(p === START_PLOT ? 'plain' : bag[k++]);
  if (cache.size > 8) cache.clear();
  cache.set(seed, out);
  return out;
}

const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };

/**
 * 列 (x, z) での、その土地の型の強さ（0〜1）。区画の中心の値を両隣の区画となめらかにつなぐ
 * （区画の境目で地形が急に変わらないように。区画の中ほどではほぼ 1）
 */
export function landWeight(lands: PlotLand[], kind: PlotLand, x: number, z: number): number {
  const fx = Math.min(PLOTS_PER_SIDE - 1, Math.max(0, (x - PLOT / 2) / PLOT));
  const fz = Math.min(PLOTS_PER_SIDE - 1, Math.max(0, (z - PLOT / 2) / PLOT));
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const x1 = Math.min(PLOTS_PER_SIDE - 1, x0 + 1), z1 = Math.min(PLOTS_PER_SIDE - 1, z0 + 1);
  // 境目の近く（区画の端から 1/4）だけでまざるよう、補間の重みを急にする
  const tx = smooth((fx - x0 - 0.25) * 2), tz = smooth((fz - z0 - 0.25) * 2);
  const v = (px: number, pz: number) => (lands[px + pz * PLOTS_PER_SIDE] === kind ? 1 : 0);
  const a = v(x0, z0) * (1 - tx) + v(x1, z0) * tx;
  const b = v(x0, z1) * (1 - tx) + v(x1, z1) * tx;
  return a * (1 - tz) + b * tz;
}
