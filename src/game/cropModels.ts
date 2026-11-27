import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { colored } from '../creatures/flowers';
import type { CropKind } from './farm';

/**
 * 作物と苗木のローポリモデル（v0.20.1 で作り直し）。遠くからでもどの植物か分かるよう、大きく、形と色をはっきりさせた。
 * 段階（0 芽 → 1 若い → 2 実がつき始め → 3 収穫できる）ごとに形を変える。1 マスの真ん中が原点、地面が y = 0。
 * 1 マスに 1 株（小麦・にんじんなど細いものは数本）。株ごとの向き・大きさのゆらぎは置く時の行列で付ける
 */

type Parts = THREE.BufferGeometry[];
const ico = (r: number, detail = 0) => new THREE.IcosahedronGeometry(r, detail);

/** 球（ico）を (sx, sy, sz) 倍して (x, y, z) へ */
function ball(r: number, x: number, y: number, z: number, color: number, sx = 1, sy = 1, sz = 1, detail = 0) {
  const g = ico(r, detail);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return colored(g, color);
}
/** 下の面の真ん中を (x, y, z) に置く円柱・円すい（r1 上・r2 下） */
function cyl(r1: number, r2: number, h: number, x: number, y: number, z: number, color: number, seg = 5, tiltX = 0, tiltZ = 0) {
  const g = new THREE.CylinderGeometry(r1, r2, h, seg);
  g.translate(0, h / 2, 0);
  if (tiltX) g.rotateX(tiltX);
  if (tiltZ) g.rotateZ(tiltZ);
  g.translate(x, y, z);
  return colored(g, color);
}
/** 下の面の真ん中を (x, y, z) に置く箱 */
function box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, rotY = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  return colored(g, color);
}
/** 葉：根元を原点に、angle の向きへ len 伸び、tilt だけ起こす（0 で水平・π/2 で真上） */
function leaf(len: number, wid: number, angle: number, tilt: number, color: number, x = 0, y = 0, z = 0) {
  const g = ico(0.5, 0);
  g.scale(wid, Math.max(0.02, wid * 0.22), len);
  g.translate(0, 0, len * 0.5);
  g.rotateX(-tilt);
  g.rotateY(angle);
  g.translate(x, y, z);
  return colored(g, color);
}
/** 葉を放射状に n 枚 */
function rosette(n: number, len: number, wid: number, tilt: number, color: number, y = 0.02, x = 0, z = 0, start = 0.3): Parts {
  return Array.from({ length: n }, (_, i) => leaf(len, wid, start + (i / n) * Math.PI * 2, tilt, color, x, y, z));
}

const LEAF = 0x4fa83a, LEAF_DARK = 0x3d8a30, LEAF_LIGHT = 0x7cc24a, STEM = 0x5a8f34;
/** 段階ごとの大きさ */
const S = [0.3, 0.55, 0.8, 1];

/** カブ：白い大きな玉（上が紫）が土から半分出て、上に葉 */
function turnip(st: number): Parts {
  const s = S[st];
  const p = rosette(st === 0 ? 2 : 5, 0.42 * s + 0.08, 0.16 * s + 0.04, 1.05, LEAF, 0.05 + (st >= 2 ? 0.22 * s : 0));
  if (st >= 2) {
    const r = 0.2 * s + 0.04;
    p.push(ball(r, 0, r * 0.75, 0, 0xf4f0ea, 1, 0.9, 1, 1), ball(r * 0.92, 0, r * 1.2, 0, st === 3 ? 0xa04aa8 : 0xc8a8cc, 1, 0.6, 1, 1));
  }
  return p;
}

/** 小麦：束ねた 11 本の茎と、太い穂（熟すと金色） */
function wheat(st: number): Parts {
  const p: Parts = [];
  const h = [0.18, 0.5, 0.85, 1.0][st];
  const stalk = st === 3 ? 0xd6ac4e : st === 2 ? 0x9cbf4a : 0x6fb442;
  const ear = st === 3 ? 0xeec86a : 0xb8cc5c;
  for (let i = 0; i < 11; i++) {
    const a = i * 2.39, r = i === 0 ? 0 : i < 6 ? 0.12 : 0.24;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, hh = h * (0.9 + 0.1 * ((i * 37) % 7) / 7);
    p.push(cyl(0.018, 0.024, hh, x, 0, z, stalk, 4, Math.sin(a) * 0.12, -Math.cos(a) * 0.12));
    if (st >= 2) p.push(ball(0.06, x * 1.15, hh + 0.08, z * 1.15, ear, 0.75, 2.4, 0.75));
    if (st <= 1) p.push(leaf(0.18 * (st + 1), 0.05, a, 1.2, LEAF_LIGHT, x, 0.05, z));
  }
  return p;
}

/** かぼちゃ：大きなつるの葉と、橙色の平たい大玉（筋の入った形） */
function pumpkin(st: number): Parts {
  const s = S[st];
  const p = rosette(st === 0 ? 2 : 4, 0.45 * s + 0.1, 0.3 * s + 0.06, 0.35, LEAF_DARK, 0.04);
  if (st >= 2) {
    const r = st === 3 ? 0.34 : 0.18, col = st === 3 ? 0xe9822a : 0x8fb04a;
    // 4 つの玉を少しずつずらして、筋のある形に
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; p.push(ball(r * 0.78, Math.cos(a) * r * 0.32, r * 0.72, Math.sin(a) * r * 0.32, col, 1, 0.82, 1, 1)); }
    p.push(cyl(0.035, 0.05, 0.14, 0, r * 1.25, 0, 0x6b5a2e, 5, 0.25));
  }
  return p;
}

/** にんじん：土から橙色の太い根の頭が出て、上にふさふさの細い葉 */
function carrot(st: number): Parts {
  const s = S[st];
  const p: Parts = [];
  for (let i = 0; i < 9; i++) p.push(leaf(0.4 * s + 0.08, 0.06, i * 0.7, 1.25 - (i % 3) * 0.12, i % 2 ? LEAF_LIGHT : LEAF, 0, st >= 2 ? 0.16 * s : 0.02, 0));
  if (st >= 2) p.push(cyl(0.17 * s + 0.02, 0.05 * s, 0.26 * s, 0, -0.06, 0, st === 3 ? 0xf08a24 : 0xe8b060, 6));
  return p;
}

/** キャベツ：外の葉を広げ、真ん中に大きな丸い玉 */
function cabbage(st: number): Parts {
  const s = S[st];
  const p = rosette(st === 0 ? 3 : 6, 0.36 * s + 0.08, 0.3 * s + 0.06, 0.45, LEAF, 0.04);
  if (st >= 1) p.push(ball(0.3 * s, 0, 0.27 * s, 0, st === 3 ? 0xa6d66a : 0x8cc45a, 1, 0.9, 1, 1));
  if (st === 3) p.push(ball(0.24, 0, 0.36, 0, 0xc4e88a, 1, 0.7, 1, 1));
  return p;
}

/** いちご：低く広がる葉の株に、赤い実と白い花 */
function strawberry(st: number): Parts {
  const s = S[st];
  const p = rosette(st === 0 ? 3 : 7, 0.3 * s + 0.08, 0.2 * s + 0.05, 0.55, LEAF_DARK, 0.04);
  if (st >= 1) p.push(...rosette(5, 0.16 * s + 0.04, 0.14 * s + 0.03, 0.85, LEAF, 0.12 * s, 0, 0, 1));
  if (st >= 2) {
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26 + 0.2, r = 0.28;
      if (st === 3) p.push(cyl(0.085, 0.001, 0.15, Math.cos(a) * r, 0.03, Math.sin(a) * r, 0xe0303a, 6), ball(0.045, Math.cos(a) * r, 0.18, Math.sin(a) * r, 0x5fa83a, 1, 0.4, 1));
      else p.push(ball(0.05, Math.cos(a) * r, 0.12, Math.sin(a) * r, 0xffffff, 1, 0.5, 1));
    }
  }
  return p;
}

/** トマト：支柱に沿って伸びた株に、真っ赤な丸い実 */
function tomato(st: number): Parts {
  const s = S[st];
  const h = 1.05 * s + 0.05;
  const p: Parts = [];
  if (st >= 1) p.push(box(0.05, h + 0.15, 0.05, 0.12, 0, 0.12, 0xb08a5a));
  p.push(cyl(0.03, 0.04, h, 0, 0, 0, STEM, 5));
  for (let i = 0; i < 2 + st * 2; i++) p.push(leaf(0.26 * s + 0.06, 0.16 * s + 0.04, i * 2.2, 0.5, LEAF, 0, (i + 1) / (st * 2 + 3) * h, 0));
  if (st >= 2) {
    const fruit = st === 3 ? 0xe23a2a : 0x8cc04a;
    for (let i = 0; i < 6; i++) { const a = i * 1.9; p.push(ball(0.085, Math.cos(a) * 0.17, h * (0.35 + 0.1 * (i % 4)), Math.sin(a) * 0.17, fruit, 1, 0.92, 1, 1)); }
  }
  return p;
}

/** とうもろこし：背の高い茎、長い葉、黄色い実（皮が開いている）と、てっぺんの穂 */
function corn(st: number): Parts {
  const s = S[st];
  const h = 1.5 * s + 0.05;
  const p: Parts = [cyl(0.04, 0.06, h, 0, 0, 0, STEM, 5)];
  for (let i = 0; i < 2 + st * 2; i++) p.push(leaf(0.45 * s + 0.1, 0.1 * s + 0.03, i * 2.5, 0.55, i % 2 ? LEAF : LEAF_LIGHT, 0, (i + 1) / (st * 2 + 3) * h * 0.9, 0));
  if (st >= 2) {
    const y = h * 0.45;
    p.push(ball(0.1, 0.13, y + 0.16, 0, st === 3 ? 0xf2cc3a : 0xc8d86a, 0.9, 2.4, 0.9), leaf(0.22, 0.12, Math.PI / 2, 1.2, 0x9ccf6a, 0.09, y, 0), leaf(0.22, 0.12, Math.PI / 2 + 0.5, 1.0, 0x9ccf6a, 0.09, y, 0));
    p.push(...[0, 1, 2].map((i) => leaf(0.18, 0.04, i * 2.1, 0.9, st === 3 ? 0xc9a860 : 0xb8c060, 0, h, 0)));
  }
  return p;
}

/** ひまわり：太い茎に大きな葉、てっぺんに黄色い大きな花（茶色の真ん中） */
function sunflower(st: number): Parts {
  const s = S[st];
  const h = 1.6 * s + 0.05;
  const p: Parts = [cyl(0.045, 0.06, h, 0, 0, 0, STEM, 5)];
  for (let i = 0; i < 2 + st; i++) p.push(leaf(0.3 * s + 0.08, 0.24 * s + 0.05, i * 2.4, 0.35, LEAF, 0, (i + 1) / (st + 3) * h, 0));
  if (st >= 2) {
    const r = st === 3 ? 0.36 : 0.18;
    // 花は南（-z）へ少し傾けて向ける
    const disc = new THREE.CylinderGeometry(r, r, 0.05, 12);
    disc.rotateX(Math.PI / 2 - 0.35);
    disc.translate(0, h + r * 0.4, -0.05);
    p.push(colored(disc, st === 3 ? 0xf6c62a : 0x9cc45a));
    if (st === 3) {
      const c = new THREE.CylinderGeometry(r * 0.45, r * 0.45, 0.08, 10);
      c.rotateX(Math.PI / 2 - 0.35);
      c.translate(0, h + r * 0.4, -0.08);
      p.push(colored(c, 0x6a4422));
    }
  }
  return p;
}

/** なす：低い木のような株に、つやのある紫の長い実がぶら下がる */
function eggplant(st: number): Parts {
  const s = S[st];
  const h = 0.6 * s + 0.05;
  const p: Parts = [cyl(0.03, 0.045, h, 0, 0, 0, 0x5a6a3a, 5)];
  p.push(...rosette(st === 0 ? 2 : 5, 0.3 * s + 0.06, 0.22 * s + 0.05, 0.35, LEAF_DARK, h * 0.7));
  if (st >= 1) p.push(...rosette(4, 0.22 * s + 0.05, 0.18 * s + 0.04, 0.6, LEAF, h, 0, 0, 1));
  if (st >= 2) {
    const col = st === 3 ? 0x4a2266 : 0x8a6aa8, len = st === 3 ? 0.16 : 0.09;
    for (let i = 0; i < 4; i++) { const a = i * 1.57 + 0.5; p.push(ball(0.07, Math.cos(a) * 0.2, h * 0.55, Math.sin(a) * 0.2, col, 0.9, len / 0.07, 0.9, 1), ball(0.03, Math.cos(a) * 0.2, h * 0.55 + len, Math.sin(a) * 0.2, 0x4f7a3a, 1.3, 0.8, 1.3)); }
  }
  return p;
}

const BUILDERS: Record<CropKind, (stage: number) => Parts> = { turnip, wheat, pumpkin, carrot, cabbage, strawberry, tomato, corn, sunflower, eggplant };

export function buildCropGeometry(kind: CropKind, stage: number): THREE.BufferGeometry {
  const g = mergeGeometries(BUILDERS[kind](Math.max(0, Math.min(3, stage))), false)!;
  g.computeBoundingSphere();
  return g;
}

/** 苗木の種類（v0.20.1）：広葉樹（丸い葉）と針葉樹（とがった葉）。育つと、それぞれの木の形になる */
export type SaplingKind = 'broad' | 'conifer';
/** 苗木：細い幹に、広葉樹は丸く、針葉樹は三角に重なった葉。植えたばかりでも分かるよう大きめ */
export function buildSaplingGeometry(kind: SaplingKind = 'broad'): THREE.BufferGeometry {
  const parts: Parts = [cyl(0.04, 0.06, 0.55, 0, 0, 0, 0x7a5532, 5)];
  if (kind === 'broad') parts.push(ball(0.22, 0, 0.62, 0, 0x6fb442, 1, 0.9, 1), ball(0.15, 0.13, 0.52, 0.05, 0x82c452), ball(0.14, -0.1, 0.5, -0.08, 0x5fa43a));
  else for (let i = 0; i < 3; i++) parts.push(cyl(0.001, 0.26 - i * 0.06, 0.3, 0, 0.3 + i * 0.17, 0, i % 2 ? 0x3f7a3a : 0x2f6a34, 6));
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}
