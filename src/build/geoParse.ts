/**
 * 建物の JSON（Blockbench の Bedrock 形式 .geo.json）を検査して、箱庭で使う形に直す。
 * データは数値と名前としてだけ読む。three.js に頼らない純粋な関数なので、テストから直接呼べる。
 * 規格：docs/superpowers/specs/2026-11-19-building-import-design.md
 */
import { LIMITS, UNITS_PER_VOXEL } from './limits';
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

// ---------- 形の変換 ----------
// Bedrock の値は、Blockbench の画面に対して X が反転し、回転の X・Y の符号が反転している（設計書 §5）。
// ここでは画面の座標に戻してから組み立てる。行列は 3×4（行優先）のアフィン変換

type M34 = number[];
const ident = (): M34 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const translate = (x: number, y: number, z: number): M34 => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
const scale = (x: number, y: number, z: number): M34 => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0];
function mul(a: M34, b: M34): M34 {
  const o = new Array(12).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + (c === 3 ? a[r * 4 + 3] : 0);
    }
  }
  return o;
}
/** 回転（度、画面の向き）。three.js の Euler 'ZYX' と同じ：Rz·Ry·Rx */
function rotZYX(rx: number, ry: number, rz: number): M34 {
  const d = Math.PI / 180;
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(rx * d), Math.sin(rx * d), Math.cos(ry * d), Math.sin(ry * d), Math.cos(rz * d), Math.sin(rz * d)];
  const Rx = [1, 0, 0, 0, 0, cx, -sx, 0, 0, sx, cx, 0];
  const Ry = [cy, 0, sy, 0, 0, 1, 0, 0, -sy, 0, cy, 0];
  const Rz = [cz, -sz, 0, 0, sz, cz, 0, 0, 0, 0, 1, 0];
  return mul(Rz, mul(Ry, Rx));
}
/** pivot まわりの回転（Bedrock の値を受け取り、画面の向きに直す） */
function rotAbout(pivot: Vec3, rot: Vec3): M34 {
  if (rot[0] === 0 && rot[1] === 0 && rot[2] === 0) return ident();
  const [px, py, pz] = [-pivot[0], pivot[1], pivot[2]];
  return mul(translate(px, py, pz), mul(rotZYX(-rot[0], -rot[1], rot[2]), translate(-px, -py, -pz)));
}

/**
 * 直方体を、Blockbench の画面の座標（単位は Blockbench の 1 = 1/16 ボクセル）の行列にする。
 * 大きさがすべて 0 の直方体は捨てる
 */
export function transformCubes(bones: ResolvedBone[], withInflate = true): BuildingCube[] {
  const boneM: (M34 | undefined)[] = [];
  const matOf = (i: number): M34 => {
    const cached = boneM[i];
    if (cached) return cached;
    const b = bones[i];
    const own = rotAbout(b.pivot, b.rotation);
    return (boneM[i] = b.parent >= 0 ? mul(matOf(b.parent), own) : own);
  };
  const out: BuildingCube[] = [];
  bones.forEach((b, i) => {
    for (const c of b.cubes) {
      if (c.size[0] === 0 && c.size[1] === 0 && c.size[2] === 0) continue;
      const k = withInflate ? c.inflate : 0;
      const from: Vec3 = [-(c.origin[0] + c.size[0]) - k, c.origin[1] - k, c.origin[2] - k];
      const m = mul(mul(matOf(i), rotAbout(c.pivot, c.rotation)), mul(translate(...from), scale(c.size[0] + 2 * k, c.size[1] + 2 * k, c.size[2] + 2 * k)));
      out.push({ m, color: b.color ?? '' });
    }
  });
  return out;
}

/** 行列 m で写した単位立方体の 8 隅 */
function corners(m: M34): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) {
    out.push([0, 1, 2].map((r) => m[r * 4] * x + m[r * 4 + 1] * y + m[r * 4 + 2] * z + m[r * 4 + 3]) as Vec3);
  }
  return out;
}

/** FNV-1a 32 ビット → 8 桁の 16 進 */
function fnv1a(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

const fmt = (v: number) => (Math.round(v * 10) / 10).toString();

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

  const cubes = transformCubes(r.bones);
  if (!cubes.length) return { ok: false, issues: [{ code: 'empty', message: '大きさのある直方体が 1 つもありません。' }] };

  // 外形（Blockbench の単位）
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const c of cubes) for (const p of corners(c.m)) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[a]); max[a] = Math.max(max[a], p[a]); }
  const EPS = 1e-6;
  const W = LIMITS.widthUnits, H = LIMITS.heightUnits, U = UNITS_PER_VOXEL;
  const wide = Math.max(max[0] - min[0], max[2] - min[2]);
  if (wide > W + EPS) {
    issues.push({ code: 'too_wide', message: `建物の幅か奥行が ${fmt(wide / U)} マス（${fmt(wide)} 単位）あります。回転した分も含めて ${W / U} マス（${W} 単位）以内にしてください。` });
  }
  if (max[1] - min[1] > H + EPS) {
    issues.push({ code: 'too_tall', message: `建物の高さが ${fmt((max[1] - min[1]) / U)} マス（${fmt(max[1] - min[1])} 単位）あります。${H / U} マス（${H} 単位）以内にしてください。` });
  }
  // 地面に着いているかは、膨らみ（inflate）を除いた形で見る（Blockbench で y = 0 に置いた直方体を膨らませても、置き直さなくてよいように）
  let ground = Infinity;
  for (const c of transformCubes(r.bones, false)) for (const p of corners(c.m)) ground = Math.min(ground, p[1]);
  if (Math.abs(ground) > LIMITS.groundTolerance + EPS) {
    issues.push({ code: 'not_grounded', message: `一番低い所が y = ${fmt(ground)} にあります。建物の底を y = 0 にそろえてください。` });
  }
  if (issues.length) return { ok: false, issues };

  // ボクセル単位にし、底面をちょうど y = 0 にずらす
  const toVoxel = mul(translate(0, -min[1] / U, 0), scale(1 / U, 1 / U, 1 / U));
  const out = cubes.map((c) => ({ m: mul(toVoxel, c.m), color: c.color }));
  const bounds = {
    min: [min[0] / U, 0, min[2] / U] as Vec3,
    max: [max[0] / U, (max[1] - min[1]) / U, max[2] / U] as Vec3,
  };
  const key = out.map((c) => c.m.map((v) => (Math.round(v * 1e4) / 1e4).toString()).join(',') + ':' + c.color).join(';');
  return { ok: true, design: { id: fnv1a(key), name: r.name, cubes: out, bounds } };
}
