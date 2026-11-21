/**
 * 建物の建設（three.js に頼らない）。
 * 置いた建物は、すぐには建たず、直方体（パーツ）を下から順に 1 つずつ組み上げていく。
 * かかる時間は大きさ（直方体の数）に比例して 10〜60 分（箱庭の時計で数えるので、閉じている間も進む）
 */
import type { BuildingCube, BuildingDesign } from './geoParse';

const MIN_MINUTES = 10;
const MAX_MINUTES = 60;
/** 直方体 1 個あたりの分 */
const PER_CUBE = 0.25;

/** 建て終わるまでの時間（分） */
export function buildMinutes(d: Pick<BuildingDesign, 'cubes'>): number {
  return Math.min(MAX_MINUTES, MIN_MINUTES + d.cubes.length * PER_CUBE);
}

/** 直方体の角 8 つ（ボクセル単位） */
export function cubeCorners(c: BuildingCube): [number, number, number][] {
  const m = c.m;
  const out: [number, number, number][] = [];
  for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) {
    out.push([0, 1, 2].map((r) => m[r * 4] * x + m[r * 4 + 1] * y + m[r * 4 + 2] * z + m[r * 4 + 3]) as [number, number, number]);
  }
  return out;
}

/** 直方体の外形（ボクセル単位） */
export function cubeBox(c: BuildingCube): { min: [number, number, number]; max: [number, number, number] } {
  const cs = cubeCorners(c);
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of cs) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[a]); max[a] = Math.max(max[a], p[a]); }
  return { min, max };
}

/**
 * 組み上げる順番：底の低い直方体から。底が同じなら、上端の低いもの・奥（−z）・左（−x）から。
 * 元の並びは変えずに、並べ替えた写しを返す
 */
export function buildOrder(d: Pick<BuildingDesign, 'cubes'>): BuildingCube[] {
  const keyed = d.cubes.map((c, i) => ({ c, i, b: cubeBox(c) }));
  const r = (v: number) => Math.round(v * 1000) / 1000;
  keyed.sort((p, q) => r(p.b.min[1]) - r(q.b.min[1]) || r(p.b.max[1]) - r(q.b.max[1]) || r(p.b.min[2]) - r(q.b.min[2]) || r(p.b.min[0]) - r(q.b.min[0]) || p.i - q.i);
  return keyed.map((k) => k.c);
}

/** 進み具合（0〜1）のとき、組み上がった直方体の数 */
export function builtCount(progress: number, total: number): number {
  if (progress >= 1) return total;
  return Math.max(0, Math.min(total, Math.floor(progress * total)));
}

/** 進み具合を dtMs（箱庭の時間）ぶん進める */
export function advanceProgress(progress: number, dtMs: number, d: Pick<BuildingDesign, 'cubes'>): number {
  if (progress >= 1) return 1;
  return Math.min(1, progress + dtMs / (buildMinutes(d) * 60_000));
}

/** 完成までの残り（分、切り上げ） */
export function minutesLeft(progress: number, d: Pick<BuildingDesign, 'cubes'>): number {
  return Math.max(0, Math.ceil((1 - progress) * buildMinutes(d)));
}
