/**
 * 建物の JSON（Blockbench の Bedrock 形式 .geo.json）を検査して、箱庭で使う形に直す。
 * データは数値と名前としてだけ読む。three.js に頼らない純粋な関数なので、テストから直接呼べる。
 * 規格：docs/superpowers/specs/2026-11-19-building-import-design.md
 */
import { LIMITS, type Limits, UNITS_PER_VOXEL } from './limits';
import { cubeMat, isCubeColor, isMatId, parseColorName, type CubeColor, type MatId } from './palette';

export type IssueCode =
  | 'json' | 'file_size' | 'no_geometry' | 'poly_mesh' | 'no_color' | 'too_many_cubes' | 'too_many_bones' | 'too_deep'
  | 'parent_missing' | 'parent_cycle' | 'bad_number' | 'negative_size' | 'too_wide' | 'too_tall' | 'not_grounded' | 'empty';

export interface ParseIssue { code: IssueCode; message: string }

/** 直方体 1 個。m：単位立方体 [0,1]^3 → ボクセル単位の座標への 3×4 アフィン行列（行優先 12 個）。大きさ・膨らみ・回転・親の回転を合成済み */
/** color：パレットの名前（古い形）か "#rrggbb"。mat：素材（v0.20。無ければ色の名前から）。glass：窓 */
export interface BuildingCube { m: number[]; color: string; mat?: MatId; glass?: true }

export interface BuildingDesign {
  id: string;
  name: string;
  cubes: BuildingCube[];
  /** 外形（ボクセル単位） */
  bounds: { min: [number, number, number]; max: [number, number, number] };
  /**
   * 家か飾りか（v0.16.1。棚に入れる時にプレイヤーが選ぶ。無ければ家）。
   * 飾りは住人の住まいにならず（家の数・好きな家に数えない）、性格は弱め（灯りの届く距離が星 1 つぶん短く、野生度を下げる重みが半分）
   */
  kind?: 'deco';
  /** 季節の記念の飾り（v0.17。季節の目標のほうび）。素材も発見ポイントも要らない */
  memento?: true;
}

export type ParseResult = { ok: true; design: BuildingDesign } | { ok: false; issues: ParseIssue[] };

type Vec3 = [number, number, number];

/** 検査を通った直方体（Bedrock の値のまま） */
export interface RawCube { origin: Vec3; size: Vec3; pivot: Vec3; rotation: Vec3; inflate: number }

/** 検査を通ったグループ */
export interface ResolvedBone { name: string; parent: number; pivot: Vec3; rotation: Vec3; cubes: RawCube[]; color: CubeColor | null }

/** start の { に対応する } の位置（なければ −1） */
function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}

/** 前置きの文の { } などで、何度も試しすぎないための上限 */
const MAX_TRIES = 50;

/**
 * AI の返事などに混ざった前置き・コードブロックの記号を除き、JSON の部分を返す。
 * 文の中の { } を飛ばし、JSON として読める { … } のうち "minecraft:geometry" を持つ最後のもの
 * （会話をまるごと貼った時、説明文の例より後にある AI の答え）を選ぶ。
 * 読めるものがなければ最初の { から後ろ、{ がなければ元の文字列
 */
export function extractJson(text: string): string {
  let firstStart = -1, lastParsed: string | null = null, lastGeometry: string | null = null;
  let i = text.indexOf('{');
  for (let tries = 0; i >= 0 && tries < MAX_TRIES; tries++) {
    if (firstStart < 0) firstStart = i;
    const end = balancedEnd(text, i);
    if (end < 0) break;
    const cand = text.slice(i, end + 1);
    let parsed: unknown;
    try { parsed = JSON.parse(cand); } catch { i = text.indexOf('{', i + 1); continue; }
    lastParsed = cand;
    if (isObj(parsed) && 'minecraft:geometry' in parsed) lastGeometry = cand;
    i = text.indexOf('{', end + 1);
  }
  return lastGeometry ?? lastParsed ?? (firstStart >= 0 ? text.slice(firstStart) : text);
}

/** 座標・大きさ・回転として受け付ける数の大きさの上限（足し算で無限大にならないように） */
const MAX_ABS = 1e5;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_ABS;
const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(isNum);

/**
 * 問題のメッセージに入れてよい形の名前（設計メモ 3 章）：NFKC で正規化し、英数字と _ だけを残して 32 文字まで。
 * メッセージは「AI に直してもらう文」にそのまま入るので、共有された建物の名前に指示文を書かれても届かないようにする。
 */
export const NAME_IN_MESSAGE_MAX = 32;
export const safeName = (name: string) => name.normalize('NFKC').replace(/[^A-Za-z0-9_]/g, '').slice(0, NAME_IN_MESSAGE_MAX);
/** グループは番号で指す。名前は安全な形だけ、かっこで添える */
const groupLabel = (name: string | undefined, i: number) => {
  const s = name ? safeName(name) : '';
  return s ? `${i + 1} 番目のグループ（${s}）` : `${i + 1} 番目のグループ`;
};

/** JSON の読み間違いの場所（何文字目か）だけを返す。エラー文は元の文を引用するので、そのまま入れない */
const jsonErrorWhere = (e: unknown) => {
  const m = /position (\d+)/.exec(String((e as Error)?.message ?? ''));
  return m ? `（${Number(m[1]) + 1} 文字目のあたり）` : '';
};

/** JSON を読み、グループの親子と色まで決める。問題は issues に足す */
export function resolveBones(json: unknown, issues: ParseIssue[], lim: Limits = LIMITS): { name: string; bones: ResolvedBone[] } | null {
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
  if (raw.length > lim.bones) {
    issues.push({ code: 'too_many_bones', message: `グループが ${raw.length} 個あります。${lim.bones} 個以下にしてください。` });
    return null;
  }

  const bones: ResolvedBone[] = [];
  const parents: (string | undefined)[] = [];
  const labels: string[] = [];
  let cubeCount = 0;
  raw.forEach((b, i) => {
    const given = isObj(b) && typeof b.name === 'string' && b.name ? b.name : undefined;
    const bname = given ?? `（名前なし・${i + 1} 番目）`;
    const label = groupLabel(given, i);
    labels.push(label);
    const bone: ResolvedBone = { name: bname, parent: -1, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [], color: null };
    bones.push(bone);
    parents.push(isObj(b) && typeof b.parent === 'string' ? b.parent : undefined);
    if (!isObj(b)) return;
    if (b.poly_mesh !== undefined) issues.push({ code: 'poly_mesh', message: `${label}に poly_mesh（自由な多角形）があります。直方体（cubes）だけで作ってください。` });
    for (const key of ['pivot', 'rotation'] as const) {
      if (b[key] === undefined) continue;
      if (isVec3(b[key])) bone[key] = b[key] as Vec3;
      else issues.push({ code: 'bad_number', message: `${label}の ${key} が数 3 つの並び（それぞれ ±100000 以内）になっていません。` });
    }
    if (b.cubes === undefined) return;
    if (!Array.isArray(b.cubes)) { issues.push({ code: 'bad_number', message: `${label}の cubes が一覧（[ ]）になっていません。` }); return; }
    b.cubes.forEach((c, j) => {
      cubeCount++;
      const where = `${label}の ${j + 1} 番目の直方体`;
      if (!isObj(c)) { issues.push({ code: 'bad_number', message: `${where}が { } の形になっていません。` }); return; }
      let good = true;
      for (const key of ['origin', 'size'] as const) {
        if (!isVec3(c[key])) { issues.push({ code: 'bad_number', message: `${where}の ${key} が数 3 つの並び（それぞれ ±100000 以内）になっていません。` }); good = false; }
      }
      for (const key of ['pivot', 'rotation'] as const) {
        if (c[key] !== undefined && !isVec3(c[key])) { issues.push({ code: 'bad_number', message: `${where}の ${key} が数 3 つの並び（それぞれ ±100000 以内）になっていません。` }); good = false; }
      }
      if (c.inflate !== undefined && !isNum(c.inflate)) { issues.push({ code: 'bad_number', message: `${where}の inflate が数（±100000 以内）になっていません。` }); good = false; }
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
  if (cubeCount > lim.cubes) issues.push({ code: 'too_many_cubes', message: `直方体が ${cubeCount} 個あります。${lim.cubes} 個以下にしてください。` });

  // 親子：名前 → 番号。親が見つからない・輪になっている・深すぎるものを調べる
  const byName = new Map<string, number>();
  bones.forEach((b, i) => { if (!byName.has(b.name)) byName.set(b.name, i); });
  bones.forEach((b, i) => {
    const p = parents[i];
    if (p === undefined) return;
    const pi = byName.get(p);
    if (pi === undefined) issues.push({ code: 'parent_missing', message: `${labels[i]}の親${safeName(p) ? `（${safeName(p)}）` : ''}が見つかりません。` });
    else b.parent = pi;
  });
  let chainOk = true;
  bones.forEach((b, i) => {
    const seen = new Set<number>([i]);
    let depth = 1;
    for (let p = b.parent; p >= 0; p = bones[p].parent) {
      if (seen.has(p)) {
        issues.push({ code: 'parent_cycle', message: `${labels[i]}の親をたどると、元に戻ってきます（親子が輪になっています）。` });
        chainOk = false;
        return;
      }
      seen.add(p);
      depth++;
    }
    if (depth > lim.depth) {
      issues.push({ code: 'too_deep', message: `${labels[i]}の入れ子が ${depth} 段あります。${lim.depth} 段以下にしてください。` });
      chainOk = false;
    }
  });
  if (!chainOk) return null;

  // 色：自分の名前 → 親の名前、の順に決める
  for (const [bi, b] of bones.entries()) {
    for (let p: ResolvedBone | undefined = b; p; p = p.parent >= 0 ? bones[p.parent] : undefined) {
      const c = parseColorName(p.name);
      if (c) { b.color = c; break; }
    }
    if (!b.color && b.cubes.length) {
      issues.push({ code: 'no_color', message: `${labels[bi]}の色が決まりません。wood_8a5a3c のように「素材_色」の名前を付けるか、色のあるグループの中に入れてください。` });
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
      out.push({ m, color: b.color?.color ?? '', mat: b.color?.mat ?? 'wood', ...(b.color?.glass ? { glass: true as const } : {}) });
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
/** lim：上限（建物は LIMITS、マイブロックは BLOCK_LIMITS。v0.20.6） */
export function parseBuilding(text: string, lim: Limits = LIMITS): ParseResult {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > lim.fileBytes) {
    return { ok: false, issues: [{ code: 'file_size', message: `ファイルが ${Math.ceil(bytes / 1024)} KB あります。${lim.fileBytes / 1024} KB 以下にしてください。` }] };
  }
  let json: unknown;
  try {
    json = JSON.parse(extractJson(text));
  } catch (e) {
    return { ok: false, issues: [{ code: 'json', message: `JSON として読めません${jsonErrorWhere(e)}。途中で切れていないか、「…」で省略していないか確かめてください。` }] };
  }
  const issues: ParseIssue[] = [];
  const r = resolveBones(json, issues, lim);
  if (!r) return { ok: false, issues };

  // 色などの問題があっても、外形の検査まで進めて、問題をまとめて伝える（読めなかった直方体は除いてある）
  const cubes = transformCubes(r.bones);
  // 念のため：組み立てた行列がすべて有限か（NaN・無限大の形を GPU や保存へ渡さない）
  if (cubes.some((c) => c.m.some((v) => !Number.isFinite(v)))) {
    return { ok: false, issues: [...issues, { code: 'bad_number', message: '座標や大きさの数が大きすぎて、形を作れません。' }] };
  }
  if (!cubes.length) {
    return { ok: false, issues: issues.length ? issues : [{ code: 'empty', message: '大きさのある直方体が 1 つもありません。' }] };
  }

  // 外形（Blockbench の単位）
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const c of cubes) for (const p of corners(c.m)) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[a]); max[a] = Math.max(max[a], p[a]); }
  const EPS = 1e-6;
  const W = lim.widthUnits, H = lim.heightUnits, U = UNITS_PER_VOXEL;
  const wide = Math.max(max[0] - min[0], max[2] - min[2]);
  if (wide > W + EPS) {
    issues.push({ code: 'too_wide', message: `建物の幅か奥行が ${fmt(wide / U)} マス（${fmt(wide)} 単位）あります。回転した分も含めて ${W / U} マス（${W} 単位）以内にしてください。` });
  }
  // マイブロック：となりのマスにはみ出さないよう、x・z は中心から ±半分の中
  if (lim.centered && Math.max(-min[0], max[0], -min[2], max[2]) > W / 2 + EPS) {
    issues.push({ code: 'too_wide', message: `マスからはみ出しています。横と奥は、x と z が −${W / 2}〜${W / 2} 単位の中に収めてください。` });
  }
  if (max[1] - min[1] > H + EPS) {
    issues.push({ code: 'too_tall', message: `建物の高さが ${fmt((max[1] - min[1]) / U)} マス（${fmt(max[1] - min[1])} 単位）あります。${H / U} マス（${H} 単位）以内にしてください。` });
  }
  // 地面に着いているかは、膨らみ（inflate）を除いた形で見る（Blockbench で y = 0 に置いた直方体を膨らませても、置き直さなくてよいように）
  let ground = Infinity;
  for (const c of transformCubes(r.bones, false)) for (const p of corners(c.m)) ground = Math.min(ground, p[1]);
  if (Math.abs(ground) > lim.groundTolerance + EPS) {
    issues.push({ code: 'not_grounded', message: `一番低い所が y = ${fmt(ground)} にあります。建物の底を y = 0 にそろえてください。` });
  }
  if (issues.length) return { ok: false, issues };

  // ボクセル単位にし、底面をちょうど y = 0 にずらす
  const toVoxel = mul(translate(0, -min[1] / U, 0), scale(1 / U, 1 / U, 1 / U));
  const out: BuildingCube[] = cubes.map((c) => ({ m: mul(toVoxel, c.m), color: c.color, mat: c.mat, ...(c.glass ? { glass: true as const } : {}) }));
  const bounds = {
    min: [min[0] / U, 0, min[2] / U] as Vec3,
    max: [max[0] / U, (max[1] - min[1]) / U, max[2] / U] as Vec3,
  };
  // 素材と窓の印も id に含める（昔の名前の建物は、昔と同じ id のまま）
  const key = out.map((c) => c.m.map((v) => (Math.round(v * 1e4) / 1e4).toString()).join(',') + ':' + c.color + (c.mat && c.color.startsWith('#') ? `:${c.mat}${c.glass ? ':g' : ''}` : '')).join(';');
  return { ok: true, design: { id: fnv1a(key), name: r.name, cubes: out, bounds } };
}

/**
 * 保存データから読んだ建物を確かめる（保存データは書き換えられるため）：
 * 色がパレットの名前で、行列が有限の数 12 個の直方体だけを残す（上限 512 個）。外形と名前の形も確かめる。残らなければ null
 */
export function sanitizeDesign(d: unknown): BuildingDesign | null {
  if (!isObj(d) || typeof d.id !== 'string' || !Array.isArray(d.cubes) || !isObj(d.bounds)) return null;
  const b = d.bounds;
  const okVec = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 1000);
  if (!okVec(b.min) || !okVec(b.max)) return null;
  const cubes = d.cubes
    .filter((c): c is BuildingCube => isObj(c) && isCubeColor(c.color) && Array.isArray(c.m) && c.m.length === 12 && c.m.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1000))
    .slice(0, LIMITS.cubes)
    .map((c) => ({ m: [...c.m], color: c.color, mat: isMatId(c.mat) ? c.mat : cubeMat(c), ...(c.glass === true || c.color === 'glass' ? { glass: true as const } : {}) }));
  if (!cubes.length) return null;
  return {
    id: d.id, name: typeof d.name === 'string' ? d.name : '名前のない建物', cubes, bounds: { min: [...(b.min as Vec3)] as Vec3, max: [...(b.max as Vec3)] as Vec3 },
    ...(d.kind === 'deco' ? { kind: 'deco' as const } : {}),
    ...(d.memento === true ? { memento: true as const } : {}),
  };
}
