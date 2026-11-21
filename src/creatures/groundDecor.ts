import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DIRT, GRASS, SAND, STONE, WATER } from '../world/blocks';
import { mulberry32 } from '../world/noise';
import { colored } from './flowers';

/**
 * 地面の小物：ローポリの小石と草。花と同じく、下のブロック（列の一番上）に付いた見た目だけの物で、
 * 建物・道具・住人の判定には関わらない。置き場所は列ごとのハッシュで決める（いつも同じ所に出る）。
 */

export const PEBBLE_VARIANTS = 3;
export const GRASS_VARIANTS = 3;

const PEBBLE_COLORS = [0x8f969e, 0xa7a49a, 0x7b8188, 0x9a8f80, 0xb3b0a6];

/** 小石：variant + 1 個の石の集まり */
export function buildPebble(variant: number): THREE.BufferGeometry {
  const rand = mulberry32(500 + variant * 17);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i <= variant; i++) {
    const r = 0.06 + rand() * 0.05;
    const g = new THREE.IcosahedronGeometry(r, 0);
    g.scale(1 + rand() * 0.3, 0.5 + rand() * 0.2, 0.8 + rand() * 0.3);
    g.rotateY(rand() * Math.PI);
    const a = rand() * Math.PI * 2, d = i === 0 ? 0 : 0.08 + rand() * 0.08;
    g.translate(Math.cos(a) * d, r * 0.25, Math.sin(a) * d); // 少し埋まっている
    parts.push(colored(g, PEBBLE_COLORS[Math.floor(rand() * PEBBLE_COLORS.length)]));
  }
  const m = mergeGeometries(parts, false)!;
  m.computeBoundingSphere();
  return m;
}

/** 草の房：細い三角錐の葉を束ねる。色は季節の草の色を掛ける（veg = 1） */
export function buildGrassTuft(variant: number): THREE.BufferGeometry {
  const rand = mulberry32(700 + variant * 23);
  const parts: THREE.BufferGeometry[] = [];
  const blades = 4 + variant * 2;
  for (let i = 0; i < blades; i++) {
    const h = 0.16 + rand() * 0.16;
    const g = new THREE.ConeGeometry(0.022 + rand() * 0.01, h, 3, 1);
    g.translate(0, h / 2, 0);
    g.rotateZ((rand() - 0.5) * 0.7);
    g.rotateX((rand() - 0.5) * 0.7);
    const a = rand() * Math.PI * 2, d = rand() * 0.08;
    g.translate(Math.cos(a) * d, 0, Math.sin(a) * d);
    // 明るさだけ変える（色はシェーダーで季節の草の色を掛ける）。細い葉は暗く見えやすいので明るめに
    const shade = Math.round((0.86 + rand() * 0.14) * 255);
    parts.push(colored(g, (shade << 16) | (shade << 8) | shade));
  }
  const m = mergeGeometries(parts, false)!;
  m.getAttribute('veg').array.fill(1);
  m.computeBoundingSphere();
  return m;
}

/** 列のハッシュ → 0..1 */
function colHash(col: number, salt: number) {
  let h = Math.imul(col ^ 0x5bd1e995, 0x27d4eb2d) ^ Math.imul(salt, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 一番上のブロックごとの出やすさ（密度 1 の時、1 列あたり） */
const CHANCE: Record<number, { grass: number; pebble: number }> = {
  [GRASS]: { grass: 0.14, pebble: 0.015 },
  [DIRT]: { grass: 0.04, pebble: 0.05 },
  [STONE]: { grass: 0, pebble: 0.1 },
  [SAND]: { grass: 0, pebble: 0.04 },
};

export interface GroundPlacements {
  /** 種類ごとの [x, y, z, rot, scale]（枠のボクセル座標） */
  pebbles: number[][];
  grass: number[][];
}

/**
 * 小石と草の置き場所を決める。
 * skip(col)：置かない列（木・建物・作物・花のある列、開いていない区画など）
 */
export function placeGround(
  voxels: Uint8Array, heights: Int16Array, size: number, height: number, density: number,
  skip: (col: number) => boolean,
): GroundPlacements {
  const out: GroundPlacements = { pebbles: Array.from({ length: PEBBLE_VARIANTS }, () => []), grass: Array.from({ length: GRASS_VARIANTS }, () => []) };
  if (density <= 0) return out;
  const NN = size * size;
  for (let col = 0; col < NN; col++) {
    const h = heights[col];
    if (h <= 0 || h >= height) continue;
    const top = voxels[col + (h - 1) * NN];
    const c = CHANCE[top];
    if (!c || voxels[col + h * NN] === WATER) continue;
    const r = colHash(col, 1);
    const pg = Math.min(0.9, c.grass * density), pp = Math.min(0.9 - pg, c.pebble * density);
    const kind = r < pg ? 'grass' : r < pg + pp ? 'pebble' : null;
    if (!kind || skip(col)) continue;
    const x = (col % size) + 0.5 + (colHash(col, 2) - 0.5) * 0.6;
    const z = Math.floor(col / size) + 0.5 + (colHash(col, 3) - 0.5) * 0.6;
    const rot = colHash(col, 4) * Math.PI * 2;
    const s = 0.8 + colHash(col, 5) * 0.45;
    const v = Math.floor(colHash(col, 6) * 3);
    (kind === 'grass' ? out.grass : out.pebbles)[v].push(x, h, z, rot, s);
  }
  return out;
}
