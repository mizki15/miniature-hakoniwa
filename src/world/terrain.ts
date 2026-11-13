import { hash2, makeNoise2D } from './noise';
import { DIRT, GRASS, SAND, STONE, WATER } from './blocks';
import { FRAME, isOpenCol, plotRect } from './plots';

/** 小物（木・花）の配置。地面のボクセル座標で持つ */
export interface Placement {
  variant: number;
  x: number; // 列の中心からのずれを含む（ボクセル単位）
  y: number;
  z: number;
  rot: number; // ラジアン
  scale: number;
}

export interface World {
  size: number; // X・Z 方向のボクセル数（いつも枠の大きさ FRAME）
  height: number; // Y 方向のボクセル数
  waterLevel: number; // 水面の高さ（この高さ未満が水）
  voxels: Uint8Array; // index = x + z*size + y*size*size
  heights: Int16Array; // 列ごとの地表の高さ（固体ボクセルの個数）
  walkable: Uint8Array; // 住人が歩ける列なら 1
  plots: number; // 開いた区画のマスク（plots.ts）
  trees: Placement[];
  flowers: Placement[];
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const TREE_VARIANTS = 6; // 0-3: 広葉樹, 4-5: 針葉樹
export const FLOWER_VARIANTS = 3;
export const WATER_LEVEL = 10;

/** 地形のファクター（どれも 1 が標準。0〜2 程度） */
export interface TerrainParams {
  relief: number; // 起伏の激しさ（細かな丘）
  mountains: number; // 山の高さ（大きな起伏）
  water: number; // 水の多さ（湖・川の幅）
  rocks: number; // 岩場の多さ
  forest: number; // 森の密度
  flowers: number; // 花の密度
}

export const DEFAULT_PARAMS: TerrainParams = { relief: 1, mountains: 1, water: 1, rocks: 1, forest: 1, flowers: 1 };

/** 枠のぶんの空の世界（まだどの区画も開いていない） */
export function createWorld(height: number): World {
  return {
    size: FRAME, height, waterLevel: WATER_LEVEL,
    voxels: new Uint8Array(FRAME * FRAME * height),
    heights: new Int16Array(FRAME * FRAME),
    walkable: new Uint8Array(FRAME * FRAME),
    plots: 0, trees: [], flowers: [],
  };
}

interface Column { h: number; top: number }

/**
 * 地形の「場」：シード値とパラメータから、どの列の高さ・地表・木の候補も座標だけで決まるようにする。
 * こうすると区画をどの順番で作っても、最初から全部作った時と同じ結果になる。
 */
function makeField(seed: number, height: number, P: TerrainParams) {
  const H = height, WL = WATER_LEVEL;
  const n1 = makeNoise2D(seed);
  const n2 = makeNoise2D(seed + 1013);
  const n3 = makeNoise2D(seed + 2027);
  const n4 = makeNoise2D(seed + 3041);
  const riverPhase = hash2(seed, 0, 0, 1) * Math.PI * 2;
  const fbm = (x: number, z: number) => {
    let a = 0, amp = 1, f = 1, sum = 0;
    for (let o = 0; o < 4; o++) { a += n1(x * f, z * f) * amp; sum += amp; amp *= 0.5; f *= 2; }
    return a / sum;
  };

  // 列の高さと地表の種類
  const column = (x: number, z: number): Column => {
    let h = 12.5 + (fbm(x / 48, z / 48) * 7 + Math.max(0, n2(x / 30, z / 30)) * 9) * P.relief;
    // 大きな起伏（広いフィールドで山と谷ができる）
    h += Math.max(0, n4(x / 90, z / 90)) ** 1.3 * 22 * P.mountains;
    // 湖：低周波ノイズの窪地（水が多いほど広く）
    const lake = n3(x / 70 + 40, z / 70 - 20);
    const lakeT = 0.35 + (1 - P.water) * 0.25;
    if (lake > lakeT) h -= (lake - lakeT) * 30;
    // 川：X 方向に蛇行しながら流れる。中心は最初の区画 (1,1) の真ん中の z = 96（水がほぼ無い設定では作らない）
    if (P.water > 0.15) {
      const cz = 96 + Math.sin(x * 0.07 + riverPhase) * 96 * 0.15 + n2(x * 0.03, 5.3) * 128 * 0.08;
      const d = Math.abs(z - cz);
      const rw = Math.max(0.8, 2.2 + 0.8 * Math.sin(x * 0.13 + riverPhase) + 1 + (P.water - 1) * 1.5);
      if (d < rw + 7) h = WL - 2.2 + (h - (WL - 2.2)) * smoothstep(rw, rw + 7, d);
    }
    h = Math.max(3, Math.min(H - 6, Math.round(h)));
    // 地表の種類：同じ高さでも場所によって砂・土・岩・草が入り混じるようにする
    const beach = n2(x / 12 + 50, z / 12);
    const rocky = n1(x / 18 + 300, z / 18);
    const bare = n3(x / 14 - 200, z / 14);
    let top: number;
    if (h - 1 <= WL) top = SAND;
    else if (h - 1 <= WL + 2 && beach > -0.1) top = SAND; // 砂浜が内陸に入り込む
    else if (h > 34 || rocky > 0.5 + (1 - P.rocks) * 0.3) top = STONE; // 岩場（高い所は岩山）
    else if (bare > 0.55) top = DIRT; // 土がむき出しの所
    else top = GRASS;
    return { h, top };
  };

  // 木の候補（森の中ほど多い）。実際に置くのは、5×5 の範囲の候補でいちばん大きなハッシュ値の列だけ
  const candidate = (x: number, z: number, c: Column) => {
    if (x < 2 || z < 2 || x >= FRAME - 2 || z >= FRAME - 2) return false;
    if (c.top !== GRASS || c.h - 1 <= WL + 1) return false;
    const forest = n3(x / 22, z / 22);
    return hash2(seed, x, z, 10) < (forest > 0.15 ? 0.07 : 0.008) * P.forest;
  };

  return { column, candidate, n1, n2 };
}

const fieldCache = new Map<string, ReturnType<typeof makeField>>();
function fieldFor(seed: number, height: number, params: TerrainParams) {
  const key = `${seed}|${height}|${JSON.stringify(params)}`;
  let f = fieldCache.get(key);
  if (!f) { fieldCache.clear(); f = makeField(seed, height, params); fieldCache.set(key, f); }
  return f;
}

/** 列にボクセルを積む（下から岩・土・地表、水面の高さまでは水） */
function fillColumn(world: World, x: number, z: number, h: number, top: number) {
  const NN = FRAME * FRAME, base = x + z * FRAME;
  world.heights[base] = h;
  for (let y = 0; y < h; y++) {
    let t: number;
    if (y < h - 4) t = STONE;
    else if (y < h - 1) t = top === STONE ? STONE : DIRT;
    else t = top;
    world.voxels[base + y * NN] = t;
  }
  for (let y = h; y < world.waterLevel; y++) world.voxels[base + y * NN] = WATER;
}

/**
 * 区画を 1 つ作る：その区画の 64×64 列のボクセル・高さ・歩けるかを書き込み、区画のビットを立てる。
 * その区画の木と花を world.trees / world.flowers に足し、同じものを返す。
 */
export function generatePlot(world: World, plot: number, seed: number, params: TerrainParams = DEFAULT_PARAMS) {
  const N = FRAME;
  const { column, candidate, n1, n2 } = fieldFor(seed, world.height, params);
  const r = plotRect(plot);
  // 木の判定は 2 列外側まで見るので、少し広い範囲の列を先に計算しておく
  const M = 2, ex0 = r.x0 - M, ez0 = r.z0 - M, ew = r.x1 - r.x0 + M * 2;
  const cols: Column[] = new Array(ew * ew);
  const cand = new Uint8Array(ew * ew);
  for (let z = 0; z < ew; z++) for (let x = 0; x < ew; x++) {
    const c = column(ex0 + x, ez0 + z);
    cols[x + z * ew] = c;
    cand[x + z * ew] = candidate(ex0 + x, ez0 + z, c) ? 1 : 0;
  }

  const trees: Placement[] = [];
  const flowers: Placement[] = [];
  for (let z = r.z0; z < r.z1; z++) {
    for (let x = r.x0; x < r.x1; x++) {
      const li = x - ex0 + (z - ez0) * ew;
      const { h, top } = cols[li];
      fillColumn(world, x, z, h, top);

      // 木：まわりの候補より大きなハッシュ値を持つ候補だけ（同じ値なら番号の小さい列を優先）
      let isTree = cand[li] === 1;
      if (isTree) {
        const mine = hash2(seed, x, z, 11);
        for (let dz = -2; dz <= 2 && isTree; dz++) for (let dx = -2; dx <= 2; dx++) {
          if ((!dx && !dz) || !cand[li + dx + dz * ew]) continue;
          const other = hash2(seed, x + dx, z + dz, 11);
          if (other > mine || (other === mine && dx + dz * N < 0)) { isTree = false; break; }
        }
      }
      if (isTree) {
        // 高い所ほど針葉樹
        const conifer = hash2(seed, x, z, 12) < (h > 19 ? 0.75 : 0.15);
        const variant = conifer ? 4 + Math.floor(hash2(seed, x, z, 13) * 2) : Math.floor(hash2(seed, x, z, 13) * 4);
        trees.push({ variant, x: x + 0.5, y: h, z: z + 0.5, rot: Math.floor(hash2(seed, x, z, 14) * 4) * (Math.PI / 2), scale: 0.85 + hash2(seed, x, z, 15) * 0.35 });
      }
      // 水面より下の列（湖や川の底）は歩けない
      world.walkable[x + z * N] = (top === GRASS || top === SAND || top === DIRT) && !isTree && h >= world.waterLevel ? 1 : 0;

      // 花（草地に散らばせる。木の根元は避ける）
      if (top !== GRASS || isTree || x < 1 || z < 1 || x >= N - 1 || z >= N - 1) continue;
      const meadow = n1(x / 15 + 100, z / 15);
      if (hash2(seed, x, z, 20) > (meadow > 0.2 ? 0.12 : 0.015) * params.flowers) continue;
      const variant = Math.floor((n2(x / 9, z / 9) * 0.5 + 0.5) * FLOWER_VARIANTS * 0.999 + hash2(seed, x, z, 21) * 0.6) % FLOWER_VARIANTS;
      flowers.push({
        variant, x: x + 0.2 + hash2(seed, x, z, 22) * 0.6, y: h, z: z + 0.2 + hash2(seed, x, z, 23) * 0.6,
        rot: hash2(seed, x, z, 24) * Math.PI * 2, scale: 0.8 + hash2(seed, x, z, 25) * 0.4,
      });
    }
  }
  world.plots |= 1 << plot;
  world.trees.push(...trees);
  world.flowers.push(...flowers);
  return { trees, flowers };
}

/** メインスレッドに渡す地形データ（小物の配置は別に送る） */
export type WorldData = Omit<World, 'trees' | 'flowers'>;

/**
 * セーブデータの差分（[番号, 種類, ...]）を生成した地形に当てる。開いた区画の中の差分だけを当てる。
 * 変えた列の高さ・歩けるかを直し、その列の花は取り除く（木の列は編集できないので残る）。
 */
export function applyEdits(world: World, edits: number[]) {
  const N = world.size, H = world.height;
  const cols = new Set<number>();
  for (let i = 0; i + 1 < edits.length; i += 2) {
    const idx = edits[i];
    if (idx < 0 || idx >= world.voxels.length) continue;
    const col = idx % (N * N);
    // 開いていない区画の差分は当てない（その区画を開いた時に当てる）
    if (!isOpenCol(world.plots, col % N, Math.floor(col / N))) continue;
    world.voxels[idx] = edits[i + 1];
    cols.add(col);
  }
  if (cols.size === 0) return;
  const treeCols = new Set(world.trees.map((t) => Math.floor(t.x) + Math.floor(t.z) * N));
  for (const col of cols) {
    const x = col % N, z = Math.floor(col / N);
    let h = H;
    while (h > 0) {
      const t = world.voxels[x + z * N + (h - 1) * N * N];
      if (t > 0 && t !== WATER) break;
      h--;
    }
    world.heights[col] = h;
    const top = h > 0 ? world.voxels[x + z * N + (h - 1) * N * N] : 0;
    world.walkable[col] = (top === GRASS || top === SAND || top === DIRT || top === 13 || top === 14) && !treeCols.has(col) && h >= world.waterLevel ? 1 : 0;
  }
  world.flowers = world.flowers.filter((f) => !cols.has(Math.floor(f.x) + Math.floor(f.z) * N));
}
