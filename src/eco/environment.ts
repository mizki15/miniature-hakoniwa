import type { WorldData } from '../world/terrain';
import { GRASS } from '../world/blocks';
import { FRAME } from '../world/plots';

/**
 * 環境の数え方（生き物が来るかどうかの材料）。
 * 毎フレームは数えない：地形を変えた時・区画を開いた時・作物が増減した時にだけ数え直す。
 */
export interface EnvInput {
  world: WorldData;
  /** 花の列（列番号 x + z*FRAME。同じ列に 2 つあれば 2 回） */
  flowerCols: number[];
  treeCols: ReadonlySet<number>;
  farmland: ReadonlySet<number>;
  crops: number;
}

export interface EnvCounts { flowers: number; trees: number; grass: number; waterside: number; deepWater: number; farmland: number; crops: number }

export type Habitat = 'flower' | 'flowerCrop' | 'farm' | 'waterside' | 'deepWater' | 'tree' | 'grassNearWater' | 'flowerOrFarm';

const N = FRAME;
const isWater = (w: WorldData, col: number) => w.heights[col] > 0 && w.heights[col] < w.waterLevel;
const isDeep = (w: WorldData, col: number) => w.heights[col] > 0 && w.heights[col] <= w.waterLevel - 3;
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

export function countEnvironment(i: EnvInput): EnvCounts {
  const w = i.world;
  let grass = 0, waterside = 0, deepWater = 0;
  for (let col = 0; col < N * N; col++) {
    if (w.heights[col] === 0) continue; // 開いていない区画
    if (isGrass(w, col)) grass++;
    if (isDeep(w, col)) deepWater++;
    if (isWaterside(w, col)) waterside++;
  }
  return { flowers: i.flowerCols.length, trees: i.treeCols.size, grass, waterside, deepWater, farmland: i.farmland.size, crops: i.crops };
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
