/**
 * 建物の性格（設計メモ 2・8・9 章）：形と素材だけから計算する。名前・説明文・JSON のほかの値は使わない。
 *
 * 1/4 マスの格子にボクセル化してから数えるので、重なり・中に隠した部品・極小の部品・分け方の違いに左右されない。
 *   ・直方体が少しでも重なる格子は埋める（厚さ 1/16 の扉も消えない）
 *   ・2 方向以上が格子 1 つ（1/4 マス）より小さい部品は数えない
 *   ・同じ格子に 2 つの素材が重なったら、小さい（体積の小さい）直方体の素材。壁に貼った薄い窓や扉が、壁に埋もれないように。
 *     同じ大きさならパレットの順で先の素材（どの順に並べても同じ結果）
 *   ・地面（y = 0 の層）につながっていない部品は数えない
 *   ・外から空気を塗りつぶし、外気に接する面だけを「見える表面」として数える（底は地面なので数えない）
 * three.js に頼らない（Web Worker とテストから呼ぶ）。
 */
import type { BuildingDesign } from './geoParse';
import { NATURALNESS, PALETTE } from './palette';

export interface BuildingCharacter {
  /** 素材ごとの見える表面の広さ（マス²） */
  areas: Record<string, number>;
  totalArea: number;
  /** 地面に接している広さ（マス²。四捨五入、最小 1） */
  footprint: number;
  /** 高さ（マス） */
  height: number;
  /** ボクセル化した体積（マス³。発見ポイントのコストに使う予定） */
  volume: number;
  /** 自然 1（人の手）〜5（自然） */
  nature: number;
  /** 灯り 0（なし）〜5 */
  light: number;
  /** 大きさ 1〜5（効果の強さ） */
  size: number;
}

/** 格子の細かさ：1 マスを 4 つに */
export const CELLS_PER_BLOCK = 4;
const CELL = 1 / CELLS_PER_BLOCK;
const HALF = CELL / 2;
const EPS = 1e-6;
const MAT_INDEX = new Map(PALETTE.map((p, i) => [p.name, i + 1]));

/** 自然の星：見える表面で重み付けした、素材の自然度の平均（四捨五入）。表面がなければ ★3 */
export function natureStars(areas: Record<string, number>): number {
  let sum = 0, w = 0;
  for (const [m, a] of Object.entries(areas)) { const n = NATURALNESS[m]; if (n === undefined || a <= 0) continue; sum += n * a; w += a; }
  return w > 0 ? Math.min(5, Math.max(1, Math.round(sum / w))) : 3;
}
/** 灯りの星：見えるガラスの広さ（マス²）。なければ 0 */
export const LIGHT_STEPS = [1, 2, 4, 8];
export const lightStars = (glassArea: number) => (glassArea <= EPS ? 0 : 1 + LIGHT_STEPS.filter((t) => glassArea + EPS >= t).length);
/** 大きさの星：足元のマス数 */
export const SIZE_STEPS = [4, 9, 25, 49];
export const sizeStars = (footprint: number) => 1 + SIZE_STEPS.filter((t) => footprint > t).length;

export function buildingCharacter(d: BuildingDesign): BuildingCharacter {
  const { min, max } = d.bounds;
  // 格子の原点はマスの境目にそろえる。横と上に 1 つずつ空気の余白
  const ox = Math.floor(min[0] + EPS), oz = Math.floor(min[2] + EPS);
  const nx = Math.ceil((max[0] - ox) / CELL - EPS) + 2, nz = Math.ceil((max[2] - oz) / CELL - EPS) + 2, ny = Math.ceil(max[1] / CELL - EPS) + 1;
  const sx = 1, sy = nx, sz = nx * ny;
  const grid = new Uint8Array(nx * ny * nz);
  /** その格子を取った直方体の体積 */
  const owner = new Float32Array(nx * ny * nz);
  // 格子 (ix, iy, iz) の中心の座標
  const cx = (ix: number) => ox + (ix - 1 + 0.5) * CELL;
  const cy = (iy: number) => (iy + 0.5) * CELL;
  const cz = (iz: number) => oz + (iz - 1 + 0.5) * CELL;

  for (const cube of d.cubes) {
    const mat = MAT_INDEX.get(cube.color);
    if (!mat) continue;
    const m = cube.m;
    const t = [m[3], m[7], m[11]];
    const cols = [0, 1, 2].map((k) => [m[k], m[4 + k], m[8 + k]]);
    const len = cols.map((c) => Math.hypot(c[0], c[1], c[2]));
    if (len.filter((l) => l < CELL - EPS).length >= 2) continue; // 極小の部品
    if (len.some((l) => !Number.isFinite(l))) continue;
    // 直方体の向き（回転と大きさだけなので、3 つの向きは直交している）。厚さ 0 の板は残り 2 つの外積で向きを決める
    const dir: number[][] = cols.map((c, k) => (len[k] > EPS ? c.map((v) => v / len[k]) : []));
    for (let k = 0; k < 3; k++) {
      if (dir[k].length) continue;
      const a = dir[(k + 1) % 3], b = dir[(k + 2) % 3];
      dir[k] = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    }
    // 囲む箱（格子の番号）
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const ax of [0, 1]) for (const ay of [0, 1]) for (const az of [0, 1]) for (let r = 0; r < 3; r++) {
      const v = t[r] + cols[0][r] * ax + cols[1][r] * ay + cols[2][r] * az;
      lo[r] = Math.min(lo[r], v); hi[r] = Math.max(hi[r], v);
    }
    const x0 = Math.max(1, Math.floor((lo[0] - ox) / CELL) + 1), x1 = Math.min(nx - 2, Math.floor((hi[0] - ox) / CELL) + 1);
    const y0 = Math.max(0, Math.floor(lo[1] / CELL)), y1 = Math.min(ny - 2, Math.floor(hi[1] / CELL));
    const z0 = Math.max(1, Math.floor((lo[2] - oz) / CELL) + 1), z1 = Math.min(nz - 2, Math.floor((hi[2] - oz) / CELL) + 1);
    const [d0, d1, d2] = dir;
    const vol = len[0] * len[1] * len[2];
    // 1 行（y と z が同じ格子）の中では、3 つの条件はどれも x の 1 次式なので、入る x の範囲を直接求める
    const dirs = [d0, d1, d2];
    for (let iz = z0; iz <= z1; iz++) for (let iy = y0; iy <= y1; iy++) {
      const pz = cz(iz) - t[2], py = cy(iy) - t[1];
      let a = x0, b = x1;
      for (let k = 0; k < 3 && a <= b; k++) {
        const dk = dirs[k];
        // s = px * dk[0] + rest。px = cx(ix) - t[0] = ox + (ix - 0.5) * CELL - t[0]
        const rest = py * dk[1] + pz * dk[2];
        const loS = -HALF + EPS, hiS = len[k] + HALF - EPS;
        if (Math.abs(dk[0]) < 1e-12) { if (rest <= loS || rest >= hiS) b = a - 1; continue; }
        // s(ix) = (ox - t[0] - 0.5 * CELL) * dk[0] + ix * CELL * dk[0] + rest
        const base = (ox - t[0] - 0.5 * CELL) * dk[0] + rest, step = CELL * dk[0];
        let p = (loS - base) / step, q = (hiS - base) / step;
        if (p > q) [p, q] = [q, p];
        a = Math.max(a, Math.floor(p) + 1);
        b = Math.min(b, Math.ceil(q) - 1);
      }
      for (let ix = a; ix <= b; ix++) {
        const i = ix * sx + iy * sy + iz * sz;
        if (!grid[i] || vol < owner[i] - EPS || (Math.abs(vol - owner[i]) <= EPS && mat < grid[i])) { grid[i] = mat; owner[i] = vol; }
      }
    }
  }

  // 地面につながっている部品だけを残す
  const queue = new Int32Array(grid.length);
  const reach = new Uint8Array(grid.length);
  let qh = 0, qt = 0;
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const i = ix * sx + iz * sz;
    if (grid[i]) { reach[i] = 1; queue[qt++] = i; }
  }
  const neighbours = (i: number, f: (j: number) => void) => {
    const ix = i % nx, iy = Math.floor(i / nx) % ny, iz = Math.floor(i / sz);
    if (ix > 0) f(i - sx); if (ix < nx - 1) f(i + sx);
    if (iy > 0) f(i - sy); if (iy < ny - 1) f(i + sy);
    if (iz > 0) f(i - sz); if (iz < nz - 1) f(i + sz);
  };
  while (qh < qt) neighbours(queue[qh++], (j) => { if (grid[j] && !reach[j]) { reach[j] = 1; queue[qt++] = j; } });
  for (let i = 0; i < grid.length; i++) if (!reach[i]) grid[i] = 0;

  // 外の空気：横と上の余白から、空いている格子を塗りつぶす
  const air = new Uint8Array(grid.length);
  qh = qt = 0;
  for (let i = 0; i < grid.length; i++) {
    const ix = i % nx, iy = Math.floor(i / nx) % ny, iz = Math.floor(i / sz);
    if (!grid[i] && (ix === 0 || ix === nx - 1 || iz === 0 || iz === nz - 1 || iy === ny - 1)) { air[i] = 1; queue[qt++] = i; }
  }
  while (qh < qt) neighbours(queue[qh++], (j) => { if (!grid[j] && !air[j]) { air[j] = 1; queue[qt++] = j; } });

  // 見える面・足元・高さ・体積
  const faceArea = CELL * CELL;
  const areaByMat = new Float64Array(PALETTE.length + 1);
  let foot = 0, filled = 0, top = -1;
  for (let i = 0; i < grid.length; i++) {
    const mat = grid[i];
    if (!mat) continue;
    filled++;
    const ix = i % nx, iy = Math.floor(i / nx) % ny, iz = Math.floor(i / sz);
    top = Math.max(top, iy);
    if (iy === 0) foot++;
    let faces = 0;
    neighbours(i, (j) => { if (air[j]) faces++; });
    areaByMat[mat] += faces * faceArea;
  }
  const footArea = Math.max(1, Math.round(foot * CELL * CELL));
  const areas: Record<string, number> = {};
  let totalArea = 0;
  PALETTE.forEach((p, k) => { const a = areaByMat[k + 1]; if (a > 0) { areas[p.name] = a; totalArea += a; } });
  return {
    areas, totalArea,
    footprint: footArea,
    height: (top + 1) * CELL,
    volume: filled * CELL * CELL * CELL,
    nature: natureStars(areas),
    light: lightStars(areas.glass ?? 0),
    size: sizeStars(footArea),
  };
}
