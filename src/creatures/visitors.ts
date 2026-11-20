import * as THREE from 'three/webgpu';
import type { WorldData } from '../world/terrain';
import type { VisitorDef } from '../eco/species';
import { mergeModel } from './animals';
import { hopArc, turnToward } from './motion';

export interface TreeShape { ground: number; top: number; radius: number; trunk: number }

/**
 * 訪問者（しばらく滞在して去る生き物）の見た目と動き。
 * モデルは基本形状の組み合わせの仮のもの。部品は mergeModel で 1 つのメッシュにまとめる（描画命令を増やさない）。
 */
const mat = (color: number) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8 });
const box = (w: number, h: number, d: number, c: number, x = 0, y = 0, z = 0, ry = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
  m.position.set(x, y, z); m.rotation.y = ry; return m;
};
const ball = (r: number, c: number, x = 0, y = 0, z = 0, sy = 1) => {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat(c));
  m.position.set(x, y, z); m.scale.y = sy; return m;
};

/** 小さな鳥（体・頭・くちばし・尾）。前は +z */
const bird = (body: number, head: number, beak: number, size = 1) => {
  const g = new THREE.Group();
  g.add(ball(0.16 * size, body, 0, 0, 0, 0.85), ball(0.11 * size, head, 0, 0.1 * size, 0.13 * size), box(0.04, 0.04, 0.09 * size, beak, 0, 0.09 * size, 0.25 * size), box(0.12 * size, 0.03, 0.16 * size, body, 0, 0.02, -0.2 * size));
  return g;
};

function buildVisitorModel(id: VisitorDef['id']): THREE.Group | null {
  const g = new THREE.Group();
  switch (id) {
    case 'butterfly': g.add(box(0.03, 0.03, 0.14, 0x333333), box(0.16, 0.01, 0.12, 0xf2a03d, 0.09, 0, 0.02, 0.3), box(0.16, 0.01, 0.12, 0xf2a03d, -0.09, 0, 0.02, -0.3)); break;
    case 'bee': g.add(ball(0.06, 0xf2c230, 0, 0, 0, 0.9), box(0.05, 0.02, 0.06, 0x2a2016, 0, 0.05, 0), box(0.09, 0.005, 0.05, 0xeaf4ff, 0.06, 0.05, 0), box(0.09, 0.005, 0.05, 0xeaf4ff, -0.06, 0.05, 0)); break;
    case 'sparrow': return bird(0x8a5a36, 0x6b4428, 0x3a2a1a, 0.9);
    case 'frog': g.add(ball(0.13, 0x6aa84f, 0, 0.08, 0, 0.7), ball(0.04, 0xf4f4e8, 0.06, 0.17, 0.08), ball(0.04, 0xf4f4e8, -0.06, 0.17, 0.08), box(0.08, 0.04, 0.12, 0x5a9440, 0.1, 0.02, -0.04), box(0.08, 0.04, 0.12, 0x5a9440, -0.1, 0.02, -0.04)); break;
    case 'fish': {
      // 立体の魚（前は +z）：背は青灰色、腹は銀色。尾びれ・背びれ・胸びれ・目
      const back = ball(0.16, 0x4f7487, 0, 0.02, 0);
      back.scale.set(0.55, 0.5, 1.5);
      const belly = ball(0.13, 0xc9d4d8, 0, -0.03, 0.02);
      belly.scale.set(0.5, 0.4, 1.35);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.18, 4), mat(0x3f6375));
      tail.rotation.x = Math.PI / 2; tail.scale.set(0.25, 1, 1); tail.position.set(0, 0.02, -0.3);
      const dorsal = box(0.015, 0.07, 0.12, 0x3f6375, 0, 0.1, -0.02);
      const finL = box(0.08, 0.01, 0.05, 0x8fa8b4, 0.07, -0.03, 0.08, 0.5);
      const finR = box(0.08, 0.01, 0.05, 0x8fa8b4, -0.07, -0.03, 0.08, -0.5);
      const eyeL = ball(0.018, 0x111111, 0.055, 0.04, 0.17), eyeR = ball(0.018, 0x111111, -0.055, 0.04, 0.17);
      g.add(back, belly, tail, dorsal, finL, finR, eyeL, eyeR);
      break;
    }
    case 'dragonfly': g.add(box(0.03, 0.03, 0.34, 0x2f6fb0), ball(0.04, 0x2f6fb0, 0, 0, 0.17), box(0.36, 0.005, 0.05, 0xdfeeff, 0, 0.02, 0.07), box(0.32, 0.005, 0.05, 0xdfeeff, 0, 0.02, 0.0)); break;
    case 'woodpecker': g.add(...bird(0x2b2b2b, 0xc0392b, 0x555555, 1.1).children); break;
    case 'snail': g.add(box(0.06, 0.04, 0.22, 0xc9b59a, 0, 0.02, 0), ball(0.09, 0xa0703c, 0, 0.1, -0.02)); break;
    case 'longtailedTit': g.add(ball(0.12, 0xf8f8f6, 0, 0, 0), box(0.04, 0.03, 0.22, 0x3a3a3a, 0, 0, -0.18), box(0.02, 0.02, 0.03, 0x222222, 0, 0.02, 0.12)); break;
    case 'owl': g.add(ball(0.22, 0x8a6d4b, 0, 0.05, 0, 1.25), ball(0.06, 0xf5e6a8, 0.08, 0.17, 0.15), ball(0.06, 0xf5e6a8, -0.08, 0.17, 0.15), box(0.06, 0.08, 0.04, 0x8a6d4b, 0.1, 0.32, 0), box(0.06, 0.08, 0.04, 0x8a6d4b, -0.1, 0.32, 0)); break;
    case 'kingfisher': return bird(0x1f8fd0, 0x1a7ab8, 0x222222, 1);
    case 'firefly': return null; // 今のホタルの光を使う
  }
  return g;
}

const smooth = (u: number) => u * u * (3 - 2 * u);

export class Visitor {
  readonly object = new THREE.Group();
  /** 形（羽ばたき・つぶれは、この形の大きさを変えて見せる） */
  private model: THREE.Object3D | null = null;
  private hx: number; private hz: number; private ground: number;
  private t = Math.random() * 100;
  private px: number; private pz: number; private tx: number; private tz: number;
  /** 跳ねる・はう生き物の、次に動き出すまでの時間（ミツバチは花の上で止まっている時間） */
  private hopT = 0;
  /** 1 回の跳ねの進み（0..1）と、その跳ねの出発点・着く点 */
  private hopU = 1;
  private hop0 = { x: 0, z: 0 }; private hop1 = { x: 0, z: 0 };
  private heading = 0;
  /** チョウ：飛ぶ／花にとまる。トンボ：すっと移る／止まって浮かぶ */
  private mode: 'fly' | 'rest' = 'fly';
  private modeT = 2 + Math.random() * 4;
  /** チョウ・トンボの、いまの位置（fx, fz, 地面からの高さ fy）と次の場所（gx, gz） */
  private fx: number; private fz: number; private fy = 1; private gx: number; private gz: number;
  /** ミツバチの行き来の進み（0..1）と向き */
  private beeU = 0; private beeDir = 1;
  /** カワセミの飛び込みの残り（1 → 0） */
  private dive = 0;

  /** とまる木の形（キツツキ・シマエナガ・フクロウ） */
  private tree: TreeShape;

  /** home：現れる場所の列（x + z*size）。second：ミツバチが行き来するもう 1 つの列。tree：とまる木の形 */
  constructor(readonly def: VisitorDef, private world: WorldData, readonly home: number, public leavesAt: number, second?: number, tree?: TreeShape | null) {
    const N = world.size;
    this.hx = (home % N) + 0.5; this.hz = Math.floor(home / N) + 0.5;
    this.ground = world.heights[home];
    this.px = this.tx = this.hx; this.pz = this.tz = this.hz;
    this.fx = this.gx = this.hx; this.fz = this.gz = this.hz;
    if (second !== undefined) { this.tx = (second % N) + 0.5; this.tz = Math.floor(second / N) + 0.5; }
    this.tree = tree ?? { ground: this.ground, top: this.ground + 7, radius: 2.4, trunk: 0.65 };
    const model = buildVisitorModel(def.id);
    if (model) { this.model = mergeModel(model); this.object.add(this.model); }
    this.object.scale.setScalar(def.motion === 'perch' || def.id === 'kingfisher' || def.id === 'sparrow' ? 1.6 : 1.4);
    // 向きを決めた後に、体から見て前後へ傾ける（つつく・跳ぶ）
    this.object.rotation.order = 'YXZ';
    this.object.userData.visitor = this;
    this.update(0);
  }

  /** 観察の基準点（ホバーの判定に使う） */
  get anchor(): THREE.Vector3 { return this.object.position; }

  private groundAt(x: number, z: number) {
    const N = this.world.size, ix = Math.floor(x), iz = Math.floor(z);
    if (ix < 0 || iz < 0 || ix >= N || iz >= N) return this.ground;
    return this.world.heights[ix + iz * N] || this.ground;
  }

  private walkable(x: number, z: number) {
    const N = this.world.size, ix = Math.floor(x), iz = Math.floor(z);
    return ix >= 0 && iz >= 0 && ix < N && iz < N && this.world.walkable[ix + iz * N] === 1;
  }

  /** 近くの歩ける列（跳ねる・はう生き物の次の行き先） */
  private nextWalk(r: number) {
    for (let i = 0; i < 10; i++) {
      const x = this.hx + (Math.random() - 0.5) * 2 * r, z = this.hz + (Math.random() - 0.5) * 2 * r;
      if (this.walkable(x, z)) { this.tx = x; this.tz = z; return; }
    }
  }

  /** 家のまわりの、飛んで行く次の場所 */
  private nextSpot(r: number) {
    const a = Math.random() * Math.PI * 2, d = r * (0.3 + Math.random() * 0.7);
    this.gx = this.hx + Math.cos(a) * d; this.gz = this.hz + Math.sin(a) * d;
  }

  update(dt: number) {
    this.t += dt;
    const t = this.t, half = this.world.size / 2, wl = this.world.waterLevel;
    let x = this.px, z = this.pz, y = this.ground;
    let pitch = 0, flap = 1;
    let face: number | null = null; // 決まった向き（null なら進む方を向く）
    switch (this.def.motion) {
      case 'fly': {
        const id = this.def.id;
        if (id === 'bee') {
          // 花と作物の間を行き来し、着くたびに少し止まって蜜を集める
          if (this.hopT > 0) this.hopT -= dt;
          else {
            this.beeU += this.beeDir * dt * 0.45;
            if (this.beeU >= 1 || this.beeU <= 0) { this.beeU = Math.min(1, Math.max(0, this.beeU)); this.beeDir *= -1; this.hopT = 1.2 + Math.random() * 1.5; }
          }
          const k = smooth(this.beeU);
          const busy = this.hopT > 0; // 花の上で止まっている
          x = this.hx + (this.tx - this.hx) * k + Math.sin(t * 7) * (busy ? 0.08 : 0.2);
          z = this.hz + (this.tz - this.hz) * k + Math.cos(t * 6) * (busy ? 0.08 : 0.2);
          y = this.groundAt(x, z) + (busy ? 0.55 : 0.9) + Math.sin(t * 13) * 0.05;
          flap = 0.6 + Math.abs(Math.sin(t * 40)) * 0.4;
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
            const beat = Math.abs(Math.sin(t * 11));
            this.fy += (1.1 + beat * 0.3 - this.fy) * Math.min(1, dt * 4); // 羽ばたくたびに少し浮く
            flap = 0.2 + beat * 0.8;
          } else {
            this.fy += (0.15 - this.fy) * Math.min(1, dt * 3);
            flap = 0.35 + Math.abs(Math.sin(t * 1.5)) * 0.65;
            face = this.heading;
          }
          x = this.fx; z = this.fz;
          y = Math.max(this.groundAt(x, z), wl) + this.fy;
        } else if (id === 'dragonfly') {
          // すっと移って、止まって浮かぶ、をくり返す
          this.modeT -= dt;
          if (this.modeT <= 0) {
            this.mode = this.mode === 'fly' ? 'rest' : 'fly';
            this.modeT = this.mode === 'fly' ? 0.5 : 1 + Math.random() * 2;
            if (this.mode === 'fly') this.nextSpot(4);
          }
          const k = Math.min(1, dt * (this.mode === 'fly' ? 7 : 1.5));
          this.fx += (this.gx - this.fx) * k; this.fz += (this.gz - this.fz) * k;
          x = this.fx; z = this.fz;
          y = Math.max(this.groundAt(x, z), wl) + 1.2 + Math.sin(t * 2) * 0.12;
          if (this.mode === 'rest') face = this.heading; // 浮かんでいる間は向きを変えない
          flap = 0.75 + Math.abs(Math.sin(t * 45)) * 0.25;
        } else {
          // カワセミ：水辺をまわり、時々水へ飛び込む
          x = this.hx + Math.sin(t * 0.5) * 2.5;
          z = this.hz + Math.sin(t * 1) * 1.25;
          this.modeT -= dt;
          if (this.modeT <= 0 && this.dive <= 0) { this.dive = 1; this.modeT = 7 + Math.random() * 6; }
          let drop = 0;
          if (this.dive > 0) {
            this.dive = Math.max(0, this.dive - dt * 0.9);
            const u = 1 - this.dive;
            drop = u < 0.35 ? smooth(u / 0.35) : 1 - smooth((u - 0.35) / 0.65); // すっと落ちて、ゆっくり上がる
            pitch = u < 0.35 ? 0.9 : -0.4; // 落ちる時は頭から、上がる時は上を向く
          }
          const base = Math.max(this.groundAt(x, z), wl);
          y = base + 2 - drop * 2 + Math.sin(t * 2) * 0.15 * (1 - drop);
        }
        break;
      }
      case 'crawl': {
        // カタツムリ：伸び縮みしながら、ゆっくりはう
        const dx = this.tx - this.px, dz = this.tz - this.pz, d = Math.hypot(dx, dz);
        let stretch = 1;
        if (d < 0.05) { this.hopT -= dt; if (this.hopT <= 0) { this.nextWalk(3); this.hopT = 1 + Math.random() * 3; } }
        else {
          const pulse = 0.5 + Math.sin(t * 3) * 0.5;
          const s = Math.min(d, 0.16 * pulse * dt);
          const nx = this.px + (dx / d) * s, nz = this.pz + (dz / d) * s;
          if (this.walkable(nx, nz)) { this.px = nx; this.pz = nz; } else { this.tx = this.px; this.tz = this.pz; }
          stretch = 0.9 + pulse * 0.2;
        }
        if (this.model) this.model.scale.set(1, 1, stretch);
        x = this.px; z = this.pz;
        y = this.groundAt(x, z);
        break;
      }
      case 'hop': {
        // スズメ：小さく何度か跳ねて、止まって地面をつつく。カエル：大きく 1 回跳んで、しばらくじっとする
        const frog = this.def.id === 'frog';
        const hopLen = frog ? 1.3 : 0.45, hopDur = frog ? 0.45 : 0.18, hopH = frog ? 0.55 : 0.18;
        let squash = 1;
        if (this.hopU < 1) {
          this.hopU = Math.min(1, this.hopU + dt / hopDur);
          x = this.hop0.x + (this.hop1.x - this.hop0.x) * this.hopU;
          z = this.hop0.z + (this.hop1.z - this.hop0.z) * this.hopU;
          y = this.groundAt(x, z) + hopArc(this.hopU) * hopH;
          pitch = (this.hopU - 0.5) * (frog ? 0.7 : 0.4); // 跳ぶ時は上を向き、着地で前へ
          if (frog) squash = 1 + hopArc(this.hopU) * 0.25; // 跳んでいる間は体が伸びる
          if (this.hopU >= 1) {
            // スズメは続けて跳ねることが多い。時々止まってつつく
            this.hopT = frog ? 0.8 + Math.random() * 2.5 : Math.random() < 0.35 ? 0.6 + Math.random() * 1.2 : 0.06;
          }
          face = this.heading;
        } else {
          this.hopT -= dt;
          x = this.px; z = this.pz;
          y = this.groundAt(x, z);
          // 止まっている間：スズメは地面をつつく、カエルはのどをふくらませる
          if (!frog && this.hopT > 0.1) pitch = Math.max(0, Math.sin(t * 14)) * 0.6;
          if (frog) squash = 0.94 + Math.sin(t * 5) * 0.03;
          if (this.hopT <= 0) {
            if (Math.hypot(this.tx - this.px, this.tz - this.pz) < 0.1) this.nextWalk(frog ? 2 : 3);
            const dx = this.tx - this.px, dz = this.tz - this.pz, d = Math.hypot(dx, dz);
            if (d >= 0.1) {
              const s = Math.min(d, hopLen);
              const nx = this.px + (dx / d) * s, nz = this.pz + (dz / d) * s;
              // 水・木・段差の列には入らない（止まって次の行き先を考える）
              if (this.walkable(nx, nz)) {
                this.hop0 = { x: this.px, z: this.pz }; this.hop1 = { x: nx, z: nz }; this.hopU = 0;
                this.heading = Math.atan2(dx, dz);
              } else { this.tx = this.px; this.tz = this.pz; }
            }
            this.hopT = 0.3 + Math.random();
          }
          face = this.heading;
        }
        if (this.model && frog) { const w = 1 / Math.sqrt(squash); this.model.scale.set(w, squash, w); }
        break;
      }
      case 'perch': {
        // 木の形に合わせてとまる：キツツキは幹の外側（葉より下）、シマエナガは葉の外側の縁、フクロウはてっぺん
        const tr = this.tree, h = tr.top - tr.ground;
        const off = this.def.id === 'woodpecker' ? tr.trunk + 0.12 : this.def.id === 'longtailedTit' ? tr.radius + 0.1 : 0;
        const up = this.def.id === 'woodpecker' ? h * 0.18 + Math.floor(t / 4) % 2 * 0.25 : this.def.id === 'longtailedTit' ? h * 0.45 : h + 0.05;
        x = this.hx + off; z = this.hz;
        y = tr.ground + up;
        if (this.def.id === 'woodpecker') {
          // こつこつ：何回か続けてつつき、少し休む
          const peck = (t % 1.6) < 0.7 ? Math.max(0, Math.sin(t * 22)) : 0;
          x -= peck * 0.05; pitch = peck * 0.35;
        } else if (this.def.id === 'longtailedTit') {
          pitch = Math.max(0, Math.sin(t * 3)) ** 4 * 0.3; // 時々首をかしげる
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
        break;
      }
      case 'glow': return;
    }
    const mx = x - this.px, mz = z - this.pz;
    if (face === null && Math.abs(mx) + Math.abs(mz) > 1e-4) {
      // 向きはなめらかに変える（トンボはすばやく、魚はゆっくり）
      const rate = this.def.id === 'dragonfly' ? 20 : this.def.motion === 'swim' ? 3 : 8;
      this.heading = dt > 0 ? turnToward(this.heading, Math.atan2(mx, mz), dt * rate) : Math.atan2(mx, mz);
    }
    // 跳ねている間は、着いた点ではなく今の点を覚える（次の跳ねの出発点は着いた点）
    this.px = x; this.pz = z;
    this.object.position.set(x - half, y, z - half);
    this.object.rotation.y = this.def.motion === 'perch' ? (this.def.id === 'woodpecker' ? -Math.PI / 2 : Math.floor(t / 6) * 1.3) : this.heading;
    this.object.rotation.x = pitch;
    // 羽ばたき：チョウ・ミツバチ・トンボは横幅を縮めて、羽を閉じたように見せる
    if (this.model && (this.def.id === 'butterfly' || this.def.id === 'bee' || this.def.id === 'dragonfly')) this.model.scale.set(flap, 1, 1);
    // 魚は体を左右にくねらせる
    if (this.def.motion === 'swim') this.object.rotation.z = Math.sin(t * 6) * 0.08;
  }

  dispose() {
    this.object.removeFromParent();
    // デバッグの目印（共有の形）は捨てない
    this.object.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry && !o.parent?.userData.marker) m.geometry.dispose(); });
  }
}
