import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { colored } from '../creatures/flowers';
import type { MatAmounts } from './materials';

/**
 * 道のタイル（v0.20.3）：地面の上に 1/8 ブロックだけ盛り上がった板。道だと一目で分かるように。
 * 地形のボクセルではなく、列ごとの印（WorldData.paths）と、種類ごとの形（InstancedMesh）で持つ。
 *   - タイルの下の地面は土にする（草が生えない）
 *   - タイルと同じ空間（地面のすぐ上）にブロックを置くと、タイルは消える（素材は戻る）。掘る・ならす・耕す・苗木を植えるでも消える
 *   - 住人は道を好んで歩く。野生度では「人の手」に数える
 */
export type PathKind = 'dirt' | 'gravel' | 'cobble' | 'plank' | 'brick';
export const TILE_H = 1 / 8;

export interface PathDef { id: PathKind; name: string; cost: MatAmounts | null; help: string }
export const PATHS: PathDef[] = [
  { id: 'dirt', name: '土の道', cost: null, help: '踏み固めた土の道。素材は要らない' },
  { id: 'gravel', name: '砂利道', cost: { stone: 1 }, help: '小石を敷いた道（石材 1）' },
  { id: 'cobble', name: '石畳', cost: { stone: 2 }, help: '平たい石を並べた道（石材 2）' },
  { id: 'plank', name: '板の道', cost: { wood: 2 }, help: '板を渡した道。水辺や森に合う（木材 2）' },
  { id: 'brick', name: 'れんが道', cost: { soil: 2 }, help: 'れんがを敷き詰めた道（土 2）' },
];
export const PATH_DEF = Object.fromEntries(PATHS.map((p) => [p.id, p])) as Record<PathKind, PathDef>;
/** WorldData.paths に入れる番号（0 は道なし） */
export const pathIndex = (k: PathKind) => PATHS.findIndex((p) => p.id === k) + 1;
export const pathOfIndex = (i: number): PathKind | null => PATHS[i - 1]?.id ?? null;

/** 下の面の真ん中を (x, y, z) に置く箱 */
function slab(w: number, h: number, d: number, x: number, y: number, z: number, color: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return colored(g, color);
}
const hash = (n: number) => { let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

/** タイル 1 枚の形（1 × 1/8 × 1。真ん中が原点、下の面が y = 0） */
export function buildPathTile(kind: PathKind): THREE.BufferGeometry {
  const H = TILE_H;
  const parts: THREE.BufferGeometry[] = [];
  switch (kind) {
    case 'dirt':
      parts.push(slab(1, H * 0.7, 1, 0, 0, 0, 0xc4a574), slab(0.86, H * 0.3, 0.86, 0, H * 0.7, 0, 0xcfb084));
      break;
    case 'gravel': {
      parts.push(slab(1, H * 0.6, 1, 0, 0, 0, 0xa49a88));
      for (let i = 0; i < 14; i++) {
        const x = (hash(i * 3 + 1) - 0.5) * 0.86, z = (hash(i * 3 + 2) - 0.5) * 0.86, r = 0.05 + hash(i * 3) * 0.05;
        const g = new THREE.IcosahedronGeometry(r, 0);
        g.scale(1, 0.55, 1);
        g.translate(x, H * 0.6, z);
        parts.push(colored(g, [0xb8b2a6, 0x8f8a80, 0xcac4b8][i % 3]));
      }
      break;
    }
    case 'cobble':
      parts.push(slab(1, H * 0.5, 1, 0, 0, 0, 0x6f6a62));
      // 2 × 2 の平たい石（すき間に目地）
      for (const [x, z, c] of [[-0.25, -0.25, 0xa9a79c], [0.25, -0.25, 0x9c9a90], [-0.25, 0.25, 0x9a988e], [0.25, 0.25, 0xb0aea4]] as const) parts.push(slab(0.46, H * 0.5, 0.46, x, H * 0.5, z, c));
      break;
    case 'plank':
      parts.push(slab(1, H * 0.35, 1, 0, 0, 0, 0x5a4028));
      for (let i = 0; i < 4; i++) parts.push(slab(1, H * 0.65, 0.23, 0, H * 0.35, -0.375 + i * 0.25, i % 2 ? 0xb08454 : 0xa07848));
      break;
    case 'brick':
      parts.push(slab(1, H * 0.5, 1, 0, 0, 0, 0xd8cfbf));
      // れんがを互い違いに（行ごとに半分ずらし、端ははみ出さないよう切る）
      for (let r = 0; r < 4; r++) for (let c = -1; c < 4; c++) {
        const a = Math.max(-0.49, -0.5 + c * 0.33 + (r % 2 ? 0.165 : 0) + 0.01), b = Math.min(0.49, -0.5 + c * 0.33 + (r % 2 ? 0.165 : 0) + 0.32);
        if (b - a < 0.04) continue;
        parts.push(slab(b - a, H * 0.5, 0.23, (a + b) / 2, H * 0.5, -0.375 + r * 0.25, [0xb05a40, 0xa04e38, 0xb86448][(r + c + 3) % 3]));
      }
      break;
  }
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}
