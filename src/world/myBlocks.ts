/**
 * マイブロック（v0.20.4）：AI（ChatGPT・Claude など）に作ってもらう、1 × 1 × 1 のブロック。three.js に頼らない。
 * 地形のブロックと同じに扱う（掘れる・水を止める・上を歩ける）。形は立方体のまま、面（上・横・下）ごとの色と模様だけを選べる。
 * 掘ると素材の割合（木材・繊維・石材・鉱物・土）で素材が入り、置くには割合のいちばん大きい素材を 1 使う。
 *
 * 種類の番号は 64〜127（地形のボクセルの番号の空き）。保存にはマイブロックの定義も入れる（置いたボクセルは番号で残る）
 */
import { MAT_IDS, type MatId } from '../build/palette';

export const MYBLOCK_BASE = 64;
export const MYBLOCK_MAX = 64;
export const isMyBlock = (t: number) => t >= MYBLOCK_BASE && t < MYBLOCK_BASE + MYBLOCK_MAX;

/** 面の模様。地形のシェーダー（render/materials.ts）と、プレビュー（ui/myBlockThumb.ts）で同じ式を使う */
export const PATTERNS = ['plain', 'speckle', 'stripes', 'bricks', 'planks', 'checker', 'dots', 'border'] as const;
export type Pattern = (typeof PATTERNS)[number];
export const PATTERN_NAME: Record<Pattern, string> = {
  plain: '無地', speckle: 'まだら', stripes: '横じま', bricks: 'れんが積み', planks: '板張り', checker: '市松', dots: '水玉', border: '縁取り',
};
export const PATTERN_EN: Record<Pattern, string> = {
  plain: 'solid color', speckle: 'random speckles of the accent color', stripes: 'horizontal stripes', bricks: 'brick courses (accent = mortar)',
  planks: 'vertical planks (accent = gaps)', checker: '2 x 2 checkerboard', dots: 'polka dots', border: 'a frame around the edge',
};

export interface FaceLook { base: string; accent: string; pattern: Pattern }
export interface MyBlockDef {
  /** 種類の番号（64〜127）。棚に入れた時に決まる */
  id: number;
  name: string;
  /** 素材の割合（合計 1） */
  mats: Partial<Record<MatId, number>>;
  top: FaceLook; side: FaceLook; bottom: FaceLook;
}
export type MyBlockLook = Omit<MyBlockDef, 'id'>;

/**
 * 面（上 0・下 1・横 2）の座標 (u, v)（0〜1。横の面は v が上向き）で、アクセントの色を使うか。
 * シェーダーと同じ式（hash も同じ）
 */
export function patternMask(p: Pattern, u: number, v: number): boolean {
  const fr = (x: number) => x - Math.floor(x);
  const hash = (x: number, y: number) => fr(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453);
  switch (p) {
    case 'plain': return false;
    case 'speckle': return hash(Math.floor(u * 6), Math.floor(v * 6)) > 0.68;
    case 'stripes': return Math.floor(v * 4) % 2 === 1;
    case 'bricks': {
      const row = Math.floor(v * 4);
      return fr(v * 4) < 0.14 || fr(u * 2 + (row % 2) * 0.5) < 0.07;
    }
    case 'planks': return fr(u * 4) < 0.1;
    case 'checker': return (Math.floor(u * 2) + Math.floor(v * 2)) % 2 === 1;
    case 'dots': return Math.hypot(fr(u * 3) - 0.5, fr(v * 3) - 0.5) < 0.22;
    case 'border': return u < 0.1 || u > 0.9 || v < 0.1 || v > 0.9;
  }
}

/** "#rgb" か "#rrggbb" を "#rrggbb" に。読めなければ null */
export function normHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s.slice(1).split('').map((c) => c + c).join('');
  return null;
}
/** 少し暗くした色（アクセントが無い時） */
export const darker = (hex: string, k = 0.72) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
export const hexNum = (hex: string) => parseInt(hex.slice(1), 16);

export interface MyBlockIssue { message: string }
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** AI の返事などの文から、"faces" を持つ JSON を取り出す（コードブロック・前後の文があってもよい） */
export function extractMyBlockJson(text: string): unknown {
  let last: unknown = null;
  for (let i = text.indexOf('{'); i >= 0; i = text.indexOf('{', i + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try { const v = JSON.parse(text.slice(i, j + 1)); if (isObj(v) && 'faces' in v) last = v; } catch { /* 次へ */ }
        break;
      }
    }
  }
  return last;
}

/** 面の見た目を読む（足りない所は fallback から） */
function readFace(v: unknown, fallback: FaceLook | null, label: string, issues: MyBlockIssue[]): FaceLook | null {
  if (v === undefined || v === null) return fallback;
  if (!isObj(v)) { issues.push({ message: `"${label}" はオブジェクト（{ "base": …, "accent": …, "pattern": … }）にしてください。` }); return fallback; }
  const base = normHex(v.base);
  if (!base) { issues.push({ message: `"${label}" の "base" を "#rrggbb" の色にしてください。` }); return fallback; }
  const pattern = typeof v.pattern === 'string' && (PATTERNS as readonly string[]).includes(v.pattern) ? (v.pattern as Pattern) : 'plain';
  if (v.pattern !== undefined && pattern === 'plain' && v.pattern !== 'plain') issues.push({ message: `"${label}" の "pattern" は ${PATTERNS.join('・')} のどれかにしてください。` });
  return { base, accent: normHex(v.accent) ?? darker(base), pattern };
}

/**
 * マイブロックの JSON を読む。
 * { "name": "…", "materials": { "stone": 0.7, "fiber": 0.3 }, "faces": { "top": {…}, "side": {…}, "bottom": {…} } }
 * side が無ければ top、bottom が無ければ side を使う。割合は合計 1 にそろえ、0.05 刻みに丸める
 */
export function parseMyBlock(text: string): { ok: true; look: MyBlockLook } | { ok: false; issues: MyBlockIssue[] } {
  const issues: MyBlockIssue[] = [];
  const json = extractMyBlockJson(text);
  if (!isObj(json)) return { ok: false, issues: [{ message: '"faces" を持つ JSON が見つかりません。AI の返事の JSON をそのまま貼り付けてください。' }] };
  const name = typeof json.name === 'string' && json.name.trim() ? json.name.trim().slice(0, 24) : 'マイブロック';
  // 素材の割合
  const mats: Partial<Record<MatId, number>> = {};
  const m = json.materials;
  if (!isObj(m)) issues.push({ message: `"materials" に、素材（${MAT_IDS.join('・')}）ごとの割合を書いてください。` });
  else {
    for (const [k, v] of Object.entries(m)) {
      if (!(MAT_IDS as string[]).includes(k)) { issues.push({ message: `素材「${k}」はありません（${MAT_IDS.join('・')} のどれか）。` }); continue; }
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) { issues.push({ message: `素材「${k}」の割合を 0 以上の数にしてください。` }); continue; }
      if (v > 0) mats[k as MatId] = v;
    }
  }
  const sum = Object.values(mats).reduce((a, b) => a + (b ?? 0), 0);
  if (isObj(m) && sum <= 0) issues.push({ message: '素材の割合の合計が 0 です。少なくとも 1 つの素材に割合を付けてください。' });
  const faces = isObj(json.faces) ? json.faces : null;
  if (!faces) issues.push({ message: '"faces" に、面（top・side・bottom）ごとの色と模様を書いてください。' });
  const top = faces ? readFace(faces.top, null, 'top', issues) : null;
  if (faces && !top) issues.push({ message: '"faces" の "top"（上の面）は必ず書いてください。' });
  const side = faces && top ? readFace(faces.side, top, 'side', issues) : null;
  const bottom = faces && side ? readFace(faces.bottom, side, 'bottom', issues) : null;
  if (issues.length || !top || !side || !bottom) return { ok: false, issues };
  // 合計 1・0.05 刻み（いちばん大きい素材で端数を合わせる）
  const norm: Partial<Record<MatId, number>> = {};
  for (const k of MAT_IDS) if (mats[k]) norm[k] = Math.round((mats[k]! / sum) * 20) / 20;
  const big = MAT_IDS.reduce((a, b) => ((norm[b] ?? 0) > (norm[a] ?? 0) ? b : a));
  const rest = MAT_IDS.filter((k) => k !== big).reduce((a, k) => a + (norm[k] ?? 0), 0);
  norm[big] = Math.round((1 - rest) * 20) / 20;
  for (const k of MAT_IDS) if (!norm[k]) delete norm[k];
  return { ok: true, look: { name, mats: norm, top, side, bottom } };
}

/** 保存データから読む（形が崩れていれば null） */
export function sanitizeMyBlock(v: unknown): MyBlockDef | null {
  if (!isObj(v) || typeof v.id !== 'number' || !isMyBlock(v.id)) return null;
  const r = parseMyBlock(JSON.stringify({ name: v.name, materials: v.mats, faces: { top: v.top, side: v.side, bottom: v.bottom } }));
  return r.ok ? { id: v.id, ...r.look } : null;
}

/** 同じ見た目・同じ割合か（同じものを 2 つ棚に入れないように） */
export const sameLook = (a: MyBlockLook, b: MyBlockLook) => JSON.stringify([a.mats, a.top, a.side, a.bottom]) === JSON.stringify([b.mats, b.top, b.side, b.bottom]);

/** 空いている番号（無ければ null） */
export function freeMyBlockId(used: Iterable<number>): number | null {
  const s = new Set(used);
  for (let i = MYBLOCK_BASE; i < MYBLOCK_BASE + MYBLOCK_MAX; i++) if (!s.has(i)) return i;
  return null;
}

/**
 * AI に渡す説明文（英語。利用者が書く「作ってほしいもの」だけ日本語のまま）。
 * 模様・素材の一覧は、検査と同じ定数から書き出す
 */
export function buildMyBlockPrompt(idea: string): string {
  const pats = PATTERNS.map((p) => `   * ${p}: ${PATTERN_EN[p]}`).join('\n');
  return `You are an assistant that designs blocks for a voxel diorama game. Design ONE 1 x 1 x 1 block (a cube) and output it as JSON.
## What to make (it may be written in Japanese)
${idea.trim()}
## Specification (must follow)

* The block is always a plain cube. Only the colors and patterns of its faces can be chosen: "top", "side" (all four sides) and "bottom"
* Each face: "base" (main color) and "accent" (second color), both "#rrggbb", and "pattern", one of:
${pats}
* "materials": what the block is made of, as fractions that add up to 1, using only these keys: ${MAT_IDS.join(', ')}
   * wood: wood, logs, planks / fiber: leaves, straw, reeds, flowers, cloth / stone: rock, cobblestone, slate / mineral: sand, glass, iron, shells / soil: earth, clay, mud, brick
* "name": a short name for the block (in Japanese if the request is in Japanese)

## Example
{
  "name": "苔むした石",
  "materials": { "stone": 0.8, "fiber": 0.2 },
  "faces": {
    "top": { "base": "#6f8f4a", "accent": "#4e6e34", "pattern": "speckle" },
    "side": { "base": "#8a9098", "accent": "#6f8f4a", "pattern": "speckle" },
    "bottom": { "base": "#7f858c", "accent": "#6a7078", "pattern": "plain" }
  }
}

## Output

* Output only the JSON, in a single code block. Do not write comments.`;
}
