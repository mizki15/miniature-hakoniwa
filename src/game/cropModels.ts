import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { colored } from '../creatures/flowers';
import type { CropKind } from './farm';

/**
 * 作物のローポリモデル。段階（0 芽 → 3 収穫できる）ごとに形を変える。
 * 1 マス（地面のボクセル 1 個）の上に、数株を並べて植える。
 */

const ico = (r: number, detail = 0) => new THREE.IcosahedronGeometry(r, detail);

/** 1 マスの中に株を並べる位置 */
const SPOTS: [number, number][] = [[-0.24, -0.24], [0.24, -0.24], [-0.24, 0.24], [0.24, 0.24]];

function leaf(len: number, wid: number, angle: number, tilt: number, color: number) {
  const g = ico(0.1);
  g.scale(wid * 6, 0.25, len * 6);
  g.translate(0, 0, len * 0.55);
  g.rotateX(-tilt);
  g.rotateY(angle);
  return colored(g, color);
}

function turnip(stage: number, x: number, z: number): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const size = [0.35, 0.6, 0.85, 1][stage];
  const leaves = stage === 0 ? 2 : 4;
  for (let i = 0; i < leaves; i++) {
    const g = leaf(0.12 * size + 0.02, 0.05 * size + 0.01, (i / leaves) * Math.PI * 2 + 0.4, 0.9, 0x5fae3a);
    g.translate(x, 0.02 + 0.03 * size, z);
    parts.push(g);
  }
  if (stage >= 2) {
    const root = ico(0.07 * size + 0.02, 0);
    root.scale(1, 0.9, 1);
    root.translate(x, 0.03, z);
    parts.push(colored(root, stage === 3 ? 0xf2eee6 : 0xe6dccb));
  }
  return parts;
}

function wheat(stage: number, x: number, z: number): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const h = [0.12, 0.3, 0.5, 0.6][stage];
  const stalkColor = stage === 3 ? 0xd9b45a : stage === 2 ? 0x9cbf4a : 0x6fb442;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const ox = x + Math.cos(a) * 0.05, oz = z + Math.sin(a) * 0.05;
    const s = new THREE.CylinderGeometry(0.008, 0.012, h, 3);
    s.translate(ox, h / 2, oz);
    parts.push(colored(s, stalkColor));
    if (stage >= 2) {
      const ear = ico(0.03, 0);
      ear.scale(0.8, 2.2, 0.8);
      ear.translate(ox, h + 0.04, oz);
      parts.push(colored(ear, stage === 3 ? 0xe8c46a : 0xb3c95a));
    }
  }
  return parts;
}

function pumpkin(stage: number, x: number, z: number, big: boolean): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  // つるの葉
  const leaves = stage === 0 ? 2 : 3;
  for (let i = 0; i < leaves; i++) {
    const g = leaf(0.1 + 0.03 * stage, 0.07 + 0.01 * stage, (i / leaves) * Math.PI * 2, 1.25, 0x4f9a3c);
    g.translate(x, 0.04, z);
    parts.push(g);
  }
  if (stage >= 2 && big) {
    const r = stage === 3 ? 0.17 : 0.09;
    const p = ico(r, 1);
    p.scale(1.15, 0.8, 1.15);
    p.translate(x + 0.05, r * 0.75, z + 0.05);
    parts.push(colored(p, stage === 3 ? 0xe07b2a : 0x8fb04a));
    const stem = new THREE.CylinderGeometry(0.012, 0.016, 0.05, 4);
    stem.translate(x + 0.05, r * 1.5, z + 0.05);
    parts.push(colored(stem, 0x6b5a2e));
  }
  return parts;
}

export function buildCropGeometry(kind: CropKind, stage: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (kind === 'pumpkin') {
    // かぼちゃは 1 マスに 1 株（大きく育つ）
    parts.push(...pumpkin(stage, 0, 0, true));
  } else {
    for (const [x, z] of SPOTS) parts.push(...(kind === 'turnip' ? turnip(stage, x, z) : wheat(stage, x, z)));
  }
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}

/** 苗木（植えたばかりの木）：細い幹と小さな葉 */
export function buildSaplingGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.03, 0.045, 0.45, 5);
  trunk.translate(0, 0.225, 0);
  const crown = ico(0.16, 0);
  crown.translate(0, 0.5, 0);
  const g = mergeGeometries([colored(trunk, 0x7a5532), colored(crown, 0x6fb442)], false)!;
  g.computeBoundingSphere();
  return g;
}
