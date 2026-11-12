/// <reference lib="webworker" />
import { FLOWER_VARIANTS, TREE_VARIANTS, applyEdits, generateWorld, type Placement, type TerrainParams } from './terrain';
import { CHUNK, buildChunk, buildMesh, transformMesh, type MeshData } from './mesher';
import { buildFlowerModel, buildTreeModel } from './details';

export interface GenerateRequest { type: 'generate'; size: number; height: number; seed: number; detail: number; params: TerrainParams; edits?: number[]; }
/** 編集したチャンクだけ作り直す。voxels は世界全体のコピー */
export interface RemeshRequest { type: 'remesh'; id: number; voxels: Uint8Array; size: number; height: number; waterLevel: number; chunks: [number, number][]; }

export interface DetailSet {
  kind: 'tree' | 'flower';
  variant: number;
  mesh: MeshData;
  /** 1 個あたり [x, y, z, rot, scale]（地面のボクセル座標） */
  placements: Float32Array;
}

export interface ChunkMesh { cx: number; cz: number; terrain: MeshData; water: MeshData; }

const buffersOf = (m: MeshData) => [m.position.buffer, m.normal.buffer, m.color.buffer, m.ao.buffer, m.veg.buffer, m.index.buffer];
const chunkBuffers = (c: ChunkMesh) => [...buffersOf(c.terrain), ...buffersOf(c.water)];

const pack = (list: Placement[], variant: number) => {
  const sel = list.filter((p) => p.variant === variant);
  const out = new Float32Array(sel.length * 5);
  sel.forEach((p, i) => out.set([p.x, p.y, p.z, p.rot, p.scale], i * 5));
  return out;
};

const post = (msg: unknown, transfer: ArrayBufferLike[]) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer as Transferable[]);

self.onmessage = (e: MessageEvent<GenerateRequest | RemeshRequest>) => {
  const req = e.data;
  if (req.type === 'remesh') {
    const chunks = req.chunks.map(([cx, cz]) => buildChunk(req.voxels, req.size, req.height, cx, cz, req.waterLevel));
    post({ type: 'remesh', id: req.id, chunks }, chunks.flatMap(chunkBuffers));
    return;
  }

  const { size, height, seed, detail, params } = req;
  const t0 = performance.now();
  const world = generateWorld(size, height, seed, params);
  // セーブデータから読み込む時は、変えた所を当ててからメッシュを作る
  if (req.edits?.length) applyEdits(world, req.edits);
  const t1 = performance.now();
  // 地形はチャンクごとに作る（編集した時にその部分だけ作り直せるように）
  const chunks: ChunkMesh[] = [];
  const nc = Math.ceil(size / CHUNK);
  for (let cz = 0; cz < nc; cz++) for (let cx = 0; cx < nc; cx++) chunks.push(buildChunk(world.voxels, size, height, cx, cz, world.waterLevel));
  const t2 = performance.now();

  // 小物（地面の 1/detail の大きさのボクセル）
  const details: DetailSet[] = [];
  for (let v = 0; v < TREE_VARIANTS; v++) {
    const m = buildTreeModel(v, detail);
    const mesh = transformMesh(buildMesh(m.grid), 1 / detail, ...m.offset);
    details.push({ kind: 'tree', variant: v, mesh, placements: pack(world.trees, v) });
  }
  // ボクセルの花（細かさ 1/3 以上の時だけ作れる）
  for (let v = 0; v < FLOWER_VARIANTS; v++) {
    const m = buildFlowerModel(v, detail);
    if (!m) continue;
    const mesh = transformMesh(buildMesh(m.grid), 1 / detail, ...m.offset);
    details.push({ kind: 'flower', variant: v, mesh, placements: pack(world.flowers, v) });
  }
  // 花の配置はボクセルの細かさに関係なく渡す（ローポリの花で使う）
  const flowerPlacements = Array.from({ length: FLOWER_VARIANTS }, (_, v) => pack(world.flowers, v));
  const t3 = performance.now();

  const { trees: _t, flowers: _f, ...worldOut } = world;
  // 地形のボクセルは編集用にメインスレッドへ渡す（こちらには残さない）
  post(
    {
      type: 'generate',
      world: worldOut, chunks, details, flowerPlacements,
      counts: { trees: world.trees.length, flowers: world.flowers.length },
      timings: { generate: t1 - t0, mesh: t2 - t1, details: t3 - t2 },
    },
    [
      world.voxels.buffer, ...chunks.flatMap(chunkBuffers),
      ...details.flatMap((d) => [...buffersOf(d.mesh), d.placements.buffer]),
      ...flowerPlacements.map((p) => p.buffer),
    ],
  );
};
