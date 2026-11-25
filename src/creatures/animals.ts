import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { WorldData as World } from '../world/terrain';
import { isPathBlock } from '../world/blocks';
import { approach, gaitPose, turnToward, wrapAngle, type Gait } from './motion';
import { RESIDENT_COLORS, buildResidentModel } from './models';

/**
 * 住人（ローポリの動物）。形は models.ts（v0.16 で Codex と作った、黒目のあるローポリ）。
 * 部品は 1 匹ぶんを 1 つのメッシュにまとめる（描画命令を増やさない）。
 */
export type Species = 'rabbit' | 'tanuki' | 'fox' | 'deer' | 'duck' | 'squirrel' | 'hedgehog'
  | 'sheep' | 'bear' | 'otter' | 'mole' | 'serow' | 'stoat' | 'beaver' | 'capybara' | 'cat';

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
  // ---- v0.16 で足した 9 種（仕事は設計メモ 10 章。効き目は後の版で入れる） ----
  sheep: { name: 'ひつじ', icon: '🐑', colors: [0xf3efe6], speed: 0.9, hop: 0.04, skill: '草刈りの手伝い', note: 'もこもこの毛。広い草原でのんびり草を食べる。', sleeps: [20.5, 5.5] },
  bear: { name: 'くま', icon: '🐻', colors: [0x6b4a32], speed: 0.9, hop: 0.03, skill: '力仕事', note: '大きくて力持ち。森の奥と水辺を行き来する。', sleeps: [21, 6.5] },
  otter: { name: 'カワウソ', icon: '🦦', colors: [0x7a5638], speed: 1.4, hop: 0.05, skill: '貝拾い', note: '水辺をすばしこく走る。きれいな石を集めるのが好き。', sleeps: [22, 6] },
  mole: { name: 'モグラ', icon: '🐾', colors: [0x3a3438], speed: 0.6, hop: 0.02, skill: '土の手入れ', note: '大きな手で土を掘る。畑の土をふかふかにする。', sleeps: [9, 17] },
  serow: { name: 'カモシカ', icon: '🐐', colors: [0xb8b2a6], speed: 1.1, hop: 0.06, skill: '石拾い', note: '岩場を身軽に歩く。高い所が好き。', sleeps: [21, 5] },
  stoat: { name: 'オコジョ', icon: '❄', colors: [0xf6f4ef], speed: 2.1, hop: 0.16, skill: '冬の畑番', note: '冬は真っ白。しっぽの先だけ黒い。', sleeps: [21.5, 6] },
  beaver: { name: 'ビーバー', icon: '🦫', colors: [0x7a5232], speed: 0.8, hop: 0.03, skill: '粘土運び', note: '平たいしっぽ。湿地で木の枝を運んでいる。', sleeps: [8, 17] },
  capybara: { name: 'カピバラ', icon: '♨', colors: [0x9a7450], speed: 0.6, hop: 0.02, skill: 'みんなを和ませる', note: 'いつも落ち着いている。湿地でのんびりする。', sleeps: [20, 6] },
  cat: { name: 'ねこ', icon: '🐈', colors: [0xe0a05a, 0x3a3a3a, 0xe8e4dc], speed: 1.3, hop: 0.04, skill: '探し物', note: '家のまわりを気ままに歩く。たまに何か拾ってくる。', sleeps: [13, 15] },
};
export const SPECIES_LIST = Object.keys(SPECIES) as Species[];

export const NAMES = ['こむぎ', 'もち', 'あずき', 'きなこ', 'まめ', 'くるみ', 'ゆず', 'しらたま', 'ごま', 'おこげ', 'みかん', 'さくら', 'つくし', 'どんぐり', 'ひなた', 'ふき', 'よもぎ', 'あんず', 'ちゃい', 'ぽこ', 'てまり', 'わかば', 'つぶ', 'こはる'];
const FAVORITES = ['カブ', '小麦', 'かぼちゃ', '花畑', '水辺', '日なたぼっこ', '雨上がり', '朝の散歩', '星空', '木かげ'];

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

export type Activity = 'walk' | 'rest' | 'sleep';
export const ACTIVITY_NAMES: Record<Activity, string> = { walk: '散歩中', rest: 'ひと休み', sleep: '眠っている' };

/** 種ごとの歩き方 */
const GAIT_OF: Record<Species, Gait> = {
  rabbit: 'hop', squirrel: 'hop', duck: 'waddle', tanuki: 'walk', fox: 'walk', deer: 'walk', hedgehog: 'walk',
  sheep: 'walk', bear: 'walk', otter: 'waddle', mole: 'walk', serow: 'walk', stoat: 'hop', beaver: 'waddle', capybara: 'walk', cat: 'walk',
};

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
    this.model = mergeModel(buildResidentModel(species, color));
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

  /** その場所の一番上が道か */
  private onPath(x: number, z: number) {
    const N = this.world.size;
    const ix = Math.floor(x), iz = Math.floor(z);
    if (ix < 0 || iz < 0 || ix >= N || iz >= N) return false;
    const h = this.world.heights[ix + iz * N];
    return h > 0 && isPathBlock(this.world.voxels[ix + iz * N + (h - 1) * N * N]);
  }

  /**
   * 次の行き先。たいていは今向いている方の前のほう（行ったり来たりしない）。
   * 道（土の道・石畳）の上に行ける候補があれば、たいていそちらを選ぶ（道を好んで歩く）
   */
  private pickTarget() {
    let first: THREE.Vector2 | null = null;
    for (let tries = 0; tries < 20; tries++) {
      const ahead = tries < 12 && Math.random() < 0.7;
      const a = ahead ? this.heading + (Math.random() - 0.5) * 2.2 : Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 7;
      // 向きは atan2(dx, dz)（前は +z）
      const tx = this.pos.x + Math.sin(a) * r, tz = this.pos.y + Math.cos(a) * r;
      if (!this.clearPath(tx, tz)) continue;
      if (this.onPath(tx, tz)) { this.target = new THREE.Vector2(tx, tz); return; }
      first ??= new THREE.Vector2(tx, tz);
      // 道を探すのは 8 回まで。道の上にいる時は、道から外れる候補を少しだけ選びにくくする
      if (tries >= 8 && !(this.onPath(this.pos.x, this.pos.y) && Math.random() < 0.6)) break;
    }
    if (first) this.target = first;
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
  // 色は models.ts の毛色（いちばんよくある色を多めに）
  const colors = RESIDENT_COLORS[species] ?? info.colors;
  return new Animal(species, colors[id % 3 === 2 ? Math.min(colors.length - 1, 1 + (id % 2)) : 0], world, x, z, id, name);
}
