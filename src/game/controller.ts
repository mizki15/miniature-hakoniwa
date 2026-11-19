import * as THREE from 'three/webgpu';
import { AIR, DIRT, FARMLAND, GRASS, SAND, WATER, WET_FARMLAND, isOpaque } from '../world/blocks';
import { CHUNK, type MeshData } from '../world/mesher';
import type { WorldData } from '../world/terrain';
import type { ChunkMesh, DetailModel, PlotPlacements, PlotResult } from '../world/worker';
import { FRAME, PLOT, plotOfCol, plotRect } from '../world/plots';
import { canSetCol, floodAllowed } from './edgeRules';
import { CROPS, Farm, type Crop, type CropKind, type Sapling } from './farm';
import { UndoStack } from './undoStack';
import { buildCropGeometry, buildSaplingGeometry } from './cropModels';
import { raycastVoxels, type VoxelHit } from './picking';
import type { SaveData } from '../save/format';
import type { BuildingDesign } from '../build/geoParse';
import { buildBuildingMesh } from '../build/geoMesh';
import { canPlace, footprintCols, rayHitPlaced, rotatedBounds, type Rot } from '../build/placement';

export type Tool = 'look' | 'till' | 'seed' | 'water' | 'harvest' | 'plant' | 'dig' | 'raise' | 'build' | 'unbuild';

/** 置いた建物 1 棟 */
interface PlacedBuilding { id: string; x: number; z: number; rot: Rot }

/** 取り消しの記録 1 つ（1 回のなぞり）。voxels：変えたボクセルの番号 → 元の種類 */
interface UndoEntry {
  label: string;
  changed: boolean;
  voxels: Map<number, number>;
  crops: Map<number, Crop>;
  saplings: Sapling[];
  wet: Map<number, number>;
  inventory: Record<string, number>;
  placed: PlacedBuilding[];
  decor: Float32Array[];
  treeCols: Set<number>;
}

export const TOOLS: { id: Tool; name: string; icon: string; key: string; help: string }[] = [
  { id: 'look', name: '見る', icon: '👁', key: '1', help: '眺めるだけ。水面をクリックすると波紋' },
  { id: 'till', name: '耕す', icon: '⛏', key: '2', help: '草地や土を耕して畑にする' },
  { id: 'seed', name: '種まき', icon: '🌱', key: '3', help: '畑に種をまく（種は下で選ぶ）' },
  { id: 'water', name: '水やり', icon: '💧', key: '4', help: '畑に水をやる（6 時間、倍の速さで育つ）' },
  { id: 'harvest', name: '収穫', icon: '🧺', key: '5', help: '育ちきった作物を収穫する' },
  { id: 'plant', name: '植林', icon: '🌳', key: '6', help: '苗木を植える（約 1 日で木になる）' },
  { id: 'dig', name: '掘る', icon: '🕳', key: '7', help: 'ブロックを掘る。水のそばを掘ると水が流れ込む' },
  { id: 'raise', name: '土を盛る', icon: '⬆', key: '8', help: '土のブロックを置く' },
  { id: 'build', name: '建物を置く', icon: '🏠', key: '9', help: '棚で選んだ建物を地面に置く（R で向きを変える）' },
  { id: 'unbuild', name: '片付ける', icon: '🧹', key: '0', help: '置いた建物を取り除く（棚には残る）' },
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

interface DecorSet { kind: 'tree' | 'flower'; variant: number; geo: THREE.BufferGeometry; mat: THREE.Material; placements: Float32Array; mesh: THREE.InstancedMesh | null; shared: boolean; }

export interface ControllerDeps {
  diorama: THREE.Group;
  worker: Worker;
  waterMat: THREE.Material;
  detailMat: THREE.Material;
  flowerMat: THREE.Material;
  /** 建物（風で揺れない） */
  buildingMat: THREE.Material;
}

const isFarm = (t: number) => t === FARMLAND || t === WET_FARMLAND;
const HOUR = 3600 * 1000;
/** 区画を開いた時に、どれだけ下からせり上がるか（ボクセル）と、かかる秒数 */
const RISE_DEPTH = 6;
const RISE_SECONDS = 0.6;

export class GameController {
  /** 建物の棚（id → 建物） */
  designs = new Map<string, BuildingDesign>();
  /** 棚で選んでいる建物 */
  selectedDesign: string | null = null;
  /** 次に置く建物の向き */
  buildRot: Rot = 0;
  private placed: PlacedBuilding[] = [];
  private buildingMeshes: THREE.InstancedMesh[] = [];
  private buildingGeos = new Map<string, THREE.BufferGeometry>();
  /** 最後に pick() に渡した光線（建物を片付ける時の当たりに使う） */
  private lastRay: { origin: [number, number, number]; dir: [number, number, number] } | null = null;
  farm = new Farm();
  tool: Tool = 'look';
  seed: CropKind = 'turnip';
  world: WorldData | null = null;
  /** 生成した状態からの変更（保存は「シード＋この差分」で行う） */
  edits = new Map<number, number>();
  /** 前回の保存から変わったか（道具を使った時に立てる） */
  unsaved = false;

  private terrainMat: THREE.Material | null = null;
  private typeTex: THREE.Data3DTexture | null = null;
  private chunks = new Map<string, { terrain: THREE.Mesh; water: THREE.Mesh }>();
  private decor: DecorSet[] = [];
  private treeGeos: THREE.BufferGeometry[] = [];
  private treeCols = new Set<number>();
  private farmland = new Set<number>();
  private dirty = new Set<string>();
  /** 今の箱庭の番号（ワーカーへの依頼に付ける）。main が箱庭を作るたびに設定する */
  gen = 0;
  /** 箱庭を作り直している間は編集しない（古い箱庭への編集がワーカーの新しい箱庭に混ざらないように） */
  locked = false;
  private remeshInFlight = false;
  private remeshId = 0;
  private cropMeshes: THREE.InstancedMesh[] = [];
  private cropGeoCache = new Map<string, THREE.BufferGeometry>();
  private saplingGeo = buildSaplingGeometry();
  private growingMeshes: THREE.InstancedMesh[] = [];
  private irrigatedCache = new Map<number, boolean>();
  private wetCheck = 0;
  private flowerGeos: THREE.BufferGeometry[] = [];
  private flowerShared = false;
  /** ワーカーにまだ送っていない編集（[番号, 種類, ...]） */
  private delta: number[] = [];
  /** 開いたばかりの区画のせり上がり（t: 0→1） */
  private rising: { objs: THREE.Object3D[]; t: number; done?: () => void }[] = [];
  readonly cursor: THREE.LineSegments;
  /** 「建物を置く」の時の、少し透かした建物の見本。置ける時は元の色、置けない時は赤みを帯びる */
  readonly ghost: THREE.Mesh;
  private ghostMat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, roughness: 0.85, metalness: 0 });
  /** 今のカーソルで見本を出してよいか（updateCursor が決め、syncGhost がカーソルの表示に合わせる） */
  private ghostWanted = false;

  constructor(private deps: ControllerDeps) {
    const box = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.04, 1.04, 1.04));
    this.cursor = new THREE.LineSegments(box, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }));
    this.cursor.renderOrder = 10;
    this.cursor.visible = false;
    this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), this.ghostMat);
    this.ghost.renderOrder = 9;
    this.ghost.visible = false;
  }

  /** 見本はカーソルと一緒に出し入れする（main が毎フレーム呼ぶ。カーソルを消す所が多いので、ここでまとめて合わせる） */
  syncGhost() { this.ghost.visible = this.ghostWanted && this.cursor.visible && this.tool === 'build'; }

  // ---------- 読み込み ----------

  load(w: WorldData, chunks: ChunkMesh[], models: DetailModel[], placements: PlotPlacements[], lowPolyFlowers: THREE.BufferGeometry[] | null, typeTex: THREE.Data3DTexture, terrainMat: THREE.Material) {
    this.world = w;
    this.typeTex = typeTex;
    this.terrainMat = terrainMat;
    this.farm = new Farm();
    this.dirty.clear();
    this.remeshInFlight = false;
    this.edits.clear();
    this.chunks.clear();
    this.farmland.clear();
    this.irrigatedCache.clear();
    this.cropMeshes = [];
    this.growingMeshes = [];
    this.decor = [];
    this.treeCols.clear();
    this.treeGeos = [];
    this.flowerGeos = [];
    this.delta = [];
    this.rising = [];
    // 置いた建物は箱庭ごと。棚（designs）は新しい箱庭にも持ち越す
    this.placed = [];
    this.buildingMeshes = [];
    // 取り消しの記録は箱庭ごと
    this.undo.clear();
    this.recording = null;
    for (const c of chunks) this.setChunk(c);

    // 木・花の形は種類ごとに 1 つ。ローポリの花はボクセルの花が作れない 1/1 でも使う
    for (const m of models) {
      if (m.kind === 'tree') this.treeGeos[m.variant] = toGeometry(m.mesh);
      else if (!lowPolyFlowers) this.flowerGeos[m.variant] = toGeometry(m.mesh);
    }
    this.flowerShared = !!lowPolyFlowers;
    if (lowPolyFlowers) this.flowerGeos = lowPolyFlowers;
    for (const p of placements) { this.addTreeCols(p); this.addDecor(p); }
    this.deps.diorama.add(this.cursor);
    this.deps.diorama.add(this.ghost);
  }

  /**
   * 区画の木・花を足す。InstancedMesh は種類ごとに 1 つ（全部の区画をまとめる）。
   * 区画ごとに分けると画面外を描かずに済むが、描画命令が増えてかえって重くなったため（16 区画で 144 → 9）。
   */
  /** 木の根元の列を覚える（耕す・掘るの判定、歩けるか）。見た目より先に、区画を開いた時点ですぐ効かせる */
  private addTreeCols(p: PlotPlacements) {
    const w = this.world!;
    for (const pl of p.trees) for (let i = 0; i < pl.length; i += 5) this.treeCols.add(Math.floor(pl[i]) + Math.floor(pl[i + 2]) * w.size);
  }

  private addDecor(p: PlotPlacements) {
    const add = (kind: 'tree' | 'flower', v: number, pl: Float32Array, geo: THREE.BufferGeometry | undefined, mat: THREE.Material, shared: boolean) => {
      if (!geo) return;
      let d = this.decor.find((x) => x.kind === kind && x.variant === v);
      if (!d) { d = { kind, variant: v, geo, mat, placements: new Float32Array(0), mesh: null, shared }; this.decor.push(d); }
      if (pl.length === 0 && d.mesh) return;
      const merged = new Float32Array(d.placements.length + pl.length);
      merged.set(d.placements);
      merged.set(pl, d.placements.length);
      d.placements = merged;
      this.buildDecor(d);
    };
    p.trees.forEach((pl, v) => add('tree', v, pl, this.treeGeos[v], this.deps.detailMat, false));
    p.flowers.forEach((pl, v) => add('flower', v, pl, this.flowerGeos[v], this.deps.flowerMat, this.flowerShared));
  }

  /**
   * 区画を開いた結果（ワーカーの返事）を当てる：ボクセル・高さ・歩けるかを書き戻し、
   * 新しい区画と境目のチャンク、その区画の木・花を足す。新しい区画は下からせり上がる。
   */
  addPlot(r: PlotResult) {
    const w = this.world!;
    const rect = plotRect(r.plot), H = w.height, NN = FRAME * FRAME;
    for (let lz = 0; lz < PLOT; lz++) {
      const row = rect.x0 + (rect.z0 + lz) * FRAME;
      w.heights.set(r.heights.subarray(lz * PLOT, lz * PLOT + PLOT), row);
      w.walkable.set(r.walkable.subarray(lz * PLOT, lz * PLOT + PLOT), row);
      for (let y = 0; y < H; y++) w.voxels.set(r.voxels.subarray(lz * PLOT + y * PLOT * PLOT, lz * PLOT + y * PLOT * PLOT + PLOT), row + y * NN);
    }
    w.plots |= 1 << r.plot;
    this.typeTex!.needsUpdate = true;
    this.irrigatedCache.clear();
    const risers: THREE.Object3D[] = [];
    for (const c of r.chunks) {
      const isNew = plotOfCol(c.cx * CHUNK, c.cz * CHUNK) === r.plot;
      const m = this.setChunk(c);
      if (isNew) risers.push(m.terrain, m.water);
    }
    for (const o of risers) o.position.y = -RISE_DEPTH;
    this.addTreeCols(r.placements);
    // 木と花は、地面がせり上がりきってから置く（全部の区画で 1 つの InstancedMesh なので一緒には動かせない）
    this.rising.push({ objs: risers, t: 0, done: () => { this.addDecor(r.placements); this.onEnvChanged?.(); this.onPlotRisen?.(); } });
    this.onPlotsChanged?.();
  }

  /** 区画が増えた時に呼ぶ（main が台座・カメラの範囲などを直す） */
  onPlotsChanged: (() => void) | null = null;
  /** 環境（花・木・畑・作物・地形）が変わったかもしれない時に呼ぶ（main が環境の数を数え直す印を付ける） */
  onEnvChanged: (() => void) | null = null;

  /** 環境を数えるための材料（花の列・木の列・畑・作物の数） */
  envInput() {
    const N = this.world!.size;
    const flowerCols: number[] = [];
    for (const d of this.decor) {
      if (d.kind !== 'flower') continue;
      for (let i = 0; i < d.placements.length; i += 5) flowerCols.push(Math.floor(d.placements[i]) + Math.floor(d.placements[i + 2]) * N);
    }
    return { flowerCols, treeCols: this.treeCols as ReadonlySet<number>, farmland: this.farmland as ReadonlySet<number>, crops: this.farm.crops.size };
  }

  /**
   * その列に立っている木の形（鳥がとまる位置に使う）。ground：根元の高さ、top：てっぺん、radius：葉の広がり、trunk：幹の太さ（半径）。
   * 木が無い・まだ小さい苗木なら null
   */
  treeShape(col: number): { ground: number; top: number; radius: number; trunk: number } | null {
    const N = this.world!.size;
    const shape = (variant: number, ground: number, s: number) => {
      const geo = this.treeGeos[variant];
      if (!geo) return null;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const b = geo.boundingBox!;
      return { ground, top: ground + b.max.y * s, radius: b.max.x * s, trunk: 0.65 * s };
    };
    for (const d of this.decor) {
      if (d.kind !== 'tree') continue;
      for (let i = 0; i < d.placements.length; i += 5) {
        if (Math.floor(d.placements[i]) + Math.floor(d.placements[i + 2]) * N === col) return shape(d.variant, d.placements[i + 1], d.placements[i + 4]);
      }
    }
    // 植えて育った木（半分以上育ったものだけ）
    const sp = this.farm.saplings.find((x) => x.col === col);
    if (sp && sp.progress >= 0.6) return shape(sp.variant, this.world!.heights[col], 0.25 + 0.75 * ((sp.progress - 0.25) / 0.75));
    return null;
  }

  /** せり上がっている途中の区画があるか */
  isRising() { return this.rising.some((r) => r.t < 1); }
  /** 開いた区画がせり上がりきった時に呼ぶ（main が動物などを足す。せり上がる途中だと宙に浮いて見えるため） */
  onPlotRisen: (() => void) | null = null;

  /** まだワーカーに送っていない編集の差分（[番号, 種類, ...]）。取り出すと空になる */
  pendingDelta(): number[] {
    const d = this.delta;
    this.delta = [];
    return d;
  }

  private chunkKey(cx: number, cz: number) { return `${cx},${cz}`; }

  private setChunk(c: ChunkMesh) {
    const half = this.world!.size / 2;
    const key = this.chunkKey(c.cx, c.cz);
    const old = this.chunks.get(key);
    if (old) {
      for (const m of [old.terrain, old.water]) { this.deps.diorama.remove(m); m.geometry.dispose(); }
    }
    // せり上がっている途中のチャンクを作り直した時は、高さを引き継いで一緒にせり上げ続ける
    const y = old ? old.terrain.position.y : 0;
    const terrain = new THREE.Mesh(toGeometry(c.terrain), this.terrainMat!);
    terrain.castShadow = terrain.receiveShadow = true;
    terrain.position.set(-half, 0, -half);
    terrain.userData.chunk = key;
    const water = new THREE.Mesh(toGeometry(c.water), this.deps.waterMat);
    water.position.set(-half, 0, -half);
    water.renderOrder = 1;
    terrain.position.y = water.position.y = y;
    if (old && y !== 0) {
      for (const r of this.rising) r.objs = r.objs.map((o) => (o === old.terrain ? terrain : o === old.water ? water : o));
    }
    this.deps.diorama.add(terrain, water);
    const m = { terrain, water };
    this.chunks.set(key, m);
    return m;
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
    im.computeBoundingSphere(); // 全部の木（花）を囲む境界球。画面外なら描かない
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

  /** 列の歩けるかどうか。水面より下の列（湖や川の底）と、木の列は歩けない */
  private updateWalkable(col: number) {
    const w = this.world!;
    const h = w.heights[col];
    const top = h > 0 ? w.voxels[col + (h - 1) * w.size * w.size] : AIR;
    w.walkable[col] = (top === GRASS || top === SAND || top === DIRT || isFarm(top)) && !this.treeCols.has(col) && h >= w.waterLevel ? 1 : 0;
  }

  // ---------- 取り消し（Ctrl+Z） ----------
  // 1 回のなぞり（またはクリック）を 1 つとして記録する。地形は変えた所の元の種類、
  // 畑・苗木・花・置いた建物は、なぞる前の写しを持つ。区画を開くこと・棚の出し入れは取り消さない

  private undo = new UndoStack<UndoEntry>(50);
  private recording: UndoEntry | null = null;

  /** なぞり（またはクリック）を始める前に呼ぶ */
  beginEdit(label: string) {
    // 前のなぞりの終わりを取りこぼしていたら（指を離す前にメニューを開いた等）、そこで区切る
    if (this.recording) this.endEdit();
    if (!this.world) return;
    const f = this.farm;
    this.recording = {
      label,
      changed: false,
      voxels: new Map(),
      crops: new Map([...f.crops].map(([k, c]) => [k, { ...c }])),
      saplings: f.saplings.map((s) => ({ ...s })),
      wet: new Map(f.wetUntil),
      inventory: { ...f.inventory },
      placed: this.placed.map((p) => ({ ...p })),
      decor: this.decor.map((d) => d.placements),
      treeCols: new Set(this.treeCols),
    };
  }

  /** なぞり（またはクリック）が終わったら呼ぶ。何も変わっていなければ記録しない */
  endEdit() {
    const r = this.recording;
    this.recording = null;
    if (r && (r.changed || r.voxels.size)) this.undo.push(r);
  }

  /** 最後の編集を取り消す。取り消したら知らせの文、何もなければ null */
  undoLast(): string | null {
    if (this.locked || !this.world || this.recording) return null;
    const r = this.undo.pop();
    if (!r) return null;
    const w = this.world;
    const N = w.size;
    const cols = new Set<number>();
    // 地形：新しく変えた順の逆に戻す（同じ所は最初の種類だけ覚えているので、順番は問わない）
    for (const [i, t] of r.voxels) {
      const x = i % N, z = Math.floor(i / N) % N, y = Math.floor(i / (N * N));
      this.setVoxel(x, y, z, t);
      cols.add(x + z * N);
    }
    // 畑：なぞる前の状態に。両方にある作物・苗木は、今の育ち具合を残す（取り消しで時間は戻さない）
    const f = this.farm;
    const crops = new Map<number, Crop>();
    for (const [col, c] of r.crops) crops.set(col, f.crops.get(col) ?? c);
    f.crops = crops;
    const nowSap = new Map(f.saplings.map((s) => [s.col, s]));
    f.saplings = r.saplings.map((s) => nowSap.get(s.col) ?? s);
    f.wetUntil = r.wet;
    f.inventory = r.inventory;
    // 苗木の列（歩けるか・耕せるか）
    for (const c of this.treeCols) if (!r.treeCols.has(c)) cols.add(c);
    for (const c of r.treeCols) if (!this.treeCols.has(c)) cols.add(c);
    this.treeCols = r.treeCols;
    // 花
    r.decor.forEach((p, k) => {
      const d = this.decor[k];
      if (d && d.placements !== p) { d.placements = p; this.buildDecor(d); }
    });
    this.placed = r.placed.filter((p) => this.designs.has(p.id));
    for (const col of cols) {
      this.updateWalkable(col);
      const h = w.heights[col];
      if (h > 0 && isFarm(w.voxels[col + (h - 1) * N * N])) this.farmland.add(col);
      else this.farmland.delete(col);
    }
    this.irrigatedCache.clear();
    this.rebuildCrops();
    this.rebuildGrowing();
    this.rebuildBuildings();
    this.onEnvChanged?.();
    this.unsaved = true;
    return `「${r.label}」を取り消しました`;
  }

  private setVoxel(x: number, y: number, z: number, t: number) {
    const w = this.world!;
    // 開いていない区画は変えない。作り直している間も変えない
    if (this.locked || !canSetCol(w.plots, x, z)) return;
    this.onEnvChanged?.();
    const i = this.idx(x, y, z);
    if (w.voxels[i] === t) return;
    // 取り消しの記録：このなぞりで初めて変える所だけ、元の種類を覚える
    if (this.recording && !this.recording.voxels.has(i)) this.recording.voxels.set(i, w.voxels[i]);
    w.voxels[i] = t;
    this.edits.set(i, t);
    this.delta.push(i, t);
    // 列の高さと歩けるかどうかを更新
    let h = w.height;
    while (h > 0 && !isOpaque(w.voxels[this.idx(x, h - 1, z)])) h--;
    const col = x + z * w.size;
    w.heights[col] = h;
    this.updateWalkable(col);
    this.typeTex!.needsUpdate = true;
    this.irrigatedCache.clear();
    // このチャンクと、縁なら隣のチャンクも作り直す
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const nc = Math.ceil(w.size / CHUNK);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const ax = x + dx, az = z + dz;
      const ncx = Math.floor(ax / CHUNK), ncz = Math.floor(az / CHUNK);
      if (ncx < 0 || ncz < 0 || ncx >= nc || ncz >= nc) continue;
      const key = this.chunkKey(ncx, ncz);
      // 開いていない区画のチャンクは作らない（その区画を開いた時に作る）
      if (!this.chunks.has(key)) continue;
      if (ncx !== cx || ncz !== cz || (dx === 0 && dz === 0)) this.dirty.add(key);
    }
  }

  /** 作り直しが必要なチャンクをワーカーに頼む（1 度に 1 回ずつ） */
  flushRemesh() {
    if (this.locked || this.remeshInFlight || this.dirty.size === 0 || !this.world) return;
    const chunks = [...this.dirty].map((k) => k.split(',').map(Number) as [number, number]);
    this.dirty.clear();
    this.remeshInFlight = true;
    // ボクセル全体は送らず、前回からの差分だけを送る（ワーカーも同じ世界を持っている）
    this.deps.worker.postMessage({ type: 'remesh', gen: this.gen, id: ++this.remeshId, delta: this.pendingDelta(), chunks });
  }

  onRemesh(chunks: ChunkMesh[]) {
    // チャンクが空の返事は sendDeltaNow の分（作り直し中の印は変えない）
    if (chunks.length === 0) return;
    for (const c of chunks) this.setChunk(c);
    this.remeshInFlight = false;
  }

  /** まだ送っていない編集の差分だけを、今すぐワーカーに送る（区画を開く前に、ワーカーの世界をそろえる） */
  sendDeltaNow() {
    const delta = this.pendingDelta();
    if (delta.length) this.deps.worker.postMessage({ type: 'remesh', gen: this.gen, id: -1, delta, chunks: [] });
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
        if (!floodAllowed(w.plots, nx, nz)) continue;
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
    this.lastRay = { origin: [origin.x, origin.y, origin.z], dir: [dir.x, dir.y, dir.z] };
    return raycastVoxels(w.voxels, w.size, w.height, origin, dir, false);
  }

  /** 置いた建物と、その高さ（建物の原点の列の地面） */
  private placedWithY() {
    const w = this.world!;
    return this.placed.flatMap((p) => {
      const design = this.designs.get(p.id);
      return design ? [{ ...p, design, y: w.heights[p.x + p.z * w.size] }] : [];
    });
  }

  /** 建物の道具の判定。box はカーソルの枠（箱庭の中での中心と大きさ）、index は片付ける建物の番号 */
  private checkBuilding(hit: VoxelHit | null): { ok: boolean; x: number; y: number; z: number; msg: string; box?: { center: THREE.Vector3; size: THREE.Vector3 }; index?: number } | null {
    const w = this.world!;
    const half = w.size / 2;
    const boxOf = (b: { min: number[]; max: number[] }, ox: number, oy: number, oz: number) => ({
      center: new THREE.Vector3(ox + 0.5 - half + (b.min[0] + b.max[0]) / 2, oy + (b.min[1] + b.max[1]) / 2, oz + 0.5 - half + (b.min[2] + b.max[2]) / 2),
      size: new THREE.Vector3(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]),
    });
    if (this.tool === 'unbuild') {
      const list = this.placedWithY();
      const i = this.lastRay ? rayHitPlaced(list, this.lastRay.origin, this.lastRay.dir, half) : -1;
      if (i < 0) return hit ? { ok: false, x: hit.x, y: hit.y, z: hit.z, msg: '建物を選んでください' } : null;
      const p = list[i];
      return { ok: true, x: p.x, y: p.y, z: p.z, msg: `「${p.design.name}」を片付ける`, box: boxOf(rotatedBounds(p.design, p.rot), p.x, p.y, p.z), index: i };
    }
    if (!hit) return null;
    const { x, y, z } = hit;
    const col = x + z * w.size;
    const fail = (msg: string) => ({ ok: false, x, y, z, msg });
    if (hit.ny !== 1 || y !== w.heights[col] - 1) return fail('地面の上面を選んでください');
    const d = this.selectedDesign ? this.designs.get(this.selectedDesign) : undefined;
    if (!d) return fail('棚から建物を選んでください');
    const box = boxOf(rotatedBounds(d, this.buildRot), x, y + 1, z);
    const can = canPlace(d, this.buildRot, x, z, w.size, w.plots, {
      height: (c) => w.heights[c],
      blocked: (c) => {
        if (this.treeCols.has(c)) return '木があります';
        if (this.farm.crops.has(c)) return '作物があります';
        if (this.get(c % w.size, w.heights[c], Math.floor(c / w.size)) === WATER) return '水の上には置けません';
        return null;
      },
    });
    if (!can.ok) return { ...fail(can.msg), box };
    const mine = new Set(footprintCols(d, this.buildRot, x, z, w.size));
    for (const p of this.placedWithY()) {
      if (footprintCols(p.design, p.rot, p.x, p.z, w.size).some((c) => mine.has(c))) return { ...fail('ほかの建物と重なっています'), box };
    }
    return { ok: true, x, y, z, msg: `「${d.name}」を置く`, box };
  }

  /** その場所にこの道具が使えるか。使えるなら対象のマス、使えないなら理由 */
  check(hit: VoxelHit | null): { ok: boolean; x: number; y: number; z: number; msg: string; box?: { center: THREE.Vector3; size: THREE.Vector3 }; index?: number } | null {
    const w = this.world;
    if (!w || this.tool === 'look') return null;
    if (this.tool === 'build' || this.tool === 'unbuild') return this.checkBuilding(hit);
    if (!hit) return null;
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
        if (tx < 0 || tz < 0 || tx >= w.size || tz >= w.size || ty >= w.height - 2 || !canSetCol(w.plots, tx, tz)) return res(false, 'ここには置けません', tx, ty, tz);
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
    if (this.locked) return null;
    const c = this.check(hit);
    if (!c) return null;
    const w = this.world!;
    const { x, y, z } = c;
    const col = x + z * w.size;
    const building = this.tool === 'build' || this.tool === 'unbuild';
    if (visited) {
      // 建物は、なぞっても 1 回のドラッグで 1 棟だけ
      if (visited.has(col) || (building && visited.size)) return null;
      visited.add(col);
    }
    if (!c.ok) return c.msg;
    this.unsaved = true;
    if (this.recording) this.recording.changed = true;
    switch (this.tool) {
      case 'build': {
        const d = this.designs.get(this.selectedDesign!)!;
        for (const fc of footprintCols(d, this.buildRot, x, z, w.size)) this.removeFlowersAt(fc % w.size, Math.floor(fc / w.size));
        this.placed.push({ id: d.id, x, z, rot: this.buildRot });
        this.rebuildBuildings();
        return `「${d.name}」を置きました`;
      }
      case 'unbuild': {
        const p = this.placedWithY()[c.index!];
        this.placed = this.placed.filter((q) => !(q.id === p.id && q.x === p.x && q.z === p.z && q.rot === p.rot));
        this.rebuildBuildings();
        return `「${p.design.name}」を片付けました`;
      }
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

  // ---------- 建物の棚 ----------

  /** 棚に建物を足す。同じ建物（id が同じ）がすでにあれば足さない */
  addDesign(d: BuildingDesign): 'added' | 'exists' {
    if (this.designs.has(d.id)) return 'exists';
    this.designs.set(d.id, d);
    this.unsaved = true;
    return 'added';
  }

  /** 棚から建物を消す。置いてある分も消す */
  removeDesign(id: string) {
    if (!this.designs.delete(id)) return;
    this.placed = this.placed.filter((p) => p.id !== id);
    this.buildingGeos.get(id)?.dispose();
    this.buildingGeos.delete(id);
    if (this.selectedDesign === id) this.selectedDesign = null;
    this.unsaved = true;
    this.rebuildBuildings();
  }

  /** 次に置く建物の向きを 90° 回す */
  rotateBuild() { this.buildRot = ((this.buildRot + 1) % 4) as Rot; }

  /** 置いた建物の描画を作り直す（建物の種類ごとに InstancedMesh 1 つ） */
  private rebuildBuildings() {
    const w = this.world;
    for (const m of this.buildingMeshes) { this.deps.diorama.remove(m); m.dispose(); }
    this.buildingMeshes = [];
    if (!w) return;
    const half = w.size / 2;
    const groups = new Map<string, ReturnType<GameController['placedWithY']>>();
    for (const p of this.placedWithY()) {
      if (!groups.has(p.id)) groups.set(p.id, []);
      groups.get(p.id)!.push(p);
    }
    const mtx = new THREE.Matrix4(), rot = new THREE.Matrix4();
    for (const [id, list] of groups) {
      const im = new THREE.InstancedMesh(this.designGeo(id), this.deps.buildingMat, list.length);
      list.forEach((p, i) => {
        mtx.makeTranslation(p.x + 0.5 - half, p.y, p.z + 0.5 - half).multiply(rot.makeRotationY((p.rot * Math.PI) / 2));
        im.setMatrixAt(i, mtx);
      });
      im.castShadow = true;
      im.receiveShadow = true;
      im.userData.sharedGeometry = true;
      this.buildingMeshes.push(im);
      this.deps.diorama.add(im);
    }
  }

  /** 光線が当たる置いた建物（右クリックで壊す時に使う）。index は removeBuildingAt に渡す番号 */
  buildingAtRay(origin: THREE.Vector3, dir: THREE.Vector3): { index: number; name: string } | null {
    const w = this.world;
    if (!w) return null;
    const list = this.placedWithY();
    const i = rayHitPlaced(list, [origin.x, origin.y, origin.z], [dir.x, dir.y, dir.z], w.size / 2);
    return i < 0 ? null : { index: i, name: list[i].design.name };
  }

  /** 置いた建物を 1 棟取り除く（棚には残る）。知らせの文を返す */
  removeBuildingAt(index: number): string | null {
    if (this.locked) return null;
    const p = this.placedWithY()[index];
    if (!p) return null;
    this.placed = this.placed.filter((q) => !(q.id === p.id && q.x === p.x && q.z === p.z && q.rot === p.rot));
    this.unsaved = true;
    if (this.recording) this.recording.changed = true;
    this.rebuildBuildings();
    return `「${p.design.name}」を壊しました`;
  }

  /** 建物の形（種類ごとに 1 度だけ作る。置いた建物と見本で同じものを使う） */
  private designGeo(id: string) {
    let geo = this.buildingGeos.get(id);
    if (!geo) { geo = toGeometry(buildBuildingMesh(this.designs.get(id)!)); this.buildingGeos.set(id, geo); }
    return geo;
  }

  /** カーソル（選んでいるマスの枠）を更新する。neutral なら使えるかどうかに関係なく白で表示 */
  updateCursor(hit: VoxelHit | null, neutral = false): string {
    const c = this.check(hit);
    this.ghostWanted = false;
    if (!c || !this.world) { this.cursor.visible = false; this.syncGhost(); return ''; }
    const half = this.world.size / 2;
    this.cursor.visible = true;
    // 建物を置く：その場所・向きに、少し透かした見本を出す（R で回すと見本も回る）
    if (this.tool === 'build' && c.box && this.selectedDesign && this.designs.has(this.selectedDesign)) {
      this.ghost.geometry = this.designGeo(this.selectedDesign);
      this.ghost.position.set(c.x + 0.5 - half, c.y + 1, c.z + 0.5 - half);
      this.ghost.rotation.set(0, (this.buildRot * Math.PI) / 2, 0);
      this.ghostMat.color.set(c.ok || neutral ? 0xffffff : 0xff7a6e);
      this.ghostWanted = true;
    }
    this.syncGhost();
    if (c.box) {
      // 建物：外形の大きさの枠
      this.cursor.position.copy(c.box.center);
      this.cursor.scale.set(Math.max(c.box.size.x, 0.05), Math.max(c.box.size.y, 0.05), Math.max(c.box.size.z, 0.05));
    } else {
      this.cursor.position.set(c.x + 0.5 - half, c.y + 0.5, c.z + 0.5 - half);
      this.cursor.scale.set(1, 1, 1);
    }
    (this.cursor.material as THREE.LineBasicMaterial).color.set(c.ok || neutral ? 0xffffff : 0xff6a5a);
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
    this.onEnvChanged?.();
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
    this.onEnvChanged?.();
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
    // 開いたばかりの区画をせり上げる
    for (const r of this.rising) {
      r.t = Math.min(1, r.t + dtReal / RISE_SECONDS);
      const e = 1 - (1 - r.t) ** 3;
      for (const o of r.objs) o.position.y = -RISE_DEPTH * (1 - e);
    }
    for (const r of this.rising) if (r.t >= 1) r.done?.();
    this.rising = this.rising.filter((r) => r.t < 1);
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

  // ---------- 保存・読み込み ----------

  /** 保存用：地形の差分と畑の状態 */
  exportState(): Pick<SaveData, 'edits' | 'farm' | 'buildings'> {
    const edits: number[] = [];
    for (const [i, t] of this.edits) edits.push(i, t);
    const f = this.farm;
    return {
      edits,
      farm: {
        simMs: f.simMs,
        inventory: { ...f.inventory },
        crops: [...f.crops.values()].map((c) => [c.col, c.kind, +c.progress.toFixed(5)]),
        saplings: f.saplings.map((s) => [s.col, s.variant, s.rot, +s.progress.toFixed(5)]),
        wet: [...f.wetUntil.entries()].filter(([, u]) => u > f.simMs),
      },
      buildings: {
        designs: [...this.designs.values()],
        placed: this.placed.map((p) => [p.id, p.x, p.z, p.rot]),
      },
    };
  }

  /** 読み込み：差分はワーカーで当て済み。ここでは差分の記録と畑の状態を戻す */
  restore(save: SaveData) {
    const w = this.world!;
    for (let i = 0; i + 1 < save.edits.length; i += 2) this.edits.set(save.edits[i], save.edits[i + 1]);
    // 耕した畑の一覧は地形から作り直す
    for (let col = 0; col < w.size * w.size; col++) {
      const h = w.heights[col];
      if (h > 0 && isFarm(w.voxels[col + (h - 1) * w.size * w.size])) this.farmland.add(col);
    }
    const f = this.farm;
    f.simMs = save.farm.simMs;
    f.inventory = { ...f.inventory, ...save.farm.inventory };
    for (const [col, kind, progress] of save.farm.crops) f.crops.set(col, { col, kind, progress });
    for (const [col, variant, rot, progress] of save.farm.saplings) {
      f.saplings.push({ col, variant, rot, progress });
      this.treeCols.add(col);
      w.walkable[col] = 0;
    }
    for (const [col, until] of save.farm.wet) f.wetUntil.set(col, until);
    // 建物：棚は保存のものに置き換える
    for (const g of this.buildingGeos.values()) g.dispose();
    this.buildingGeos.clear();
    this.designs = new Map(save.buildings.designs.map((d) => [d.id, d]));
    this.placed = save.buildings.placed.filter(([id]) => this.designs.has(id)).map(([id, x, z, rot]) => ({ id, x, z, rot }));
    if (this.selectedDesign && !this.designs.has(this.selectedDesign)) this.selectedDesign = null;
    this.rebuildCrops();
    this.rebuildGrowing();
    this.rebuildBuildings();
    this.undo.clear();
    this.wetCheck = 0;
    this.unsaved = false;
  }

  /**
   * 閉じていた間の時間を進める（オフライン進行）。15 分ずつ、その時々の季節と天気で育てる。
   * 戻り値：進めた時間と、その間に収穫できるようになった作物・育ちきった木の数
   */
  catchUp(toMs: number, envAt: (ms: number) => { season: number; raining: boolean }, maxHours = 24 * 7) {
    const f = this.farm;
    const from = f.simMs;
    const target = Math.min(toMs, from + maxHours * HOUR);
    if (target <= from) return { hours: 0, ripened: 0, grown: 0 };
    const ripeBefore = [...f.crops.values()].filter((c) => c.progress >= 1).length;
    const grownBefore = f.saplings.filter((s) => s.progress >= 1).length;
    const STEP = 15 * 60 * 1000;
    while (f.simMs < target) {
      const dt = Math.min(STEP, target - f.simMs);
      f.advance(dt, { ...envAt(f.simMs), isWet: (col) => this.isWet(col) });
    }
    this.rebuildCrops();
    this.rebuildGrowing();
    this.wetCheck = 0;
    return {
      hours: (target - from) / HOUR,
      ripened: [...f.crops.values()].filter((c) => c.progress >= 1).length - ripeBefore,
      grown: f.saplings.filter((s) => s.progress >= 1).length - grownBefore,
    };
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
