/**
 * 建物 1 棟の上限。単位：widthUnits・heightUnits・groundTolerance は Blockbench の単位（16 = ボクセル 1 個）。
 * AI に渡す説明文（aiPrompt.ts）もこの値から書き出す
 */
export const LIMITS = {
  fileBytes: 65536,
  cubes: 512,
  bones: 128,
  depth: 16,
  widthUnits: 192,
  heightUnits: 320,
  groundTolerance: 0.5,
} as const;

/** Blockbench の単位 → ボクセル */
export const UNITS_PER_VOXEL = 16;

/** 上限の形（建物とマイブロックで使い分ける） */
export type Limits = { readonly [K in keyof typeof LIMITS]: number } & { readonly centered?: boolean };

/**
 * マイブロック（v0.20.6）の上限：1 × 1 × 1（16 単位）の中。立方体である必要は無い（机・つぼ・柵なども）。
 * centered：横と奥は x = 0・z = 0 を中心に ±8 単位の中（となりのマスにはみ出さない）
 */
export const BLOCK_LIMITS: Limits = { fileBytes: 32768, cubes: 96, bones: 48, depth: 8, widthUnits: 16, heightUnits: 16, groundTolerance: 0.5, centered: true };
