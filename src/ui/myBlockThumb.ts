import { patternMask, type FaceLook, type MyBlockLook } from '../world/myBlocks';

/**
 * マイブロックのプレビュー（v0.20.4）：立方体を斜め上から見た絵（上・左手前・右手前の 3 面）を 2D の canvas に描く。
 * 面ごとに 32 × 32 のます目に分け、模様（world/myBlocks.ts の patternMask。シェーダーと同じ式）で色を塗る
 */
const cache = new Map<string, string>();

const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${Math.round(((n >> 16) & 255) * k)},${Math.round(((n >> 8) & 255) * k)},${Math.round((n & 255) * k)})`;
};

export function myBlockThumb(look: MyBlockLook, size = 72): string {
  const key = JSON.stringify([look.top, look.side, look.bottom, size]);
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const s = size * 0.36, c30 = Math.cos(Math.PI / 6);
  const cx = size / 2, cy = size * 0.5 - s * 0.5;
  // 立方体の点 (x, y, z)（0〜1）→ 画面。x は右手前、z は左手前、y は上
  const P = (x: number, y: number, z: number): [number, number] => [cx + (x - z) * c30 * s, cy + (x + z) * 0.5 * s - y * s + s * 0.5];
  const G = 32;
  /** 面を塗る。at(u, v)：面の座標 → 立方体の点 */
  const face = (look: FaceLook, k: number, at: (u: number, v: number) => [number, number, number]) => {
    const base = shade(look.base, k), acc = shade(look.accent, k);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const u0 = i / G, v0 = j / G, u1 = (i + 1) / G, v1 = (j + 1) / G;
      const pts = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)].map((q) => P(...q));
      ctx.beginPath();
      ctx.moveTo(...pts[0]);
      for (const q of pts.slice(1)) ctx.lineTo(...q);
      ctx.closePath();
      const col = patternMask(look.pattern, (i + 0.5) / G, (j + 0.5) / G) ? acc : base;
      ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 0.5;
      ctx.fill(); ctx.stroke();
    }
  };
  // 上（u = x、v = z）・左手前（z = 1。u = x、v = 上へ）・右手前（x = 1。u = 奥から手前、v = 上へ）
  face(look.top, 1, (u, v) => [u, 1, v]);
  face(look.side, 0.82, (u, v) => [u, v, 1]);
  face(look.side, 0.66, (u, v) => [1, v, 1 - u]);
  const url = cv.toDataURL();
  cache.set(key, url);
  return url;
}
