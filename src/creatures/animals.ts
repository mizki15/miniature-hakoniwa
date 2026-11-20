import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { WorldData as World } from '../world/terrain';
import { approach, gaitPose, turnToward, wrapAngle, type Gait } from './motion';

/**
 * 仮の住人（ローポリの動物）。CC0 素材に差し替える前提で、基本形状だけで組み立てている。
 * フラットシェーディングで、地形の立方体と並べたときの相性を確認するのが目的。
 */
export type Species = 'rabbit' | 'tanuki' | 'fox' | 'deer' | 'duck' | 'squirrel' | 'hedgehog';

export interface SpeciesInfo {
  name: string;
  icon: string;
  colors: number[];
  speed: number;
  hop: number; // 歩く時の跳ね方
  skill: string; // 得意なこと（今後、住人の仕事に使う）
  note: string; // 図鑑の説明
  sleeps: [number, number]; // 眠る時間帯 [寝る時刻, 起きる時刻]
}

export const SPECIES: Record<Species, SpeciesInfo> = {
  rabbit: { name: 'うさぎ', icon: '🐇', colors: [0xf4efe6, 0xc9a27a, 0xe9e4da], speed: 1.5, hop: 0.28, skill: '畑仕事', note: '跳ねるように歩く。畑の近くが好き。', sleeps: [21, 5.5] },
  tanuki: { name: 'たぬき', icon: '🦝', colors: [0x8a6a4a, 0x9a7a58], speed: 1.0, hop: 0.06, skill: '森の手入れ', note: 'のんびり屋。夕方によく動く。', sleeps: [23.5, 8] },
  fox: { name: 'きつね', icon: '🦊', colors: [0xd9792e, 0xc8662a], speed: 1.7, hop: 0.08, skill: '見回り', note: 'すばしこい。ふさふさのしっぽ。', sleeps: [22, 5] },
  deer: { name: 'しか', icon: '🦌', colors: [0xa77a4e, 0x9c6f45], speed: 1.2, hop: 0.05, skill: '草地の手入れ', note: '背が高く、遠くからでも目立つ。', sleeps: [21.5, 5] },
  duck: { name: 'あひる', icon: '🦆', colors: [0xf6f2ea, 0xf2e3b0], speed: 0.8, hop: 0.03, skill: '釣り', note: '水辺をよちよち歩く。', sleeps: [20.5, 6] },
  squirrel: { name: 'りす', icon: '🐿', colors: [0xb0683a, 0x9a5a32], speed: 2.0, hop: 0.2, skill: '木の実集め', note: '木のそばをちょこまか走る。', sleeps: [20, 6] },
  hedgehog: { name: 'はりねずみ', icon: '🦔', colors: [0x7a6a58, 0x8a7a66], speed: 0.6, hop: 0.02, skill: '虫取り', note: '夜に活動する。', sleeps: [8, 18] },
};
export const SPECIES_LIST = Object.keys(SPECIES) as Species[];

export const NAMES = ['こむぎ', 'もち', 'あずき', 'きなこ', 'まめ', 'くるみ', 'ゆず', 'しらたま', 'ごま', 'おこげ', 'みかん', 'さくら', 'つくし', 'どんぐり', 'ひなた', 'ふき', 'よもぎ', 'あんず', 'ちゃい', 'ぽこ', 'てまり', 'わかば', 'つぶ', 'こはる'];
const FAVORITES = ['カブ', '小麦', 'かぼちゃ', '花畑', '水辺', '日なたぼっこ', '雨上がり', '朝の散歩', '星空', '木かげ'];

const mat = (color: number) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85 });
/** 1 匹ぶんの部品をまとめた後の材質（色は頂点ごとに持つ。全部の動物で共有） */
const mergedMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });

/**
 * 部品ごとのメッシュを 1 つのメッシュにまとめる（部品は個別に動かさないので、見た目は同じまま描画命令を減らせる）。
 * 部品の色は頂点の色にする。
 */
export function mergeModel(g: THREE.Group): THREE.Group {
  g.updateMatrixWorld(true);
  const geos: THREE.BufferGeometry[] = [];
  const c = new THREE.Color();
  for (const o of g.children) {
    const m = o as THREE.Mesh;
    const geo = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix);
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    c.copy((m.material as THREE.MeshStandardMaterial).color);
    const n = geo.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(geo);
    (m.material as THREE.Material).dispose();
  }
  const out = new THREE.Group();
  const mesh = new THREE.Mesh(mergeGeometries(geos), mergedMat);
  mesh.castShadow = true;
  out.add(mesh);
  geos.forEach((x) => x.dispose());
  return out;
}

function part(geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, mat(color));
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  return m;
}

const ico = (r: number) => new THREE.IcosahedronGeometry(r, 0);
const box = new THREE.BoxGeometry(1, 1, 1);
const cone = (r: number, h: number) => new THREE.ConeGeometry(r, h, 4);
const EYE = 0x222222;

function buildModel(species: Species, color: number): THREE.Group {
  const g = new THREE.Group();
  const eyes = (y: number, z: number, dx: number, c = EYE) => {
    g.add(part(box, c, -dx, y, z, 0.04, 0.05, 0.03));
    g.add(part(box, c, dx, y, z, 0.04, 0.05, 0.03));
  };
  switch (species) {
    case 'rabbit':
      g.add(part(ico(0.3), color, 0, 0.3, 0, 1, 0.9, 1.2));
      g.add(part(ico(0.22), color, 0, 0.55, 0.25));
      g.add(part(box, color, -0.08, 0.85, 0.22, 0.07, 0.34, 0.12));
      g.add(part(box, color, 0.08, 0.85, 0.22, 0.07, 0.34, 0.12));
      g.add(part(ico(0.1), 0xffffff, 0, 0.33, -0.35));
      eyes(0.6, 0.43, 0.1);
      break;
    case 'tanuki':
      g.add(part(ico(0.34), color, 0, 0.36, 0, 1.1, 1, 1.2));
      g.add(part(ico(0.26), color, 0, 0.62, 0.28));
      g.add(part(box, 0x3a2a1e, 0, 0.6, 0.47, 0.32, 0.1, 0.06));
      g.add(part(ico(0.08), 0x3a2a1e, -0.15, 0.86, 0.26));
      g.add(part(ico(0.08), 0x3a2a1e, 0.15, 0.86, 0.26));
      g.add(part(ico(0.13), color, 0, 0.32, -0.42, 1, 1, 1.6));
      g.add(part(ico(0.09), 0x3a2a1e, 0, 0.32, -0.6));
      eyes(0.66, 0.5, 0.08, 0xffffff);
      break;
    case 'fox':
      g.add(part(ico(0.26), color, 0, 0.34, 0, 0.9, 0.85, 1.35));
      g.add(part(ico(0.2), color, 0, 0.56, 0.3));
      g.add(part(cone(0.08, 0.22), color, 0, 0.53, 0.48, 1, 1, 1).rotateX(Math.PI / 2) as THREE.Mesh);
      g.add(part(cone(0.07, 0.18), color, -0.1, 0.78, 0.27));
      g.add(part(cone(0.07, 0.18), color, 0.1, 0.78, 0.27));
      g.add(part(ico(0.15), color, 0, 0.38, -0.42, 0.9, 0.9, 1.8));
      g.add(part(ico(0.08), 0xffffff, 0, 0.38, -0.68));
      g.add(part(ico(0.1), 0xf6efe4, 0, 0.47, 0.42, 1, 0.6, 1));
      eyes(0.62, 0.45, 0.08);
      break;
    case 'deer':
      g.add(part(ico(0.3), color, 0, 0.62, 0, 0.85, 0.8, 1.4));
      for (const [x, z] of [[-0.12, 0.25], [0.12, 0.25], [-0.12, -0.25], [0.12, -0.25]]) g.add(part(box, 0x6e4c2e, x, 0.27, z, 0.06, 0.55, 0.06));
      g.add(part(box, color, 0, 0.92, 0.33, 0.12, 0.35, 0.12));
      g.add(part(ico(0.15), color, 0, 1.12, 0.42, 0.9, 0.9, 1.2));
      g.add(part(box, 0x8a6a4a, -0.1, 1.33, 0.38, 0.03, 0.22, 0.03));
      g.add(part(box, 0x8a6a4a, 0.1, 1.33, 0.38, 0.03, 0.22, 0.03));
      g.add(part(ico(0.06), 0xffffff, 0, 0.7, -0.4));
      for (const [x, y, z] of [[0.08, 0.66, 0.2], [-0.1, 0.72, 0], [0.06, 0.7, -0.18]]) g.add(part(ico(0.035), 0xf6efe4, x, y, z));
      eyes(1.16, 0.55, 0.07);
      break;
    case 'duck':
      g.add(part(ico(0.25), color, 0, 0.25, 0, 0.9, 0.8, 1.3));
      g.add(part(ico(0.15), color, 0, 0.5, 0.2));
      g.add(part(box, 0xf2a03a, 0, 0.47, 0.37, 0.12, 0.05, 0.14));
      g.add(part(cone(0.08, 0.15), color, 0, 0.32, -0.36).rotateX(-Math.PI / 2.5) as THREE.Mesh);
      g.add(part(box, 0xf2a03a, -0.07, 0.03, 0.05, 0.08, 0.04, 0.12));
      g.add(part(box, 0xf2a03a, 0.07, 0.03, 0.05, 0.08, 0.04, 0.12));
      eyes(0.55, 0.32, 0.07);
      break;
    case 'squirrel':
      g.add(part(ico(0.18), color, 0, 0.24, 0, 0.9, 1, 1.2));
      g.add(part(ico(0.14), color, 0, 0.42, 0.17));
      g.add(part(cone(0.04, 0.1), color, -0.07, 0.56, 0.15));
      g.add(part(cone(0.04, 0.1), color, 0.07, 0.56, 0.15));
      g.add(part(ico(0.15), color, 0, 0.42, -0.26, 0.8, 1.6, 0.9));
      g.add(part(ico(0.08), 0xf2e3c8, 0, 0.26, 0.15));
      eyes(0.45, 0.29, 0.06);
      break;
    case 'hedgehog':
      g.add(part(ico(0.24), 0x5a4a3c, 0, 0.2, -0.02, 1, 0.75, 1.15));
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        g.add(part(cone(0.05, 0.14), 0x4a3a2c, Math.cos(a) * 0.17, 0.28, Math.sin(a) * 0.17 - 0.04));
      }
      g.add(part(ico(0.12), color, 0, 0.15, 0.22, 1, 0.9, 1.2));
      g.add(part(ico(0.03), EYE, 0, 0.14, 0.36));
      eyes(0.2, 0.3, 0.06);
      break;
  }
  return g;
}

export type Activity = 'walk' | 'rest' | 'sleep';
export const ACTIVITY_NAMES: Record<Activity, string> = { walk: '散歩中', rest: 'ひと休み', sleep: '眠っている' };

/** 種ごとの歩き方 */
const GAIT_OF: Record<Species, Gait> = { rabbit: 'hop', squirrel: 'hop', duck: 'waddle', tanuki: 'walk', fox: 'walk', deer: 'walk', hedgehog: 'walk' };

/** 止まっている時のしぐさ。look：あたりを見回す、sniff：地面のにおいをかぐ、still：じっとする */
type Idle = 'look' | 'sniff' | 'still';

export class Animal {
  readonly object = new THREE.Group();
  readonly name: string;
  readonly favorite: string;
  readonly id: number;
  activity: Activity = 'rest';
  private model: THREE.Group;
  private pos = new THREE.Vector2();
  private target: THREE.Vector2 | null = null;
  private y = 0;
  private idle = 0;
  private phase = Math.random() * 10;
  private heading = Math.random() * Math.PI * 2;
  /** いまの速さ（急に走り出したり止まったりしないよう、少しずつ変える） */
  private vel = 0;
  private gesture: Idle = 'still';
  private gestureT = 0;
  /** 見回す時の首の向き（体の向きからのずれ） */
  private look = 0;
  private lookTo = 0;
  private sniff = 0;
  private t = Math.random() * 100;

  constructor(readonly species: Species, color: number, private world: World, x: number, z: number, id: number, name?: string) {
    this.id = id;
    this.name = name ?? NAMES[id % NAMES.length];
    this.favorite = FAVORITES[(id * 7 + species.length) % FAVORITES.length];
    this.model = mergeModel(buildModel(species, color));
    this.object.add(this.model);
    // 傾きは体の向きを決めた後に、体から見て前後・左右に付ける
    this.model.rotation.order = 'YXZ';
    // 見下ろし視点で見つけやすいよう、ボクセル 1 個分より少し大きめにする
    this.object.scale.setScalar(1.7);
    this.object.userData.animal = this;
    this.pos.set(x + 0.5, z + 0.5);
    this.y = world.heights[x + z * world.size];
    this.object.rotation.y = this.heading;
    this.sync();
  }

  get info() { return SPECIES[this.species]; }
  /** いる列（保存用。枠の座標） */
  get colXZ(): [number, number] { return [Math.floor(this.pos.x), Math.floor(this.pos.y)]; }

  /** 別の列へ移す（建物が足元に置かれた時など）。向かっていた先は考え直す */
  moveTo(x: number, z: number) {
    this.pos.set(x + 0.5, z + 0.5);
    this.y = this.world.heights[x + z * this.world.size];
    this.target = null;
    this.vel = 0;
    this.sync();
  }

  private cell(x: number, z: number) {
    const N = this.world.size;
    const ix = Math.floor(x), iz = Math.floor(z);
    if (ix < 0 || iz < 0 || ix >= N || iz >= N) return null;
    return { walk: this.world.walkable[ix + iz * N] === 1, h: this.world.heights[ix + iz * N] };
  }

  /** 次の行き先。たいていは今向いている方の前のほう（行ったり来たりしない） */
  private pickTarget() {
    for (let tries = 0; tries < 20; tries++) {
      const ahead = tries < 12 && Math.random() < 0.7;
      const a = ahead ? this.heading + (Math.random() - 0.5) * 2.2 : Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 7;
      // 向きは atan2(dx, dz)（前は +z）
      const tx = this.pos.x + Math.sin(a) * r, tz = this.pos.y + Math.cos(a) * r;
      if (this.clearPath(tx, tz)) { this.target = new THREE.Vector2(tx, tz); return; }
    }
  }

  /** まっすぐ歩いて行けるか（途中に水・木・高い段差がない）。崖の前で行ったり来たりしないように、道を先に確かめる */
  private clearPath(tx: number, tz: number) {
    const dx = tx - this.pos.x, dz = tz - this.pos.y, n = Math.ceil(Math.hypot(dx, dz) / 0.4);
    let prev = this.cell(this.pos.x, this.pos.y);
    for (let i = 1; i <= n; i++) {
      const c = this.cell(this.pos.x + (dx * i) / n, this.pos.y + (dz * i) / n);
      if (!c?.walk || (prev && Math.abs(c.h - prev.h) > 1)) return false;
      prev = c;
    }
    return true;
  }

  private isAsleep(hour: number) {
    const [s, w] = this.info.sleeps;
    return s > w ? hour >= s || hour < w : hour >= s && hour < w;
  }

  /** 止まっている間のしぐさを時々替える */
  private nextGesture() {
    const r = Math.random();
    this.gesture = r < 0.4 ? 'look' : r < 0.7 ? 'sniff' : 'still';
    this.gestureT = 1.2 + Math.random() * 2.2;
    this.lookTo = this.gesture === 'look' ? (Math.random() - 0.5) * 1.6 : 0;
  }

  update(dt: number, hour: number) {
    this.t += dt;
    const asleep = this.isAsleep(hour);
    const { speed, hop: hopH } = this.info;
    const gait = GAIT_OF[this.species];
    let want = 0; // 出したい速さ

    if (!asleep && this.idle <= 0 && !this.target) this.pickTarget();
    if (this.idle > 0) this.idle -= dt;

    if (this.target && !asleep) {
      const d = this.target.clone().sub(this.pos);
      const dist = d.length();
      if (dist < 0.1) {
        this.target = null;
        this.idle = 1 + Math.random() * 4;
      } else {
        // 行き先へ向きを変えてから歩き出す（大きく向きを変える時はその場で回る）
        const face = Math.atan2(d.x, d.y);
        this.heading = turnToward(this.heading, face, dt * (3 + speed));
        const off = Math.abs(wrapAngle(face - this.heading));
        // 着く少し前から速さを落とす
        want = off > 0.9 ? 0 : speed * Math.min(1, dist / 0.8) * (1 - off / 0.9 * 0.6);
      }
    }
    this.vel = approach(this.vel, want, dt * speed * (want > this.vel ? 3 : 5));
    let moving = this.vel > 0.02;
    if (moving) {
      const step = this.vel * dt;
      const nx = this.pos.x + Math.sin(this.heading) * step, nz = this.pos.y + Math.cos(this.heading) * step;
      const here = this.cell(this.pos.x, this.pos.y), next = this.cell(nx, nz);
      if (!next || !next.walk || (here && Math.abs(next.h - here.h) > 1)) {
        this.target = null; // 段差・水・木で止まって考え直す
        this.idle = 0.5;
        this.vel = 0;
        moving = false;
      } else {
        this.pos.set(nx, nz);
        // 歩いた距離の分だけ足取りを進める（速いほど足取りも速い）
        this.phase += step * (gait === 'hop' ? 4.2 : gait === 'waddle' ? 7 : 5.5);
      }
    }
    this.activity = asleep ? 'sleep' : moving ? 'walk' : 'rest';

    // 止まっている時のしぐさ
    if (!moving && !asleep) {
      this.gestureT -= dt;
      if (this.gestureT <= 0) this.nextGesture();
    } else if (this.gesture !== 'still') {
      this.gesture = 'still';
      this.lookTo = 0;
    }
    this.look += (this.lookTo - this.look) * Math.min(1, dt * 3);
    const sniffTo = this.gesture === 'sniff' ? 0.22 + Math.max(0, Math.sin(this.t * 9)) * 0.06 : 0;
    this.sniff += (sniffTo - this.sniff) * Math.min(1, dt * 5);

    const c = this.cell(this.pos.x, this.pos.y);
    if (c) this.y += (c.h - this.y) * Math.min(1, dt * 10);
    // 坂では体を前後に傾ける（登りは鼻先が上がる）
    const ahead = this.cell(this.pos.x + Math.sin(this.heading) * 0.6, this.pos.y + Math.cos(this.heading) * 0.6);
    const slope = c && ahead?.walk ? Math.max(-1, Math.min(1, ahead.h - c.h)) : 0;

    const pose = gaitPose(gait, this.phase, hopH, Math.min(1, this.vel / speed));
    // 眠っている時は少し縮こまり、ゆっくり息をする
    const breathe = asleep ? 0.85 + Math.sin(this.t * 1.6) * 0.025 : 1;
    this.model.position.y = pose.lift;
    this.model.scale.set(1 + (1 - pose.squash) * 0.5, breathe * pose.squash, 1);
    this.model.rotation.set(pose.pitch + this.sniff - slope * 0.25, asleep ? 0 : this.look, pose.roll);
    this.object.rotation.y = this.heading;
    this.sync();
  }

  private sync() {
    const half = this.world.size / 2;
    this.object.position.set(this.pos.x - half, this.y, this.pos.y - half);
  }
}

/** 住人を 1 匹作る（場所は creatures/place.ts で選ぶ）。色は番号で順に変える */
export function makeResident(world: World, species: Species, x: number, z: number, id: number, name: string): Animal {
  const info = SPECIES[species];
  return new Animal(species, info.colors[id % info.colors.length], world, x, z, id, name);
}
