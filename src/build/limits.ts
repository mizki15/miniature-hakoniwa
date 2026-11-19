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
