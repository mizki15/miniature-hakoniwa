import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FRAME, PLOT, PLOTS_PER_SIDE, isOpen, plotRect } from '../world/plots';

/** 台座の縁：隣の区画が開いていない側だけ、地形より少しはみ出させる */
const RIM = 1.5;
const THICK = 2.4;

const baseMat = new THREE.MeshStandardMaterial({ color: 0x5a3e2b, roughness: 0.7 });

/**
 * ジオラマの木の台座。開いた区画ごとに板を置く（形がいびつになっても箱庭らしく見えるように）。
 * 描画命令を減らすため、板は 1 つのメッシュにまとめる。座標は箱庭の中心（枠の中央）が原点。
 */
export function buildBase(mask: number): THREE.Group {
  const g = new THREE.Group();
  const half = FRAME / 2;
  const boxes: THREE.BufferGeometry[] = [];
  for (let p = 0; p < 16; p++) {
    if (!isOpen(mask, p)) continue;
    const px = p % PLOTS_PER_SIDE, pz = Math.floor(p / PLOTS_PER_SIDE);
    const open = (dx: number, dz: number) => {
      const qx = px + dx, qz = pz + dz;
      return qx >= 0 && qz >= 0 && qx < PLOTS_PER_SIDE && qz < PLOTS_PER_SIDE && isOpen(mask, qx + qz * PLOTS_PER_SIDE);
    };
    const l = open(-1, 0) ? 0 : RIM, r = open(1, 0) ? 0 : RIM, t = open(0, -1) ? 0 : RIM, b = open(0, 1) ? 0 : RIM;
    const rect = plotRect(p);
    const box = new THREE.BoxGeometry(PLOT + l + r, THICK, PLOT + t + b);
    box.translate(rect.x0 - l + (PLOT + l + r) / 2 - half, -THICK / 2, rect.z0 - t + (PLOT + t + b) / 2 - half);
    boxes.push(box);
  }
  if (boxes.length) {
    const m = new THREE.Mesh(mergeGeometries(boxes), baseMat);
    m.receiveShadow = true;
    g.add(m);
    boxes.forEach((b) => b.dispose());
  }
  return g;
}

/** 台座を捨てる（ジオメトリだけ。マテリアルは使い回す） */
export function disposeBase(g: THREE.Group) {
  for (const o of g.children) (o as THREE.Mesh).geometry.dispose();
  g.removeFromParent();
}
