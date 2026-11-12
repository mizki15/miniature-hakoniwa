import { CONIFER, LEAVES, LOG, PETAL_R, PETAL_W, PETAL_Y, STEM } from './blocks';
import { mulberry32 } from './noise';
import type { Grid } from './mesher';

/**
 * 木や花などの「小物」を、地面より細かいボクセル（1/s の大きさ）で作る。
 * 形は地面のボクセル単位の連続的な形として定義し、細かさ s で標本化する。
 * → 細かさを変えても同じ形・同じ大きさになる。
 */

const hash3 = (x: number, y: number, z: number, seed: number) => {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144665) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** 3D の値ノイズ（0..1） */
function valueNoise3(x: number, y: number, z: number, seed: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(ix + dx, iy + dy, iz + dz, seed);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), sx), l(c(0, 1, 0), c(1, 1, 0), sx), sy),
    l(l(c(0, 0, 1), c(1, 0, 1), sx), l(c(0, 1, 1), c(1, 1, 1), sx), sy),
    sz,
  );
}

export interface DetailModel {
  grid: Grid;
  /** 格子の原点を地面の単位に直すためのずれ（細かいボクセル単位） */
  offset: [number, number, number];
}

function makeGrid(sx: number, sy: number, sz: number): Grid {
  return { sx, sy, sz, data: new Uint8Array(sx * sy * sz) };
}

/** 連続的な形（地面の単位）を細かさ s で標本化する */
function sample(width: number, height: number, s: number, shape: (x: number, y: number, z: number) => number): DetailModel {
  const W = Math.ceil(width * s) | 1; // 奇数にして中心をそろえる
  const Hh = Math.ceil(height * s) + 1;
  const g = makeGrid(W, Hh, W);
  for (let y = 0; y < Hh; y++) for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) {
    const t = shape((x + 0.5 - W / 2) / s, (y + 0.5) / s, (z + 0.5 - W / 2) / s);
    if (t) g.data[x + z * W + y * W * W] = t;
  }
  return { grid: g, offset: [-W / 2, 0, -W / 2] };
}

/** 広葉樹 */
function broadleaf(variant: number, s: number): DetailModel {
  const rand = mulberry32(1000 + variant * 31);
  const th = 2.6 + rand() * 1.4; // 幹の高さ
  const R = 1.9 + rand() * 0.6; // 樹冠の半径
  const blobs: [number, number, number, number][] = [[0, th + R * 0.55, 0, R]];
  for (let k = 0; k < 3; k++) {
    const a = rand() * Math.PI * 2;
    blobs.push([Math.cos(a) * R * 0.6, th + R * (0.15 + rand() * 0.4), Math.sin(a) * R * 0.6, R * (0.55 + rand() * 0.15)]);
  }
  const holes = s === 1 ? 0.08 : 0;
  return sample(R * 3.2 + 1, th + R * 2.2, s, (x, y, z) => {
    // 幹（上に行くほど細く）
    const tr = 0.34 * (1 - 0.35 * Math.min(1, y / (th + R)));
    if (y < th + R * 0.6 && x * x + z * z <= tr * tr) return LOG;
    // 枝（細かいボクセルの時だけ）
    if (s > 1) {
      for (let k = 1; k < blobs.length; k++) {
        const [bx, by, bz] = blobs[k];
        const y0 = th * 0.75;
        const t = Math.max(0, Math.min(1, ((x * bx) + (y - y0) * (by - y0) + (z * bz)) / (bx * bx + (by - y0) ** 2 + bz * bz)));
        const dx = x - bx * t, dy = y - (y0 + (by - y0) * t), dz = z - bz * t;
        if (t > 0.05 && t < 0.7 && dx * dx + dy * dy + dz * dz < 0.13 * 0.13) return LOG;
      }
    }
    // 樹冠：いくつかの球を重ね、表面をノイズで揺らす
    const n = valueNoise3(x * 1.4, y * 1.4, z * 1.4, variant) - 0.5;
    for (const [bx, by, bz, br] of blobs) {
      const dx = x - bx, dy = (y - by) * 1.15, dz = z - bz;
      const r = br * (1 + n * 0.35);
      if (dx * dx + dy * dy + dz * dz < r * r) {
        if (holes && hash3(Math.floor(x * s), Math.floor(y * s), Math.floor(z * s), variant) < holes) return 0;
        return LEAVES;
      }
    }
    return 0;
  });
}

/** 針葉樹：段々になった円すい */
function conifer(variant: number, s: number): DetailModel {
  const rand = mulberry32(2000 + variant * 17);
  const trunk = 1.2 + rand() * 0.4;
  const hgt = 5.5 + rand() * 2;
  const R = 1.7 + rand() * 0.4;
  const tiers = 4;
  return sample(R * 2 + 1, trunk + hgt + 0.5, s, (x, y, z) => {
    const r2 = x * x + z * z;
    if (y < trunk + hgt * 0.6 && r2 <= 0.3 * 0.3) return LOG;
    const t = (y - trunk) / hgt; // 0..1
    if (t < 0 || t > 1) return 0;
    const tierT = (t * tiers) % 1; // 各段の中での位置
    const r = R * (1 - t) * (0.55 + 0.45 * (1 - tierT)) + 0.15;
    const n = valueNoise3(x * 1.6, y * 1.6, z * 1.6, 50 + variant) - 0.5;
    return r2 < (r * (1 + n * 0.25)) ** 2 ? CONIFER : 0;
  });
}

/** 花：細かいボクセルでのみ作る（1/1 では作らない） */
function flower(variant: number, s: number): DetailModel | null {
  if (s < 3) return null;
  const petal = [PETAL_R, PETAL_Y, PETAL_W][variant % 3];
  const W = 3;
  const stem = s >= 4 ? 2 : 1;
  const g = makeGrid(W, stem + 2, W);
  const set = (x: number, y: number, z: number, t: number) => { g.data[x + z * W + y * W * W] = t; };
  for (let y = 0; y < stem; y++) set(1, y, 1, STEM);
  set(1, stem, 1, PETAL_Y === petal ? PETAL_R : PETAL_Y); // 花の中心
  if (s >= 4) {
    set(0, stem, 1, petal); set(2, stem, 1, petal); set(1, stem, 0, petal); set(1, stem, 2, petal);
  } else {
    set(1, stem + 1, 1, petal);
  }
  return { grid: g, offset: [-W / 2, 0, -W / 2] };
}

export function buildTreeModel(variant: number, s: number): DetailModel {
  return variant >= 4 ? conifer(variant, s) : broadleaf(variant, s);
}

export function buildFlowerModel(variant: number, s: number): DetailModel | null {
  return flower(variant, s);
}
