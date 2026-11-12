/// <reference lib="webworker" />
import { FLOWER_VARIANTS, TREE_VARIANTS, generateWorld, type Placement, type TerrainParams } from './terrain';
import { buildMesh, transformMesh, type MeshData } from './mesher';
import { buildFlowerModel, buildTreeModel } from './details';

export interface GenerateRequest { size: number; height: number; seed: number; detail: number; params: TerrainParams; }

export interface DetailSet {
  kind: 'tree' | 'flower';
  mesh: MeshData;
  /** 1 個あたり [x, y, z, rot, scale]（地面のボクセル座標） */
  placements: Float32Array;
}

const buffersOf = (m: MeshData) => [m.position.buffer, m.normal.buffer, m.color.buffer, m.ao.buffer, m.veg.buffer, m.index.buffer];

const pack = (list: Placement[], variant: number) => {
  const sel = list.filter((p) => p.variant === variant);
  const out = new Float32Array(sel.length * 5);
  sel.forEach((p, i) => out.set([p.x, p.y, p.z, p.rot, p.scale], i * 5));
  return out;
};

self.onmessage = (e: MessageEvent<GenerateRequest>) => {
  const { size, height, seed, detail, params } = e.data;
  const t0 = performance.now();
  const world = generateWorld(size, height, seed, params);
  const t1 = performance.now();
  const grid = { sx: size, sy: height, sz: size, data: world.voxels };
  const terrain = buildMesh(grid, { skipBottom: true });
  const water = buildMesh(grid, { water: true, waterLevel: world.waterLevel, skipBottom: true });
  const t2 = performance.now();

  // 小物（地面の 1/detail の大きさのボクセル）
  const details: DetailSet[] = [];
  for (let v = 0; v < TREE_VARIANTS; v++) {
    const m = buildTreeModel(v, detail);
    const mesh = transformMesh(buildMesh(m.grid), 1 / detail, ...m.offset);
    details.push({ kind: 'tree', mesh, placements: pack(world.trees, v) });
  }
  // ボクセルの花（細かさ 1/3 以上の時だけ作れる）
  for (let v = 0; v < FLOWER_VARIANTS; v++) {
    const m = buildFlowerModel(v, detail);
    if (!m) continue;
    const mesh = transformMesh(buildMesh(m.grid), 1 / detail, ...m.offset);
    details.push({ kind: 'flower', mesh, placements: pack(world.flowers, v) });
  }
  // 花の配置はボクセルの細かさに関係なく渡す（ローポリの花で使う）
  const flowerPlacements = Array.from({ length: FLOWER_VARIANTS }, (_, v) => pack(world.flowers, v));
  const t3 = performance.now();

  const { trees: _t, flowers: _f, ...worldOut } = world;
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(
    {
      world: worldOut, terrain, water, details, flowerPlacements,
      counts: { trees: world.trees.length, flowers: world.flowers.length },
      timings: { generate: t1 - t0, mesh: t2 - t1, details: t3 - t2 },
    },
    [
      world.voxels.buffer, ...buffersOf(terrain), ...buffersOf(water),
      ...details.flatMap((d) => [...buffersOf(d.mesh), d.placements.buffer]),
      ...flowerPlacements.map((p) => p.buffer),
    ],
  );
};
