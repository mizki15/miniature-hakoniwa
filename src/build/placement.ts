/**
 * 建物を置く場所の計算（three.js に頼らない）。
 * 置いた建物の原点は、選んだ列の中心 (x + 0.5, z + 0.5)、高さはその列の地面。
 * 向き rot は 90° 刻み。three.js の rotation.y = rot·π/2 と同じ回り方（x' = z, z' = −x が 1 回分）
 */
import type { BuildingDesign } from './geoParse';
import { isOpenCol } from '../world/plots';

export type Rot = 0 | 1 | 2 | 3;
type V = [number, number, number];

/** 回転した外形（ボクセル単位、建物の原点から） */
export function rotatedBounds(d: BuildingDesign, rot: Rot): { min: V; max: V } {
  const { min, max } = d.bounds;
  const xs: number[] = [], zs: number[] = [];
  for (const x of [min[0], max[0]]) for (const z of [min[2], max[2]]) {
    let px = x, pz = z;
    for (let i = 0; i < rot; i++) [px, pz] = [pz, -px];
    xs.push(px); zs.push(pz);
  }
  return { min: [Math.min(...xs), min[1], Math.min(...zs)], max: [Math.max(...xs), max[1], Math.max(...zs)] };
}

const EPS = 1e-6;

/** 外形に一部でもかかる列（col = x + z·size）。枠の外の列も、そのままの番号の代わりに −1 を入れて返す */
function footprint(d: BuildingDesign, rot: Rot, x: number, z: number, size: number): number[] {
  const b = rotatedBounds(d, rot);
  const x0 = Math.floor(x + 0.5 + b.min[0] + EPS), x1 = Math.ceil(x + 0.5 + b.max[0] - EPS) - 1;
  const z0 = Math.floor(z + 0.5 + b.min[2] + EPS), z1 = Math.ceil(z + 0.5 + b.max[2] - EPS) - 1;
  const out: number[] = [];
  for (let cz = z0; cz <= Math.max(z0, z1); cz++) for (let cx = x0; cx <= Math.max(x0, x1); cx++) {
    out.push(cx < 0 || cz < 0 || cx >= size || cz >= size ? -1 : cx + cz * size);
  }
  return out;
}

/** 建物の足元の列（枠の中のものだけ） */
export function footprintCols(d: BuildingDesign, rot: Rot, x: number, z: number, size: number): number[] {
  return footprint(d, rot, x, z, size).filter((c) => c >= 0);
}

/**
 * 足元の地面の様子。height：列の地面の高さ。blocked：その列に置けない理由（木・作物・水など）、なければ null
 */
export interface Ground { height: (col: number) => number; blocked: (col: number) => string | null }

/** 足元の高さの差がこれより大きければ、坂や段差とみなして置かない */
const MAX_STEP = 1;

/**
 * そこに置けるか。足元がすべて枠の中の、開いた区画にあること。
 * ground を渡すと、足元の高さがそろっているか（差 1 まで）と、木・作物・水などがないかも見る
 */
export function canPlace(d: BuildingDesign, rot: Rot, x: number, z: number, size: number, plots: number, ground?: Ground): { ok: true } | { ok: false; msg: string } {
  const cols = footprint(d, rot, x, z, size);
  if (cols.some((c) => c < 0)) return { ok: false, msg: '箱庭の外にはみ出します' };
  if (cols.some((c) => !isOpenCol(plots, c % size, Math.floor(c / size)))) return { ok: false, msg: '開いていない土地にかかっています' };
  if (ground) {
    let lo = Infinity, hi = -Infinity;
    for (const c of cols) { const h = ground.height(c); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if (hi - lo > MAX_STEP) return { ok: false, msg: '地面の高さがそろっていません（坂や段差の上には置けません）' };
    // 建物の底は原点の列の地面に置く。それより高い列が足元にあると、建物が地面にめり込む
    if (hi > ground.height(x + z * size)) return { ok: false, msg: '地面にめり込みます（足元に高い所があります）' };
    for (const c of cols) { const why = ground.blocked(c); if (why) return { ok: false, msg: why }; }
  }
  return { ok: true };
}

/**
 * 光線が当たる、置いた建物の番号（一番手前）。当たらなければ −1。
 * 当たりは回転した外形の箱で見る。half は箱庭の中心のずれ（world.size / 2）
 */
export function rayHitPlaced(placed: { design: BuildingDesign; x: number; z: number; y: number; rot: Rot }[], origin: V, dir: V, half: number): number {
  return rayHitPlacedT(placed, origin, dir, half).index;
}

/** rayHitPlaced と同じ。当たった所までの光線の長さ t も返す（当たらなければ index −1、t は Infinity） */
export function rayHitPlacedT(placed: { design: BuildingDesign; x: number; z: number; y: number; rot: Rot }[], origin: V, dir: V, half: number): { index: number; t: number } {
  let best = -1, bestT = Infinity;
  placed.forEach((p, i) => {
    const b = rotatedBounds(p.design, p.rot);
    const o: V = [p.x + 0.5 - half, p.y, p.z + 0.5 - half];
    let t0 = 0, t1 = Infinity;
    for (let a = 0; a < 3; a++) {
      const lo = o[a] + b.min[a], hi = o[a] + b.max[a];
      if (Math.abs(dir[a]) < 1e-12) {
        if (origin[a] < lo || origin[a] > hi) return;
        continue;
      }
      let ta = (lo - origin[a]) / dir[a], tb = (hi - origin[a]) / dir[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return;
    }
    if (t0 < bestT) { bestT = t0; best = i; }
  });
  return { index: best, t: bestT };
}
