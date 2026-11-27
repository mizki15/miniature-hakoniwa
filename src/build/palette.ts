/**
 * 建物の色。建物の JSON では、グループ（ボーン）の名前でこの色を選ぶ。
 * 色は sRGB の 16 進で持ち、表示する時にリニアに直す（world/blocks.ts の hexToLinear）。
 */
/** use：用途（日本語）、en：AI に渡す説明文で使う用途（英語） */
export const PALETTE: readonly { name: string; hex: number; use: string; en: string }[] = [
  { name: 'wall', hex: 0xa07a4e, use: '木の壁', en: 'wooden wall' },
  { name: 'wood', hex: 0x6e4c2e, use: '柱・扉・濃い木', en: 'posts, doors, dark wood' },
  { name: 'plank', hex: 0xc8a070, use: '明るい木', en: 'light wood' },
  { name: 'roof', hex: 0xc8403c, use: '赤い屋根', en: 'red roof' },
  { name: 'roof_blue', hex: 0x4a6a9a, use: '青い屋根', en: 'blue roof' },
  { name: 'thatch', hex: 0xc9a85a, use: 'かやぶき・わら', en: 'thatch, straw' },
  { name: 'stone', hex: 0x9298a0, use: '石・土台', en: 'stone, foundation' },
  { name: 'brick', hex: 0xa85a44, use: 'れんが', en: 'brick' },
  { name: 'white', hex: 0xf6f2ea, use: 'しっくい・窓・白', en: 'plaster, windows, white' },
  { name: 'glass', hex: 0xbfd8e0, use: 'ガラス', en: 'glass' },
  { name: 'dark', hex: 0x3a3a40, use: '鉄・影', en: 'iron, shadows' },
  { name: 'leaf', hex: 0x4f9a3c, use: '植え込み・つた', en: 'hedges, ivy' },
  { name: 'flower', hex: 0xf2c94c, use: '花・飾り', en: 'flowers, ornaments' },
];

/**
 * 素材の自然度（1 人の手〜5 自然。設計メモ 7 章）。建物の性格の「自然」に効く
 */
export const NATURALNESS: Record<string, number> = {
  wall: 4, plank: 4, wood: 4, thatch: 5, leaf: 5, flower: 5,
  stone: 3, roof_blue: 3, roof: 2, brick: 2, white: 2, glass: 1, dark: 1,
};

/** 名前の長い順（roof_blue を roof より先に照らし合わせるため） */
const BY_LENGTH = [...PALETTE].sort((a, b) => b.name.length - a.name.length);

/** パレットの名前 → 色 */
export const paletteHex = (name: string) => PALETTE.find((p) => p.name === name)?.hex;

/** パレットの名前か（保存データなど、外から来た色の名前を確かめる） */
export const isPaletteName = (name: unknown): name is string => typeof name === 'string' && PALETTE.some((p) => p.name === name);

/**
 * グループの名前から色を決める。名前がパレットの名前そのものか、「パレットの名前_何か」ならその色。
 * 大文字小文字は区別しない。名前は NFKC で正規化し（全角の ｇｌａｓｓ は glass になる）、
 * それでも英数字と _ 以外が残る名前（キリル文字の о を混ぜたものなど）は一致させない（設計メモ 8 章）。決まらなければ null
 */
export function colorOfName(boneName: string): string | null {
  const n = boneName.normalize('NFKC').toLowerCase();
  if (!/^[a-z0-9_]+$/.test(n)) return null;
  for (const p of BY_LENGTH) if (n === p.name || n.startsWith(p.name + '_')) return p.name;
  return null;
}

// ---------------------------------------------------------------- 素材 5 つと、自由な色（v0.20）

/** 素材（v0.20。原料と 13 色の素材をやめて 5 つに）：木材・繊維・石材・鉱物・土 */
export type MatId = 'wood' | 'fiber' | 'stone' | 'mineral' | 'soil';
export const MAT_IDS: MatId[] = ['wood', 'fiber', 'stone', 'mineral', 'soil'];
export const isMatId = (v: unknown): v is MatId => typeof v === 'string' && (MAT_IDS as string[]).includes(v);
/** 名前だけで色を書かなかった時の色 */
export const MAT_DEFAULT_HEX: Record<MatId, number> = { wood: 0xa07a4e, fiber: 0xc9a85a, stone: 0x9298a0, mineral: 0xf6f2ea, soil: 0xa85a44 };
/** 素材の自然度（建物の性格の「自然」。1 人の手〜5 自然） */
export const MAT_NATURE: Record<MatId, number> = { wood: 4, fiber: 5, stone: 3, soil: 2, mineral: 1 };
/** v0.19 までのパレットの名前 → 素材（古い建物・AI が昔の名前で書いた建物も読めるように） */
export const LEGACY_MAT: Record<string, MatId> = {
  wall: 'wood', wood: 'wood', plank: 'wood', thatch: 'fiber', leaf: 'fiber', flower: 'fiber',
  stone: 'stone', roof_blue: 'stone', roof: 'soil', brick: 'soil', white: 'mineral', glass: 'mineral', dark: 'mineral',
};

/** 直方体の色と素材。color はパレットの名前（古い形）か "#rrggbb"。glass：窓（夜に光る・灯りの星に数える） */
export interface CubeColor { color: string; mat: MatId; glass?: true }

/**
 * グループの名前から色と素材を決める（v0.20）。決まらなければ null。
 *   「素材_rrggbb」「素材_rrggbb_何か」：その素材で、その色（例 wood_8a5a3c_door、stone_6f7780）
 *   「素材」「素材_何か」：その素材の、いつもの色（例 fiber_roof）
 *   昔のパレットの名前（wall・roof・glass など）：その色と、決まった素材（LEGACY_MAT）
 *   名前のどこかに glass という区切りがあれば窓（例 mineral_bfd8e0_glass）
 */
export function parseColorName(boneName: string): CubeColor | null {
  const n = boneName.normalize('NFKC').toLowerCase();
  if (!/^[a-z0-9_]+$/.test(n)) return null;
  const parts = n.split('_');
  const glass = parts.includes('glass') ? { glass: true as const } : {};
  const m = /^(wood|fiber|stone|mineral|soil)_([0-9a-f]{6})(_|$)/.exec(n);
  if (m) return { color: `#${m[2]}`, mat: m[1] as MatId, ...glass };
  const legacy = colorOfName(n);
  if (legacy) return { color: legacy, mat: LEGACY_MAT[legacy], ...(legacy === 'glass' ? { glass: true as const } : glass) };
  if (isMatId(parts[0])) return { color: `#${MAT_DEFAULT_HEX[parts[0]].toString(16).padStart(6, '0')}`, mat: parts[0], ...glass };
  return null;
}

/** 色として読めるか（パレットの名前か "#rrggbb"） */
export const isCubeColor = (c: unknown): c is string => isPaletteName(c) || (typeof c === 'string' && /^#[0-9a-f]{6}$/.test(c));
/** 直方体の色（16 進の数） */
export const cubeHex = (c: { color: string }) => (c.color.startsWith('#') ? parseInt(c.color.slice(1), 16) : paletteHex(c.color) ?? 0xff00ff);
/** 直方体の素材（古い建物はパレットの名前から） */
export const cubeMat = (c: { color: string; mat?: MatId }): MatId => c.mat ?? LEGACY_MAT[c.color] ?? 'wood';
/** 窓か */
export const cubeGlass = (c: { color: string; glass?: boolean }) => c.glass === true || c.color === 'glass';
