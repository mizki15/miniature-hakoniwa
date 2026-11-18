/**
 * 建物の JSON（Blockbench の Bedrock 形式 .geo.json）を検査して、箱庭で使う形に直す。
 * データは数値と名前としてだけ読む。three.js に頼らない純粋な関数なので、テストから直接呼べる。
 * 規格：docs/superpowers/specs/2026-11-19-building-import-design.md
 */
import { LIMITS } from './limits';
import { colorOfName } from './palette';

export type IssueCode =
  | 'json' | 'file_size' | 'no_geometry' | 'poly_mesh' | 'no_color' | 'too_many_cubes' | 'too_many_bones' | 'too_deep'
  | 'parent_missing' | 'parent_cycle' | 'bad_number' | 'negative_size' | 'too_wide' | 'too_tall' | 'not_grounded' | 'empty';

export interface ParseIssue { code: IssueCode; message: string }

/** 直方体 1 個。m：単位立方体 [0,1]^3 → ボクセル単位の座標への 3×4 アフィン行列（行優先 12 個）。大きさ・膨らみ・回転・親の回転を合成済み */
export interface BuildingCube { m: number[]; color: string }

export interface BuildingDesign {
  id: string;
  name: string;
  cubes: BuildingCube[];
  /** 外形（ボクセル単位） */
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

export type ParseResult = { ok: true; design: BuildingDesign } | { ok: false; issues: ParseIssue[] };

type Vec3 = [number, number, number];

/** 検査を通った直方体（Bedrock の値のまま） */
export interface RawCube { origin: Vec3; size: Vec3; pivot: Vec3; rotation: Vec3; inflate: number }

/** 検査を通ったグループ */
export interface ResolvedBone { name: string; parent: number; pivot: Vec3; rotation: Vec3; cubes: RawCube[]; color: string | null }

/**
 * AI の返事などに混ざった前置き・コードブロックの記号を除き、最初の { から対応する } までを返す。
 * 見つからなければ元の文字列
 */
export function extractJson(text: string): string {
  const start = text.indexOf('{');
  if (start < 0) return text;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(isNum);

/** JSON を読み、グループの親子と色まで決める。問題は issues に足す */
export function resolveBones(json: unknown, issues: ParseIssue[]): { name: string; bones: ResolvedBone[] } | null {
  const list = isObj(json) ? json['minecraft:geometry'] : undefined;
  const geo = Array.isArray(list) ? list[0] : undefined;
  if (!isObj(geo) || !Array.isArray(geo.bones)) {
    issues.push({ code: 'no_geometry', message: '"minecraft:geometry" の中に "bones"（グループの一覧）が見つかりません。Blockbench の「Bedrock Entity」形式で書き出してください。' });
    return null;
  }
  const desc = isObj(geo.description) ? geo.description : {};
  const ident = typeof desc.identifier === 'string' ? desc.identifier.replace(/^geometry\./, '').trim() : '';
  const name = ident || '名前のない建物';
  const raw = geo.bones as unknown[];
  if (raw.length > LIMITS.bones) {
    issues.push({ code: 'too_many_bones', message: `グループが ${raw.length} 個あります。${LIMITS.bones} 個以下にしてください。` });
    return null;
  }

  const bones: ResolvedBone[] = [];
  const parents: (string | undefined)[] = [];
  let cubeCount = 0;
  raw.forEach((b, i) => {
    const bname = isObj(b) && typeof b.name === 'string' && b.name ? b.name : `（名前なし・${i + 1} 番目）`;
    const bone: ResolvedBone = { name: bname, parent: -1, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [], color: null };
    bones.push(bone);
    parents.push(isObj(b) && typeof b.parent === 'string' ? b.parent : undefined);
    if (!isObj(b)) return;
    if (b.poly_mesh !== undefined) issues.push({ code: 'poly_mesh', message: `グループ「${bname}」に poly_mesh（自由な多角形）があります。直方体（cubes）だけで作ってください。` });
    for (const key of ['pivot', 'rotation'] as const) {
      if (b[key] === undefined) continue;
      if (isVec3(b[key])) bone[key] = b[key] as Vec3;
      else issues.push({ code: 'bad_number', message: `グループ「${bname}」の ${key} が数 3 つの並びになっていません。` });
    }
    if (b.cubes === undefined) return;
    if (!Array.isArray(b.cubes)) { issues.push({ code: 'bad_number', message: `グループ「${bname}」の cubes が一覧（[ ]）になっていません。` }); return; }
    b.cubes.forEach((c, j) => {
      cubeCount++;
      const where = `グループ「${bname}」の ${j + 1} 番目の直方体`;
      if (!isObj(c)) { issues.push({ code: 'bad_number', message: `${where}が { } の形になっていません。` }); return; }
      let good = true;
      for (const key of ['origin', 'size'] as const) {
        if (!isVec3(c[key])) { issues.push({ code: 'bad_number', message: `${where}の ${key} が数 3 つの並びになっていません。` }); good = false; }
      }
      for (const key of ['pivot', 'rotation'] as const) {
        if (c[key] !== undefined && !isVec3(c[key])) { issues.push({ code: 'bad_number', message: `${where}の ${key} が数 3 つの並びになっていません。` }); good = false; }
      }
      if (c.inflate !== undefined && !isNum(c.inflate)) { issues.push({ code: 'bad_number', message: `${where}の inflate が数になっていません。` }); good = false; }
      if (!good) return;
      const size = c.size as Vec3;
      if (size.some((s) => s < 0)) { issues.push({ code: 'negative_size', message: `${where}の size に負の数があります。0 以上にしてください。` }); return; }
      bone.cubes.push({
        origin: c.origin as Vec3, size,
        pivot: (c.pivot as Vec3 | undefined) ?? [0, 0, 0],
        rotation: (c.rotation as Vec3 | undefined) ?? [0, 0, 0],
        inflate: (c.inflate as number | undefined) ?? 0,
      });
    });
  });
  if (cubeCount > LIMITS.cubes) issues.push({ code: 'too_many_cubes', message: `直方体が ${cubeCount} 個あります。${LIMITS.cubes} 個以下にしてください。` });

  // 親子：名前 → 番号。親が見つからない・輪になっている・深すぎるものを調べる
  const byName = new Map<string, number>();
  bones.forEach((b, i) => { if (!byName.has(b.name)) byName.set(b.name, i); });
  bones.forEach((b, i) => {
    const p = parents[i];
    if (p === undefined) return;
    const pi = byName.get(p);
    if (pi === undefined) issues.push({ code: 'parent_missing', message: `グループ「${b.name}」の親「${p}」が見つかりません。` });
    else b.parent = pi;
  });
  let chainOk = true;
  bones.forEach((b, i) => {
    const seen = new Set<number>([i]);
    let depth = 1;
    for (let p = b.parent; p >= 0; p = bones[p].parent) {
      if (seen.has(p)) {
        issues.push({ code: 'parent_cycle', message: `グループ「${b.name}」の親をたどると、元に戻ってきます（親子が輪になっています）。` });
        chainOk = false;
        return;
      }
      seen.add(p);
      depth++;
    }
    if (depth > LIMITS.depth) {
      issues.push({ code: 'too_deep', message: `グループ「${b.name}」の入れ子が ${depth} 段あります。${LIMITS.depth} 段以下にしてください。` });
      chainOk = false;
    }
  });
  if (!chainOk) return null;

  // 色：自分の名前 → 親の名前、の順に決める
  for (const b of bones) {
    for (let p: ResolvedBone | undefined = b; p; p = p.parent >= 0 ? bones[p.parent] : undefined) {
      const c = colorOfName(p.name);
      if (c) { b.color = c; break; }
    }
    if (!b.color && b.cubes.length) {
      issues.push({ code: 'no_color', message: `グループ「${b.name}」の色が決まりません。wood などパレットの名前を付けるか、色のあるグループの中に入れてください。` });
    }
  }
  return { name, bones };
}

/** 建物の JSON を検査して、箱庭で使う形にする */
export function parseBuilding(text: string): ParseResult {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > LIMITS.fileBytes) {
    return { ok: false, issues: [{ code: 'file_size', message: `ファイルが ${Math.ceil(bytes / 1024)} KB あります。${LIMITS.fileBytes / 1024} KB 以下にしてください。` }] };
  }
  let json: unknown;
  try {
    json = JSON.parse(extractJson(text));
  } catch (e) {
    return { ok: false, issues: [{ code: 'json', message: `JSON として読めません（${(e as Error).message}）。途中で切れていないか、「…」で省略していないか確かめてください。` }] };
  }
  const issues: ParseIssue[] = [];
  const r = resolveBones(json, issues);
  if (!r || issues.length) return { ok: false, issues };
  return { ok: true, design: { id: '', name: r.name, cubes: [], bounds: { min: [0, 0, 0], max: [0, 0, 0] } } };
}
