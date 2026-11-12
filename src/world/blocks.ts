export const AIR = 0;
export const GRASS = 1;
export const DIRT = 2;
export const STONE = 3;
export const SAND = 4;
export const WATER = 5;
export const LOG = 6;
export const LEAVES = 7;
export const CONIFER = 8;
export const STEM = 9;
export const PETAL_R = 10;
export const PETAL_Y = 11;
export const PETAL_W = 12;
export const FARMLAND = 13; // 耕した土（乾いている）
export const WET_FARMLAND = 14; // 耕した土（湿っている）
export const BLOCK_COUNT = 15;

export const isOpaque = (t: number) => t > 0 && t !== WATER;

/** 面の種類：0=上面, 1=下面, 2=側面 */
export type FaceKind = 0 | 1 | 2;

const hex = (h: number): [number, number, number] => {
  const c = [(h >> 16) & 255, (h >> 8) & 255, h & 255].map((v) => v / 255);
  // sRGB → リニア（three.js の頂点カラーはリニア前提）
  return c.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))) as [number, number, number];
};

/** ブロック種別 × 面の種類（上・下・側）ごとの色 */
const PALETTE: Record<number, [number, number, number][]> = {
  [GRASS]: [hex(0x7cbf4a), hex(0x8b6a46), hex(0x6a9e3e)],
  [DIRT]: [hex(0x8b6a46), hex(0x7d5f3f), hex(0x8b6a46)],
  [STONE]: [hex(0x9298a0), hex(0x7f858c), hex(0x8a9098)],
  [SAND]: [hex(0xe6d49c), hex(0xd8c58c), hex(0xdccb92)],
  [WATER]: [hex(0x3a7fa0), hex(0x3a7fa0), hex(0x3a7fa0)],
  [LOG]: [hex(0xa07a4e), hex(0xa07a4e), hex(0x6e4c2e)],
  [LEAVES]: [hex(0x4f9a3c), hex(0x3f8030), hex(0x4a9238)],
  [CONIFER]: [hex(0x2f6b3a), hex(0x24552e), hex(0x2c6436)],
  [STEM]: [hex(0x4f8a34), hex(0x4f8a34), hex(0x4f8a34)],
  [PETAL_R]: [hex(0xe0504a), hex(0xc8403c), hex(0xd84a44)],
  [PETAL_Y]: [hex(0xf2c94c), hex(0xd9b03c), hex(0xeac046)],
  [PETAL_W]: [hex(0xf6f2ea), hex(0xe2ddd2), hex(0xefeae0)],
  [FARMLAND]: [hex(0x9a7448), hex(0x7d5f3f), hex(0x8b6a46)],
  [WET_FARMLAND]: [hex(0x5e4329), hex(0x7d5f3f), hex(0x6e5136)],
};

export function faceColor(t: number, kind: FaceKind): [number, number, number] {
  return PALETTE[t]?.[kind] ?? [1, 0, 1];
}

/** シェーダー用：index = type*3 + kind の色の配列 */
export function paletteFlat(): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let t = 0; t < BLOCK_COUNT; t++) for (let k = 0; k < 3; k++) out.push(PALETTE[t]?.[k] ?? [0, 0, 0]);
  return out;
}

/** 季節で色を変える対象：0=なし, 1=草の上面, 2=広葉樹の葉, 3=針葉樹の上面（冬に雪が積もる） */
export function vegKind(t: number, kind: FaceKind): number {
  if (t === GRASS && kind === 0) return 1;
  if (t === LEAVES) return 2;
  if (t === CONIFER && kind === 0) return 3;
  return 0;
}
