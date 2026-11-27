import * as THREE from 'three/webgpu';
import { faceColor } from '../world/blocks';

/**
 * 小さなプレビューの絵（v0.20.1。画面下の選択バーのアイコン）：ローポリの形（頂点色つき）を 2D の canvas に描く。
 * WebGPU の描画とは別に、三角形を奥から順に塗るだけ（数百〜数千の三角形なので一瞬）。結果は data URL で覚えておく
 */
const cache = new Map<string, string>();

export interface ThumbOpts {
  /** 絵の大きさ（px） */
  size?: number;
  /** 横から回す角度・見下ろす角度（ラジアン） */
  yaw?: number; pitch?: number;
}

export function thumbOf(key: string, geo: () => THREE.BufferGeometry, o: ThumbOpts = {}): string {
  const hit = cache.get(key);
  if (hit) return hit;
  const url = renderThumb(geo(), o);
  cache.set(key, url);
  return url;
}

/** 線形の色（0〜1）を sRGB に */
const toSrgb = (v: number) => Math.round(255 * Math.min(1, v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));

export function renderThumb(g: THREE.BufferGeometry, { size = 72, yaw = 0.62, pitch = 0.42 }: ThumbOpts = {}): string {
  const pos = g.getAttribute('position'), col = g.getAttribute('color');
  const idx = g.getIndex();
  const n = idx ? idx.count : pos.count;
  const vi = (k: number) => (idx ? idx.getX(k) : k);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), spp = Math.sin(pitch);
  const L = [0.35, 0.8, 0.48];
  const ln = Math.hypot(...L);
  const tris: { z: number; pts: number[]; fill: string }[] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let k = 0; k + 2 < n; k += 3) {
    const v = [0, 1, 2].map((j) => { const i = vi(k + j); return [pos.getX(i), pos.getY(i), pos.getZ(i)]; });
    const a = v[1].map((x, j) => x - v[0][j]), b = v[2].map((x, j) => x - v[0][j]);
    const nn = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const nl = Math.hypot(...nn) || 1;
    const lit = 0.55 + 0.45 * Math.max(0, (nn[0] * L[0] + nn[1] * L[1] + nn[2] * L[2]) / nl / ln);
    const i0 = vi(k);
    const c = col ? [col.getX(i0), col.getY(i0), col.getZ(i0)] : [0.5, 0.5, 0.5];
    const pts: number[] = [];
    let zs = 0;
    for (const [x, y, z] of v) {
      // y 軸まわりに yaw、x 軸まわりに pitch 回す（正射影）
      const x2 = x * cy - z * sy, z2 = x * sy + z * cy;
      const y2 = y * cp - z2 * spp, z3 = y * spp + z2 * cp;
      pts.push(x2, -y2);
      zs += z3;
      minX = Math.min(minX, x2); maxX = Math.max(maxX, x2); minY = Math.min(minY, -y2); maxY = Math.max(maxY, -y2);
    }
    tris.push({ z: zs / 3, pts, fill: `rgb(${toSrgb(c[0] * lit)},${toSrgb(c[1] * lit)},${toSrgb(c[2] * lit)})` });
  }
  tris.sort((p, q) => q.z - p.z);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const span = Math.max(maxX - minX, maxY - minY, 1e-3);
  const k = (size * 0.86) / span;
  const ox = size / 2 - ((minX + maxX) / 2) * k, oy = size / 2 - ((minY + maxY) / 2) * k;
  for (const t of tris) {
    ctx.beginPath();
    ctx.moveTo(ox + t.pts[0] * k, oy + t.pts[1] * k);
    ctx.lineTo(ox + t.pts[2] * k, oy + t.pts[3] * k);
    ctx.lineTo(ox + t.pts[4] * k, oy + t.pts[5] * k);
    ctx.closePath();
    ctx.fillStyle = t.fill;
    ctx.strokeStyle = t.fill; // すき間が見えないよう、同じ色で縁も
    ctx.lineWidth = 0.6;
    ctx.fill();
    ctx.stroke();
  }
  return cv.toDataURL();
}

/** ブロック 1 つのプレビュー用の形：箱の面ごとに、上・下・側の色（world/blocks.ts） */
export function blockPreviewGeometry(block: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  // BoxGeometry の面の順：+x, -x, +y, -y, +z, -z（1 面 6 頂点）
  const kinds = [2, 2, 0, 1, 2, 2] as const;
  for (let i = 0; i < n; i++) col.set(faceColor(block, kinds[Math.floor(i / 6)]), i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** 絵文字のアイコン（形の無い道具に） */
export function emojiIcon(emoji: string, size = 72): string {
  const key = `emoji:${emoji}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  ctx.font = `${Math.round(size * 0.66)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, size / 2, size / 2 + size * 0.04);
  const url = cv.toDataURL();
  cache.set(key, url);
  return url;
}
