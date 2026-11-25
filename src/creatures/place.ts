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

/** 住人の好きな場所（v0.16）。土地の型は environment.ts の LAND_CODE の番号 */
const HOME: Record<Species, 'water' | 'tree' | number | 'house' | 'high'> = {
  rabbit: 6, deer: 6, fox: 6, sheep: 6, // 草原
  hedgehog: 5, // 花畑
  duck: 'water', otter: 'water',
  squirrel: 'tree', tanuki: 'tree', bear: 'tree',
  beaver: 9, capybara: 9, // 湿地
  serow: 'high', stoat: 8, // 岩場
  mole: 2, // 畑
  cat: 'house',
};
const HIGH = 20;

/**
 * 新しい住人の場所。種類ごとの好きな場所（HOME）の歩ける列から選ぶ。木の近くは半径 6 以内。
 * 好きな場所が見つからなければ、歩ける列のどこか。どこも歩けなければ null。
 * codes：列ごとの土地の型（classifyColumns）。無ければ土地の型で選ぶ種類は、歩ける列のどこか
 */
export function placeResident(w: WorldData, species: Species, rand: () => number = Math.random, treeCols?: ReadonlySet<number>,
  extra: { codes?: Uint8Array; buildingCols?: ReadonlySet<number> } = {}): [number, number] | null {
  const N = w.size;
  const cols = walkableCols(w);
  if (cols.length === 0) return null;
  let prefer: number[] = [];
  const home = HOME[species];
  const codes = extra.codes;
  if (home === 'water') prefer = cols.filter((c) => nearWaterCol(w, c));
  else if (home === 'tree' && treeCols && treeCols.size) {
    const trees = [...treeCols];
    for (let tries = 0; tries < 200 && prefer.length === 0; tries++) {
      const t = trees[Math.floor(rand() * trees.length)];
      const r = restorePlace(w, (t % N) + Math.round((rand() - 0.5) * 8), Math.floor(t / N) + Math.round((rand() - 0.5) * 8));
      if (r && Math.abs(r[0] - (t % N)) + Math.abs(r[1] - Math.floor(t / N)) <= 8) prefer = [r[0] + r[1] * N];
    }
  } else if (home === 'house' && extra.buildingCols?.size) {
    const b = extra.buildingCols;
    const near = (c: number) => { for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) if (b.has(c + dx + dz * N)) return true; return false; };
    prefer = cols.filter(near);
  } else if (home === 'high' && codes) {
    prefer = cols.filter((c) => codes[c] === 8 && w.heights[c] >= HIGH);
    if (!prefer.length) prefer = cols.filter((c) => codes[c] === 8);
  } else if (typeof home === 'number' && codes) {
    prefer = cols.filter((c) => codes[c] === home);
    // 湿地の住人は、泥が無ければ水辺でもよい
    if (!prefer.length && home === 9) prefer = cols.filter((c) => nearWaterCol(w, c));
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
