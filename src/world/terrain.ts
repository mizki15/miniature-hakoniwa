import { hash2, makeNoise2D } from './noise';
import { DIRT, GRASS, MUD, SAND, STONE, WATER, isWalkableTop } from './blocks';
import { DEFAULT_LAND_COUNTS, landWeight, plotLands } from './landPlan';
import { FIELD_SHIFT, FRAME, OLD_FRAME, PLOT, PLOTS_PER_SIDE, isOpen, isOpenCol, plotRect, type Rect } from './plots';

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
  // ---- v0.14 で足した地形のファクター（無い時は標準 = 今までと同じ地形） ----
  lakes?: number; // 湖の多さ
  river?: number; // 川の幅（0 で川なし）
  bare?: number; // 土のむき出しの多さ
  shoreSand?: number; // 岸の砂の多さ
  conifer?: number; // 針葉樹の割合
  // ---- バイオーム（地形の作り方の版 2 の箱庭だけ） ----
  rockPlots?: number; // 岩場の区画の数
  wetPlots?: number; // 湿地の区画の数
  beachPlots?: number; // 砂浜の区画の数
  cliffs?: number; // 岩場の崖の高さ
  wetland?: number; // 湿地の広さ（ならす高さの幅）
  pools?: number; // 湿地の水たまりの多さ
  beachWidth?: number; // 砂浜の広さ
  // ---- 空島（地形の作り方の版 3 の箱庭だけ） ----
  islandEdge?: number; // 縁の削れ方（大きいほど深く削れて、形が揺れる）
  islandDetail?: number; // 縁の細かさ（大きいほど細かく入り組む）
  islandDepth?: number; // 島の底の厚さ
  biomeSize?: number; // 岩場・湿地・砂浜の広がりの大きさ
  /**
   * 地形の作り方の版。1（無い時も）：v0.12 までの作り方。2：区画ごとに岩場・湿地・砂浜が出る（v0.13〜）。
   * 3：空島（開いた土地の縁が削れて宙に浮く。岩場・湿地・砂浜は区画でなくノイズで広がる。試作）。
   * 保存した箱庭は、作った時の版のまま作り直す（差分がずれないように）
   */
  land?: number;
}

/** 新しく作る箱庭の、地形の作り方の版 */
export const LAND_VERSION = 3;

/** 空島の縁までの距離を数える上限（列）。これより内側の列は、隣の区画を開いても変わらない */
export const ISLAND_DMAX = 40;
/** 縁の内側の、水がこぼれないように砂で高くする幅（列） */
const LIP = 4;

/**
 * 列 (x, z)（枠の座標）の中心から、いちばん近い開いていない区画（枠の外も含む）までの距離。上限 ISLAND_DMAX。
 * 開いていない区画の列なら 0
 */
export function islandDist(mask: number, x: number, z: number): number {
  const px = Math.floor(x / PLOT), pz = Math.floor(z / PLOT);
  const cx = x + 0.5, cz = z + 0.5;
  let best = ISLAND_DMAX;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const qx = px + dx, qz = pz + dz;
    const open = qx >= 0 && qz >= 0 && qx < PLOTS_PER_SIDE && qz < PLOTS_PER_SIDE && isOpen(mask, qx + qz * PLOTS_PER_SIDE);
    if (open) continue;
    const x0 = qx * PLOT, z0 = qz * PLOT;
    const ddx = Math.max(x0 - cx, 0, cx - (x0 + PLOT)), ddz = Math.max(z0 - cz, 0, cz - (z0 + PLOT));
    best = Math.min(best, Math.hypot(ddx, ddz));
  }
  return best;
}

/** 地形のパラメータの初期値（「標準に戻す」もこの値） */
export const DEFAULT_PARAMS: TerrainParams = {
  // v0.16.2 で今の値に（それまで：起伏 0.4・山 0.8・水 1・岩場 0.8・森 0.5・花 1.6・湖 1・崖 1・湿地の広さ 1・水たまり 1・砂浜の広さ 1・縁の削れ方 1・縁の細かさ 1・バイオームの大きさ 1）
  relief: 0.2, mountains: 0.2, water: 0.4, rocks: 0.4, forest: 0.9, flowers: 1.4,
  lakes: 0.4, river: 1, bare: 1, shoreSand: 1, conifer: 1,
  rockPlots: DEFAULT_LAND_COUNTS.rock, wetPlots: DEFAULT_LAND_COUNTS.wetland, beachPlots: DEFAULT_LAND_COUNTS.beach,
  cliffs: 0.2, wetland: 0.8, pools: 0.7, beachWidth: 0.7,
  islandEdge: 0.5, islandDetail: 2.6, islandDepth: 1, biomeSize: 0.7,
  land: LAND_VERSION,
};

/** パラメータから区画の土地の型の数（無ければ標準） */
export const landCountsOf = (P: TerrainParams) => ({
  rock: P.rockPlots ?? DEFAULT_LAND_COUNTS.rock, wetland: P.wetPlots ?? DEFAULT_LAND_COUNTS.wetland, beach: P.beachPlots ?? DEFAULT_LAND_COUNTS.beach,
});

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
  const v2 = (P.land ?? 1) >= 2;
  const v3 = (P.land ?? 1) >= 3;
  const lands = plotLands(seed, landCountsOf(P));
  const counts = landCountsOf(P);
  // 版 3：岩場・湿地・砂浜は、区画でなく低い周波数のノイズで広がる（数が多いほど、しきい値が下がって広くなる）
  const nb1 = makeNoise2D(seed + 5101), nb2 = makeNoise2D(seed + 6113), nb3 = makeNoise2D(seed + 7127);
  const bs = 110 * (P.biomeSize ?? 1);
  const biome = (n: (x: number, z: number) => number, count: number, x: number, z: number) => {
    if (count <= 0) return 0;
    const t = 0.6 - (count / 24) * 1.2;
    return smoothstep(t, t + 0.3, n(x / bs, z / bs));
  };
  // v0.14 のファクター（無い時は標準の 1。標準なら今までとまったく同じ式になる）
  const lakes = P.lakes ?? 1, river = P.river ?? 1, bareK = P.bare ?? 1, shoreSand = P.shoreSand ?? 1, coniferK = P.conifer ?? 1;
  const cliffs = P.cliffs ?? 1, wetK = P.wetland ?? 1, pools = P.pools ?? 1, bw = P.beachWidth ?? 1;
  const n5 = makeNoise2D(seed + 4057);
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
    // 区画の土地の型の強さ（版 2 だけ）
    // 区画の土地の型は枠の座標で決まる（x, z は場の座標）
    const wr = v3 ? biome(nb1, counts.rock, x, z) : v2 ? landWeight(lands, 'rock', x + FIELD_SHIFT, z + FIELD_SHIFT) : 0;
    const ww = v3 ? biome(nb2, counts.wetland, x, z) : v2 ? landWeight(lands, 'wetland', x + FIELD_SHIFT, z + FIELD_SHIFT) : 0;
    const wb = v3 ? biome(nb3, counts.beach, x, z) : v2 ? landWeight(lands, 'beach', x + FIELD_SHIFT, z + FIELD_SHIFT) : 0;
    // 砂浜の区画は入り江ができやすい
    const lakeT = 0.35 + (1 - P.water) * 0.25 + (1 - lakes) * 0.2 - wb * 0.3 * bw;
    if (lake > lakeT) h -= (lake - lakeT) * 30;
    // 岩場の区画は岩が突き出て崖になる
    if (wr > 0) h += wr * Math.max(0, n5(x / 16, z / 16)) ** 0.8 * 16 * cliffs;
    // 川：X 方向に蛇行しながら流れる。中心は最初の区画 (1,1) の真ん中の z = 96（水がほぼ無い設定では作らない）
    if (P.water > 0.15 && river > 0) {
      const cz = 96 + Math.sin(x * 0.07 + riverPhase) * 96 * 0.15 + n2(x * 0.03, 5.3) * 128 * 0.08;
      const d = Math.abs(z - cz);
      const rw = Math.max(0.8, (2.2 + 0.8 * Math.sin(x * 0.13 + riverPhase) + 1 + (P.water - 1) * 1.5) * river);
      if (d < rw + 7) h = WL - 2.2 + (h - (WL - 2.2)) * smoothstep(rw, rw + 7, d);
    }
    // 湿地の区画：低い所を水面すれすれにならし、ところどころ浅い水たまり（深さ 1）にする
    let wet = false;
    const wetTop = WL + 2 + 4 * wetK;
    if (ww > 0 && wetK > 0 && h < wetTop) {
      const pool = n5(x / 9 + 70, z / 9) > 0.25 + (1 - pools) * 0.4;
      const target = pool ? WL - 1 : WL;
      const k = ww * smoothstep(wetTop, WL + 2, h);
      h = h * (1 - k) + target * k;
      wet = k > 0.5;
    }
    // 砂浜の区画：水辺の近くを低く平らに（波打ち際が広がる）
    const flat = Math.min(0.9, wb * 0.6 * bw);
    if (wb > 0 && h > WL - 2 && h < WL + 6) h = h * (1 - flat) + (WL + 0.6) * flat;
    h = Math.max(3, Math.min(H - 6, Math.round(h)));
    // 地表の種類：同じ高さでも場所によって砂・土・岩・草が入り混じるようにする
    const beach = n2(x / 12 + 50, z / 12);
    const rocky = n1(x / 18 + 300, z / 18);
    const bare = n3(x / 14 - 200, z / 14);
    let top: number;
    if (wet && h >= WL - 1 && h <= WL + 1) top = MUD; // 湿地の泥（水たまりの底も）
    else if (h - 1 <= WL) top = SAND;
    else if (h - 1 <= WL + 2 + Math.round(wb * 2 * bw) && beach > -0.1 + (1 - shoreSand) * 0.5 - wb * 0.7 * bw) top = SAND; // 砂浜が内陸に入り込む
    else if (h > 34 || rocky > 0.5 + (1 - P.rocks) * 0.3 - wr * 0.75) top = STONE; // 岩場（高い所は岩山）
    else if (bare > 0.55 + (1 - bareK) * 0.3) top = DIRT; // 土がむき出しの所
    else top = GRASS;
    return { h, top };
  };

  // 木の候補（森の中ほど多い）。実際に置くのは、5×5 の範囲の候補でいちばん大きなハッシュ値の列だけ
  // x, z は場の座標。枠の端 2 列には置かない。版 1 は v0.13 までの枠（場の座標 0〜255）の端 2 列にも置かない（同じ地形のまま）
  const candidate = (x: number, z: number, c: Column) => {
    const fx = x + FIELD_SHIFT, fz = z + FIELD_SHIFT;
    if (fx < 2 || fz < 2 || fx >= FRAME - 2 || fz >= FRAME - 2) return false;
    if (!v2 && (x === 0 || x === 1 || z === 0 || z === 1 || x === OLD_FRAME - 2 || x === OLD_FRAME - 1 || z === OLD_FRAME - 2 || z === OLD_FRAME - 1)) return false;
    if (c.top !== GRASS || c.h - 1 <= WL + 1) return false;
    const forest = n3(x / 22, z / 22);
    return hash2(seed, x, z, 10) < (forest > 0.15 ? 0.07 : 0.008) * P.forest;
  };

  // 空島の縁（版 3）：縁までの距離 d が edge より小さい列は空。縁の近くほど底が高い（薄い）
  const ne = makeNoise2D(seed + 8147), nd = makeNoise2D(seed + 9161);
  const edgeK = P.islandEdge ?? 1, es = 28 / Math.max(0.2, P.islandDetail ?? 1), depthK = P.islandDepth ?? 1;
  const edgeFbm = (x: number, z: number) => {
    let a = 0, amp = 1, f = 1, sum = 0;
    for (let o = 0; o < 3; o++) { a += ne((x / es) * f, (z / es) * f) * amp; sum += amp; amp *= 0.5; f *= 2; }
    return a / sum;
  };
  /** 削った後の列（null なら空）。b は底の高さ（これより下は空） */
  const carve = (c: Column, d: number, x: number, z: number): (Column & { b: number }) | null => {
    const edge = Math.min(ISLAND_DMAX - LIP - 2, edgeK * (4 + 10 * (edgeFbm(x, z) * 0.5 + 0.5)));
    if (d < edge) return null;
    let { h, top } = c;
    if (d < edge + LIP && h < WL + 1) { h = WL + 1; top = SAND; }
    const thick = Math.max(2, depthK * (3 + (Math.min(d, ISLAND_DMAX) - edge) * 1.1 + (nd(x / 7, z / 7) * 0.5 + 0.5) * 3));
    const b = Math.max(0, Math.min(h - 2, Math.floor(h - thick)));
    return { h, top, b };
  };

  return { column, candidate, carve, n1, n2, v2, v3, coniferK };
}

const fieldCache = new Map<string, ReturnType<typeof makeField>>();
function fieldFor(seed: number, height: number, params: TerrainParams) {
  const key = `${seed}|${height}|${JSON.stringify(params)}`;
  let f = fieldCache.get(key);
  if (!f) { fieldCache.clear(); f = makeField(seed, height, params); fieldCache.set(key, f); }
  return f;
}

/** 列にボクセルを積む（下から岩・土・地表、水面の高さまでは水）。b より下は空（空島の底） */
function fillColumn(world: World, x: number, z: number, h: number, top: number, b = 0) {
  const NN = FRAME * FRAME, base = x + z * FRAME;
  world.heights[base] = h;
  for (let y = 0; y < b; y++) world.voxels[base + y * NN] = 0;
  for (let y = Math.max(h, world.waterLevel); y < world.height; y++) world.voxels[base + y * NN] = 0;
  for (let y = b; y < h; y++) {
    let t: number;
    if (y < h - 4) t = STONE;
    else if (y < h - 1) t = top === STONE ? STONE : DIRT;
    else t = top;
    world.voxels[base + y * NN] = t;
  }
  for (let y = h; y < world.waterLevel; y++) world.voxels[base + y * NN] = WATER;
}

/** 列を空にする（空島の縁の外） */
function clearColumn(world: World, x: number, z: number) {
  const NN = FRAME * FRAME, base = x + z * FRAME;
  world.heights[base] = 0;
  world.walkable[base] = 0;
  for (let y = 0; y < world.height; y++) world.voxels[base + y * NN] = 0;
}

/**
 * 区画を 1 つ作る：その区画の 64×64 列のボクセル・高さ・歩けるかを書き込み、区画のビットを立てる。
 * その区画の木と花を world.trees / world.flowers に足し、同じものを返す。
 * 版 3 では、開いた区画のマスク（world.plots）で縁を削る
 */
export function generatePlot(world: World, plot: number, seed: number, params: TerrainParams = DEFAULT_PARAMS) {
  world.plots |= 1 << plot;
  return fillArea(world, plotRect(plot), seed, params);
}

/**
 * 区画を開いた後、版 3 の空島で、隣の開いた区画の縁を作り直す（before：開く前のマスク）。
 * 縁が新しい区画の方へ動く列（開く前の縁までの距離が ISLAND_DMAX 未満の列）だけを作り直し、
 * 空だった列に出た木と花だけを足して返す。cols：作り直した列。
 * 版 1・2 では何もしない
 */
export function refillAround(world: World, plot: number, seed: number, params: TerrainParams, before: number) {
  const out = { trees: [] as Placement[], flowers: [] as Placement[], cols: [] as number[] };
  if ((params.land ?? 1) < 3) return out;
  const px = plot % PLOTS_PER_SIDE, pz = Math.floor(plot / PLOTS_PER_SIDE);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const qx = px + dx, qz = pz + dz;
    if ((!dx && !dz) || qx < 0 || qz < 0 || qx >= PLOTS_PER_SIDE || qz >= PLOTS_PER_SIDE) continue;
    const q = qx + qz * PLOTS_PER_SIDE;
    if (!isOpen(world.plots, q)) continue;
    const r = fillArea(world, plotRect(q), seed, params, (x, z) => islandDist(before, x, z) < ISLAND_DMAX, out.cols);
    out.trees.push(...r.trees);
    out.flowers.push(...r.flowers);
  }
  return out;
}

/**
 * 四角の範囲の列を作る。only：作る列（無ければ全部）。版 3 では、空だった列にだけ木と花を足す
 * （空でなかった列の木と花はもうあり、削る前の列で決まるので変わらない）
 */
function fillArea(world: World, r: Rect, seed: number, params: TerrainParams, only?: (x: number, z: number) => boolean, touched?: number[]) {
  const N = FRAME;
  const { column, candidate, carve, n1, n2, v2, v3, coniferK } = fieldFor(seed, world.height, params);
  // ノイズとハッシュは場の座標（枠の座標 − FIELD_SHIFT）で引く。置く位置は枠の座標
  const S = FIELD_SHIFT;
  // 木の判定は 2 列外側まで見るので、少し広い範囲の列を先に計算しておく
  const M = 2, ex0 = r.x0 - M, ez0 = r.z0 - M, ew = r.x1 - r.x0 + M * 2;
  const cols: Column[] = new Array(ew * ew);
  const cand = new Uint8Array(ew * ew);
  for (let z = 0; z < ew; z++) for (let x = 0; x < ew; x++) {
    const c = column(ex0 + x - S, ez0 + z - S);
    cols[x + z * ew] = c;
    cand[x + z * ew] = candidate(ex0 + x - S, ez0 + z - S, c) ? 1 : 0;
  }

  const trees: Placement[] = [];
  const flowers: Placement[] = [];
  for (let z = r.z0; z < r.z1; z++) {
    for (let x = r.x0; x < r.x1; x++) {
      if (only && !only(x, z)) continue;
      const li = x - ex0 + (z - ez0) * ew;
      let { h, top } = cols[li];
      // 作り直しの時、もう地面だった列の木と花はそのまま（足さない）
      const wasGround = only !== undefined && world.heights[x + z * N] > 0;
      touched?.push(x + z * N);
      if (v3) {
        const c = carve(cols[li], islandDist(world.plots, x, z), x - S, z - S);
        if (!c) { clearColumn(world, x, z); continue; }
        ({ h, top } = c);
        fillColumn(world, x, z, h, top, c.b);
      } else fillColumn(world, x, z, h, top);

      const fx = x - S, fz = z - S;
      // 木：まわりの候補より大きなハッシュ値を持つ候補だけ（同じ値なら番号の小さい列を優先）
      let isTree = cand[li] === 1;
      if (isTree) {
        const mine = hash2(seed, fx, fz, 11);
        for (let dz = -2; dz <= 2 && isTree; dz++) for (let dx = -2; dx <= 2; dx++) {
          if ((!dx && !dz) || !cand[li + dx + dz * ew]) continue;
          const other = hash2(seed, fx + dx, fz + dz, 11);
          if (other > mine || (other === mine && dx + dz * N < 0)) { isTree = false; break; }
        }
      }
      if (isTree && !wasGround) {
        // 高い所ほど針葉樹
        const conifer = hash2(seed, fx, fz, 12) < (h > 19 ? 0.75 : 0.15) * coniferK;
        const variant = conifer ? 4 + Math.floor(hash2(seed, fx, fz, 13) * 2) : Math.floor(hash2(seed, fx, fz, 13) * 4);
        trees.push({ variant, x: x + 0.5, y: h, z: z + 0.5, rot: Math.floor(hash2(seed, fx, fz, 14) * 4) * (Math.PI / 2), scale: 0.85 + hash2(seed, fx, fz, 15) * 0.35 });
      }
      // 水面より下の列（湖や川の底）は歩けない
      world.walkable[x + z * N] = isWalkableTop(top) && !isTree && h >= world.waterLevel ? 1 : 0;

      // 花（草地に散らばせる。木の根元は避ける）
      if (wasGround || top !== GRASS || isTree || x < 1 || z < 1 || x >= N - 1 || z >= N - 1) continue;
      if (!v2 && (fx < 1 || fz < 1 || fx >= OLD_FRAME - 1 || fz >= OLD_FRAME - 1)) continue; // 版 1：v0.13 までの枠の端と同じ
      const meadow = n1(fx / 15 + 100, fz / 15);
      if (hash2(seed, fx, fz, 20) > (meadow > 0.2 ? 0.12 : 0.015) * params.flowers) continue;
      const variant = Math.floor((n2(fx / 9, fz / 9) * 0.5 + 0.5) * FLOWER_VARIANTS * 0.999 + hash2(seed, fx, fz, 21) * 0.6) % FLOWER_VARIANTS;
      flowers.push({
        variant, x: x + 0.2 + hash2(seed, fx, fz, 22) * 0.6, y: h, z: z + 0.2 + hash2(seed, fx, fz, 23) * 0.6,
        rot: hash2(seed, fx, fz, 24) * Math.PI * 2, scale: 0.8 + hash2(seed, fx, fz, 25) * 0.4,
      });
    }
  }
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
  /** 地面の表面（生成した時の一番上）より上を変えた列。木の根元は、切ってから掘った時だけ変わる */
  const surfaceCols = new Set<number>();
  for (let i = 0; i + 1 < edits.length; i += 2) {
    const idx = edits[i];
    if (idx < 0 || idx >= world.voxels.length) continue;
    const col = idx % (N * N);
    // 開いていない区画の差分は当てない（その区画を開いた時に当てる）
    if (!isOpenCol(world.plots, col % N, Math.floor(col / N))) continue;
    if (Math.floor(idx / (N * N)) >= world.heights[col] - 1) surfaceCols.add(col);
    world.voxels[idx] = edits[i + 1];
    cols.add(col);
  }
  if (cols.size === 0) return;
  // 切った木の根元を掘った列には、生成した木を戻さない
  world.trees = world.trees.filter((t) => !surfaceCols.has(Math.floor(t.x) + Math.floor(t.z) * N));
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
    world.walkable[col] = isWalkableTop(top) && !treeCols.has(col) && h >= world.waterLevel ? 1 : 0;
  }
  world.flowers = world.flowers.filter((f) => !cols.has(Math.floor(f.x) + Math.floor(f.z) * N));
}
