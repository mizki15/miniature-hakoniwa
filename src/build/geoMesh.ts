/**
 * 建物の直方体から、フラットシェーディングのメッシュを作る（three.js に頼らない）。
 * 直方体 1 個につき 6 面 × 4 頂点・12 三角形。面ごとに頂点を分け、法線は面の向き。
 * 厚さ 0 の板では、面積のない側面を作らない
 */
import type { MeshData } from '../world/mesher';
import { hexToLinear } from '../world/blocks';
import { paletteHex } from './palette';
import type { BuildingDesign } from './geoParse';

type V = [number, number, number];

/** veg 属性の値：ガラス（夜に窓が光る。render/materials.ts） */
export const WINDOW_VEG = 4;

export function buildBuildingMesh(d: BuildingDesign): MeshData {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [], veg: number[] = [];
  for (const c of d.cubes) {
    const m = c.m;
    const apply = (p: V): V => [0, 1, 2].map((r) => m[r * 4] * p[0] + m[r * 4 + 1] * p[1] + m[r * 4 + 2] * p[2] + m[r * 4 + 3]) as V;
    // 行列が裏返し（行列式が負）なら、三角形の向きを逆にする
    const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
    const rgb = hexToLinear(paletteHex(c.color) ?? 0xff00ff);
    const kind = c.color === 'glass' ? WINDOW_VEG : 0;
    for (let a = 0; a < 3; a++) {
      const u = (a + 1) % 3, v = (a + 2) % 3;
      for (const s of [0, 1]) {
        // (u, v) の順に回ると、法線は +a 向き。s = 0（−a の面）と裏返しの時は逆に回る
        const quad: V[] = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([pu, pv]) => {
          const p: V = [0, 0, 0];
          p[a] = s; p[u] = pu; p[v] = pv;
          return apply(p);
        });
        if ((s === 0) !== (det < 0)) quad.reverse();
        const e1 = quad[1].map((x, i) => x - quad[0][i]), e2 = quad[2].map((x, i) => x - quad[0][i]);
        const n: V = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const len = Math.hypot(...n);
        if (len < 1e-12) continue;
        const base = pos.length / 3;
        for (const q of quad) { pos.push(...q); nor.push(n[0] / len, n[1] / len, n[2] / len); col.push(...rgb); veg.push(kind); }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
  }
  const n = pos.length / 3;
  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nor),
    color: new Float32Array(col),
    ao: new Float32Array(n).fill(1),
    veg: new Float32Array(veg),
    index: new Uint32Array(idx),
  };
}
