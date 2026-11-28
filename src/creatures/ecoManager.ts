import * as THREE from 'three/webgpu';
import type { WorldData } from '../world/terrain';
import type { SaveData } from '../save/format';
import { countOpen } from '../world/plots';
import { classifyColumns, countEnvironment, emptyEnv, fitsHabitat, habitatCols, houseWallSpots, type EnvCounts, type EnvInput } from '../eco/environment';
import { checkEcosystem, dueChecks, needsStarterRabbits, stayMs, type EcoState } from '../eco/ecosystem';
import { VISITOR, type DexId, type Moment, type VisitorId, VISITOR_POINTS } from '../eco/species';
import { markSeen, observe, type Dex } from '../eco/dexState';
import { SPECIES, SPECIES_LIST, NAMES, makeResident, type Animal, type Species } from './animals';
import { pickName, placeResident, restorePlace } from './place';
import { Visitor, type TreeShape, type VisitorPlace } from './visitors';
import { SATISFIED_POINTS, TREAT_MS, jobEffects, pickShareCrop, visitorGift, type ResidentInfo } from '../eco/residents';
import type { MatId } from '../game/materials';
import type { Fireflies } from './fireflies';

export interface EcoDeps {
  diorama: THREE.Group;
  /** 環境を数えるための材料（ゲームの花・木・畑・作物） */
  envInput: () => Omit<EnvInput, 'world'>;
  toast: (msg: string, ms?: number) => void;
  fireflies: Fireflies;
  /** その列の木の形（鳥がとまる位置）。木が無い・小さい苗木なら null */
  treeShape: (col: number) => TreeShape | null;
  /** 住人・訪問者が増えた・減った・図鑑が変わった時 */
  onChanged: () => void;
  /** 発見ポイントが入った（訪問者が来た時など） */
  onPoints?: (n: number) => void;
  /** 訪問者が、その箱庭でとれない素材を運んできた（v0.16.1） */
  onGift?: (id: VisitorId, mat: MatId, n: number) => void;
  /** エフェクト（v0.21.0。ID は docs/エフェクト一覧.md。位置はマスの座標） */
  onFx?: (id: string, at: { x: number; y: number; z: number }) => void;
}

/**
 * 生き物のまとめ役：住人（保存する）と訪問者（保存しない）、図鑑、来るかどうかの判定。
 * 判定の中身は eco/ の純粋な関数。ここは置く・消す・時刻の管理だけをする。
 */
/**
 * デバッグ用の目印：地形や木を透かして見える丸い印（画面上でいつも同じ大きさ）と、上に伸びる柱。
 * 住人は黄色、訪問者は水色。形と材質は全員で共有する
 */
function ringTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.fill();
  g.lineWidth = 7; g.strokeStyle = '#fff';
  g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let ringTex: THREE.CanvasTexture | null = null;
const markerBeam = new THREE.CylinderGeometry(0.06, 0.06, 12, 6).translate(0, 6.5, 0);
const markerMats: Partial<Record<'resident' | 'visitor', [THREE.SpriteMaterial, THREE.MeshBasicMaterial]>> = {};
function matsOf(kind: 'resident' | 'visitor') {
  if (!markerMats[kind]) {
    ringTex ??= ringTexture();
    const color = kind === 'resident' ? 0xffd84a : 0x5fe3ff;
    markerMats[kind] = [
      new THREE.SpriteMaterial({ map: ringTex, color, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true }),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false }),
    ];
  }
  return markerMats[kind]!;
}
function makeMarker(kind: 'resident' | 'visitor', parentScale: number): THREE.Group {
  const g = new THREE.Group();
  const [ringMat, beamMat] = matsOf(kind);
  const ring = new THREE.Sprite(ringMat), beam = new THREE.Mesh(markerBeam, beamMat);
  ring.scale.set(0.045, 0.045, 1); // 画面の高さに対する大きさ（遠くても同じ）
  ring.position.y = 0.3;
  ring.renderOrder = beam.renderOrder = 999; // 何よりも後に、透かして描く
  g.add(ring, beam);
  g.scale.setScalar(1 / parentScale); // 生き物の大きさによらず同じ大きさに
  g.userData.marker = true;
  return g;
}

export class EcoManager {
  animals: Animal[] = [];
  dex: Dex = {};
  /** 来ている訪問者（ホタルは見た目を持たず、今のホタルの光を使う） */
  visitors: Visitor[] = [];
  get visitorStays(): { id: VisitorId; leavesAt: number }[] { return this.visitors.map((v) => ({ id: v.def.id, leavesAt: v.leavesAt })); }
  private world: WorldData | null = null;
  private envCache: EnvCounts | null = null;
  private lastCheckSim = 0;
  /** 生き物の多さの倍率（デバッグ。保存しない）。来る確率・上限・1 回に引っ越してくる数が増える */
  abundance = 1;
  private lastCheckReal = -Infinity;
  private nextId = 0;
  /** デバッグ：全部の生き物に、透かして見える目印を付ける */
  private highlight = false;
  /** 季節の目標にある「まれ」の訪問者（来る確率を上げる。v0.17） */
  goalBoost: ReadonlySet<string> = new Set();
  /** 雪が降っているか（住人が家のそばで暖まる。v0.17） */
  private snowing = false;

  constructor(private deps: EcoDeps) {}

  /** 目印を付ける・外す（デバッグ「生き物を透かして表示」） */
  setHighlight(on: boolean) {
    this.highlight = on;
    for (const a of this.animals) this.mark(a.object, 'resident');
    for (const v of this.visitors) this.mark(v.object, 'visitor');
  }

  private mark(o: THREE.Object3D, kind: 'resident' | 'visitor') {
    const old = o.children.find((c) => c.userData.marker);
    if (old && !this.highlight) o.remove(old);
    if (!old && this.highlight) o.add(makeMarker(kind, o.scale.x));
  }

  /** 箱庭を作った時：生き物を全部片付ける（住人・図鑑は restore で入れる） */
  reset(world: WorldData, simMs: number) {
    this.world = world;
    this.dex = {};
    for (const a of this.animals) a.object.removeFromParent();
    this.animals = [];
    for (const v of this.visitors) v.dispose();
    this.visitors = [];
    this.deps.fireflies.setPresent(false);
    this.envCache = null;
    this.nextId = 0;
    this.resetClock(simMs);
  }

  /**
   * 図鑑と住人を入れる。畑・苗木を戻した後に呼ぶ（苗木の列は歩けないので、その上に住人を戻さないように）。
   * residents が null（新しい箱庭）か、戻せた住人が 1 匹もいない時（段階 ① の保存データ）は、うさぎを 1〜2 匹置く
   */
  restore(dex: Dex, residents: SaveData['residents'] | null) {
    const world = this.world!;
    this.dex = structuredClone(dex);
    for (const [sp, x, z, name, treated] of residents ?? []) {
      if (!(sp in SPECIES)) continue;
      const at = restorePlace(world, x, z) ?? placeResident(world, sp as Species, Math.random, this.deps.envInput().treeCols);
      if (!at) continue;
      const a = this.put(sp as Species, at, name);
      if (typeof treated === 'number' && Number.isFinite(treated)) a.treatedUntil = treated;
    }
    if (needsStarterRabbits(this.animals.map((a) => a.species))) {
      const n = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) this.addResident('rabbit');
    }
    this.deps.onChanged();
  }

  /** 作り直し（画質の自動切り替えなど）の前にいた訪問者を、新しい場所で呼び戻す（滞在の残り時間はそのまま） */
  readdVisitors(stays: { id: VisitorId; leavesAt: number }[]) {
    for (const v of stays) this.addVisitor(v.id, v.leavesAt);
    if (stays.length) this.deps.onChanged();
  }

  /** 判定の基準をいまにそろえる（閉じていた間の時間を進めた後など。まとめて引っ越してこないように） */
  resetClock(simMs: number) { this.lastCheckSim = simMs; }

  /** 環境が変わったかもしれない（次に env() を読む時に数え直す） */
  envDirty() { this.envCache = null; }
  env(): EnvCounts {
    if (!this.envCache && this.world) this.envCache = countEnvironment({ world: this.world, ...this.deps.envInput() });
    return this.envCache ?? emptyEnv();
  }

  private put(sp: Species, at: [number, number], name?: string) {
    const used = new Set(this.animals.map((a) => a.name));
    const a = makeResident(this.world!, sp, at[0], at[1], this.nextId++, name ?? pickName(NAMES, used));
    this.animals.push(a);
    this.deps.diorama.add(a.object);
    this.mark(a.object, 'resident');
    return a;
  }

  private addResident(sp: Species) {
    const input = this.deps.envInput();
    const at = placeResident(this.world!, sp, Math.random, input.treeCols, { codes: classifyColumns({ world: this.world!, ...input }), buildingCols: input.buildingCols });
    if (!at) return null;
    markSeen(this.dex, sp, Date.now());
    return this.put(sp, at);
  }

  /** 毎フレーム呼ぶ。判定の時なら 1 回だけ判定する */
  update(dt: number, hour: number, moment: Moment, simMs: number, nowReal: number) {
    for (const a of this.animals) a.update(dt, hour);
    for (const v of this.visitors) v.update(dt);
    if (!this.world || !dueChecks(this.lastCheckSim, simMs, this.lastCheckReal, nowReal)) return;
    this.lastCheckSim = simMs;
    this.lastCheckReal = nowReal;
    this.check(moment, nowReal, Math.random);
  }

  /** 1 回判定する。来た訪問者と引っ越してきた住人の数を返す */
  check(moment: Moment, nowReal: number, rand: () => number): { arrived: number; left: number; movedIn: boolean } {
    // 訪問者のいる場所が、まだ合っているか（埋めた水・耕した花など）。ホタルは場所を持たない
    const input = { world: this.world!, ...this.deps.envInput() };
    const visitors = this.visitors.map((v) => ({ id: v.def.id, leavesAt: v.leavesAt, homeOk: v.def.motion === 'glow' ? undefined : fitsHabitat(input, v.def.habitat, v.home) }));
    const state: EcoState = { visitors, residents: this.animals.map((a) => a.species), openPlots: countOpen(this.world!.plots), abundance: this.abundance, liked: input.liked, boost: this.goalBoost };
    const r = checkEcosystem(state, this.env(), moment, nowReal, rand);
    let arrived = 0, movedIn = false;
    for (const id of r.leave) { this.fxAtVisitor('D03', id); this.removeVisitor(id); }
    // きつねがいると、訪問者が少し長くいる（仕事）
    const jobs = jobEffects(this.residentInfos(), this.world!.size);
    for (const id of r.arrive) {
      if (!this.addVisitor(id, nowReal + stayMs(Math.random) * jobs.stayMul)) continue;
      arrived++;
      // その箱庭でとれない素材を、たまに運んでくる
      const gift = visitorGift(this.env(), Math.random);
      if (gift) { this.deps.onGift?.(id, gift.mat, gift.n); this.fxAtVisitor('D12', id); }
    }
    if (arrived) this.deps.onPoints?.(arrived * VISITOR_POINTS); // 訪問者が来るたびに少し
    // 生き物の多さを上げていると、1 回に何匹も引っ越してくる。知らせは 1 回にまとめる
    const came: string[] = [];
    let firstSeen = false;
    for (const sp of r.moveIns) {
      const first = !this.dex[sp];
      const a = this.addResident(sp);
      if (!a) continue;
      this.fxAtAnimal('D04', a);
      if (first) firstSeen = true;
      else came.push(`${SPECIES[sp].name}の${a.name}`);
      movedIn = true;
      // 好きな家がある所に来た：満足して発見ポイント（カピバラがいると 2 倍）
      if (input.liked?.has(sp)) {
        const pts = SATISFIED_POINTS * jobEffects(this.residentInfos(), this.world!.size).satisfyMul;
        this.fxAtAnimal('D05', a);
        this.deps.onPoints?.(pts);
        if (!first) this.deps.toast(`${SPECIES[sp].name}の${a.name}は、家が気に入ったようだ ✨ +${pts}`);
      }
    }
    if (firstSeen) this.deps.toast('何かの気配がする…');
    else if (came.length === 1) this.deps.toast(`${came[0]}が引っ越してきた`);
    else if (came.length > 1) this.deps.toast(`${came[0]}など ${came.length} 匹が引っ越してきた`);
    if (r.leave.length || arrived || movedIn) this.deps.onChanged();
    if (this.snowing) this.assignWarmSpots(); // 家が建った・住人が来た
    return { arrived, left: r.leave.length, movedIn };
  }

  /** 雪が降り始めた・やんだ（v0.17）。降っている間、家のそばの住人は家に寄り添って暖まる */
  setSnowing(on: boolean) {
    if (on === this.snowing) return;
    this.snowing = on;
    if (on) this.assignWarmSpots();
    else for (const a of this.animals) a.warmSpot = null;
  }

  /**
   * 暖まる所を決める：家（飾りは除く）の足元のすぐ外の、歩ける列。住人ごとに近い所を 1 つ（重ならないように）。
   * 家から 40 列より遠い住人は行かない。決まっている所がまだ使えるなら、そのまま
   */
  private assignWarmSpots() {
    const w = this.world;
    if (!w) return;
    const N = w.size;
    const homes = this.deps.envInput().homeCols;
    const spots: { x: number; z: number; face: number }[] = [];
    for (const col of homes ?? []) {
      const hx = col % N, hz = Math.floor(col / N);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = hx + dx, z = hz + dz, n = x + z * N;
        if (x < 0 || z < 0 || x >= N || z >= N || homes!.has(n) || w.walkable[n] !== 1) continue;
        if (!spots.some((s) => s.x === x && s.z === z)) spots.push({ x, z, face: Math.atan2(dx, dz) });
      }
    }
    const used = new Set<string>();
    const ok = (s: { x: number; z: number }) => spots.some((p) => p.x === s.x && p.z === s.z) && !used.has(`${s.x},${s.z}`);
    for (const a of this.animals) if (a.warmSpot && ok(a.warmSpot)) used.add(`${a.warmSpot.x},${a.warmSpot.z}`); else a.warmSpot = null;
    for (const a of this.animals) {
      if (a.warmSpot) continue;
      const [ax, az] = a.colXZ;
      let best: (typeof spots)[number] | null = null, bd = 40;
      for (const s of spots) {
        const d = Math.hypot(s.x - ax, s.z - az);
        if (d < bd && !used.has(`${s.x},${s.z}`)) { bd = d; best = s; }
      }
      if (best) { a.warmSpot = best; used.add(`${best.x},${best.z}`); }
    }
  }

  /** 訪問者を足す。現れる場所が無ければ来ない。初めてなら「何かの気配がする…」 */
  addVisitor(id: VisitorId, leavesAt: number): boolean {
    if (!this.world || this.visitors.some((v) => v.def.id === id)) return false;
    const def = VISITOR[id];
    const input = { world: this.world, ...this.deps.envInput() };
    // とまる鳥・ムササビは、育った木だけ（小さい苗木にはとまらない）
    const onTree = def.motion === 'perch' || def.motion === 'glide';
    const cols = onTree ? habitatCols(input, def.habitat).filter((c) => this.deps.treeShape(c)) : habitatCols(input, def.habitat);
    if (cols.length === 0) return false;
    const pick = (a: number[]) => a[Math.floor(Math.random() * a.length)];
    const N = this.world.size;
    let home = pick(cols);
    const place: VisitorPlace = {};
    if (id === 'bee') {
      // ミツバチ：花と作物（畑）の間を行き来する
      const flowers = habitatCols(input, 'flower'), farm = habitatCols(input, 'farm');
      if (flowers.length && farm.length) { home = pick(flowers); place.second = pick(farm); }
    }
    if (onTree) place.tree = this.deps.treeShape(home);
    if (def.motion === 'glide') {
      // ムササビ：4〜14 列離れた、もう 1 本の育った木へ滑空する
      const hx = home % N, hz = Math.floor(home / N);
      const far = cols.filter((c) => { const d = Math.hypot((c % N) - hx, Math.floor(c / N) - hz); return d >= 4 && d <= 14; });
      if (far.length) { place.second = pick(far); place.tree2 = this.deps.treeShape(place.second); }
    }
    if (def.motion === 'wall') {
      // ヤモリ：建物の足元の縁の列と、壁の外向き
      const spot = houseWallSpots(input).find((s) => s.col === home);
      if (spot) place.wall = { dx: spot.dx, dz: spot.dz };
    }
    const v = new Visitor(def, this.world, home, leavesAt, place);
    this.visitors.push(v);
    this.deps.diorama.add(v.object);
    // ホタルは見た目を持たない（光そのものが目印）
    if (def.motion !== 'glow') this.mark(v.object, 'visitor');
    if (id === 'firefly') this.deps.fireflies.setPresent(true);
    const first = markSeen(this.dex, id, Date.now());
    if (first) this.deps.toast('何かの気配がする…');
    if (id !== 'firefly') this.fxAtVisitor(first ? 'D01' : 'D02', id);
    return true;
  }

  /** エフェクトを、その訪問者・住人の所で */
  private fxAtVisitor(fx: string, id: VisitorId) {
    const v = this.visitors.find((x) => x.def.id === id);
    if (!v || !this.world) return;
    const h = this.world.size / 2, p = v.anchor ?? v.object.position;
    this.deps.onFx?.(fx, { x: p.x + h, y: p.y, z: p.z + h });
  }
  fxAtAnimal(fx: string, a: Animal) {
    if (!this.world) return;
    const h = this.world.size / 2, p = a.object.position;
    this.deps.onFx?.(fx, { x: p.x + h, y: p.y, z: p.z + h });
  }

  removeVisitor(id: VisitorId) {
    for (const v of this.visitors) if (v.def.id === id) v.dispose();
    this.visitors = this.visitors.filter((v) => v.def.id !== id);
    if (id === 'firefly') this.deps.fireflies.setPresent(false);
  }

  /** デバッグ：条件を見ずにすぐ 1 匹出す（滞在 30 分） */
  spawnVisitor(id: VisitorId) {
    this.removeVisitor(id);
    const ok = this.addVisitor(id, performance.now() + 30 * 60_000);
    if (ok) this.deps.onChanged();
    return ok;
  }

  /**
   * デバッグ：全種類の生き物を条件を見ずに一気に出す。住人は種類ごとに 1 匹ずつ引っ越してくる（保存される）。
   * 訪問者は 1 匹ずつ（いれば出し直す。滞在 30 分）。居場所が無い種類は出ない。出なかった種類の名前を返す
   */
  spawnAll(): { residents: number; visitors: number; missed: string[] } {
    if (!this.world) return { residents: 0, visitors: 0, missed: [] };
    let residents = 0, visitors = 0;
    const missed: string[] = [];
    for (const sp of SPECIES_LIST) {
      if (this.addResident(sp)) residents++;
      else missed.push(SPECIES[sp].name);
    }
    for (const id of Object.keys(VISITOR) as VisitorId[]) {
      this.removeVisitor(id);
      if (this.addVisitor(id, performance.now() + 30 * 60_000)) visitors++;
      else missed.push(VISITOR[id].name);
    }
    this.deps.onChanged();
    return { residents, visitors, missed };
  }

  /** 建物の足元（歩けなくなった列）にいる住人を、近くの歩ける列へ移す。めり込んだままにしないため */
  evictFrom(cols: ReadonlySet<number>) {
    const w = this.world;
    if (!w || !cols.size) return;
    for (const a of this.animals) {
      const [x, z] = a.colXZ;
      if (!cols.has(x + z * w.size)) continue;
      const to = restorePlace(w, x, z) ?? placeResident(w, a.species);
      if (to) a.moveTo(to[0], to[1]);
    }
  }

  /** デバッグ：訪問者をみんな帰す */
  clearVisitors() {
    for (const v of [...this.visitors]) this.removeVisitor(v.def.id);
    this.deps.onChanged();
  }

  /** 観察するとポイントが入るか（まだ観察していない、または訪問者をこの季節にまだ観察していない） */
  needsObserving(id: DexId, season: number): boolean {
    const e = this.dex[id];
    return !e || e.observedAt === undefined || (id in VISITOR && !e.seasons.includes(season));
  }

  /** 観察した：入ったポイントを返す。通知も出す */
  observe(id: DexId, season: number): number {
    const pts = observe(this.dex, id, season, Date.now());
    const name = id in VISITOR ? VISITOR[id as VisitorId].name : SPECIES[id as Species].name;
    this.deps.toast(`${name}を観察した！${pts > 0 ? ` +${pts}` : ''}`);
    this.deps.onChanged();
    return pts;
  }

  residentsSave(): SaveData['residents'] {
    return this.animals.map((a) => (a.treatedUntil ? [a.species, ...a.colXZ, a.name, a.treatedUntil] : [a.species, ...a.colXZ, a.name]));
  }

  /** 住人の様子（仕事の効き目・拾う素材に使う。eco/residents.ts） */
  residentInfos(): ResidentInfo[] {
    const N = this.world?.size ?? 0;
    return this.animals.map((a) => { const [x, z] = a.colXZ; return { species: a.species, col: x + z * N, treatedUntil: a.treatedUntil }; });
  }

  /**
   * おすそ分け（v0.16.1）：収穫物を 1 つあげる。好きなものがあればそれ。あげた物を返す（無ければ null）。
   * その住人は箱庭の 3 日間、素材を多く拾ってくる
   */
  share(a: Animal, inv: Record<string, number>, now: number): string | null {
    const crop = pickShareCrop(inv, a.favorite);
    if (!crop) return null;
    inv[crop] = (inv[crop] ?? 0) - 1;
    a.treatedUntil = Math.max(a.treatedUntil, now) + TREAT_MS;
    this.deps.onChanged();
    return crop;
  }
}
