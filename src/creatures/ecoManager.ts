import * as THREE from 'three/webgpu';
import type { WorldData } from '../world/terrain';
import type { SaveData } from '../save/format';
import { countOpen } from '../world/plots';
import { countEnvironment, fitsHabitat, habitatCols, type EnvCounts, type EnvInput } from '../eco/environment';
import { checkEcosystem, dueChecks, needsStarterRabbits, stayMs, type EcoState } from '../eco/ecosystem';
import { VISITOR, type DexId, type Moment, type VisitorId } from '../eco/species';
import { markSeen, observe, type Dex } from '../eco/dexState';
import { SPECIES, NAMES, makeResident, type Animal, type Species } from './animals';
import { pickName, placeResident, restorePlace } from './place';
import { Visitor } from './visitors';
import type { Fireflies } from './fireflies';

export interface EcoDeps {
  diorama: THREE.Group;
  /** 環境を数えるための材料（ゲームの花・木・畑・作物） */
  envInput: () => Omit<EnvInput, 'world'>;
  toast: (msg: string, ms?: number) => void;
  fireflies: Fireflies;
  /** 住人・訪問者が増えた・減った・図鑑が変わった時 */
  onChanged: () => void;
}

/**
 * 生き物のまとめ役：住人（保存する）と訪問者（保存しない）、図鑑、来るかどうかの判定。
 * 判定の中身は eco/ の純粋な関数。ここは置く・消す・時刻の管理だけをする。
 */
export class EcoManager {
  animals: Animal[] = [];
  dex: Dex = {};
  /** 来ている訪問者（ホタルは見た目を持たず、今のホタルの光を使う） */
  visitors: Visitor[] = [];
  get visitorStays(): { id: VisitorId; leavesAt: number }[] { return this.visitors.map((v) => ({ id: v.def.id, leavesAt: v.leavesAt })); }
  private world: WorldData | null = null;
  private envCache: EnvCounts | null = null;
  private lastCheckSim = 0;
  private lastCheckReal = -Infinity;
  private nextId = 0;

  constructor(private deps: EcoDeps) {}

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
    for (const [sp, x, z, name] of residents ?? []) {
      if (!(sp in SPECIES)) continue;
      const at = restorePlace(world, x, z) ?? placeResident(world, sp as Species, Math.random, this.deps.envInput().treeCols);
      if (at) this.put(sp as Species, at, name);
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
    return this.envCache ?? { flowers: 0, trees: 0, grass: 0, waterside: 0, deepWater: 0, farmland: 0, crops: 0 };
  }

  private put(sp: Species, at: [number, number], name?: string) {
    const used = new Set(this.animals.map((a) => a.name));
    const a = makeResident(this.world!, sp, at[0], at[1], this.nextId++, name ?? pickName(NAMES, used));
    this.animals.push(a);
    this.deps.diorama.add(a.object);
    return a;
  }

  private addResident(sp: Species) {
    const at = placeResident(this.world!, sp, Math.random, this.deps.envInput().treeCols);
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
    const state: EcoState = { visitors, residents: this.animals.map((a) => a.species), openPlots: countOpen(this.world!.plots) };
    const r = checkEcosystem(state, this.env(), moment, nowReal, rand);
    let arrived = 0, movedIn = false;
    for (const id of r.leave) this.removeVisitor(id);
    for (const id of r.arrive) if (this.addVisitor(id, nowReal + stayMs(Math.random))) arrived++;
    if (r.moveIn) {
      const first = !this.dex[r.moveIn];
      const a = this.addResident(r.moveIn);
      if (a) {
        this.deps.toast(first ? '何かの気配がする…' : `${SPECIES[r.moveIn].name}の${a.name}が引っ越してきた`);
        movedIn = true;
      }
    }
    if (r.leave.length || arrived || movedIn) this.deps.onChanged();
    return { arrived, left: r.leave.length, movedIn };
  }

  /** 訪問者を足す。現れる場所が無ければ来ない。初めてなら「何かの気配がする…」 */
  addVisitor(id: VisitorId, leavesAt: number): boolean {
    if (!this.world || this.visitors.some((v) => v.def.id === id)) return false;
    const def = VISITOR[id];
    const input = { world: this.world, ...this.deps.envInput() };
    const cols = habitatCols(input, def.habitat);
    if (cols.length === 0) return false;
    const pick = (a: number[]) => a[Math.floor(Math.random() * a.length)];
    let second: number | undefined;
    let home = pick(cols);
    if (id === 'bee') {
      // ミツバチ：花と作物（畑）の間を行き来する
      const flowers = habitatCols(input, 'flower'), farm = habitatCols(input, 'farm');
      if (flowers.length && farm.length) { home = pick(flowers); second = pick(farm); }
    }
    const v = new Visitor(def, this.world, home, leavesAt, second);
    this.visitors.push(v);
    this.deps.diorama.add(v.object);
    if (id === 'firefly') this.deps.fireflies.setPresent(true);
    if (markSeen(this.dex, id, Date.now())) this.deps.toast('何かの気配がする…');
    return true;
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
    return this.animals.map((a) => [a.species, ...a.colXZ, a.name]);
  }
}
