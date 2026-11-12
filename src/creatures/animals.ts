import * as THREE from 'three/webgpu';
import type { WorldData as World } from '../world/terrain';

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

const NAMES = ['こむぎ', 'もち', 'あずき', 'きなこ', 'まめ', 'くるみ', 'ゆず', 'しらたま', 'ごま', 'おこげ', 'みかん', 'さくら', 'つくし', 'どんぐり', 'ひなた', 'ふき', 'よもぎ', 'あんず', 'ちゃい', 'ぽこ', 'てまり', 'わかば', 'つぶ', 'こはる'];
const FAVORITES = ['カブ', '小麦', 'かぼちゃ', '花畑', '水辺', '日なたぼっこ', '雨上がり', '朝の散歩', '星空', '木かげ'];

const mat = (color: number) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85 });

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

  constructor(readonly species: Species, color: number, private world: World, x: number, z: number, id: number) {
    this.id = id;
    this.name = NAMES[id % NAMES.length];
    this.favorite = FAVORITES[(id * 7 + species.length) % FAVORITES.length];
    this.model = buildModel(species, color);
    this.object.add(this.model);
    // 見下ろし視点で見つけやすいよう、ボクセル 1 個分より少し大きめにする
    this.object.scale.setScalar(1.7);
    this.object.userData.animal = this;
    this.pos.set(x + 0.5, z + 0.5);
    this.y = world.heights[x + z * world.size];
    this.sync();
  }

  get info() { return SPECIES[this.species]; }

  private cell(x: number, z: number) {
    const N = this.world.size;
    const ix = Math.floor(x), iz = Math.floor(z);
    if (ix < 0 || iz < 0 || ix >= N || iz >= N) return null;
    return { walk: this.world.walkable[ix + iz * N] === 1, h: this.world.heights[ix + iz * N] };
  }

  private pickTarget() {
    for (let tries = 0; tries < 20; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 7;
      const tx = this.pos.x + Math.cos(a) * r, tz = this.pos.y + Math.sin(a) * r;
      const c = this.cell(tx, tz);
      if (c?.walk) { this.target = new THREE.Vector2(tx, tz); return; }
    }
  }

  private isAsleep(hour: number) {
    const [s, w] = this.info.sleeps;
    return s > w ? hour >= s || hour < w : hour >= s && hour < w;
  }

  update(dt: number, hour: number) {
    const asleep = this.isAsleep(hour);
    const { speed, hop: hopH } = this.info;
    let moving = false;

    if (!asleep && this.idle <= 0 && !this.target) this.pickTarget();
    if (this.idle > 0) this.idle -= dt;

    if (this.target && !asleep) {
      const d = this.target.clone().sub(this.pos);
      const dist = d.length();
      if (dist < 0.1) {
        this.target = null;
        this.idle = 1 + Math.random() * 4;
      } else {
        const step = Math.min(dist, speed * dt);
        const nx = this.pos.x + (d.x / dist) * step, nz = this.pos.y + (d.y / dist) * step;
        const here = this.cell(this.pos.x, this.pos.y), next = this.cell(nx, nz);
        if (!next || !next.walk || (here && Math.abs(next.h - here.h) > 1)) {
          this.target = null; // 段差・水・木で止まって考え直す
          this.idle = 0.5;
        } else {
          this.pos.set(nx, nz);
          this.heading = Math.atan2(d.x, d.y);
          moving = true;
        }
      }
    }
    this.activity = asleep ? 'sleep' : moving ? 'walk' : 'rest';

    const c = this.cell(this.pos.x, this.pos.y);
    if (c) this.y += (c.h - this.y) * Math.min(1, dt * 10);
    this.phase += dt * (moving ? 9 : 2);
    this.model.position.y = moving ? Math.abs(Math.sin(this.phase)) * hopH : 0;
    // 眠っている時は少し縮こまる
    const s = asleep ? 0.85 : 1;
    this.model.scale.set(1, s, 1);
    this.object.rotation.y += ((this.heading - this.object.rotation.y + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 8);
    this.sync();
  }

  private sync() {
    const half = this.world.size / 2;
    this.object.position.set(this.pos.x - half, this.y, this.pos.y - half);
  }
}

/** 歩ける場所にランダムに動物を配置する。あひるは水辺、りすは木の近くを選びやすく */
export function spawnAnimals(world: World, count: number): Animal[] {
  const N = world.size;
  const out: Animal[] = [];
  for (let i = 0; i < count; i++) {
    const species = SPECIES_LIST[i % SPECIES_LIST.length];
    const info = SPECIES[species];
    let best: [number, number] | null = null;
    for (let tries = 0; tries < 300; tries++) {
      const x = 4 + Math.floor(Math.random() * (N - 8)), z = 4 + Math.floor(Math.random() * (N - 8));
      if (!world.walkable[x + z * N]) continue;
      best = [x, z];
      if (species !== 'duck') break;
      // あひる：水辺（隣が水）を探す
      const nearWater = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => world.heights[x + dx + (z + dz) * N] < world.waterLevel);
      if (nearWater) break;
    }
    if (best) out.push(new Animal(species, info.colors[i % info.colors.length], world, best[0], best[1], i));
  }
  return out;
}
