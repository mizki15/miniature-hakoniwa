import * as THREE from 'three/webgpu';
import type { WorldData } from '../world/terrain';
import type { VisitorDef, VisitorId } from '../eco/species';
import { mergeModel } from './animals';
import { buildVisitorParts, type VisitorModelId } from './models';
import { hopArc, turnToward, wrapAngle } from './motion';

export interface TreeShape { ground: number; top: number; radius: number; trunk: number }

/**
 * 訪問者（しばらく滞在して去る生き物）の見た目と動き。
 * 形は creatures/models.ts（Codex と作ったローポリ）。体は 1 つのメッシュにまとめ、翼は左右を別に動かす（v0.16）。
 *   object（位置・向き・前後と左右の傾き）→ pose（伸び縮み）→ 体・左の翼・右の翼
 */

/** 見つけやすいよう、モデルより大きめに出す（大きな鳥は控えめに） */
const SCALE: Partial<Record<VisitorId, number>> = {
  sparrow: 1.6, kingfisher: 1.6, woodpecker: 1.6, longtailedTit: 1.6, owl: 1.6, mejiro: 1.6, skylark: 1.6, swallow: 1.6, cricket: 1.6,
  eagle: 1.25, heron: 1.3, crane: 1.3, gull: 1.35, seaTurtle: 1.35, crab: 1.5, gecko: 1.5, flyingSquirrel: 1.5,
};

const smooth = (u: number) => u * u * (3 - 2 * u);
/** 鳥の羽ばたき：打ち下ろしは速く、引き上げはゆっくり（-0.6..1） */
const stroke = (beat: number) => { const s = Math.sin(beat); return s > 0 ? s : s * 0.6; };

/** 現れる場所の補い（ecoManager が選ぶ）：ミツバチの行き先、とまる木、ムササビの 2 本目の木、ヤモリの壁の向き */
export interface VisitorPlace { second?: number; tree?: TreeShape | null; tree2?: TreeShape | null; wall?: { dx: number; dz: number } }

export class Visitor {
  readonly object = new THREE.Group();
  /** 伸び縮み（カエルの跳ね・カタツムリのはい方）は、この形の大きさを変えて見せる */
  private pose = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private wingL: THREE.Object3D | null = null;
  private wingR: THREE.Object3D | null = null;
  private folded = 0;
  private hx: number; private hz: number; private ground: number;
  private t = Math.random() * 100;
  private px: number; private pz: number; private tx: number; private tz: number;
  /** 跳ねる・はう生き物の、次に動き出すまでの時間（ミツバチは花の上で止まっている時間） */
  private hopT = 0;
  /** 1 回の跳ねの進み（0..1）と、その跳ねの出発点・着く点 */
  private hopU = 1;
  private hop0 = { x: 0, z: 0 }; private hop1 = { x: 0, z: 0 };
  private heading = Math.random() * Math.PI * 2;
  /** 体の左右の傾き（曲がる時に内側へ） */
  private roll = 0;
  /** 動きの段階と、その残り時間 */
  private mode = 'fly';
  private modeT = 2 + Math.random() * 4;
  /** 飛ぶ生き物の、いまの位置（fx, fz, 地面からの高さ fy）と次の場所（gx, gz） */
  private fx: number; private fz: number; private fy = 1; private gx: number; private gz: number;
  /** 段階の始まりの位置（上昇・下降・滑空の出発点） */
  private sx = 0; private sy = 0; private sz = 0;
  /** ミツバチの行き来の進み（0..1）と向き */
  private beeU = 0; private beeDir = 1;
  /** 羽ばたきの位相 */
  private beat = Math.random() * 10;
  /** 旋回する鳥の角度 */
  private orbit = Math.random() * Math.PI * 2;

  /** とまる木の形（キツツキ・シマエナガ・フクロウ・メジロ・ムササビ） */
  private tree: TreeShape;
  private tree2: TreeShape | null;
  private wall: { dx: number; dz: number };

  /** home：現れる場所の列（x + z*size） */
  constructor(readonly def: VisitorDef, private world: WorldData, readonly home: number, public leavesAt: number, place: VisitorPlace = {}) {
    const N = world.size;
    this.hx = (home % N) + 0.5; this.hz = Math.floor(home / N) + 0.5;
    this.ground = world.heights[home];
    this.px = this.tx = this.hx; this.pz = this.tz = this.hz;
    this.fx = this.gx = this.hx; this.fz = this.gz = this.hz;
    if (place.second !== undefined) { this.tx = (place.second % N) + 0.5; this.tz = Math.floor(place.second / N) + 0.5; }
    this.tree = place.tree ?? { ground: this.ground, top: this.ground + 7, radius: 2.4, trunk: 0.65 };
    this.tree2 = place.tree2 ?? null;
    this.wall = place.wall ?? { dx: 1, dz: 0 };
    if (def.id !== 'firefly') {
      const parts = buildVisitorParts(def.id as VisitorModelId);
      this.model = mergeModel(parts.body);
      this.pose.add(this.model);
      if (parts.wings) {
        const [x, y, z] = parts.wings.pivot;
        const l = new THREE.Group(), r = new THREE.Group();
        l.add(mergeModel(parts.wings.left)); r.add(mergeModel(parts.wings.right));
        l.position.set(x, y, z); r.position.set(-x, y, z);
        this.pose.add(l, r);
        this.wingL = l; this.wingR = r; this.folded = parts.wings.folded;
      }
      this.object.add(this.pose);
    }
    this.object.scale.setScalar(SCALE[def.id] ?? 1.4);
    // 向きを決めた後に、体から見て前後・左右へ傾ける（つつく・跳ぶ・旋回）
    this.object.rotation.order = 'YXZ';
    this.object.userData.visitor = this;
    // 鳥は最初、空の上（ヒバリは地面から）
    if (def.id === 'skylark') { this.mode = 'ground'; this.modeT = 2 + Math.random() * 3; }
    if (def.motion === 'glide') { this.mode = 'sit'; this.modeT = 1 + Math.random() * 3; }
    // ワシは、旋回の輪（半径 7）の下でいちばん高い地面より 4 上、少なくとも出た所の 11 上を飛ぶ（山にめり込まない）
    if (def.id === 'eagle') {
      let top = this.ground + 7;
      for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; top = Math.max(top, this.surfaceAt(this.hx + Math.cos(a) * 7, this.hz + Math.sin(a) * 7)); }
      this.sy = Math.max(this.ground + 11, top + 4);
    }
    this.update(0);
  }

  /** 観察の基準点（ホバーの判定に使う） */
  get anchor(): THREE.Vector3 { return this.object.position; }

  private groundAt(x: number, z: number) {
    const N = this.world.size, ix = Math.floor(x), iz = Math.floor(z);
    if (ix < 0 || iz < 0 || ix >= N || iz >= N) return this.ground;
    return this.world.heights[ix + iz * N] || this.ground;
  }

  /** 地面か水面の高さ（飛ぶ生き物が水の上でも水面より下に潜らないように） */
  private surfaceAt(x: number, z: number) { return Math.max(this.groundAt(x, z), this.world.waterLevel); }

  /** 飛ぶ生き物の基準の高さ（なめらかに追う。v0.16.2） */
  private baseY: number | null = null;
  /**
   * 飛ぶ生き物の基準の高さ：足元の地面（水面）を、まわり r 列も見て、なめらかに追う。
   * 真下の列の高さをそのまま使うと、列の段差のたびに高さが跳んでカクカクする（v0.16.2）。
   * 上がる時は速く（ぶつからないように）、下がる時はゆっくり
   */
  private smoothSurface(x: number, z: number, dt: number, r = 1) {
    let s = 0;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) s = Math.max(s, this.surfaceAt(x + dx, z + dz));
    if (this.baseY === null || dt <= 0) this.baseY = s;
    else this.baseY += (s - this.baseY) * Math.min(1, dt * (s > this.baseY ? 5 : 1.2));
    return this.baseY;
  }

  private walkable(x: number, z: number) {
    const N = this.world.size, ix = Math.floor(x), iz = Math.floor(z);
    return ix >= 0 && iz >= 0 && ix < N && iz < N && this.world.walkable[ix + iz * N] === 1;
  }

  /** 浅瀬（深さ 1 までの水）か歩ける列：サギ・ツルが歩ける所 */
  private wadeable(x: number, z: number) {
    const N = this.world.size, ix = Math.floor(x), iz = Math.floor(z);
    if (ix < 0 || iz < 0 || ix >= N || iz >= N) return false;
    const c = ix + iz * N, h = this.world.heights[c];
    return this.world.walkable[c] === 1 || (h > 0 && h >= this.world.waterLevel - 1 && h < this.world.waterLevel);
  }

  /** 近くの行ける列（跳ねる・はう・歩く生き物の次の行き先） */
  private nextWalk(r: number, ok: (x: number, z: number) => boolean = (x, z) => this.walkable(x, z)) {
    for (let i = 0; i < 12; i++) {
      const x = this.hx + (Math.random() - 0.5) * 2 * r, z = this.hz + (Math.random() - 0.5) * 2 * r;
      if (ok(x, z)) { this.tx = x; this.tz = z; return; }
    }
  }

  /** 家のまわりの、飛んで行く次の場所 */
  private nextSpot(r: number) {
    const a = Math.random() * Math.PI * 2, d = r * (0.3 + Math.random() * 0.7);
    this.gx = this.hx + Math.cos(a) * d; this.gz = this.hz + Math.sin(a) * d;
  }

  /** 翼の角度（左が上がる向きが正。右は鏡写し） */
  private wings(a: number) {
    if (!this.wingL || !this.wingR) return;
    this.wingL.rotation.z = a;
    this.wingR.rotation.z = -a;
  }

  /** 鳥の羽ばたき：speed は 1 秒あたりの羽ばたきの速さ、amp は振れ幅、lift は翼の付け根の上げ具合 */
  private flapBird(dt: number, speed: number, amp = 0.75, lift = 0.1) {
    this.beat += dt * speed;
    this.wings(lift + stroke(this.beat) * amp);
  }

  update(dt: number) {
    this.t += dt;
    const t = this.t, half = this.world.size / 2, wl = this.world.waterLevel;
    let x = this.px, z = this.pz, y = this.ground;
    let pitch = 0, bank: number | null = null;
    let face: number | null = null; // 決まった向き（null なら進む方を向く）
    let sx = 1, sy = 1, sz = 1; // 伸び縮み
    const id = this.def.id;
    switch (this.def.motion) {
      case 'fly': {
        if (id === 'bee') {
          // 花と作物の間を行き来し、着くたびに少し止まって蜜を集める。羽は細かく震わせる
          if (this.hopT > 0) this.hopT -= dt;
          else {
            this.beeU += this.beeDir * dt * 0.45;
            if (this.beeU >= 1 || this.beeU <= 0) { this.beeU = Math.min(1, Math.max(0, this.beeU)); this.beeDir *= -1; this.hopT = 1.2 + Math.random() * 1.5; }
          }
          const k = smooth(this.beeU);
          const busy = this.hopT > 0; // 花の上で止まっている
          x = this.hx + (this.tx - this.hx) * k + Math.sin(t * 7) * (busy ? 0.08 : 0.2);
          z = this.hz + (this.tz - this.hz) * k + Math.cos(t * 6) * (busy ? 0.08 : 0.2);
          // 花の上で止まる時と飛ぶ時の高さは、少しずつ切り替える（急に跳ばない）
          const want = busy ? 0.55 : 0.9;
          this.fy = dt > 0 ? this.fy + (want - this.fy) * Math.min(1, dt * 4) : want;
          y = this.smoothSurface(x, z, dt, 0) + this.fy + Math.sin(t * 13) * 0.05;
          this.wings(0.35 + Math.sin(t * 70) * 0.45);
        } else if (id === 'butterfly') {
          // ひらひら飛び、時々花にとまって羽をゆっくり開け閉めする
          this.modeT -= dt;
          if (this.modeT <= 0) {
            this.mode = this.mode === 'fly' ? 'rest' : 'fly';
            this.modeT = this.mode === 'fly' ? 4 + Math.random() * 5 : 2 + Math.random() * 3;
            if (this.mode === 'fly') this.nextSpot(2.5);
          }
          if (this.mode === 'fly') {
            if (Math.hypot(this.gx - this.fx, this.gz - this.fz) < 0.3) this.nextSpot(2.5);
            const dx = this.gx - this.fx, dz = this.gz - this.fz, d = Math.hypot(dx, dz) || 1;
            // まっすぐ行かず、ふらふらと寄り道しながら向かう
            const wob = Math.sin(t * 2.3) * 0.9 + Math.sin(t * 5.1) * 0.4;
            this.fx += (dx / d - (dz / d) * wob) * dt * 0.9;
            this.fz += (dz / d + (dx / d) * wob) * dt * 0.9;
            this.beat += dt * 11;
            const open = Math.abs(Math.sin(this.beat)); // 0 で開き、1 で上に閉じる
            this.fy += (1.1 + (1 - open) * 0.25 - this.fy) * Math.min(1, dt * 4); // 打ち下ろすたびに少し浮く
            this.wings(0.05 + open * 1.25);
          } else {
            this.fy += (0.15 - this.fy) * Math.min(1, dt * 3);
            this.wings(0.25 + Math.abs(Math.sin(t * 1.5)) * 1.0);
            face = this.heading;
          }
          x = this.fx; z = this.fz;
          y = this.smoothSurface(x, z, dt, 0) + this.fy;
        } else if (id === 'dragonfly') {
          // すっと移って、止まって浮かぶ、をくり返す。羽は細かく震わせる
          this.modeT -= dt;
          if (this.modeT <= 0) {
            this.mode = this.mode === 'fly' ? 'rest' : 'fly';
            this.modeT = this.mode === 'fly' ? 0.5 : 1 + Math.random() * 2;
            if (this.mode === 'fly') this.nextSpot(4);
          }
          const k = Math.min(1, dt * (this.mode === 'fly' ? 7 : 1.5));
          this.fx += (this.gx - this.fx) * k; this.fz += (this.gz - this.fz) * k;
          x = this.fx; z = this.fz;
          y = this.smoothSurface(x, z, dt) + 1.2 + Math.sin(t * 2) * 0.12;
          if (this.mode === 'rest') face = this.heading; // 浮かんでいる間は向きを変えない
          this.wings(Math.sin(t * 55) * 0.35);
        } else if (id === 'kingfisher') {
          ({ x, y, z, pitch } = this.kingfisher(dt, wl));
        } else if (id === 'skylark') {
          ({ x, y, z, pitch } = this.skylark(dt));
          if (this.mode === 'ground') face = this.heading;
        } else {
          ({ x, y, z, bank } = this.soar(dt, id));
        }
        break;
      }
      case 'crawl': {
        if (id === 'crab') { ({ x, z, face } = this.crab(dt)); y = this.groundAt(x, z); break; }
        // カタツムリ：伸び縮みしながら、ゆっくりはう。ウミガメ：ゆっくり、ひれで体を左右にゆらして進む
        const turtle = id === 'seaTurtle';
        const dx = this.tx - this.px, dz = this.tz - this.pz, d = Math.hypot(dx, dz);
        if (d < 0.05) { this.hopT -= dt; if (this.hopT <= 0) { this.nextWalk(turtle ? 4 : 3); this.hopT = 1 + Math.random() * 3; } }
        else {
          const pulse = 0.5 + Math.sin(t * (turtle ? 2.2 : 3)) * 0.5;
          const s = Math.min(d, (turtle ? 0.35 : 0.16) * pulse * dt);
          const nx = this.px + (dx / d) * s, nz = this.pz + (dz / d) * s;
          if (this.walkable(nx, nz)) { this.px = nx; this.pz = nz; } else { this.tx = this.px; this.tz = this.pz; }
          if (turtle) bank = Math.sin(t * 2.2) * 0.08;
          else sz = 0.9 + pulse * 0.2;
        }
        x = this.px; z = this.pz;
        y = this.groundAt(x, z);
        break;
      }
      case 'hop': {
        // スズメ：小さく何度か跳ねて、止まって地面をつつく。カエル・コオロギ：大きく 1 回跳んで、しばらくじっとする
        const frog = id === 'frog', cricket = id === 'cricket';
        const hopLen = frog ? 1.3 : cricket ? 0.8 : 0.45, hopDur = frog ? 0.45 : cricket ? 0.3 : 0.18, hopH = frog ? 0.55 : cricket ? 0.45 : 0.18;
        let squash = 1;
        if (this.hopU < 1) {
          this.hopU = Math.min(1, this.hopU + dt / hopDur);
          x = this.hop0.x + (this.hop1.x - this.hop0.x) * this.hopU;
          z = this.hop0.z + (this.hop1.z - this.hop0.z) * this.hopU;
          y = this.surfaceAt(x, z) + hopArc(this.hopU) * hopH; // 水を跳び越える時も水面より上
          pitch = (0.5 - this.hopU) * (frog || cricket ? 0.7 : 0.4); // 跳ぶ時は上を向き、着地で前へ
          if (frog) squash = 1 + hopArc(this.hopU) * 0.25; // 跳んでいる間は体が伸びる
          // スズメは跳ぶ時に翼を少し開く
          this.wings(this.folded + (this.wingL ? Math.sin(this.hopU * Math.PI) * 0.6 : 0));
          if (this.hopU >= 1) {
            // スズメは続けて跳ねることが多い。時々止まってつつく
            this.hopT = frog || cricket ? 0.8 + Math.random() * 2.5 : Math.random() < 0.35 ? 0.6 + Math.random() * 1.2 : 0.06;
          }
          face = this.heading;
        } else {
          this.hopT -= dt;
          x = this.px; z = this.pz;
          y = this.groundAt(x, z);
          this.wings(this.folded);
          // 止まっている間：スズメは地面をつつく、カエルはのどをふくらませる
          if (!frog && !cricket && this.hopT > 0.1) pitch = -Math.max(0, Math.sin(t * 14)) * 0.6;
          if (frog) squash = 0.94 + Math.sin(t * 5) * 0.03;
          if (this.hopT <= 0) {
            if (Math.hypot(this.tx - this.px, this.tz - this.pz) < 0.1) this.nextWalk(frog ? 2 : 3);
            const dx = this.tx - this.px, dz = this.tz - this.pz, d = Math.hypot(dx, dz);
            if (d >= 0.1) {
              const s = Math.min(d, hopLen);
              const nx = this.px + (dx / d) * s, nz = this.pz + (dz / d) * s;
              // 水・木・段差の列には入らない（止まって次の行き先を考える）
              if (this.walkable(nx, nz) && Math.abs(this.groundAt(nx, nz) - this.groundAt(this.px, this.pz)) <= 1) {
                this.hop0 = { x: this.px, z: this.pz }; this.hop1 = { x: nx, z: nz }; this.hopU = 0;
                this.heading = Math.atan2(dx, dz);
              } else { this.tx = this.px; this.tz = this.pz; }
            }
            this.hopT = 0.3 + Math.random();
          }
          face = this.heading;
        }
        if (frog) { const w = 1 / Math.sqrt(squash); sx = w; sy = squash; sz = w; }
        break;
      }
      case 'perch': {
        // 木の形に合わせてとまる：キツツキは幹の外側（葉より下）、シマエナガ・メジロは葉の外側の縁、フクロウはてっぺん
        const tr = this.tree, h = tr.top - tr.ground;
        const edge = id === 'longtailedTit' || id === 'mejiro';
        const off = id === 'woodpecker' ? tr.trunk + 0.12 : edge ? tr.radius + 0.1 : 0;
        const up = id === 'woodpecker' ? h * 0.18 + Math.floor(t / 4) % 2 * 0.25 : edge ? h * 0.45 : h + 0.05;
        x = this.hx + off; z = this.hz;
        y = tr.ground + up;
        this.wings(this.folded);
        if (id === 'woodpecker') {
          // こつこつ：何回か続けてつつき、少し休む
          const peck = (t % 1.6) < 0.7 ? Math.max(0, Math.sin(t * 22)) : 0;
          x -= peck * 0.05; pitch = -peck * 0.35;
          face = -Math.PI / 2; // 幹の方を向く
        } else {
          if (edge) pitch = -(Math.max(0, Math.sin(t * 3)) ** 4) * 0.3; // 時々首をかしげる
          // 時々向きを変える。メジロは時々羽をふるわせる
          face = Math.floor(t / 6) * 1.3;
          if (id === 'mejiro' && (t % 5) < 0.4) this.wings(this.folded + Math.abs(Math.sin(t * 30)) * 0.5);
        }
        break;
      }
      case 'swim': {
        x = this.hx + Math.sin(t * 0.25) * 2.2 + Math.sin(t * 0.61) * 0.8;
        z = this.hz + Math.cos(t * 0.21) * 2.2;
        // 深い水からはみ出す時は戻る
        if (this.groundAt(x, z) > wl - 2) { x = this.px; z = this.pz; }
        // 水面（水面の高さ − 0.15）の少し下を泳ぐ。浅いので、水を通して色が見える（深いと水の色に隠れる）
        y = wl - 0.15 - 0.3 + Math.sin(t * 0.9) * 0.05;
        bank = Math.sin(t * 6) * 0.08; // 体を左右にくねらせる
        break;
      }
      case 'glide': ({ x, y, z, pitch, face } = this.glide(dt)); break;
      case 'wade': ({ x, y, z, pitch, face } = this.wade(dt)); break;
      case 'wall': {
        // ヤモリ：灯りのともる家の壁に張り付き、時々するっと上り下りする。頭は上、おなかは壁
        const w = this.wall;
        const slide = Math.sin(t * 0.35) * 0.45 + (Math.sin(t * 0.13) > 0.6 ? Math.sin(t * 2) * 0.05 : 0);
        x = this.hx + w.dx * 0.52 + w.dz * Math.sin(t * 0.21) * 0.25;
        z = this.hz + w.dz * 0.52 - w.dx * Math.sin(t * 0.21) * 0.25;
        y = this.ground + 1.1 + slide;
        this.object.position.set(x - half, y, z - half);
        this.object.rotation.set(-Math.PI / 2, Math.atan2(-w.dx, -w.dz), 0);
        this.px = x; this.pz = z;
        return;
      }
      case 'glow': return;
    }
    const mx = x - this.px, mz = z - this.pz;
    const prev = this.heading;
    if (face !== null) this.heading = face;
    else if (Math.abs(mx) + Math.abs(mz) > 1e-4) {
      // 向きはなめらかに変える（トンボ・ツバメはすばやく、魚・大きな鳥はゆっくり）
      const rate = id === 'dragonfly' || id === 'swallow' ? 20 : this.def.motion === 'swim' || id === 'eagle' || id === 'gull' ? 3 : 8;
      this.heading = dt > 0 ? turnToward(this.heading, Math.atan2(mx, mz), dt * rate) : Math.atan2(mx, mz);
    }
    // 曲がる時は体を内側へ傾ける（飛ぶ生き物）。決まった傾きがあればそれ
    if (bank === null) {
      const turn = dt > 0 ? wrapAngle(this.heading - prev) / dt : 0;
      const want = this.def.motion === 'fly' && id !== 'bee' && id !== 'butterfly' ? Math.max(-0.7, Math.min(0.7, -turn * 0.35)) : 0;
      this.roll += (want - this.roll) * Math.min(1, dt * 4);
    } else this.roll = bank;
    // 跳ねている間は、着いた点ではなく今の点を覚える（次の跳ねの出発点は着いた点）
    this.px = x; this.pz = z;
    this.object.position.set(x - half, y, z - half);
    // pitch は正で頭が上（three.js の X 回転は正で頭が下がるので逆にする）
    this.object.rotation.set(-pitch, this.heading, this.roll);
    this.pose.scale.set(sx, sy, sz);
  }

  /** カワセミ：水辺の上を巡り、止まって羽ばたきながら狙いをつけ、水へまっすぐ飛び込んで上がってくる */
  private kingfisher(dt: number, wl: number) {
    const t = this.t;
    this.modeT -= dt;
    let pitch = 0;
    if (this.mode === 'fly') {
      this.orbit += dt * 0.55;
      this.fx = this.hx + Math.sin(this.orbit) * 2.5;
      this.fz = this.hz + Math.sin(this.orbit * 2) * 1.25;
      this.fy = 2 + Math.sin(t * 2) * 0.15;
      this.flapBird(dt, 22, 0.8);
      if (this.modeT <= 0) { this.mode = 'hover'; this.modeT = 1.2; }
    } else if (this.mode === 'hover') {
      // 空中で止まって狙う（速く羽ばたく）
      this.flapBird(dt, 30, 0.7, 0.2);
      pitch = -0.25;
      if (this.modeT <= 0) { this.mode = 'dive'; this.modeT = 1.3; this.sy = this.fy; }
    } else {
      // 0〜0.35：翼をたたんで頭から落ちる。0.35〜：羽ばたいて上がる
      const u = 1 - this.modeT / 1.3;
      if (u < 0.3) { this.fy = this.sy - smooth(u / 0.3) * (this.sy + 0.35); this.wings(this.folded); pitch = -1.2; }
      else { this.fy = -0.35 + smooth((u - 0.3) / 0.7) * (this.sy + 0.35); this.flapBird(dt, 26, 0.85); pitch = 0.45; }
      if (this.modeT <= 0) { this.mode = 'fly'; this.modeT = 5 + Math.random() * 6; this.fy = this.sy; }
    }
    void wl;
    return { x: this.fx, y: this.smoothSurface(this.fx, this.fz, dt) + this.fy, z: this.fz, pitch };
  }

  /** ヒバリ：草原から真上へ舞い上がり、空の高い所で羽ばたきながらさえずり、ゆっくり降りてくる */
  private skylark(dt: number) {
    const t = this.t;
    this.modeT -= dt;
    let pitch = 0;
    const TOP = 9;
    switch (this.mode) {
      case 'ground': {
        this.fy = 0;
        this.wings(this.folded);
        pitch = (this.modeT % 1.2) < 0.25 ? -0.4 : 0; // 地面をつつく
        if (this.modeT <= 0) { this.mode = 'rise'; this.modeT = 4; this.sx = this.fx; this.sz = this.fz; }
        break;
      }
      case 'rise': {
        const u = 1 - this.modeT / 4;
        this.fy = smooth(u) * TOP;
        this.fx = this.sx + Math.sin(t * 1.3) * 0.3; this.fz = this.sz + Math.cos(t * 1.1) * 0.3;
        this.flapBird(dt, 24, 0.85, 0.15);
        pitch = 0.6 * (1 - u);
        if (this.modeT <= 0) { this.mode = 'hover'; this.modeT = 8 + Math.random() * 5; }
        break;
      }
      case 'hover': {
        // 高い所でほぼ止まって、ひたすら羽ばたく（さえずり）
        this.fy = TOP + Math.sin(t * 1.7) * 0.3;
        this.fx = this.sx + Math.sin(t * 0.4) * 0.8; this.fz = this.sz + Math.sin(t * 0.33) * 0.8;
        this.flapBird(dt, 28, 0.6, 0.25);
        pitch = 0.15;
        if (this.modeT <= 0) {
          this.mode = 'descend'; this.modeT = 5;
          this.sy = this.fy; this.sx = this.fx; this.sz = this.fz;
          // 降りる先は、近くの歩ける列
          this.nextWalk(4);
          this.gx = this.tx; this.gz = this.tz;
        }
        break;
      }
      default: {
        // 翼を広げて、ゆっくり輪を描きながら降りる。最後はすっと落ちる
        const u = 1 - this.modeT / 5;
        const k = smooth(u);
        this.fx = this.sx + (this.gx - this.sx) * k + Math.sin(u * 6) * (1 - u) * 1.2;
        this.fz = this.sz + (this.gz - this.sz) * k + Math.cos(u * 6) * (1 - u) * 1.2;
        this.fy = this.sy * (1 - (u < 0.8 ? u * 0.7 / 0.8 : 0.7 + (u - 0.8) / 0.2 * 0.3));
        if (u < 0.8) this.wings(0.12 + Math.sin(t * 3) * 0.05);
        else this.flapBird(dt, 20, 0.6);
        pitch = -0.15;
        if (this.modeT <= 0) { this.mode = 'ground'; this.modeT = 3 + Math.random() * 4; this.fy = 0; }
      }
    }
    // 地面にいる間と降りる途中は真下の地面へ（なめらかに寄せる）、飛んでいる間はまわりも見たなめらかな基準の高さ
    let base: number;
    if (this.mode === 'ground' || this.mode === 'descend') {
      const g = this.groundAt(this.fx, this.fz);
      this.baseY = this.baseY === null || dt <= 0 ? g : this.baseY + (g - this.baseY) * Math.min(1, dt * (this.mode === 'ground' ? 8 : 2));
      base = this.baseY;
    } else base = this.smoothSurface(this.fx, this.fz, dt);
    return { x: this.fx, y: base + Math.max(0, this.fy), z: this.fz, pitch };
  }

  /**
   * 大きな輪を描いて飛ぶ鳥：ワシは高い岩場の上をほとんど羽ばたかずに舞い、カモメは砂浜と水の上を楕円に、
   * ツバメは家のまわりを低く速く、急に曲がりながら飛ぶ
   */
  private soar(dt: number, id: VisitorId) {
    const t = this.t;
    let x: number, y: number, z: number, bank: number | null = null;
    if (id === 'eagle') {
      this.orbit += dt * 0.22;
      x = this.hx + Math.cos(this.orbit) * 7; z = this.hz + Math.sin(this.orbit) * 7;
      y = this.sy + Math.sin(t * 0.3) * 1.2;
      // 時々 3 回だけゆっくり羽ばたき、あとは翼を広げて滑る
      const cycle = t % 9;
      if (cycle < 2) this.flapBird(dt, 7, 0.5, 0.05); else this.wings(0.06 + Math.sin(t * 0.8) * 0.02);
      bank = -0.35;
    } else if (id === 'gull') {
      this.orbit += dt * 0.35;
      x = this.hx + Math.cos(this.orbit) * 6; z = this.hz + Math.sin(this.orbit) * 3.5;
      y = this.smoothSurface(x, z, dt, 2) + 4.5 + Math.sin(t * 0.7) * 0.8;
      const cycle = t % 5;
      if (cycle < 1.6) this.flapBird(dt, 11, 0.6, 0.12); else this.wings(0.18); // 少し V の字にして滑る
      bank = -0.25 + Math.sin(t * 0.7) * 0.1;
    } else {
      // ツバメ：8 の字を速く、上下に波打ちながら。羽ばたきと滑りを短く繰り返す
      this.orbit += dt * 1.1;
      x = this.hx + Math.sin(this.orbit) * 6; z = this.hz + Math.sin(this.orbit * 2) * 3;
      y = this.smoothSurface(x, z, dt) + 1.6 + Math.sin(this.orbit * 3) * 0.8;
      if ((t % 1.4) < 0.7) this.flapBird(dt, 20, 0.7); else this.wings(0.05);
    }
    return { x, y, z, bank };
  }

  /** カニ：横向きのまま、さっと走っては止まる。止まるとはさみを振り上げる */
  private crab(dt: number) {
    const t = this.t;
    let face = this.heading;
    const dx = this.tx - this.px, dz = this.tz - this.pz, d = Math.hypot(dx, dz);
    if (d < 0.05) {
      this.hopT -= dt;
      if (this.hopT <= 0) {
        this.nextWalk(2.5);
        this.hopT = 0.8 + Math.random() * 2.5;
        // 進む向きに対して横を向く（右か左は、いま向いている方に近い方）
        const dir = Math.atan2(this.tx - this.px, this.tz - this.pz);
        const a = dir + Math.PI / 2, b = dir - Math.PI / 2;
        this.heading = Math.abs(wrapAngle(a - this.heading)) < Math.abs(wrapAngle(b - this.heading)) ? a : b;
      }
      face = this.heading + Math.sin(t * 6) * 0.05;
    } else {
      const s = Math.min(d, 1.4 * dt);
      const nx = this.px + (dx / d) * s, nz = this.pz + (dz / d) * s;
      if (this.walkable(nx, nz)) { this.px = nx; this.pz = nz; } else { this.tx = this.px; this.tz = this.pz; }
    }
    return { x: this.px, z: this.pz, face };
  }

  /**
   * ムササビ：木のてっぺんにとまり、もう 1 本の木へ向かって膜を広げて滑空し、幹を駆け上がる。
   * 2 本目の木が無い時は、近くまで滑空して同じ木へ戻る
   */
  private glide(dt: number) {
    const t = this.t;
    this.modeT -= dt;
    const a = { x: this.hx, z: this.hz, tr: this.tree };
    const b = this.tree2 ? { x: this.tx, z: this.tz, tr: this.tree2 } : { x: this.hx + 5, z: this.hz + 2, tr: { ...this.tree, ground: this.groundAt(this.hx + 5, this.hz + 2) } };
    // fx/fz は今いる木（0 = a、1 = b）
    const at = this.fy > 0.5 ? b : a, to = this.fy > 0.5 ? a : b;
    let x = at.x, z = at.z, y = at.tr.top, pitch = 0, face: number | null = null;
    if (this.mode === 'sit') {
      y = at.tr.top + 0.05;
      face = Math.atan2(to.x - at.x, to.z - at.z) + Math.sin(t * 0.7) * 0.3;
      if (this.modeT <= 0) { this.mode = 'glide'; this.modeT = 2.2; }
    } else if (this.mode === 'glide') {
      // 頭を少し下げて、膜を広げたまま斜めに滑り降りる
      const u = 1 - this.modeT / 2.2;
      const k = smooth(u);
      x = at.x + (to.x - at.x) * k; z = at.z + (to.z - at.z) * k;
      const y0 = at.tr.top, y1 = to.tr.ground + (to.tr.top - to.tr.ground) * 0.35;
      y = y0 + (y1 - y0) * u + Math.sin(u * Math.PI) * 0.6;
      pitch = -0.25;
      face = Math.atan2(to.x - at.x, to.z - at.z);
      if (this.modeT <= 0) { this.mode = 'climb'; this.modeT = 2.4; }
    } else {
      // 幹を駆け上がる（頭が上）
      const u = 1 - this.modeT / 2.4;
      const y1 = to.tr.ground + (to.tr.top - to.tr.ground) * 0.35;
      x = to.x - Math.sin(Math.atan2(to.x - at.x, to.z - at.z)) * (to.tr.trunk + 0.1);
      z = to.z - Math.cos(Math.atan2(to.x - at.x, to.z - at.z)) * (to.tr.trunk + 0.1);
      y = y1 + (to.tr.top - y1) * smooth(u);
      pitch = 1.2;
      face = Math.atan2(to.x - at.x, to.z - at.z);
      if (this.modeT <= 0) { this.mode = 'sit'; this.modeT = 2 + Math.random() * 4; this.fy = this.fy > 0.5 ? 0 : 1; }
    }
    return { x, y, z, pitch, face };
  }

  /** サギ・ツル：浅瀬をゆっくり歩き、立ち止まってじっと待ち、時々くちばしをさっと水に入れる */
  private wade(dt: number) {
    const t = this.t;
    let pitch = 0, face: number | null = null;
    const dx = this.tx - this.px, dz = this.tz - this.pz, d = Math.hypot(dx, dz);
    if (d < 0.08) {
      this.hopT -= dt;
      face = this.heading;
      // 待っている間：時々さっと首を下げる
      const strike = (t % 4) < 0.35 ? Math.sin(((t % 4) / 0.35) * Math.PI) : 0;
      pitch = -strike * 0.7;
      if (this.hopT <= 0) { this.nextWalk(3, (x, z) => this.wadeable(x, z)); this.hopT = 3 + Math.random() * 5; }
    } else {
      const s = Math.min(d, 0.35 * dt);
      const nx = this.px + (dx / d) * s, nz = this.pz + (dz / d) * s;
      if (this.wadeable(nx, nz)) { this.px = nx; this.pz = nz; } else { this.tx = this.px; this.tz = this.pz; }
      pitch = Math.sin(t * 5) * 0.06; // 一歩ごとに首を前後に
    }
    const x = this.px, z = this.pz;
    // 浅瀬では足が水に入る（地面＝水底の高さに立つ）。一歩ごとに少し上下する
    const y = this.groundAt(x, z) + (d >= 0.08 ? Math.abs(Math.sin(t * 5)) * 0.03 : 0);
    return { x, y, z, pitch, face };
  }

  dispose() {
    this.object.removeFromParent();
    // デバッグの目印（共有の形）は捨てない
    this.object.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry && !o.parent?.userData.marker) m.geometry.dispose(); });
  }
}
