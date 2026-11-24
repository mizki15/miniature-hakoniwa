import type { WorldData } from '../world/terrain';
import { GRASS, isPathBlock } from '../world/blocks';
import { FRAME } from '../world/plots';

/**
 * 環境の数え方（生き物が来るかどうかの材料）。
 * 毎フレームは数えない：地形を変えた時・区画を開いた時・作物が増減した時にだけ数え直す。
 *
 * 開いた区画の列（水面も含む）を、1 列ずつどれか 1 つの土地の型に分ける（設計メモ 10 章）。
 * 先に当てはまったものを取る：水面 → 水辺 → 畑 → 人の手 → 森 → 花畑 → 草原 → そのほか。
 *   水面：水の列（分母には入るが、条件には使わない。深い水だけは別に数える）
 *   水辺：水から 2 列以内（5×5）の、水でない列
 *   畑：耕した列
 *   人の手：道（土の道・石畳）と建物の足元
 *   森：木の根元から 2 列以内（5×5）
 *   花畑：草地で、まわり 3×3 に花のある列が 2 つ以上
 *   草原：残りの草地
 * 深い水（深さ 3 以上）は水辺の中の数で、別に数える。
 */
export interface EnvInput {
  world: WorldData;
  /** 花の列（列番号 x + z*FRAME。同じ列に 2 つあれば 2 回） */
  flowerCols: number[];
  treeCols: ReadonlySet<number>;
  farmland: ReadonlySet<number>;
  crops: number;
  /** 建物の足元の列 */
  buildingCols?: ReadonlySet<number>;
}

/** 割合と上限で条件にする土地の型 */
export type Land = 'forest' | 'meadow' | 'flowerField' | 'farm' | 'waterside' | 'deepWater' | 'human';
export const LANDS: Land[] = ['forest', 'meadow', 'flowerField', 'farm', 'waterside', 'deepWater', 'human'];
export const LAND_NAMES: Record<Land, string> = {
  forest: '森', meadow: '草原', flowerField: '花畑', farm: '畑', waterside: '水辺', deepWater: '深い水', human: '人の手',
};

/** 列の数。ground は開いた区画の列の合計（割合の分母） */
export type EnvCounts = Record<Land, number> & {
  ground: number;
  crops: number;
  /** 野生度（1〜5）。5 がいちばん自然 */
  wild: number;
};

export const emptyEnv = (): EnvCounts => ({ ground: 0, forest: 0, meadow: 0, flowerField: 0, farm: 0, waterside: 0, deepWater: 0, human: 0, crops: 0, wild: 5 });

/** その土地の型が、開いた地面に占める割合（%） */
export const sharePct = (e: EnvCounts, land: Land) => (e.ground > 0 ? (e[land] / e.ground) * 100 : 0);

/**
 * 野生度（星 5 段階）：畑・道・建物の足元が占める割合から決める。
 * 建物の素材の自然らしさは、建物の性格を計算するようになってから足す（v0.12）。
 */
export const WILD_STEPS = [2, 5, 10, 20]; // この % 未満なら ★5・★4・★3・★2、それ以上は ★1
export function wildness(humanPct: number): number {
  const i = WILD_STEPS.findIndex((t) => humanPct < t);
  return i < 0 ? 1 : 5 - i;
}

export type Habitat = 'flower' | 'flowerCrop' | 'farm' | 'waterside' | 'deepWater' | 'tree' | 'grassNearWater' | 'flowerOrFarm';

const N = FRAME;
const isWater = (w: WorldData, col: number) => w.heights[col] > 0 && w.heights[col] < w.waterLevel;
const isDeep = (w: WorldData, col: number) => w.heights[col] > 0 && w.heights[col] <= w.waterLevel - 3;
const topOf = (w: WorldData, col: number) => { const h = w.heights[col]; return h > 0 ? w.voxels[col + (h - 1) * N * N] : 0; };
const isGrass = (w: WorldData, col: number) => {
  const h = w.heights[col];
  return h > 0 && h >= w.waterLevel && w.voxels[col + (h - 1) * N * N] === GRASS;
};
const isWaterside = (w: WorldData, col: number) => {
  if (w.walkable[col] !== 1) return false;
  const x = col % N, z = (col - x) / N;
  return (x > 0 && isWater(w, col - 1)) || (x < N - 1 && isWater(w, col + 1)) || (z > 0 && isWater(w, col - N)) || (z < N - 1 && isWater(w, col + N));
};
const nearWater = (w: WorldData, col: number, r = 4) => {
  const x = col % N, z = (col - x) / N;
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const xx = x + dx, zz = z + dz;
    if (xx >= 0 && zz >= 0 && xx < N && zz < N && isWater(w, xx + zz * N)) return true;
  }
  return false;
};

/** 森の範囲：木の根元から 2 列以内 */
export const FOREST_REACH = 2;
/** 水辺の範囲：水から 2 列以内 */
export const SHORE_REACH = 2;

/** 列ごとの土地の型（0 そのほか・閉じた区画）。テストと、将来の表示に使う */
export type ExclusiveLand = Exclude<Land, 'deepWater'>;
export const LAND_CODE: Record<ExclusiveLand, number> = { waterside: 1, farm: 2, human: 3, forest: 4, flowerField: 5, meadow: 6 };
/** 水面の列の番号（土地の型には数えない） */
export const WATER_CODE = 7;

export function classifyColumns(i: EnvInput): Uint8Array {
  const w = i.world;
  const out = new Uint8Array(N * N);
  const forest = new Uint8Array(N * N);
  for (const c of i.treeCols) {
    const x = c % N, z = (c - x) / N;
    for (let dz = -FOREST_REACH; dz <= FOREST_REACH; dz++) for (let dx = -FOREST_REACH; dx <= FOREST_REACH; dx++) {
      const xx = x + dx, zz = z + dz;
      if (xx >= 0 && zz >= 0 && xx < N && zz < N) forest[xx + zz * N] = 1;
    }
  }
  const shore = new Uint8Array(N * N);
  for (let col = 0; col < N * N; col++) {
    if (!isWater(w, col)) continue;
    const x = col % N, z = (col - x) / N;
    for (let dz = -SHORE_REACH; dz <= SHORE_REACH; dz++) for (let dx = -SHORE_REACH; dx <= SHORE_REACH; dx++) {
      const xx = x + dx, zz = z + dz;
      if (xx >= 0 && zz >= 0 && xx < N && zz < N) shore[xx + zz * N] = 1;
    }
  }
  const flower = new Uint8Array(N * N);
  for (const c of i.flowerCols) flower[c] = 1;
  const flowersAround = (col: number) => {
    const x = col % N, z = (col - x) / N;
    let n = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, zz = z + dz;
      if (xx >= 0 && zz >= 0 && xx < N && zz < N) n += flower[xx + zz * N];
    }
    return n;
  };
  for (let col = 0; col < N * N; col++) {
    if (w.heights[col] === 0) continue; // 開いていない区画
    let code = 0;
    if (isWater(w, col)) code = WATER_CODE;
    else if (shore[col]) code = LAND_CODE.waterside;
    else if (i.farmland.has(col)) code = LAND_CODE.farm;
    else if (i.buildingCols?.has(col) || isPathBlock(topOf(w, col))) code = LAND_CODE.human;
    else if (forest[col]) code = LAND_CODE.forest;
    else if (isGrass(w, col)) code = flowersAround(col) >= 2 ? LAND_CODE.flowerField : LAND_CODE.meadow;
    out[col] = code;
  }
  return out;
}

export function countEnvironment(i: EnvInput): EnvCounts {
  const w = i.world;
  const e = emptyEnv();
  const codes = classifyColumns(i);
  const byCode: ExclusiveLand[] = [];
  for (const l of Object.keys(LAND_CODE) as ExclusiveLand[]) byCode[LAND_CODE[l]] = l;
  for (let col = 0; col < N * N; col++) {
    if (w.heights[col] === 0) continue;
    e.ground++;
    const l = byCode[codes[col]];
    if (l) e[l]++;
    if (isDeep(w, col)) e.deepWater++;
  }
  e.crops = i.crops;
  e.wild = wildness(e.ground ? ((e.farm + e.human) / e.ground) * 100 : 0);
  return e;
}

/** その列が、まだその生き物の場所に合っているか（訪問者が去るかどうかの判定に使う） */
export function fitsHabitat(i: EnvInput, h: Habitat, col: number): boolean {
  const w = i.world;
  if (w.heights[col] === 0) return false;
  switch (h) {
    case 'flower': return i.flowerCols.includes(col);
    case 'farm': return i.farmland.has(col);
    case 'tree': return i.treeCols.has(col);
    case 'flowerCrop':
    case 'flowerOrFarm': return i.flowerCols.includes(col) || i.farmland.has(col);
    case 'waterside': return isWaterside(w, col);
    case 'deepWater': return isDeep(w, col);
    case 'grassNearWater': return isGrass(w, col) && nearWater(w, col);
  }
}

/** 生き物が現れる場所の候補（列番号）。開いた区画の中だけ */
export function habitatCols(i: EnvInput, h: Habitat): number[] {
  const w = i.world;
  const uniq = (a: Iterable<number>) => [...new Set(a)].filter((c) => w.heights[c] > 0);
  switch (h) {
    case 'flower': return uniq(i.flowerCols);
    case 'farm': return uniq(i.farmland);
    case 'tree': return uniq(i.treeCols);
    case 'flowerCrop':
    case 'flowerOrFarm': return uniq([...i.flowerCols, ...i.farmland]);
    default: {
      const out: number[] = [];
      for (let col = 0; col < N * N; col++) {
        if (w.heights[col] === 0) continue;
        if (h === 'waterside' ? isWaterside(w, col) : h === 'deepWater' ? isDeep(w, col) : isGrass(w, col) && col % 2 === 0 && nearWater(w, col)) out.push(col); // 水辺の草地は 1 列おき（半径 4 の水探しを半分に）
      }
      return out;
    }
  }
}
