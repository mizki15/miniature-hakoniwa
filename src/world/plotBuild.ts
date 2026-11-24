/**
 * ワーカーの中身：世界の状態を持ち続け、区画の追加と編集の差分だけを受け取ってメッシュを作る。
 * three.js に頼らない純粋な関数なので、テストから直接呼べる。
 */
import { FLOWER_VARIANTS, TREE_VARIANTS, applyEdits, createWorld, generatePlot, refillAround, type Placement, type TerrainParams, type World, type WorldData } from './terrain';
import { buildChunk, buildMesh, transformMesh, type MeshData } from './mesher';
import { buildFlowerModel, buildTreeModel } from './details';
import { FRAME, PLOT, PLOTS_PER_SIDE, PLOT_COUNT, borderChunks, chunksOfPlot, isOpen, plotOfCol, plotRect, type Rect } from './plots';

export interface ChunkMesh { cx: number; cz: number; terrain: MeshData; water: MeshData; }

/** 木・花の形（種類ごとに 1 度だけ送る） */
export interface DetailModel { kind: 'tree' | 'flower'; variant: number; mesh: MeshData; }

/** 区画ごとの木・花の配置。1 個あたり [x, y, z, rot, scale]（枠のボクセル座標） */
export interface PlotPlacements { plot: number; trees: Float32Array[]; flowers: Float32Array[]; }

/** gen：箱庭を作るたびに増える番号。古い箱庭あての依頼（作り直しの最中に届いたもの）は捨てる */
export interface InitRequest { type: 'init'; gen: number; height: number; seed: number; detail: number; params: TerrainParams; plots: number; edits?: number[]; }
export interface AddPlotRequest { type: 'addPlot'; gen: number; plot: number; edits: number[]; }
export interface RemeshRequest { type: 'remesh'; gen: number; id: number; delta: number[]; chunks: [number, number][]; }
export type WorkerRequest = InitRequest | AddPlotRequest | RemeshRequest;

export interface InitResult {
  type: 'init';
  gen: number;
  world: WorldData;
  chunks: ChunkMesh[];
  models: DetailModel[];
  placements: PlotPlacements[];
  counts: { trees: number; flowers: number };
  timings: { generate: number; mesh: number; details: number };
}

export interface PlotResult {
  type: 'plot';
  gen: number;
  plot: number;
  /** 書き戻す範囲（枠の座標）。版 1・2 は区画だけ、版 3 は隣の縁も作り直すので区画 ±1 区画 */
  rect: Rect;
  /** 範囲のボクセル。番号は lx + lz*W + y*W*D（W, D は範囲の幅と奥行き） */
  voxels: Uint8Array;
  heights: Int16Array;
  walkable: Uint8Array;
  chunks: ChunkMesh[];
  placements: PlotPlacements;
}

export interface RemeshResult { type: 'remesh'; gen: number; id: number; chunks: ChunkMesh[]; }
export type WorkerResult = InitResult | PlotResult | RemeshResult;

export interface BuildState { gen: number; world: World; seed: number; params: TerrainParams; detail: number; }

const meshChunks = (w: World, list: [number, number][]) => list.map(([cx, cz]) => buildChunk(w.voxels, FRAME, w.height, cx, cz, w.waterLevel));

const pack = (list: Placement[], variant: number) => {
  const sel = list.filter((p) => p.variant === variant);
  const out = new Float32Array(sel.length * 5);
  sel.forEach((p, i) => out.set([p.x, p.y, p.z, p.rot, p.scale], i * 5));
  return out;
};

const inPlot = (plot: number) => (p: Placement) => plotOfCol(Math.floor(p.x), Math.floor(p.z)) === plot;

function placementsOf(w: World, plot: number): PlotPlacements {
  return packPlacements(plot, w.trees.filter(inPlot(plot)), w.flowers.filter(inPlot(plot)));
}

function packPlacements(plot: number, trees: Placement[], flowers: Placement[]): PlotPlacements {
  return {
    plot,
    trees: Array.from({ length: TREE_VARIANTS }, (_, v) => pack(trees, v)),
    flowers: Array.from({ length: FLOWER_VARIANTS }, (_, v) => pack(flowers, v)),
  };
}

export function initWorld(req: InitRequest): { state: BuildState; result: InitResult } {
  const t0 = performance.now();
  const world = createWorld(req.height);
  // 空島（版 3）の縁は開いた区画のマスクで決まる。作る順番によらないよう、先に全部の区画のビットを立てる
  world.plots = req.plots;
  const open: number[] = [];
  for (let p = 0; p < PLOT_COUNT; p++) if (req.plots & (1 << p)) { generatePlot(world, p, req.seed, req.params); open.push(p); }
  if (req.edits?.length) applyEdits(world, req.edits);
  const t1 = performance.now();
  const chunks = meshChunks(world, open.flatMap(chunksOfPlot));
  const t2 = performance.now();
  // 小物（地面の 1/detail の大きさのボクセル）。ボクセルの花は細かさ 1/3 以上の時だけ作れる
  const models: DetailModel[] = [];
  for (let v = 0; v < TREE_VARIANTS; v++) {
    const m = buildTreeModel(v, req.detail);
    models.push({ kind: 'tree', variant: v, mesh: transformMesh(buildMesh(m.grid), 1 / req.detail, ...m.offset) });
  }
  for (let v = 0; v < FLOWER_VARIANTS; v++) {
    const m = buildFlowerModel(v, req.detail);
    if (m) models.push({ kind: 'flower', variant: v, mesh: transformMesh(buildMesh(m.grid), 1 / req.detail, ...m.offset) });
  }
  const placements = open.map((p) => placementsOf(world, p));
  const t3 = performance.now();
  const { trees: _t, flowers: _f, ...rest } = world;
  return {
    state: { gen: req.gen, world, seed: req.seed, params: req.params, detail: req.detail },
    result: {
      type: 'init',
      gen: req.gen,
      // ボクセルはメインスレッドでも編集に使う。ワーカーも持ち続けるので複製して送る
      world: { ...rest, voxels: world.voxels.slice(), heights: world.heights.slice(), walkable: world.walkable.slice() },
      chunks, models, placements,
      counts: { trees: world.trees.length, flowers: world.flowers.length },
      timings: { generate: t1 - t0, mesh: t2 - t1, details: t3 - t2 },
    },
  };
}

/**
 * 区画を開く：生成して、その区画の保存済みの差分を当て、新しい区画と境目のチャンクを作る。
 * 古い箱庭あての依頼や、もう開いている区画なら何もしない（null）
 */
export function addPlot(state: BuildState, plot: number, edits: number[], gen: number): PlotResult | null {
  const w = state.world;
  if (gen !== state.gen || (w.plots & (1 << plot)) !== 0) return null;
  const before = w.plots;
  const own = generatePlot(w, plot, state.seed, state.params);
  // 空島（版 3）：隣の区画の縁を作り直す（新しい区画の方へ地面がつながる）
  const around = refillAround(w, plot, state.seed, state.params, before);
  if (edits.length) applyEdits(w, edits);
  const v3 = (state.params.land ?? 1) >= 3;
  let chunkList: [number, number][];
  let r: Rect;
  if (v3) {
    // 新しい区画と、開いている 8 近傍の区画のチャンク。書き戻す範囲は区画 ±1 区画
    const px = plot % PLOTS_PER_SIDE, pz = Math.floor(plot / PLOTS_PER_SIDE);
    chunkList = [...chunksOfPlot(plot)];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const qx = px + dx, qz = pz + dz;
      if ((!dx && !dz) || qx < 0 || qz < 0 || qx >= PLOTS_PER_SIDE || qz >= PLOTS_PER_SIDE || !isOpen(before, qx + qz * PLOTS_PER_SIDE)) continue;
      chunkList.push(...chunksOfPlot(qx + qz * PLOTS_PER_SIDE));
    }
    const pr = plotRect(plot);
    r = { x0: Math.max(0, pr.x0 - PLOT), z0: Math.max(0, pr.z0 - PLOT), x1: Math.min(FRAME, pr.x1 + PLOT), z1: Math.min(FRAME, pr.z1 + PLOT) };
  } else {
    chunkList = [...chunksOfPlot(plot), ...borderChunks(before, plot)];
    r = plotRect(plot);
  }
  const chunks = meshChunks(w, chunkList);
  const H = w.height, NN = FRAME * FRAME, W = r.x1 - r.x0, D = r.z1 - r.z0;
  const voxels = new Uint8Array(W * D * H);
  const heights = new Int16Array(W * D);
  const walkable = new Uint8Array(W * D);
  for (let lz = 0; lz < D; lz++) {
    const row = r.x0 + (r.z0 + lz) * FRAME;
    heights.set(w.heights.subarray(row, row + W), lz * W);
    walkable.set(w.walkable.subarray(row, row + W), lz * W);
    for (let y = 0; y < H; y++) voxels.set(w.voxels.subarray(row + y * NN, row + y * NN + W), lz * W + y * W * D);
  }
  // 小物：新しい区画のぶん（編集で消えたものを除く）と、隣の縁で空だった列に出たぶん
  const alive = new Set([...w.trees, ...w.flowers]);
  const placements = packPlacements(plot, [...own.trees, ...around.trees].filter((p) => alive.has(p)), [...own.flowers, ...around.flowers].filter((p) => alive.has(p)));
  return { type: 'plot', gen, plot, rect: r, voxels, heights, walkable, chunks, placements };
}

/** 編集の差分（[番号, 種類, ...]）をワーカーの世界に当て、指定したチャンクを作り直す。古い箱庭あてなら何もしない（null） */
export function applyDelta(state: BuildState, delta: number[], chunks: [number, number][], gen: number): ChunkMesh[] | null {
  if (gen !== state.gen) return null;
  const v = state.world.voxels;
  for (let i = 0; i + 1 < delta.length; i += 2) if (delta[i] >= 0 && delta[i] < v.length) v[delta[i]] = delta[i + 1];
  return meshChunks(state.world, chunks);
}

const meshBuffers = (m: MeshData) => [m.position.buffer, m.normal.buffer, m.color.buffer, m.ao.buffer, m.veg.buffer, m.index.buffer];
export const chunkBuffers = (c: ChunkMesh) => [...meshBuffers(c.terrain), ...meshBuffers(c.water)];
export const placementBuffers = (p: PlotPlacements) => [...p.trees, ...p.flowers].map((a) => a.buffer);
export const modelBuffers = (m: DetailModel) => meshBuffers(m.mesh);
