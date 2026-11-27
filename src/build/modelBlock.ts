/**
 * 形のあるマイブロック（v0.20.6）：建物と同じ形式（Blockbench の geo.json）で、1 × 1 × 1 の中に収まる小さな物。
 * 立方体を埋める必要は無い（机・つぼ・ランタン・柵など）。素材の割合は、部品の素材（グループの名前の頭）の見える表面の広さから決める。
 * three.js に頼らない
 */
import { parseBuilding, sanitizeDesign, type BuildingDesign, type ParseIssue } from './geoParse';
import { buildingCharacter } from './character';
import { BLOCK_LIMITS } from './limits';
import { MAT_IDS, type MatId } from './palette';

export interface ModelBlockLook { name: string; mats: Partial<Record<MatId, number>>; design: BuildingDesign }

/** 素材の割合（見える表面の広さ）を、合計 1・0.05 刻みに */
export function matsOfDesign(d: BuildingDesign): Partial<Record<MatId, number>> {
  // 性格の計算は 1/4 マスの格子なので、小さな物（机の脚など）は細すぎて数えられない。4 倍に広げてから数える（割合は変わらない）
  const K = 4;
  const big: BuildingDesign = {
    ...d,
    cubes: d.cubes.map((c) => ({ ...c, m: c.m.map((v) => v * K) })),
    bounds: { min: d.bounds.min.map((v) => v * K) as [number, number, number], max: d.bounds.max.map((v) => v * K) as [number, number, number] },
  };
  const c = buildingCharacter(big);
  const sum = MAT_IDS.reduce((a, m) => a + (c.areas[m] ?? 0), 0);
  if (sum <= 0) return { wood: 1 };
  const out: Partial<Record<MatId, number>> = {};
  for (const m of MAT_IDS) { const v = Math.round(((c.areas[m] ?? 0) / sum) * 20) / 20; if (v > 0) out[m] = v; }
  // 端数は、いちばん大きい素材で合わせる
  const main = MAT_IDS.reduce((a, b) => ((out[b] ?? 0) > (out[a] ?? 0) ? b : a));
  const rest = MAT_IDS.filter((m) => m !== main).reduce((a, m) => a + (out[m] ?? 0), 0);
  out[main] = Math.round((1 - rest) * 20) / 20;
  for (const m of MAT_IDS) if (!out[m]) delete out[m];
  return Object.keys(out).length ? out : { wood: 1 };
}

/** AI の返事を読む。name：利用者が書いた「作りたいもの」（無ければ JSON の名前） */
export function parseModelBlock(text: string, name = ''): { ok: true; look: ModelBlockLook } | { ok: false; issues: ParseIssue[] } {
  const r = parseBuilding(text, BLOCK_LIMITS);
  if (!r.ok) return r;
  const nm = (name.trim() || r.design.name.replace(/^geometry\./, '')).slice(0, 24) || 'マイブロック';
  return { ok: true, look: { name: nm, mats: matsOfDesign(r.design), design: { ...r.design, name: nm } } };
}

/** 保存から読んだ形を確かめる（直方体の数・1 マスに収まるか） */
export function sanitizeModelDesign(v: unknown): BuildingDesign | null {
  const d = sanitizeDesign(v);
  if (!d || d.cubes.length > BLOCK_LIMITS.cubes) return null;
  const h = BLOCK_LIMITS.widthUnits / 32 + 0.01; // ボクセル単位で ±0.5
  if (Math.max(-d.bounds.min[0], d.bounds.max[0], -d.bounds.min[2], d.bounds.max[2]) > h) return null;
  if (d.bounds.max[1] > BLOCK_LIMITS.heightUnits / 16 + 0.01) return null;
  return d;
}
