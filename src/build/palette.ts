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

/** 名前の長い順（roof_blue を roof より先に照らし合わせるため） */
const BY_LENGTH = [...PALETTE].sort((a, b) => b.name.length - a.name.length);

/** パレットの名前 → 色 */
export const paletteHex = (name: string) => PALETTE.find((p) => p.name === name)?.hex;

/**
 * グループの名前から色を決める。名前がパレットの名前そのものか、「パレットの名前_何か」ならその色。
 * 大文字小文字は区別しない。決まらなければ null
 */
export function colorOfName(boneName: string): string | null {
  const n = boneName.toLowerCase();
  for (const p of BY_LENGTH) if (n === p.name || n.startsWith(p.name + '_')) return p.name;
  return null;
}
