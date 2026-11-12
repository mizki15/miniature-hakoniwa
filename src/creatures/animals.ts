import * as THREE from 'three/webgpu';
import type { WorldData as World } from '../world/terrain';

/**
 * 仮の住人（ローポリの動物）。CC0 素材に差し替える前提で、基本形状だけで組み立てている。
 * フラットシェーディングで、地形の立方体と並べたときの相性を確認するのが目的。
 */
type Species = 'rabbit' | 'tanuki';

const mat = (color: number) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85 });

function part(geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, mat(color));
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  return m;
}

function buildModel(species: Species, color: number): THREE.Group {
  const g = new THREE.Group();
  const ico = (r: number) => new THREE.IcosahedronGeometry(r, 0);
  const box = new THREE.BoxGeometry(1, 1, 1);
  if (species === 'rabbit') {
    g.add(part(ico(0.3), color, 0, 0.3, 0, 1, 0.9, 1.2));
    g.add(part(ico(0.22), color, 0, 0.55, 0.25));
    g.add(part(box, color, -0.08, 0.85, 0.22, 0.07, 0.34, 0.12));
    g.add(part(box, color, 0.08, 0.85, 0.22, 0.07, 0.34, 0.12));
    g.add(part(ico(0.1), 0xffffff, 0, 0.33, -0.35));
    g.add(part(box, 0x222222, -0.1, 0.6, 0.43, 0.04, 0.05, 0.03));
    g.add(part(box, 0x222222, 0.1, 0.6, 0.43, 0.04, 0.05, 0.03));
  } else {
    g.add(part(ico(0.34), color, 0, 0.36, 0, 1.1, 1, 1.2));
    g.add(part(ico(0.26), color, 0, 0.62, 0.28));
    g.add(part(box, 0x3a2a1e, 0, 0.6, 0.47, 0.32, 0.1, 0.06));
    g.add(part(ico(0.08), 0x3a2a1e, -0.15, 0.86, 0.26));
    g.add(part(ico(0.08), 0x3a2a1e, 0.15, 0.86, 0.26));
    g.add(part(ico(0.13), color, 0, 0.32, -0.42, 1, 1, 1.6));
    g.add(part(ico(0.09), 0x3a2a1e, 0, 0.32, -0.6, 1, 1, 1));
    g.add(part(box, 0xffffff, -0.08, 0.66, 0.5, 0.04, 0.05, 0.03));
    g.add(part(box, 0xffffff, 0.08, 0.66, 0.5, 0.04, 0.05, 0.03));
  }
  return g;
}

export class Animal {
  readonly object = new THREE.Group();
  private model: THREE.Group;
  private pos = new THREE.Vector2();
  private target: THREE.Vector2 | null = null;
  private y = 0;
  private idle = 0;
  private phase = Math.random() * 10;
  private heading = Math.random() * Math.PI * 2;

  constructor(readonly species: Species, color: number, private world: World, x: number, z: number) {
    this.model = buildModel(species, color);
    this.object.add(this.model);
    // 見下ろし視点で見つけやすいよう、ボクセル 1 個分より少し大きめにする
    this.object.scale.setScalar(1.7);
    this.pos.set(x + 0.5, z + 0.5);
    this.y = world.heights[x + z * world.size];
    this.sync();
  }

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

  update(dt: number, hour: number) {
    const asleep = hour < 5.5 || hour > 21;
    const speed = this.species === 'rabbit' ? 1.5 : 1.0;
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

    const c = this.cell(this.pos.x, this.pos.y);
    if (c) this.y += (c.h - this.y) * Math.min(1, dt * 10);
    this.phase += dt * (moving ? 9 : 2);
    const hop = moving ? Math.abs(Math.sin(this.phase)) * (this.species === 'rabbit' ? 0.28 : 0.06) : 0;
    this.model.position.y = hop;
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

/** 歩ける場所にランダムに動物を配置する */
export function spawnAnimals(world: World, count: number): Animal[] {
  const N = world.size;
  const out: Animal[] = [];
  const colors: [Species, number][] = [['rabbit', 0xf4efe6], ['rabbit', 0xc9a27a], ['tanuki', 0x8a6a4a], ['rabbit', 0xe9e4da], ['tanuki', 0x9a7a58]];
  for (let i = 0; i < count; i++) {
    for (let tries = 0; tries < 200; tries++) {
      const x = 4 + Math.floor(Math.random() * (N - 8)), z = 4 + Math.floor(Math.random() * (N - 8));
      if (world.walkable[x + z * N]) {
        const [sp, col] = colors[i % colors.length];
        out.push(new Animal(sp, col, world, x, z));
        break;
      }
    }
  }
  return out;
}
