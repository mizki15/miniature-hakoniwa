import type { BuildingCube, BuildingDesign } from './geoParse';
import { seasonOfKey } from '../eco/goals';

/**
 * 季節の記念の飾り（v0.17。設計メモ 11 章）：季節の目標の「難しい」を達成すると、棚に入る。
 * 飾り（住まいにならない）で、置くのに素材も発見ポイントも要らない。形は季節ごと（春 花の鉢・夏 ひまわり・秋 かかし・冬 雪だるま）
 */
type Box = [x: number, y: number, z: number, w: number, h: number, d: number, color: string];
/** 真ん中（x・z）と下の面（y）で置く箱 */
const box = ([x, y, z, w, h, d, color]: Box): BuildingCube => ({ m: [w, 0, 0, x - w / 2, 0, h, 0, y, 0, 0, d, z - d / 2], color });

/** fit：足元の幅（列）。真ん中の列から、外形がこの幅に収まるよう全体を縮める */
const SHAPES: { name: string; fit: number; boxes: Box[] }[] = [
  { name: '花の鉢', fit: 1, boxes: [
    [0, 0, 0, 1.6, 0.9, 1.6, 'brick'], [0, 0.9, 0, 1.8, 0.2, 1.8, 'brick'],
    [0, 1.1, 0, 1.3, 0.6, 1.3, 'leaf'], [0, 1.7, 0, 0.7, 0.4, 0.7, 'leaf'],
    [-0.4, 1.7, 0.3, 0.35, 0.35, 0.35, 'flower'], [0.35, 1.8, -0.2, 0.35, 0.35, 0.35, 'flower'], [0, 2.1, 0, 0.35, 0.35, 0.35, 'white'], [0.3, 1.6, 0.45, 0.3, 0.3, 0.3, 'roof'],
  ] },
  { name: 'ひまわり', fit: 1, boxes: [
    [0, 0, 0, 1, 0.3, 1, 'stone'], [0, 0.3, 0, 0.45, 2.6, 0.45, 'leaf'], [0.35, 1.2, 0, 0.5, 0.15, 0.3, 'leaf'], [-0.35, 1.7, 0, 0.5, 0.15, 0.3, 'leaf'],
    [0, 2.6, 0.15, 1.5, 1.5, 0.2, 'flower'], [0, 3.0, 0.25, 0.7, 0.7, 0.15, 'wood'],
  ] },
  { name: 'かかし', fit: 3, boxes: [
    [0, 0, 0, 0.3, 2.4, 0.3, 'wood'], [0, 1.5, 0, 2.2, 0.25, 0.25, 'plank'], [0, 1.0, 0, 0.9, 0.9, 0.5, 'roof_blue'],
    [0, 2.0, 0, 0.7, 0.7, 0.7, 'thatch'], [0, 2.7, 0, 1.2, 0.12, 0.95, 'thatch'], [0, 2.8, 0, 0.6, 0.35, 0.6, 'thatch'],
    [-0.15, 2.35, 0.36, 0.1, 0.1, 0.05, 'dark'], [0.15, 2.35, 0.36, 0.1, 0.1, 0.05, 'dark'],
  ] },
  { name: '雪だるま', fit: 1, boxes: [
    [0, 0, 0, 1.6, 1.3, 1.6, 'white'], [0, 1.3, 0, 1.1, 0.95, 1.1, 'white'], [0, 2.1, 0, 1.15, 0.2, 1.15, 'roof'], [0, 2.3, 0, 0.8, 0.75, 0.8, 'white'],
    [0, 3.05, 0, 0.6, 0.45, 0.6, 'roof_blue'], [-0.17, 2.7, 0.41, 0.1, 0.1, 0.04, 'dark'], [0.17, 2.7, 0.41, 0.1, 0.1, 0.04, 'dark'],
    [0, 2.5, 0.45, 0.12, 0.12, 0.25, 'flower'], [0, 1.75, 0.56, 0.12, 0.12, 0.04, 'dark'], [0, 1.5, 0.56, 0.12, 0.12, 0.04, 'dark'],
  ] },
];

export const mementoId = (key: number) => `memento-${key}`;

/** その月（季節の目標の番号）の記念の飾り */
export function mementoDesign(key: number): BuildingDesign {
  const shape = SHAPES[seasonOfKey(key)];
  const ext = Math.max(...shape.boxes.flatMap(([x, , z, w, , d]) => [Math.abs(x) + w / 2, Math.abs(z) + d / 2])) * 2;
  const k = Math.min(1, (shape.fit * 0.98) / ext);
  const boxes = shape.boxes.map(([x, y, z, w, h, d, c]): Box => [x * k, y * k, z * k, w * k, h * k, d * k, c]);
  const cubes = boxes.map(box);
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const [x, y, z, w, h, d] of boxes) {
    const lo = [x - w / 2, y, z - d / 2], hi = [x + w / 2, y + h, z + d / 2];
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], lo[i]); max[i] = Math.max(max[i], hi[i]); }
  }
  const year = 2027 + Math.floor(key / 12), month = (((key % 12) + 12) % 12) + 1;
  return { id: mementoId(key), name: `${year}年${month}月の記念：${shape.name}`, cubes, bounds: { min, max }, kind: 'deco', memento: true };
}
