import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * ローポリの花（動物と同じフラットシェーディングの作り）。
 * 小物用マテリアル（頂点カラー・ao・veg 属性を使う）でインスタンス描画する。
 */

const lin = (hex: number) => new THREE.Color(hex); // Color(hex) は sRGB → リニアに変換される

function colored(geo: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const c = lin(color);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('ao', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  g.setAttribute('veg', new THREE.BufferAttribute(new Float32Array(n), 1));
  g.computeVertexNormals(); // インデックスなし → 面ごとの法線（フラット）
  return g;
}

const PETALS = [0xe0504a, 0xf2c94c, 0xf6f2ea];
const CENTERS = [0xf2c94c, 0xc8742c, 0xf2c94c];

export function buildLowPolyFlower(variant: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const stemH = 0.42;
  const stem = new THREE.CylinderGeometry(0.018, 0.026, stemH, 4, 1);
  stem.translate(0, stemH / 2, 0);
  parts.push(colored(stem, 0x4f8a34));

  // 葉
  const leaf = new THREE.IcosahedronGeometry(0.06, 0);
  leaf.scale(1.6, 0.35, 0.8);
  leaf.rotateZ(0.5);
  leaf.translate(0.06, 0.14, 0);
  parts.push(colored(leaf, 0x5b9a3c));

  // 花びら（放射状に 5 枚）
  const count = 5;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const p = new THREE.IcosahedronGeometry(0.055, 0);
    p.scale(1.5, 0.4, 0.9);
    p.rotateY(-a);
    p.translate(Math.cos(a) * 0.075, stemH + 0.01, Math.sin(a) * 0.075);
    parts.push(colored(p, PETALS[variant % PETALS.length]));
  }
  const center = new THREE.IcosahedronGeometry(0.04, 0);
  center.scale(1, 0.7, 1);
  center.translate(0, stemH + 0.03, 0);
  parts.push(colored(center, CENTERS[variant % CENTERS.length]));

  const merged = mergeGeometries(parts, false)!;
  merged.scale(1.8, 1.8, 1.8); // 見下ろしでも見つけやすい大きさに
  merged.computeBoundingSphere();
  return merged;
}
