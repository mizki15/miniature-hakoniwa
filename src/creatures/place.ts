import type { WorldData } from '../world/terrain';
import type { Species } from './animals';

/**
 * 住人をどこに置くか（three.js を使わない。テストできるように）。
 * 列番号は x + z*size（枠の座標）。
 */
const isWater = (w: WorldData, col: number) => w.heights[col] > 0 && w.heights[col] < w.waterLevel;

function walkableCols(w: WorldData): number[] {
  const N = w.size, out: number[] = [];
  for (let z = 4; z < N - 4; z++) for (let x = 4; x < N - 4; x++) if (w.walkable[x + z * N]) out.push(x + z * N);
  return out;
}

const nearWaterCol = (w: WorldData, col: number) => {
  const N = w.size, x = col % N;
  return (x > 0 && isWater(w, col - 1)) || (x < N - 1 && isWater(w, col + 1)) || isWater(w, col - N) || isWater(w, col + N);
};

/**
 * 新しい住人の場所。あひるは水辺、りす・たぬきは木の近く（半径 6）、ほかは歩ける列。
 * 好きな場所が見つからなければ、歩ける列のどこか。どこも歩けなければ null
 */
export function placeResident(w: WorldData, species: Species, rand: () => number = Math.random, treeCols?: ReadonlySet<number>): [number, number] | null {
  const N = w.size;
  const cols = walkableCols(w);
  if (cols.length === 0) return null;
  let prefer: number[] = [];
  if (species === 'duck') prefer = cols.filter((c) => nearWaterCol(w, c));
  else if ((species === 'squirrel' || species === 'tanuki') && treeCols && treeCols.size) {
    const trees = [...treeCols];
    for (let tries = 0; tries < 200 && prefer.length === 0; tries++) {
      const t = trees[Math.floor(rand() * trees.length)];
      const r = restorePlace(w, (t % N) + Math.round((rand() - 0.5) * 8), Math.floor(t / N) + Math.round((rand() - 0.5) * 8));
      if (r && Math.abs(r[0] - (t % N)) + Math.abs(r[1] - Math.floor(t / N)) <= 8) prefer = [r[0] + r[1] * N];
    }
  }
  const pool = prefer.length ? prefer : cols;
  const c = pool[Math.floor(rand() * pool.length)];
  return [c % N, Math.floor(c / N)];
}

/**
 * 保存していた場所に戻す。歩ける列ならそのまま、違えば半径 8 以内で一番近い歩ける列。
 * それも無ければ null（呼ぶ側で placeResident で選び直す）
 */
export function restorePlace(w: WorldData, x: number, z: number): [number, number] | null {
  const N = w.size;
  const ok = (xx: number, zz: number) => xx >= 0 && zz >= 0 && xx < N && zz < N && w.walkable[xx + zz * N] === 1;
  if (ok(x, z)) return [x, z];
  let best: [number, number] | null = null, bestD = Infinity;
  for (let dz = -8; dz <= 8; dz++) for (let dx = -8; dx <= 8; dx++) {
    const d = dx * dx + dz * dz;
    if (d < bestD && d <= 64 && ok(x + dx, z + dz)) { bestD = d; best = [x + dx, z + dz]; }
  }
  return best;
}

/** 住人の名前を選ぶ。今いる住人と重ならない名前を優先する */
export function pickName(names: readonly string[], used: ReadonlySet<string>, rand: () => number = Math.random): string {
  const free = names.filter((n) => !used.has(n));
  const pool = free.length ? free : names;
  return pool[Math.floor(rand() * pool.length)];
}
