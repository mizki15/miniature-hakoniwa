import * as THREE from 'three/webgpu';
import { AIR, COBBLE, CONIFER, DIRT, FARMLAND, GRASS, LEAVES, LOG, PATH, SAND, STONE, WATER, WET_FARMLAND, isOpaque, isWalkableTop } from '../world/blocks';
import { CHUNK, type MeshData } from '../world/mesher';
import type { WorldData } from '../world/terrain';
import type { ChunkMesh, DetailModel, PlotPlacements, PlotResult } from '../world/worker';
import { FRAME, PLOT, plotOfCol, plotRect } from '../world/plots';
import { canSetCol, floodAllowed } from './edgeRules';
import { CROPS, Farm, type Crop, type CropKind, type Sapling } from './farm';
import { UndoStack } from './undoStack';
import { buildCropGeometry, buildSaplingGeometry } from './cropModels';
import { raycastVoxels, type VoxelHit } from './picking';
import { GRASS_VARIANTS, PEBBLE_VARIANTS, buildGrassTuft, buildPebble, placeGround } from '../creatures/groundDecor';
import type { SaveData } from '../save/format';
import type { BuildingDesign } from '../build/geoParse';
import { buildBuildingMesh } from '../build/geoMesh';
import { canPlace, footprintCols, rayHitPlaced, rayHitPlacedT, rotatedBounds, type Rot } from '../build/placement';
import { advanceProgress, buildOrder, builtCount, cubeBox, minutesLeft } from '../build/construction';

export type Tool = 'look' | 'till' | 'seed' | 'water' | 'harvest' | 'plant' | 'flower' | 'fell' | 'dig' | 'raise' | 'level' | 'path' | 'build' | 'unbuild';

/** 置いた建物 1 棟。progress：建設の進み具合（0〜1、1 で完成） */
interface PlacedBuilding { id: string; x: number; z: number; rot: Rot; progress: number }

/** 建設中の建物 1 棟の見た目（組み上がった分・足場・次のパーツ・土ぼこり） */
interface Site {
  p: PlacedBuilding;
  group: THREE.Group;
  /** 組み上がった直方体の数（見た目を作った時の） */
  shown: number;
  built: THREE.Mesh | null;
  next: THREE.Mesh | null;
  scaffold: THREE.LineSegments | null;
  dust: THREE.InstancedMesh;
  /** 土ぼこりの粒：位置（建物の中の座標）と年齢（秒、負ならまだ出ていない） */
  puffs: { x: number; y: number; z: number; vx: number; vz: number; age: number }[];
  /** 次のパーツの上端の中心（土ぼこりが出る所） */
  workAt: [number, number, number];
}

/** 置けるブロック（「ブロックを置く」で選ぶ） */
export const PLACE_BLOCKS: { id: number; name: string; icon: string }[] = [
  { id: DIRT, name: '土', icon: '🟫' },
  { id: GRASS, name: '草地', icon: '🟩' },
  { id: STONE, name: '石', icon: '🪨' },
  { id: SAND, name: '砂', icon: '🟨' },
  { id: LOG, name: '丸太', icon: '🪵' },
  { id: LEAVES, name: '葉', icon: '🍃' },
  { id: CONIFER, name: '針葉', icon: '🌲' },
];

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
  planted: Map<number, number>;
}

/** 木を 1 本切ると手に入る木材 */
const WOOD_PER_TREE = 3;

export const TOOLS: { id: Tool; name: string; icon: string; help: string }[] = [
  { id: 'look', name: '見る', icon: '👁', help: '眺めるだけ。水面をクリックすると波紋' },
  { id: 'till', name: '耕す', icon: '⛏', help: '草地や土を耕して畑にする' },
  { id: 'seed', name: '種まき', icon: '🌱', help: '畑に種をまく' },
  { id: 'water', name: '水やり', icon: '💧', help: '畑に水をやる（6 時間、倍の速さで育つ）' },
  { id: 'harvest', name: '収穫', icon: '🧺', help: '育ちきった作物を収穫する' },
  { id: 'plant', name: '苗木', icon: '🌳', help: '苗木を植える（約 1 日で木になる）' },
  { id: 'flower', name: '花を植える', icon: '🌷', help: '草地に花を植える。花は虫や鳥を呼ぶ' },
  { id: 'fell', name: '木を切る', icon: '🪓', help: `育った木を切って木材 ${WOOD_PER_TREE} 個。切り株から、また育つ` },
  { id: 'dig', name: '掘る', icon: '🕳', help: 'ブロックを掘る。水のそばを掘ると水が流れ込む' },
  { id: 'raise', name: 'ブロックを置く', icon: '🧱', help: '選んだブロックを置く' },
  { id: 'level', name: '整地', icon: '📏', help: '最初に押したマスの高さに、なぞった所を削る・盛る' },
  { id: 'path', name: '道を敷く', icon: '🛤', help: '地面を道にする。住人は道を好んで歩く' },
  { id: 'build', name: '建物を置く', icon: '🏠', help: '選んだ建物を地面に置く。下から少しずつ建っていく' },
  { id: 'unbuild', name: '片付ける', icon: '🧹', help: '置いた建物を取り除く（棚には残る）' },
];

/** 植えられる花（色）。variant は花の形の番号（0 赤・1 黄・2 白） */
export const FLOWER_KINDS: { variant: number; name: string; icon: string }[] = [
  { variant: 0, name: '赤い花', icon: '🌹' },
  { variant: 1, name: '黄色い花', icon: '🌼' },
  { variant: 2, name: '白い花', icon: '🤍' },
];
/** 敷ける道 */
export const PATH_KINDS: { id: number; name: string; icon: string }[] = [
  { id: PATH, name: '土の道', icon: '🟤' },
  { id: COBBLE, name: '石畳', icon: '⬜' },
];
/** 整地で、1 列あたり削る・盛る高さの上限 */
const LEVEL_MAX = 8;

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
  /** 置いた建物の足元の列（歩けない） */
  private buildingCols = new Set<number>();
  private buildingMeshes: THREE.InstancedMesh[] = [];
  private buildingGeos = new Map<string, THREE.BufferGeometry>();
  /** 最後に pick() に渡した光線（建物を片付ける時の当たりに使う） */
  private lastRay: { origin: [number, number, number]; dir: [number, number, number] } | null = null;
  farm = new Farm();
  tool: Tool = 'look';
  seed: CropKind = 'turnip';
  /** 「ブロックを置く」で置くブロック */
  block: number = DIRT;
  /** 「花を植える」で植える花（FLOWER_KINDS の variant） */
  flowerVariant = 0;
  /** 「道を敷く」で敷く道のブロック */
  pathBlock: number = PATH;
  /** 植えた花（列 → 花の形）。地形から作り直せないので保存する */
  private planted = new Map<number, number>();
  /** 整地：このなぞりでそろえる高さ（最初に押した列の地面の高さ）。なぞりごとに決め直す */
  private levelTarget: number | null = null;
  /** 建設中の建物の見た目 */
  private sites: Site[] = [];
  private siteGhostMat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.14, depthWrite: false, roughness: 0.85, metalness: 0 });
  private siteNextMat = new THREE.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.5, depthWrite: false });
  private scaffoldMat = new THREE.LineBasicMaterial({ color: 0x8a6436, transparent: true, opacity: 0.9 });
  private dustMat = new THREE.MeshBasicMaterial({ color: 0xe9dcc0, transparent: true, opacity: 0.7, depthWrite: false });
  private dustGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
  private siteTime = 0;
  /** 建物が建ち終わった時（main が知らせを出す） */
  onBuildingDone: ((name: string) => void) | null = null;
  world: WorldData | null = null;
  /** 生成した状態からの変更（保存は「シード＋この差分」で行う） */
  edits = new Map<number, number>();
  /** 前回の保存から変わったか（道具を使った時に立てる） */
  unsaved = false;
  /** プレイヤーが手を加えた時に呼ぶ（Drive との同期の「変更あり」に使う。時間が進んだだけでは呼ばない） */
  onPlayerChange?: () => void;

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
    // 時間の流れ（デバッグの早送り）は、作り直した箱庭にも引き継ぐ
    const speed = this.farm.speed;
    this.farm = new Farm();
    this.farm.speed = speed;
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
    this.planted.clear();
    this.treeGeos = [];
    this.flowerGeos = [];
    this.delta = [];
    this.rising = [];
    this.groundMeshes = []; // 箱庭を作り直す時に main が片付けている
    this.groundDirty = true;
    // 置いた建物は箱庭ごと。棚（designs）は新しい箱庭にも持ち越す
    this.placed = [];
    this.buildingMeshes = [];
    this.buildingCols = new Set();
    this.sites = [];
    // 取り消しの記録は箱庭ごと
    this.undo.clear();
    this.redo.clear();
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
    this.rising.push({ objs: risers, t: 0, done: () => { this.addDecor(r.placements); this.env(); this.onPlotRisen?.(); } });
    this.onPlotsChanged?.();
  }

  /** 区画が増えた時に呼ぶ（main が台座・カメラの範囲などを直す） */
  onPlotsChanged: (() => void) | null = null;
  /** 環境（花・木・畑・作物・地形）が変わったかもしれない時に呼ぶ（main が環境の数を数え直す印を付ける） */
  onEnvChanged: (() => void) | null = null;
  /** 環境が変わった：地面の小物（小石・草）も置き直す */
  private env() { this.groundDirty = true; this.onEnvChanged?.(); }

  // ---------- 地面の小物（ローポリの小石と草。見た目だけ） ----------
  /** 出る多さ（デバッグ「石と草の多さ」。0 = なし） */
  private groundDensity = 1;
  private groundDirty = false;
  private groundTimer = 0;
  private groundMeshes: THREE.InstancedMesh[] = [];
  private readonly pebbleGeos = Array.from({ length: PEBBLE_VARIANTS }, (_, v) => buildPebble(v));
  private readonly grassGeos = Array.from({ length: GRASS_VARIANTS }, (_, v) => buildGrassTuft(v));

  setGroundDensity(d: number) { this.groundDensity = d; this.groundDirty = true; }
  /** 小石と草の数（デバッグの表示用） */
  groundCount() { return this.groundMeshes.reduce((n, m) => n + m.count, 0); }

  /** 小石と草を置き直す。木・建物・花のある列には置かない */
  private rebuildGround() {
    const w = this.world!;
    this.groundDirty = false;
    for (const m of this.groundMeshes) { this.deps.diorama.remove(m); m.dispose(); }
    this.groundMeshes = [];
    const flowerCols = new Set<number>();
    for (const d of this.decor) {
      if (d.kind !== 'flower') continue;
      for (let i = 0; i < d.placements.length; i += 5) flowerCols.add(Math.floor(d.placements[i]) + Math.floor(d.placements[i + 2]) * w.size);
    }
    const pl = placeGround(w.voxels, w.heights, w.size, w.height, this.groundDensity,
      (col) => this.treeCols.has(col) || this.buildingCols.has(col) || flowerCols.has(col));
    const half = w.size / 2;
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const make = (geo: THREE.BufferGeometry, mat: THREE.Material, list: number[]) => {
      const count = list.length / 5;
      if (!count) return;
      const im = new THREE.InstancedMesh(geo, mat, count);
      for (let i = 0; i < count; i++) {
        ps.set(list[i * 5] - half, list[i * 5 + 1], list[i * 5 + 2] - half);
        q.setFromAxisAngle(up, list[i * 5 + 3]);
        sc.setScalar(list[i * 5 + 4]);
        im.setMatrixAt(i, mtx.compose(ps, q, sc));
      }
      im.castShadow = false; // 小さいので影は落とさない（軽さのため）
      im.receiveShadow = true;
      im.userData.kind = 'ground';
      im.userData.sharedGeometry = true;
      im.computeBoundingSphere();
      this.groundMeshes.push(im);
      this.deps.diorama.add(im);
    };
    pl.pebbles.forEach((list, v) => make(this.pebbleGeos[v], this.deps.buildingMat, list));
    pl.grass.forEach((list, v) => make(this.grassGeos[v], this.deps.flowerMat, list));
  }
  /** 建物の足元が新しく増えた時（main が、そこにいる住人を外へ移す） */
  onBuildingsPlaced: ((cols: ReadonlySet<number>) => void) | null = null;

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
    this.planted.delete(x + z * this.world!.size);
  }

  /** 花を 1 本足す（列の中で少しずらし、向き・大きさはばらつかせる） */
  private addFlower(col: number, variant: number) {
    const w = this.world!;
    const geo = this.flowerGeos[variant];
    if (!geo) return;
    const x = col % w.size, z = Math.floor(col / w.size);
    let d = this.decor.find((q) => q.kind === 'flower' && q.variant === variant);
    if (!d) { d = { kind: 'flower', variant, geo, mat: this.deps.flowerMat, placements: new Float32Array(0), mesh: null, shared: this.flowerShared }; this.decor.push(d); }
    const merged = new Float32Array(d.placements.length + 5);
    merged.set(d.placements);
    merged.set([x + 0.2 + Math.random() * 0.6, w.heights[col], z + 0.2 + Math.random() * 0.6, Math.random() * Math.PI * 2, 0.8 + Math.random() * 0.4], d.placements.length);
    d.placements = merged;
    this.buildDecor(d);
    this.planted.set(col, variant);
  }

  /** その列に花があるか */
  private hasFlower(col: number) {
    const N = this.world!.size;
    for (const d of this.decor) {
      if (d.kind !== 'flower') continue;
      for (let i = 0; i < d.placements.length; i += 5) if (Math.floor(d.placements[i]) + Math.floor(d.placements[i + 2]) * N === col) return true;
    }
    return false;
  }

  /**
   * 光線が当たる、育った木の列（地形より手前のもの）。木は「根元から てっぺん、葉の広がりの 7 割」の箱で見る。
   * 自然の木と、植えて育った木（育ち具合 0.6 以上）。当たらなければ null
   */
  private treeColAtRay(voxelT: number): number | null {
    const w = this.world!;
    const ray = this.lastRay;
    if (!ray) return null;
    const half = w.size / 2;
    let best: number | null = null, bestT = voxelT + 0.5;
    const test = (col: number, cx: number, cz: number, ground: number, top: number, r: number) => {
      const lo = [cx - r, ground, cz - r], hi = [cx + r, top, cz + r];
      let t0 = 0, t1 = Infinity;
      for (let a = 0; a < 3; a++) {
        const o = ray.origin[a], dd = ray.dir[a];
        if (Math.abs(dd) < 1e-12) { if (o < lo[a] || o > hi[a]) return; continue; }
        let ta = (lo[a] - o) / dd, tb = (hi[a] - o) / dd;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) return;
      }
      if (t0 < bestT) { bestT = t0; best = col; }
    };
    for (const d of this.decor) {
      if (d.kind !== 'tree' || !d.placements.length) continue;
      if (!d.geo.boundingBox) d.geo.computeBoundingBox();
      const b = d.geo.boundingBox!;
      for (let i = 0; i < d.placements.length; i += 5) {
        const px = d.placements[i], py = d.placements[i + 1], pz = d.placements[i + 2], s = d.placements[i + 4];
        test(Math.floor(px) + Math.floor(pz) * w.size, px - half, pz - half, py, py + b.max.y * s, Math.max(0.5, b.max.x * s * 0.7));
      }
    }
    for (const sp of this.farm.saplings) {
      const shape = sp.progress >= 0.25 ? this.treeShape(sp.col) : null;
      if (!shape) continue;
      const x = sp.col % w.size, z = Math.floor(sp.col / w.size);
      test(sp.col, x + 0.5 - half, z + 0.5 - half, shape.ground, shape.top, Math.max(0.5, shape.radius * 0.7));
    }
    return best;
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
    w.walkable[col] = isWalkableTop(top) && !this.treeCols.has(col) && !this.buildingCols.has(col) && h >= w.waterLevel ? 1 : 0;
  }

  // ---------- 取り消し（Ctrl+Z） ----------
  // 1 回のなぞり（またはクリック）を 1 つとして記録する。地形は変えた所の元の種類、
  // 畑・苗木・花・置いた建物は、なぞる前の写しを持つ。区画を開くこと・棚の出し入れは取り消さない

  private undo = new UndoStack<UndoEntry>(50);
  private recording: UndoEntry | null = null;
  /** やり直し（取り消した編集）の記録 */
  private redo = new UndoStack<UndoEntry>(50);

  /** なぞり（またはクリック）を始める前に呼ぶ */
  beginEdit(label: string) {
    // 前のなぞりの終わりを取りこぼしていたら（指を離す前にメニューを開いた等）、そこで区切る
    if (this.recording) this.endEdit();
    this.levelTarget = null;
    if (!this.world) return;
    this.recording = this.snapshot(label);
  }

  /** いまの畑・苗木・花・建物の写し（地形は、変えた所だけ後で足す） */
  private snapshot(label: string): UndoEntry {
    const f = this.farm;
    return {
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
      planted: new Map(this.planted),
    };
  }

  /** なぞり（またはクリック）が終わったら呼ぶ。何も変わっていなければ記録しない */
  endEdit() {
    const r = this.recording;
    this.recording = null;
    this.levelTarget = null;
    if (r && (r.changed || r.voxels.size)) { this.undo.push(r); this.redo.clear(); } // 新しく編集したら、やり直しの記録は捨てる
    this.groundDirty = true; // 花・苗木・建物など、ボクセル以外の変化でも置き直す
  }

  /** 最後の編集を取り消す。取り消したら知らせの文、何もなければ null */
  undoLast(): string | null {
    if (this.locked || !this.world || this.recording) return null;
    const r = this.undo.pop();
    if (!r) return null;
    this.redo.push(this.applyEntry(r));
    return `「${r.label}」を取り消しました`;
  }

  /** 取り消した編集をやり直す（Ctrl+Y・Ctrl+Shift+Z）。やり直したら知らせの文、何もなければ null */
  redoLast(): string | null {
    if (this.locked || !this.world || this.recording) return null;
    const r = this.redo.pop();
    if (!r) return null;
    this.undo.push(this.applyEntry(r));
    return `「${r.label}」をやり直しました`;
  }

  /**
   * 記録の状態に戻す。戻す前の状態を、同じ形の記録にして返す
   * （取り消しの記録を当てるとやり直しの記録が、やり直しの記録を当てると取り消しの記録ができる）
   */
  private applyEntry(r: UndoEntry): UndoEntry {
    const back = this.snapshot(r.label);
    for (const i of r.voxels.keys()) back.voxels.set(i, this.world!.voxels[i]);
    back.changed = true;
    this.groundDirty = true;
    const w = this.world!;
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
    // 花（植えた花の記録も）・切った木
    this.planted = r.planted;
    r.decor.forEach((p, k) => {
      const d = this.decor[k];
      if (d && d.placements !== p) { d.placements = p; this.buildDecor(d); }
    });
    // 置いた建物：両方にある建物は、今の建設の進み具合を残す（取り消しで時間は戻さない）
    const nowKey = (p: PlacedBuilding) => `${p.id}:${p.x}:${p.z}:${p.rot}`;
    const nowPlaced = new Map(this.placed.map((p) => [nowKey(p), p]));
    this.placed = r.placed.filter((p) => this.designs.has(p.id)).map((p) => ({ ...p, progress: nowPlaced.get(nowKey(p))?.progress ?? p.progress }));
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
    this.env();
    this.unsaved = true; this.onPlayerChange?.();
    return back;
  }

  private setVoxel(x: number, y: number, z: number, t: number) {
    const w = this.world!;
    // 開いていない区画は変えない。作り直している間も変えない
    if (this.locked || !canSetCol(w.plots, x, z)) return;
    this.env();
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
        if (this.buildingCols.has(nx + nz * w.size)) continue;
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
    // 建物（建設中も）の中や足元には使えない。光線が地形より先に建物に当たる時も（建物の向こう側に使わないように）
    if (this.lastRay && this.placed.length) {
      const bh = rayHitPlacedT(this.placedWithY(), this.lastRay.origin, this.lastRay.dir, w.size / 2);
      if (bh.index >= 0 && bh.t < hit.t) return res(false, '建物があります');
    }
    if (this.tool !== 'raise' && this.buildingCols.has(col)) return res(false, '建物があります');
    if (this.tool === 'fell') {
      // 指した所の手前の木。なければ、指した列に立っている木
      const tc = this.treeColAtRay(hit.t) ?? (this.treeCols.has(col) ? col : null);
      if (tc === null) return res(false, '木を選んでください');
      const tx = tc % w.size, tz = Math.floor(tc / w.size), ty = w.heights[tc] - 1;
      const sp = this.farm.saplings.find((s) => s.col === tc);
      if (sp && sp.progress < 1) return res(false, `まだ育っています（${Math.floor(sp.progress * 100)}%）`, tx, ty, tz);
      return res(true, `木を切る（木材 +${WOOD_PER_TREE}）`, tx, ty, tz);
    }
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
      case 'flower': {
        if (!topFace || !isTop) return res(false, '地面の上面を選んでください');
        if (t !== GRASS) return res(false, '草地に植えられます');
        if (this.treeCols.has(col)) return res(false, '木の根元には植えられません');
        if (this.hasFlower(col)) return res(false, 'もう花があります');
        return res(true, `${FLOWER_KINDS.find((f) => f.variant === this.flowerVariant)?.name ?? '花'}を植える`);
      }
      case 'path': {
        if (!topFace || !isTop) return res(false, '地面の上面を選んでください');
        if (this.treeCols.has(col)) return res(false, '木の根元には敷けません');
        if (this.farm.crops.has(col)) return res(false, '作物があります');
        const name = PATH_KINDS.find((p) => p.id === this.pathBlock)?.name ?? '道';
        if (t === this.pathBlock) return res(false, `もう${name}です`);
        if (t !== GRASS && t !== DIRT && t !== SAND && !isFarm(t) && t !== PATH && t !== COBBLE) return res(false, '草地・土・砂の所に敷けます');
        return res(true, `${name}を敷く`);
      }
      case 'dig':
        if (y === 0) return res(false, '一番下は掘れません');
        if (this.treeCols.has(col) && isTop) {
          // 育っている途中の苗木なら、苗木ごと掘れる。育った木は先に「木を切る」
          const sp = this.farm.saplings.find((s) => s.col === col);
          if (!sp || sp.progress >= 1) return res(false, '木の根元は掘れません（先に木を切る）');
          return res(true, '苗木ごと掘る');
        }
        return res(true, '掘る');
      case 'raise': {
        const tx = x + hit.nx, ty = y + hit.ny, tz = z + hit.nz;
        if (tx < 0 || tz < 0 || tx >= w.size || tz >= w.size || ty >= w.height - 2 || !canSetCol(w.plots, tx, tz)) return res(false, 'ここには置けません', tx, ty, tz);
        if (this.treeCols.has(tx + tz * w.size)) return res(false, '木があります', tx, ty, tz);
        if (this.buildingCols.has(tx + tz * w.size)) return res(false, '建物があります', tx, ty, tz);
        const there = this.get(tx, ty, tz);
        if (there !== AIR && there !== WATER) return res(false, 'ふさがっています', tx, ty, tz);
        return res(true, `${this.blockName()}を置く`, tx, ty, tz);
      }
      case 'level': {
        // 整地は列で見る（坂をなぞると側面に当たることが多いので、面の向きは問わない）
        let lx = x, lz = z, lcol = col;
        // 側面に当たった時：当たった列がもうそろっていて、面の向こう（へこみ側）の低い列がまだなら、そちらを選ぶ
        // （へこみの底にカーソルが届かなくても、へこみの壁を指せば埋まる）
        if (this.levelTarget !== null && hit.ny === 0) {
          const ax = x + hit.nx, az = z + hit.nz;
          if (ax >= 0 && az >= 0 && ax < w.size && az < w.size) {
            const acol = ax + az * w.size;
            if (w.heights[col] === this.levelTarget && w.heights[acol] !== this.levelTarget && w.heights[acol] <= y) { lx = ax; lz = az; lcol = acol; }
          }
        }
        if (this.buildingCols.has(lcol)) return res(false, '建物があります', lx, w.heights[lcol] - 1, lz);
        if (this.treeCols.has(lcol)) return res(false, '木があります', lx, w.heights[lcol] - 1, lz);
        if (this.farm.crops.has(lcol)) return res(false, '作物があります', lx, w.heights[lcol] - 1, lz);
        if (!canSetCol(w.plots, lx, lz)) return res(false, 'ここはそろえられません', lx, w.heights[lcol] - 1, lz);
        const h = w.heights[lcol];
        const target = this.levelTarget ?? h;
        if (Math.abs(h - target) > LEVEL_MAX) return res(false, `高さが違いすぎます（${LEVEL_MAX} 段まで）`, lx, h - 1, lz);
        if (target < 1 || target >= w.height - 2) return res(false, 'ここはそろえられません', lx, h - 1, lz);
        return res(true, h > target ? `削って高さ ${target} にそろえる` : h < target ? `盛って高さ ${target} にそろえる` : `高さ ${target} にそろえる`, lx, h - 1, lz);
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
    this.unsaved = true; this.onPlayerChange?.();
    if (this.recording) this.recording.changed = true;
    switch (this.tool) {
      case 'build': {
        const d = this.designs.get(this.selectedDesign!)!;
        for (const fc of footprintCols(d, this.buildRot, x, z, w.size)) this.removeFlowersAt(fc % w.size, Math.floor(fc / w.size));
        this.placed.push({ id: d.id, x, z, rot: this.buildRot, progress: 0 });
        this.rebuildBuildings();
        return `「${d.name}」の建設を始めました（完成まで約 ${minutesLeft(0, d)} 分）`;
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
      case 'flower':
        this.addFlower(col, this.flowerVariant);
        return `${FLOWER_KINDS.find((f) => f.variant === this.flowerVariant)?.name ?? '花'}を植えました`;
      case 'path':
        this.removeFlowersAt(x, z);
        this.farmland.delete(col);
        this.farm.wetUntil.delete(col);
        this.setVoxel(x, y, z, this.pathBlock);
        return `${PATH_KINDS.find((p) => p.id === this.pathBlock)?.name ?? '道'}を敷きました`;
      case 'fell': {
        // 自然の木：形を消して、同じ種類の若木（切り株から育つ）にする。植えた木：育ち具合を 0 に戻す
        const sp = this.farm.saplings.find((s) => s.col === col);
        if (sp) sp.progress = 0;
        else {
          for (const d of this.decor) {
            if (d.kind !== 'tree') continue;
            const keep: number[] = [];
            let found: number[] | null = null;
            for (let i = 0; i < d.placements.length; i += 5) {
              if (!found && Math.floor(d.placements[i]) + Math.floor(d.placements[i + 2]) * w.size === col) { found = [...d.placements.subarray(i, i + 5)]; continue; }
              for (let k = 0; k < 5; k++) keep.push(d.placements[i + k]);
            }
            if (found) {
              d.placements = new Float32Array(keep);
              this.buildDecor(d);
              this.farm.plantSapling(col, d.variant, found[3]);
              break;
            }
          }
        }
        this.farm.inventory.wood = (this.farm.inventory.wood ?? 0) + WOOD_PER_TREE;
        this.rebuildGrowing();
        this.env();
        return `木を切りました（木材 +${WOOD_PER_TREE}、全部で ${this.farm.inventory.wood}）`;
      }
      case 'dig': {
        const wasTop = y === w.heights[col] - 1;
        if (wasTop) {
          // 育っている途中の苗木は、掘ると一緒になくなる
          const si = this.farm.saplings.findIndex((s) => s.col === col);
          if (si >= 0) {
            this.farm.saplings.splice(si, 1);
            this.treeCols.delete(col);
            this.rebuildGrowing();
          }
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
        this.setVoxel(x, y, z, this.block);
        return `${this.blockName()}を置きました`;
      }
      case 'level': {
        const h = w.heights[col];
        if (this.levelTarget === null) this.levelTarget = h;
        const target = this.levelTarget;
        if (h === target) return '高さをそろえます';
        const top = this.get(x, h - 1, z);
        // 表面の草地・砂は、そろえた後の表面にも残す（畑は土に戻す）
        const surface = top === GRASS || top === SAND ? top : DIRT;
        this.removeFlowersAt(x, z);
        this.farmland.delete(col);
        if (h > target) {
          for (let yy = h - 1; yy >= target; yy--) this.setVoxel(x, yy, z, AIR);
          this.setVoxel(x, target - 1, z, surface);
          this.flood(x, target, z);
        } else {
          if (top === GRASS || isFarm(top)) this.setVoxel(x, h - 1, z, DIRT);
          for (let yy = h; yy < target; yy++) this.setVoxel(x, yy, z, yy === target - 1 ? surface : DIRT);
        }
        return '整地しました';
      }
    }
    return null;
  }

  /** 「ブロックを置く」で選んでいるブロックの名前 */
  blockName() { return PLACE_BLOCKS.find((b) => b.id === this.block)?.name ?? 'ブロック'; }

  // ---------- 建物の棚 ----------

  /** 棚に建物を足す。同じ建物（id が同じ）がすでにあれば足さない */
  addDesign(d: BuildingDesign): 'added' | 'exists' {
    if (this.designs.has(d.id)) return 'exists';
    this.designs.set(d.id, d);
    this.unsaved = true; this.onPlayerChange?.();
    return 'added';
  }

  /** 棚から建物を消す。置いてある分も消す */
  removeDesign(id: string) {
    if (!this.designs.delete(id)) return;
    this.placed = this.placed.filter((p) => p.id !== id);
    this.buildingGeos.get(id)?.dispose();
    this.buildingGeos.delete(id);
    if (this.selectedDesign === id) this.selectedDesign = null;
    this.unsaved = true; this.onPlayerChange?.();
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
    // 建物の足元は歩けない（住人・訪問者がめり込まないように）。外れた列は元に戻す
    const before = this.buildingCols;
    this.groundDirty = true;
    this.buildingCols = new Set(this.placedWithY().flatMap((p) => footprintCols(p.design, p.rot, p.x, p.z, w.size)));
    for (const c of before) if (!this.buildingCols.has(c)) this.updateWalkable(c);
    const added = new Set<number>();
    for (const c of this.buildingCols) { this.updateWalkable(c); if (!before.has(c)) added.add(c); }
    if (added.size) this.onBuildingsPlaced?.(added);
    // 建設中の建物は 1 棟ずつ（組み上がった分・足場・次のパーツ）
    for (const st of this.sites) this.disposeSite(st);
    this.sites = [];
    const groups = new Map<string, ReturnType<GameController['placedWithY']>>();
    for (const p of this.placedWithY()) {
      if (p.progress < 1) { this.makeSite(p, half); continue; }
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

  // ---------- 建設 ----------
  // 置いた建物は、直方体（パーツ）を下から順に 1 つずつ組み上げる。組み上がった分は不透明、
  // 全体の形はうっすら透かして見せ、次のパーツは明るく点滅させる。周りに足場、作業中のパーツから土ぼこり

  /** 建設中の建物の見た目を作る（pw は placedWithY の要素。進み具合は this.placed の物を見る） */
  private makeSite(pw: ReturnType<GameController['placedWithY']>[number], half: number) {
    const p = this.placed.find((q) => q.id === pw.id && q.x === pw.x && q.z === pw.z && q.rot === pw.rot);
    if (!p) return;
    const group = new THREE.Group();
    group.position.set(p.x + 0.5 - half, pw.y, p.z + 0.5 - half);
    group.rotation.y = (p.rot * Math.PI) / 2;
    const ghost = new THREE.Mesh(this.designGeo(p.id), this.siteGhostMat);
    ghost.renderOrder = 2;
    group.add(ghost);
    const dust = new THREE.InstancedMesh(this.dustGeo, this.dustMat, 10);
    dust.userData.sharedGeometry = true;
    dust.frustumCulled = false;
    group.add(dust);
    const st: Site = { p, group, shown: -1, built: null, next: null, scaffold: null, dust, puffs: Array.from({ length: 10 }, (_, i) => ({ x: 0, y: 0, z: 0, vx: 0, vz: 0, age: -i * 0.11 })), workAt: [0, 0, 0] };
    this.sites.push(st);
    this.updateSite(st);
    this.deps.diorama.add(group);
  }

  private disposeSite(st: Site) {
    this.deps.diorama.remove(st.group);
    st.built?.geometry.dispose();
    st.next?.geometry.dispose();
    st.scaffold?.geometry.dispose();
    st.dust.dispose();
  }

  /** 組み上がった数が変わったら、組み上がった分・次のパーツ・足場を作り直す */
  private updateSite(st: Site) {
    const d = this.designs.get(st.p.id);
    if (!d) return;
    const order = buildOrder(d);
    const k = builtCount(st.p.progress, order.length);
    if (k === st.shown) return;
    st.shown = k;
    for (const m of [st.built, st.next, st.scaffold]) if (m) { st.group.remove(m); m.geometry.dispose(); }
    st.built = st.next = null;
    st.scaffold = null;
    if (k > 0) {
      st.built = new THREE.Mesh(toGeometry(buildBuildingMesh({ ...d, cubes: order.slice(0, k) })), this.deps.buildingMat);
      st.built.castShadow = st.built.receiveShadow = true;
      st.group.add(st.built);
    }
    // 作業中の高さ：次のパーツの上端（なければ全体の上端）
    let workTop = d.bounds.max[1];
    if (k < order.length) {
      st.next = new THREE.Mesh(toGeometry(buildBuildingMesh({ ...d, cubes: [order[k]] })), this.siteNextMat);
      st.next.renderOrder = 3;
      st.group.add(st.next);
      const b = cubeBox(order[k]);
      workTop = b.max[1];
      st.workAt = [(b.min[0] + b.max[0]) / 2, b.max[1], (b.min[2] + b.max[2]) / 2];
    }
    // 足場：四隅の柱と、作業中の高さまで 1 段ごとの横木、下の段に筋交い
    const { min, max } = d.bounds;
    const m = 0.2;
    const x0 = min[0] - m, x1 = max[0] + m, z0 = min[2] - m, z1 = max[2] + m;
    const top = Math.min(max[1], workTop) + 0.6;
    const pts: number[] = [];
    for (const [cx, cz] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) pts.push(cx, 0, cz, cx, top, cz);
    for (let y = 1; y <= top; y++) {
      pts.push(x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0);
    }
    const by = Math.min(1, top);
    pts.push(x0, 0, z0, x1, by, z0, x1, 0, z1, x0, by, z1, x0, 0, z1, x0, by, z0, x1, 0, z0, x1, by, z1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    st.scaffold = new THREE.LineSegments(g, this.scaffoldMat);
    st.group.add(st.scaffold);
  }

  /** 建設を dtMs（箱庭の時間）ぶん進める。建ち終わった建物があれば、まとめて描き直す */
  private advanceBuildings(dtMs: number) {
    let finished = false;
    for (const p of this.placed) {
      if (p.progress >= 1) continue;
      const d = this.designs.get(p.id);
      if (!d) continue;
      p.progress = advanceProgress(p.progress, dtMs, d);
      if (p.progress >= 1) { finished = true; this.onBuildingDone?.(d.name); }
    }
    if (finished) { this.rebuildBuildings(); this.env(); }
    else for (const st of this.sites) this.updateSite(st);
  }

  /** 建設中の動き（毎フレーム、現実の秒で）：次のパーツの点滅と土ぼこり */
  private animateSites(dtReal: number) {
    if (!this.sites.length) return;
    this.siteTime += dtReal;
    this.siteNextMat.opacity = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(this.siteTime * 4));
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), ps = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const LIFE = 1.1;
    for (const st of this.sites) {
      st.puffs.forEach((f, i) => {
        f.age += dtReal;
        if (f.age >= LIFE) {
          // 作業中のパーツの上から、また出す
          f.age = 0;
          f.x = st.workAt[0] + (Math.random() - 0.5) * 0.6;
          f.y = st.workAt[1];
          f.z = st.workAt[2] + (Math.random() - 0.5) * 0.6;
          f.vx = (Math.random() - 0.5) * 0.5;
          f.vz = (Math.random() - 0.5) * 0.5;
        }
        const a = Math.max(0, f.age);
        const s = f.age < 0 ? 0 : (1 - a / LIFE) * 1.4 + 0.3;
        ps.set(f.x + f.vx * a, f.y + 0.15 + a * 0.55, f.z + f.vz * a);
        q.setFromAxisAngle(up, a * 3 + i);
        sc.setScalar(s);
        st.dust.setMatrixAt(i, mtx.compose(ps, q, sc));
      });
      st.dust.instanceMatrix.needsUpdate = true;
    }
  }

  /** 建設中の建物の様子（見るモードのホバー用）。光線の先（地形より手前）に建設中の建物がなければ null */
  siteAt(origin: THREE.Vector3, dir: THREE.Vector3, voxelT: number): { key: string; name: string; progress: number; minutes: number; top: THREE.Vector3 } | null {
    const w = this.world;
    if (!w) return null;
    const list = this.placedWithY().filter((p) => p.progress < 1);
    if (!list.length) return null;
    const h = rayHitPlacedT(list, [origin.x, origin.y, origin.z], [dir.x, dir.y, dir.z], w.size / 2);
    if (h.index < 0 || h.t > voxelT + 0.5) return null;
    const p = list[h.index];
    const half = w.size / 2;
    return { key: `${p.id}:${p.x}:${p.z}`, name: p.design.name, progress: p.progress, minutes: minutesLeft(p.progress, p.design), top: new THREE.Vector3(p.x + 0.5 - half, p.y + p.design.bounds.max[1] + 0.3, p.z + 0.5 - half) };
  }

  /** 建設中の建物の様子（key は siteAt の物）。建ち終わった・片付けた建物なら null */
  siteInfo(key: string): { name: string; progress: number; minutes: number; built: number; total: number; top: THREE.Vector3 } | null {
    const w = this.world;
    if (!w) return null;
    const p = this.placedWithY().find((q) => `${q.id}:${q.x}:${q.z}` === key && q.progress < 1);
    if (!p) return null;
    const half = w.size / 2;
    const total = p.design.cubes.length;
    return { name: p.design.name, progress: p.progress, minutes: minutesLeft(p.progress, p.design), built: builtCount(p.progress, total), total, top: new THREE.Vector3(p.x + 0.5 - half, p.y + p.design.bounds.max[1] + 0.3, p.z + 0.5 - half) };
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
    this.env();
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
    this.env();
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
    this.advanceBuildings(dtReal * 1000 * this.farm.speed);
    this.animateSites(dtReal);
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
    // 地面の小物：変わってから少し待って置き直す（なぞっている間に毎フレーム作り直さない）。せり上がり中は待つ
    this.groundTimer -= dtReal;
    if (this.groundDirty && this.groundTimer <= 0 && !this.isRising()) { this.rebuildGround(); this.groundTimer = 0.3; }
    this.flushRemesh();
  }

  /** 早送り（デバッグ用）：hours 時間ぶん一気に進める */
  skip(hours: number, env: { season: number; raining: boolean }) {
    const steps = Math.ceil(hours * 4); // 15 分ずつ
    for (let i = 0; i < steps; i++) this.farm.advance((hours * HOUR) / steps, { ...env, isWet: (col) => this.isWet(col) });
    this.advanceBuildings(hours * HOUR);
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
        flowers: [...this.planted.entries()],
      },
      buildings: {
        designs: [...this.designs.values()],
        placed: this.placed.map((p): [string, number, number, Rot, number?] => (p.progress >= 1 ? [p.id, p.x, p.z, p.rot] : [p.id, p.x, p.z, p.rot, +p.progress.toFixed(5)])),
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
    // 切った自然の木：その列には若木（植えた木）があるので、生成した木の形は消す
    const sapCols = new Set(f.saplings.map((s) => s.col));
    for (const d of this.decor) {
      if (d.kind !== 'tree' || !sapCols.size) continue;
      const keep: number[] = [];
      for (let i = 0; i < d.placements.length; i += 5) {
        if (sapCols.has(Math.floor(d.placements[i]) + Math.floor(d.placements[i + 2]) * w.size)) continue;
        for (let k = 0; k < 5; k++) keep.push(d.placements[i + k]);
      }
      if (keep.length !== d.placements.length) { d.placements = new Float32Array(keep); this.buildDecor(d); }
    }
    // 植えた花（今の地面が草地の列だけ）
    for (const [col, variant] of save.farm.flowers ?? []) {
      const h = w.heights[col];
      if (h > 0 && w.voxels[col + (h - 1) * w.size * w.size] === GRASS && !this.treeCols.has(col)) this.addFlower(col, variant);
    }
    // 建物：棚は保存のものに置き換える
    for (const g of this.buildingGeos.values()) g.dispose();
    this.buildingGeos.clear();
    this.designs = new Map(save.buildings.designs.map((d) => [d.id, d]));
    // 進み具合のない古い記録は、建ち終わった建物として読む
    this.placed = save.buildings.placed.filter(([id]) => this.designs.has(id)).map(([id, x, z, rot, progress]) => ({ id, x, z, rot, progress: progress ?? 1 }));
    if (this.selectedDesign && !this.designs.has(this.selectedDesign)) this.selectedDesign = null;
    this.rebuildCrops();
    this.rebuildGrowing();
    this.rebuildBuildings();
    this.undo.clear();
    this.redo.clear();
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
    if (target <= from) return { hours: 0, ripened: 0, grown: 0, built: 0 };
    const ripeBefore = [...f.crops.values()].filter((c) => c.progress >= 1).length;
    const builtBefore = this.placed.filter((p) => p.progress >= 1).length;
    const grownBefore = f.saplings.filter((s) => s.progress >= 1).length;
    const STEP = 15 * 60 * 1000;
    while (f.simMs < target) {
      const dt = Math.min(STEP, target - f.simMs);
      f.advance(dt, { ...envAt(f.simMs), isWet: (col) => this.isWet(col) });
    }
    // 閉じていた間の建設は、建ち終わりの知らせを 1 棟ずつ出さず、数だけ返す
    const done = this.onBuildingDone;
    this.onBuildingDone = null;
    this.advanceBuildings(target - from);
    this.onBuildingDone = done;
    this.rebuildBuildings();
    this.rebuildCrops();
    this.rebuildGrowing();
    this.wetCheck = 0;
    return {
      hours: (target - from) / HOUR,
      ripened: [...f.crops.values()].filter((c) => c.progress >= 1).length - ripeBefore,
      grown: f.saplings.filter((s) => s.progress >= 1).length - grownBefore,
      built: this.placed.filter((p) => p.progress >= 1).length - builtBefore,
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
      building: this.placed.filter((p) => p.progress < 1).length,
      edits: this.edits.size,
    };
  }
}
