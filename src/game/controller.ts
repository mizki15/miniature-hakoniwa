import * as THREE from 'three/webgpu';
import { AIR, DIRT, FARMLAND, GRASS, SAND, WATER, WET_FARMLAND, isOpaque } from '../world/blocks';
import { CHUNK, type MeshData } from '../world/mesher';
import type { WorldData } from '../world/terrain';
import type { ChunkMesh, DetailSet } from '../world/worker';
import { CROPS, Farm, type CropKind } from './farm';
import { buildCropGeometry, buildSaplingGeometry } from './cropModels';
import { raycastVoxels, type VoxelHit } from './picking';

export type Tool = 'look' | 'till' | 'seed' | 'water' | 'harvest' | 'plant' | 'dig' | 'raise';

export const TOOLS: { id: Tool; name: string; icon: string; key: string; help: string }[] = [
  { id: 'look', name: '見る', icon: '👁', key: '1', help: '眺めるだけ。水面をクリックすると波紋' },
  { id: 'till', name: '耕す', icon: '⛏', key: '2', help: '草地や土を耕して畑にする' },
  { id: 'seed', name: '種まき', icon: '🌱', key: '3', help: '畑に種をまく（種は下で選ぶ）' },
  { id: 'water', name: '水やり', icon: '💧', key: '4', help: '畑に水をやる（6 時間、倍の速さで育つ）' },
  { id: 'harvest', name: '収穫', icon: '🧺', key: '5', help: '育ちきった作物を収穫する' },
  { id: 'plant', name: '植林', icon: '🌳', key: '6', help: '苗木を植える（約 1 日で木になる）' },
  { id: 'dig', name: '掘る', icon: '🕳', key: '7', help: 'ブロックを掘る。水のそばを掘ると水が流れ込む' },
  { id: 'raise', name: '土を盛る', icon: '⬆', key: '8', help: '土のブロックを置く' },
];

export function toGeometry(m: MeshData) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(m.color, 3));
  g.setAttribute('ao', new THREE.BufferAttribute(m.ao, 1));
  g.setAttribute('veg', new THREE.BufferAttribute(m.veg, 1));
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  g.computeBoundingSphere();
  return g;
}

interface DecorSet { kind: 'tree' | 'flower'; geo: THREE.BufferGeometry; mat: THREE.Material; placements: Float32Array; mesh: THREE.InstancedMesh | null; shared: boolean; }

export interface ControllerDeps {
  diorama: THREE.Group;
  worker: Worker;
  waterMat: THREE.Material;
  detailMat: THREE.Material;
  flowerMat: THREE.Material;
}

const isFarm = (t: number) => t === FARMLAND || t === WET_FARMLAND;
const HOUR = 3600 * 1000;

export class GameController {
  farm = new Farm();
  tool: Tool = 'look';
  seed: CropKind = 'turnip';
  world: WorldData | null = null;
  /** 生成した状態からの変更（保存は「シード＋この差分」で行う予定） */
  edits = new Map<number, number>();

  private terrainMat: THREE.Material | null = null;
  private typeTex: THREE.Data3DTexture | null = null;
  private chunks = new Map<string, { terrain: THREE.Mesh; water: THREE.Mesh }>();
  private decor: DecorSet[] = [];
  private treeGeos: THREE.BufferGeometry[] = [];
  private treeCols = new Set<number>();
  private farmland = new Set<number>();
  private dirty = new Set<string>();
  private remeshInFlight = false;
  private remeshId = 0;
  private cropMeshes: THREE.InstancedMesh[] = [];
  private cropGeoCache = new Map<string, THREE.BufferGeometry>();
  private saplingGeo = buildSaplingGeometry();
  private growingMeshes: THREE.InstancedMesh[] = [];
  private irrigatedCache = new Map<number, boolean>();
  private wetCheck = 0;
  readonly cursor: THREE.LineSegments;

  constructor(private deps: ControllerDeps) {
    const box = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.04, 1.04, 1.04));
    this.cursor = new THREE.LineSegments(box, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }));
    this.cursor.renderOrder = 10;
    this.cursor.visible = false;
  }

  // ---------- 読み込み ----------

  load(w: WorldData, chunks: ChunkMesh[], details: DetailSet[], flowerPlacements: Float32Array[], lowPolyFlowers: THREE.BufferGeometry[] | null, typeTex: THREE.Data3DTexture, terrainMat: THREE.Material) {
    this.world = w;
    this.typeTex = typeTex;
    this.terrainMat = terrainMat;
    this.farm = new Farm();
    this.edits.clear();
    this.chunks.clear();
    this.farmland.clear();
    this.irrigatedCache.clear();
    this.cropMeshes = [];
    this.growingMeshes = [];
    this.decor = [];
    this.treeCols.clear();
    this.treeGeos = [];
    for (const c of chunks) this.setChunk(c);

    for (const d of details) {
      if (d.kind === 'tree') {
        const geo = toGeometry(d.mesh);
        this.treeGeos[d.variant] = geo;
        this.decor.push({ kind: 'tree', geo, mat: this.deps.detailMat, placements: d.placements, mesh: null, shared: false });
        for (let i = 0; i < d.placements.length; i += 5) this.treeCols.add(Math.floor(d.placements[i]) + Math.floor(d.placements[i + 2]) * w.size);
      } else if (!lowPolyFlowers) {
        this.decor.push({ kind: 'flower', geo: toGeometry(d.mesh), mat: this.deps.flowerMat, placements: d.placements, mesh: null, shared: false });
      }
    }
    if (lowPolyFlowers) flowerPlacements.forEach((p, v) => this.decor.push({ kind: 'flower', geo: lowPolyFlowers[v], mat: this.deps.flowerMat, placements: p, mesh: null, shared: true }));
    for (const d of this.decor) this.buildDecor(d);
    this.deps.diorama.add(this.cursor);
  }

  private chunkKey(cx: number, cz: number) { return `${cx},${cz}`; }

  private setChunk(c: ChunkMesh) {
    const half = this.world!.size / 2;
    const key = this.chunkKey(c.cx, c.cz);
    const old = this.chunks.get(key);
    if (old) {
      for (const m of [old.terrain, old.water]) { this.deps.diorama.remove(m); m.geometry.dispose(); }
    }
    const terrain = new THREE.Mesh(toGeometry(c.terrain), this.terrainMat!);
    terrain.castShadow = terrain.receiveShadow = true;
    terrain.position.set(-half, 0, -half);
    terrain.userData.chunk = key;
    const water = new THREE.Mesh(toGeometry(c.water), this.deps.waterMat);
    water.position.set(-half, 0, -half);
    water.renderOrder = 1;
    this.deps.diorama.add(terrain, water);
    this.chunks.set(key, { terrain, water });
  }

  private buildDecor(d: DecorSet) {
    const w = this.world!;
    const half = w.size / 2;
    if (d.mesh) { this.deps.diorama.remove(d.mesh); d.mesh.dispose(); }
    const count = d.placements.length / 5;
    d.mesh = null;
    if (count === 0) return;
    const im = new THREE.InstancedMesh(d.geo, d.mat, count);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      const [x, y, z, rot, s] = d.placements.subarray(i * 5, i * 5 + 5);
      ps.set(x - half, y, z - half);
      q.setFromAxisAngle(up, rot);
      sc.setScalar(s);
      im.setMatrixAt(i, mtx.compose(ps, q, sc));
    }
    im.castShadow = d.kind === 'tree';
    im.receiveShadow = true;
    im.userData.kind = d.kind;
    im.userData.sharedGeometry = true; // ジオメトリは DecorSet が持つ（作り直しても使い回す）
    d.mesh = im;
    this.deps.diorama.add(im);
  }

  /** その列にある花を取り除く（耕したり掘ったりした時） */
  private removeFlowersAt(x: number, z: number) {
    for (const d of this.decor) {
      if (d.kind !== 'flower') continue;
      const keep: number[] = [];
      let removed = false;
      for (let i = 0; i < d.placements.length; i += 5) {
        if (Math.floor(d.placements[i]) === x && Math.floor(d.placements[i + 2]) === z) { removed = true; continue; }
        for (let k = 0; k < 5; k++) keep.push(d.placements[i + k]);
      }
      if (removed) { d.placements = new Float32Array(keep); this.buildDecor(d); }
    }
  }

  // ---------- 地形の編集 ----------

  private idx(x: number, y: number, z: number) { const N = this.world!.size; return x + z * N + y * N * N; }
  get(x: number, y: number, z: number) {
    const w = this.world!;
    if (x < 0 || z < 0 || y < 0 || x >= w.size || z >= w.size || y >= w.height) return AIR;
    return w.voxels[this.idx(x, y, z)];
  }

  private setVoxel(x: number, y: number, z: number, t: number) {
    const w = this.world!;
    const i = this.idx(x, y, z);
    if (w.voxels[i] === t) return;
    w.voxels[i] = t;
    this.edits.set(i, t);
    // 列の高さと歩けるかどうかを更新
    let h = w.height;
    while (h > 0 && !isOpaque(w.voxels[this.idx(x, h - 1, z)])) h--;
    const col = x + z * w.size;
    w.heights[col] = h;
    const top = h > 0 ? w.voxels[this.idx(x, h - 1, z)] : AIR;
    w.walkable[col] = (top === GRASS || top === SAND || top === DIRT || isFarm(top)) && !this.treeCols.has(col) ? 1 : 0;
    this.typeTex!.needsUpdate = true;
    this.irrigatedCache.clear();
    // このチャンクと、縁なら隣のチャンクも作り直す
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const nc = Math.ceil(w.size / CHUNK);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const ax = x + dx, az = z + dz;
      const ncx = Math.floor(ax / CHUNK), ncz = Math.floor(az / CHUNK);
      if (ncx < 0 || ncz < 0 || ncx >= nc || ncz >= nc) continue;
      if (ncx !== cx || ncz !== cz || (dx === 0 && dz === 0)) this.dirty.add(this.chunkKey(ncx, ncz));
    }
  }

  /** 作り直しが必要なチャンクをワーカーに頼む（1 度に 1 回ずつ） */
  flushRemesh() {
    if (this.remeshInFlight || this.dirty.size === 0 || !this.world) return;
    const w = this.world;
    const chunks = [...this.dirty].map((k) => k.split(',').map(Number) as [number, number]);
    this.dirty.clear();
    this.remeshInFlight = true;
    this.deps.worker.postMessage({ type: 'remesh', id: ++this.remeshId, voxels: w.voxels.slice(), size: w.size, height: w.height, waterLevel: w.waterLevel, chunks });
  }

  onRemesh(chunks: ChunkMesh[]) {
    for (const c of chunks) this.setChunk(c);
    this.remeshInFlight = false;
  }

  /** 掘った穴が水のそばなら、水面の高さまで水を流し込む */
  private flood(sx: number, sy: number, sz: number) {
    const w = this.world!;
    const WL = w.waterLevel;
    if (sy >= WL) return;
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
    const touchesWater = (x: number, y: number, z: number) => dirs.some(([dx, dy, dz]) => this.get(x + dx, y + dy, z + dz) === WATER);
    if (!touchesWater(sx, sy, sz)) return;
    const queue: [number, number, number][] = [[sx, sy, sz]];
    const seen = new Set<number>();
    while (queue.length && seen.size < 600) {
      const [x, y, z] = queue.shift()!;
      const i = this.idx(x, y, z);
      if (seen.has(i)) continue;
      seen.add(i);
      if (this.get(x, y, z) !== AIR || y >= WL) continue;
      this.setVoxel(x, y, z, WATER);
      for (const [dx, dy, dz] of dirs) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (nx < 0 || nz < 0 || ny < 0 || nx >= w.size || nz >= w.size) continue;
        if (Math.abs(nx - sx) > 16 || Math.abs(nz - sz) > 16) continue;
        queue.push([nx, ny, nz]);
      }
    }
  }

  /** 水路のそば（水平に 3 マス以内に水がある）か */
  private irrigated(col: number) {
    const cached = this.irrigatedCache.get(col);
    if (cached !== undefined) return cached;
    const w = this.world!;
    const x = col % w.size, z = Math.floor(col / w.size);
    const h = w.heights[col];
    let wet = false;
    for (let dz = -3; dz <= 3 && !wet; dz++) for (let dx = -3; dx <= 3 && !wet; dx++) {
      for (let y = h - 2; y <= h; y++) if (this.get(x + dx, y, z + dz) === WATER) { wet = true; break; }
    }
    this.irrigatedCache.set(col, wet);
    return wet;
  }

  isWet(col: number) { return this.farm.isWateredNow(col) || this.irrigated(col); }

  // ---------- 道具 ----------

  pick(origin: THREE.Vector3, dir: THREE.Vector3): VoxelHit | null {
    const w = this.world;
    if (!w) return null;
    return raycastVoxels(w.voxels, w.size, w.height, origin, dir, false);
  }

  /** その場所にこの道具が使えるか。使えるなら対象のマス、使えないなら理由 */
  check(hit: VoxelHit | null): { ok: boolean; x: number; y: number; z: number; msg: string } | null {
    const w = this.world;
    if (!w || !hit || this.tool === 'look') return null;
    const { x, y, z } = hit;
    const col = x + z * w.size;
    const t = this.get(x, y, z);
    const topFace = hit.ny === 1;
    const isTop = y === w.heights[col] - 1;
    const res = (ok: boolean, msg: string, tx = x, ty = y, tz = z) => ({ ok, x: tx, y: ty, z: tz, msg });
    switch (this.tool) {
      case 'till':
        if (!topFace || !isTop) return res(false, '地面の上面を選んでください');
        if (this.treeCols.has(col)) return res(false, '木の根元は耕せません');
        if (isFarm(t)) return res(false, 'もう耕してあります');
        if (t !== GRASS && t !== DIRT) return res(false, '草地か土の所だけ耕せます');
        return res(true, '耕す');
      case 'seed': {
        if (!isFarm(t) || !isTop) return res(false, '畑に種をまけます');
        if (this.farm.crops.has(col)) return res(false, 'もう植えてあります');
        return res(true, `${CROPS[this.seed].name}の種をまく`);
      }
      case 'water':
        if (!isFarm(t) || !isTop) return res(false, '畑に水をやれます');
        return res(true, this.farm.isWateredNow(col) ? 'もう湿っています（延長）' : '水をやる');
      case 'harvest': {
        const c = this.farm.crops.get(col);
        if (!c || !isTop) return res(false, '作物がありません');
        if (c.progress < 1) return res(false, `${CROPS[c.kind].name}：育ち具合 ${Math.floor(c.progress * 100)}%`);
        return res(true, `${CROPS[c.kind].name}を収穫`);
      }
      case 'plant': {
        if (!topFace || !isTop) return res(false, '地面の上面を選んでください');
        if (t !== GRASS && t !== DIRT) return res(false, '草地か土の所に植えられます');
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          if (this.treeCols.has(x + dx + (z + dz) * w.size)) return res(false, '近くに木があります');
        }
        return res(true, '苗木を植える');
      }
      case 'dig':
        if (y === 0) return res(false, '一番下は掘れません');
        if (this.treeCols.has(col) && isTop) return res(false, '木の根元は掘れません');
        return res(true, '掘る');
      case 'raise': {
        const tx = x + hit.nx, ty = y + hit.ny, tz = z + hit.nz;
        if (tx < 0 || tz < 0 || tx >= w.size || tz >= w.size || ty >= w.height - 2) return res(false, 'ここには置けません', tx, ty, tz);
        if (this.treeCols.has(tx + tz * w.size)) return res(false, '木があります', tx, ty, tz);
        const there = this.get(tx, ty, tz);
        if (there !== AIR && there !== WATER) return res(false, 'ふさがっています', tx, ty, tz);
        return res(true, '土を盛る', tx, ty, tz);
      }
    }
    return null;
  }

  /**
   * 道具を使う。結果の短いメッセージを返す。
   * visited を渡すと、同じ列には 1 回しか使わない（ドラッグでなぞる時、掘りすぎ・積みすぎを防ぐ）
   */
  use(hit: VoxelHit | null, visited?: Set<number>): string | null {
    const c = this.check(hit);
    if (!c) return null;
    const w = this.world!;
    const { x, y, z } = c;
    const col = x + z * w.size;
    if (visited) {
      if (visited.has(col)) return null;
      visited.add(col);
    }
    if (!c.ok) return c.msg;
    switch (this.tool) {
      case 'till':
        this.removeFlowersAt(x, z);
        this.setVoxel(x, y, z, FARMLAND);
        this.farmland.add(col);
        return '耕しました';
      case 'seed':
        this.farm.plant(col, this.seed);
        this.rebuildCrops();
        return `${CROPS[this.seed].name}の種をまきました`;
      case 'water':
        this.farm.water(col);
        this.setVoxel(x, y, z, WET_FARMLAND);
        return '水をやりました';
      case 'harvest': {
        const kind = this.farm.harvest(col);
        this.rebuildCrops();
        return kind ? `${CROPS[kind].name}を収穫しました` : null;
      }
      case 'plant': {
        this.removeFlowersAt(x, z);
        const variant = y + 1 > 19 ? 4 + Math.floor(Math.random() * 2) : Math.floor(Math.random() * 4);
        this.farm.plantSapling(col, variant, Math.floor(Math.random() * 4) * (Math.PI / 2));
        this.treeCols.add(col);
        w.walkable[col] = 0;
        this.rebuildGrowing();
        return '苗木を植えました';
      }
      case 'dig': {
        const wasTop = y === w.heights[col] - 1;
        if (wasTop) {
          this.removeFlowersAt(x, z);
          if (this.farm.crops.delete(col)) this.rebuildCrops();
          this.farmland.delete(col);
        }
        this.setVoxel(x, y, z, AIR);
        this.flood(x, y, z);
        return '掘りました';
      }
      case 'raise': {
        const prevTop = w.heights[col] - 1;
        if (y > prevTop) {
          this.removeFlowersAt(x, z);
          if (this.farm.crops.delete(col)) this.rebuildCrops();
          if (this.farmland.delete(col)) this.setVoxel(x, prevTop, z, DIRT);
        }
        this.setVoxel(x, y, z, DIRT);
        return '土を盛りました';
      }
    }
    return null;
  }

  /** カーソル（選んでいるマスの枠）を更新する */
  updateCursor(hit: VoxelHit | null): string {
    const c = this.check(hit);
    if (!c || !this.world) { this.cursor.visible = false; return ''; }
    const half = this.world.size / 2;
    this.cursor.visible = true;
    this.cursor.position.set(c.x + 0.5 - half, c.y + 0.5, c.z + 0.5 - half);
    (this.cursor.material as THREE.LineBasicMaterial).color.set(c.ok ? 0xffffff : 0xff6a5a);
    return c.msg;
  }

  // ---------- 作物・苗木の見た目 ----------

  private cropGeo(kind: CropKind, stage: number) {
    const key = `${kind}:${stage}`;
    let g = this.cropGeoCache.get(key);
    if (!g) { g = buildCropGeometry(kind, stage); this.cropGeoCache.set(key, g); }
    return g;
  }

  private rebuildCrops() {
    const w = this.world!;
    const half = w.size / 2;
    for (const m of this.cropMeshes) { this.deps.diorama.remove(m); m.dispose(); }
    this.cropMeshes = [];
    const groups = new Map<string, { kind: CropKind; stage: number; cols: number[] }>();
    for (const c of this.farm.crops.values()) {
      const stage = Farm.stage(c.progress);
      const key = `${c.kind}:${stage}`;
      if (!groups.has(key)) groups.set(key, { kind: c.kind, stage, cols: [] });
      groups.get(key)!.cols.push(c.col);
    }
    const mtx = new THREE.Matrix4();
    for (const g of groups.values()) {
      const im = new THREE.InstancedMesh(this.cropGeo(g.kind, g.stage), this.deps.flowerMat, g.cols.length);
      g.cols.forEach((col, i) => {
        const x = col % w.size, z = Math.floor(col / w.size);
        mtx.makeTranslation(x + 0.5 - half, w.heights[col], z + 0.5 - half);
        im.setMatrixAt(i, mtx);
      });
      im.castShadow = true;
      im.receiveShadow = true;
      im.userData.sharedGeometry = true;
      this.cropMeshes.push(im);
      this.deps.diorama.add(im);
    }
  }

  /** 植えた木：苗木 → 小さな木 → 大きな木 */
  private rebuildGrowing() {
    const w = this.world!;
    const half = w.size / 2;
    for (const m of this.growingMeshes) { this.deps.diorama.remove(m); m.dispose(); }
    this.growingMeshes = [];
    const byGeo = new Map<THREE.BufferGeometry, THREE.Matrix4[]>();
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (const s of this.farm.saplings) {
      const x = s.col % w.size, z = Math.floor(s.col / w.size);
      const pos = new THREE.Vector3(x + 0.5 - half, w.heights[s.col], z + 0.5 - half);
      q.setFromAxisAngle(up, s.rot);
      let geo: THREE.BufferGeometry, scale: number;
      if (s.progress < 0.25) { geo = this.saplingGeo; scale = 1 + s.progress * 2.4; }
      else { geo = this.treeGeos[s.variant] ?? this.saplingGeo; scale = 0.25 + 0.75 * ((s.progress - 0.25) / 0.75); }
      const m = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(scale, scale, scale));
      if (!byGeo.has(geo)) byGeo.set(geo, []);
      byGeo.get(geo)!.push(m);
    }
    for (const [geo, mats] of byGeo) {
      const im = new THREE.InstancedMesh(geo, geo === this.saplingGeo ? this.deps.flowerMat : this.deps.detailMat, mats.length);
      mats.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = true;
      im.receiveShadow = true;
      im.userData.sharedGeometry = true;
      im.userData.kind = 'tree';
      this.growingMeshes.push(im);
      this.deps.diorama.add(im);
    }
  }

  // ---------- 時間の経過 ----------

  /** 毎フレーム呼ぶ。dtReal は現実の経過秒 */
  tick(dtReal: number, env: { season: number; raining: boolean }) {
    if (!this.world) return;
    const changed = this.farm.advance(dtReal * 1000 * this.farm.speed, { ...env, isWet: (col) => this.isWet(col) });
    if (changed) { this.rebuildCrops(); this.rebuildGrowing(); }
    // 畑の湿り具合を見た目（ブロックの種類）に反映（1 秒ごと）
    this.wetCheck -= dtReal;
    if (this.wetCheck <= 0) {
      this.wetCheck = 1;
      const w = this.world;
      for (const col of this.farmland) {
        const x = col % w.size, z = Math.floor(col / w.size), y = w.heights[col] - 1;
        const want = this.isWet(col) || env.raining ? WET_FARMLAND : FARMLAND;
        if (isFarm(this.get(x, y, z)) && this.get(x, y, z) !== want) this.setVoxel(x, y, z, want);
      }
    }
    this.flushRemesh();
  }

  /** 早送り（デバッグ用）：hours 時間ぶん一気に進める */
  skip(hours: number, env: { season: number; raining: boolean }) {
    const steps = Math.ceil(hours * 4); // 15 分ずつ
    for (let i = 0; i < steps; i++) this.farm.advance((hours * HOUR) / steps, { ...env, isWet: (col) => this.isWet(col) });
    this.rebuildCrops();
    this.rebuildGrowing();
    this.wetCheck = 0;
  }

  /** 指した所の作物の列（作物がなければ null） */
  cropColAt(hit: VoxelHit | null): number | null {
    const w = this.world;
    if (!w || !hit) return null;
    const col = hit.x + hit.z * w.size;
    return this.farm.crops.has(col) ? col : null;
  }

  /** 作物の様子（ホバー・固定表示用）。作物がなければ null */
  describeCrop(col: number, env: { season: number; raining: boolean }): { title: string; lines: string[]; progress: number } | null {
    const crop = this.farm.crops.get(col);
    if (!crop) return null;
    const def = CROPS[crop.kind];
    const stageNames = ['芽が出た', '若い', '育ってきた', '収穫できる'];
    const wet = this.farm.isWateredNow(col) ? '水やり済み' : this.irrigated(col) ? '水路のそば（しっとり）' : env.raining ? '雨でしっとり' : '乾いている（水やりで倍の速さ）';
    const lines = [stageNames[Farm.stage(crop.progress)], wet];
    if (crop.progress < 1) {
      const seasonRate = env.season === 3 ? 0 : def.seasons.includes(env.season) ? 1 : 0.35;
      const rate = seasonRate * (this.isWet(col) || env.raining ? 1 : 0.5);
      if (rate === 0) lines.push('冬のあいだは育たない');
      else {
        const mins = Math.ceil(((1 - crop.progress) * def.hours * 60) / rate);
        lines.push(`収穫まで あと約 ${mins >= 60 ? `${Math.floor(mins / 60)}時間${mins % 60}分` : `${mins}分`}`);
      }
      if (!def.seasons.includes(env.season) && env.season !== 3) lines.push('季節外れなのでゆっくり');
    }
    return { title: def.name, lines, progress: crop.progress };
  }

  /** 列の上面の中心（世界座標） */
  colTop(col: number) {
    const w = this.world!;
    const half = w.size / 2;
    return new THREE.Vector3((col % w.size) + 0.5 - half, w.heights[col], Math.floor(col / w.size) + 0.5 - half);
  }

  /** 右パネルに出す情報 */
  summary() {
    const crops = [...this.farm.crops.values()];
    return {
      inventory: this.farm.inventory,
      fields: this.farmland.size,
      growing: crops.filter((c) => c.progress < 1).length,
      ripe: crops.filter((c) => c.progress >= 1).length,
      saplings: this.farm.saplings.filter((s) => s.progress < 1).length,
      edits: this.edits.size,
    };
  }
}
