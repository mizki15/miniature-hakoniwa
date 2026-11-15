import * as THREE from 'three/webgpu';
import type { WorldData } from '../world/terrain';
import type { VisitorDef } from '../eco/species';
import { mergeModel } from './animals';

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
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.35, 10), new THREE.MeshBasicMaterial({ color: 0x0b1a26, transparent: true, opacity: 0.5, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.scale.set(0.55, 1, 1);
      const tail = new THREE.Mesh(new THREE.CircleGeometry(0.14, 3), m.material);
      tail.rotation.x = -Math.PI / 2; tail.position.z = -0.38;
      // 水面（renderOrder 1）の後で描く。水の下に置くと、深い水の色に隠れてほとんど見えない
      m.renderOrder = tail.renderOrder = 2;
      g.add(m, tail);
      return g; // 半透明の影なのでまとめない
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

export class Visitor {
  readonly object = new THREE.Group();
  private hx: number; private hz: number; private ground: number;
  private t = Math.random() * 100;
  private px: number; private pz: number; private tx: number; private tz: number;
  private hopT = 0;
  private heading = 0;

  /** とまる木の形（キツツキ・シマエナガ・フクロウ） */
  private tree: TreeShape;

  /** home：現れる場所の列（x + z*size）。second：ミツバチが行き来するもう 1 つの列。tree：とまる木の形 */
  constructor(readonly def: VisitorDef, private world: WorldData, readonly home: number, public leavesAt: number, second?: number, tree?: TreeShape | null) {
    const N = world.size;
    this.hx = (home % N) + 0.5; this.hz = Math.floor(home / N) + 0.5;
    this.ground = world.heights[home];
    this.px = this.tx = this.hx; this.pz = this.tz = this.hz;
    if (second !== undefined) { this.tx = (second % N) + 0.5; this.tz = Math.floor(second / N) + 0.5; }
    this.tree = tree ?? { ground: this.ground, top: this.ground + 7, radius: 2.4, trunk: 0.65 };
    const model = buildVisitorModel(def.id);
    if (model) this.object.add(def.id === 'fish' ? model : mergeModel(model));
    this.object.scale.setScalar(def.motion === 'perch' || def.id === 'kingfisher' || def.id === 'sparrow' ? 1.6 : 1.4);
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

  /** 近くの歩ける列（跳ねる・はう生き物の次の行き先） */
  private nextWalk(r: number) {
    const N = this.world.size;
    for (let i = 0; i < 10; i++) {
      const x = this.hx + (Math.random() - 0.5) * 2 * r, z = this.hz + (Math.random() - 0.5) * 2 * r;
      const ix = Math.floor(x), iz = Math.floor(z);
      if (ix >= 0 && iz >= 0 && ix < N && iz < N && this.world.walkable[ix + iz * N]) { this.tx = x; this.tz = z; return; }
    }
  }

  update(dt: number) {
    this.t += dt;
    const t = this.t, half = this.world.size / 2, wl = this.world.waterLevel;
    let x = this.px, z = this.pz, y = this.ground;
    switch (this.def.motion) {
      case 'fly': {
        if (this.def.id === 'bee') {
          // 花と作物の間を行き来する
          const k = (Math.sin(t * 0.35) + 1) / 2;
          x = this.hx + (this.tx - this.hx) * k + Math.sin(t * 7) * 0.25;
          z = this.hz + (this.tz - this.hz) * k + Math.cos(t * 6) * 0.25;
          y = this.groundAt(x, z) + 0.9 + Math.sin(t * 9) * 0.1;
        } else {
          const r = this.def.id === 'dragonfly' ? 4 : this.def.id === 'kingfisher' ? 2.5 : 2.5;
          const sp = this.def.id === 'dragonfly' ? 0.9 : this.def.id === 'kingfisher' ? 0.5 : 0.45;
          x = this.hx + Math.sin(t * sp) * r;
          z = this.hz + Math.sin(t * sp * 2) * r * 0.5;
          const base = Math.max(this.groundAt(x, z), wl);
          y = base + (this.def.id === 'kingfisher' ? 2 : 1.2) + (this.def.id === 'butterfly' ? Math.abs(Math.sin(t * 6)) * 0.35 : Math.sin(t * 2) * 0.15);
        }
        break;
      }
      case 'hop': case 'crawl': {
        const speed = this.def.motion === 'crawl' ? 0.08 : 1.6;
        const dx = this.tx - this.px, dz = this.tz - this.pz, d = Math.hypot(dx, dz);
        if (d < 0.05) { this.hopT -= dt; if (this.hopT <= 0) { this.nextWalk(this.def.id === 'frog' ? 2 : 3); this.hopT = 1 + Math.random() * 3; } }
        else {
          const s = Math.min(d, speed * dt);
          const nx = this.px + (dx / d) * s, nz = this.pz + (dz / d) * s;
          const N = this.world.size, ix = Math.floor(nx), iz = Math.floor(nz);
          // 水・木・段差の列には入らない（止まって次の行き先を考える）
          if (ix >= 0 && iz >= 0 && ix < N && iz < N && this.world.walkable[ix + iz * N]) { this.px = nx; this.pz = nz; }
          else { this.tx = this.px; this.tz = this.pz; }
        }
        x = this.px; z = this.pz;
        const moving = d >= 0.05;
        y = this.groundAt(x, z) + (moving && this.def.motion === 'hop' ? Math.abs(Math.sin(t * 10)) * 0.25 : 0);
        break;
      }
      case 'perch': {
        // 木の形に合わせてとまる：キツツキは幹の外側（葉より下）、シマエナガは葉の外側の縁、フクロウはてっぺん
        const tr = this.tree, h = tr.top - tr.ground;
        const off = this.def.id === 'woodpecker' ? tr.trunk + 0.12 : this.def.id === 'longtailedTit' ? tr.radius + 0.1 : 0;
        const up = this.def.id === 'woodpecker' ? h * 0.18 + Math.floor(t / 4) % 2 * 0.25 : this.def.id === 'longtailedTit' ? h * 0.45 : h + 0.05;
        x = this.hx + off; z = this.hz;
        y = tr.ground + up;
        if (this.def.id === 'woodpecker') x -= Math.max(0, Math.sin(t * 18)) * 0.04; // こつこつ
        break;
      }
      case 'swim': {
        x = this.hx + Math.sin(t * 0.25) * 2.2 + Math.sin(t * 0.61) * 0.8;
        z = this.hz + Math.cos(t * 0.21) * 2.2;
        // 深い水からはみ出す時は戻る
        if (this.groundAt(x, z) > wl - 2) { x = this.px; z = this.pz; }
        y = wl - 0.13; // 水面（水面の高さ − 0.15）のすぐ上に影を落とす
        break;
      }
      case 'glow': return;
    }
    const mx = x - this.px, mz = z - this.pz;
    if (Math.abs(mx) + Math.abs(mz) > 1e-4) this.heading = Math.atan2(mx, mz);
    this.px = x; this.pz = z;
    this.object.position.set(x - half, y, z - half);
    this.object.rotation.y = this.def.motion === 'perch' ? (this.def.id === 'woodpecker' ? -Math.PI / 2 : Math.floor(t / 6) * 1.3) : this.heading;
  }

  dispose() {
    this.object.removeFromParent();
    // デバッグの目印（共有の形）は捨てない
    this.object.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry && !o.parent?.userData.marker) m.geometry.dispose(); });
  }
}
