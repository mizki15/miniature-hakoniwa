import * as THREE from 'three/webgpu';
import { WATER, isOpaque } from '../world/blocks';

export interface VoxelHit {
  x: number; y: number; z: number; // 当たったボクセル（世界のボクセル座標）
  nx: number; ny: number; nz: number; // 当たった面の向き
  t: number; // 光線に沿った距離
}

/**
 * ボクセルへのレイキャスト（DDA：格子を 1 マスずつたどる）。
 * 箱庭の中心が原点なので、ボクセル座標には size/2 を足して変換する。
 */
export function raycastVoxels(
  voxels: Uint8Array, N: number, H: number,
  origin: THREE.Vector3, dir: THREE.Vector3,
  hitWater = false,
): VoxelHit | null {
  const half = N / 2;
  const oa = [origin.x + half, origin.y, origin.z + half];
  const da = [dir.x, dir.y, dir.z];
  const lo = [0, 0, 0], hi = [N, H, N];
  // 箱との交差区間
  let t0 = 0, t1 = 1e9;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(da[a]) < 1e-9) { if (oa[a] < lo[a] || oa[a] > hi[a]) return null; continue; }
    let ta = (lo[a] - oa[a]) / da[a], tb = (hi[a] - oa[a]) / da[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
  }
  if (t0 > t1) return null;
  const p = oa.map((v, a) => v + da[a] * (t0 + 1e-4));
  const cell = p.map((v, a) => Math.min(hi[a] - 1, Math.max(0, Math.floor(v))));
  const step = da.map((v) => (v > 0 ? 1 : -1));
  const tMax = da.map((v, a) => (Math.abs(v) < 1e-9 ? 1e9 : t0 + ((v > 0 ? cell[a] + 1 : cell[a]) - p[a]) / v));
  const tDelta = da.map((v) => (Math.abs(v) < 1e-9 ? 1e9 : Math.abs(1 / v)));
  // 最初のセルに入った面（箱の外から入った場合）
  let lastAxis = -1;
  let t = t0;
  for (let i = 0; i < N * 4 + H; i++) {
    const v = voxels[cell[0] + cell[2] * N + cell[1] * N * N];
    if (isOpaque(v) || (hitWater && v === WATER)) {
      const n = [0, 0, 0];
      if (lastAxis >= 0) n[lastAxis] = -step[lastAxis];
      else n[1] = 1;
      return { x: cell[0], y: cell[1], z: cell[2], nx: n[0], ny: n[1], nz: n[2], t };
    }
    const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
    t = tMax[a];
    cell[a] += step[a];
    lastAxis = a;
    if (cell[a] < 0 || cell[a] >= hi[a]) return null;
    tMax[a] += tDelta[a];
  }
  return null;
}
