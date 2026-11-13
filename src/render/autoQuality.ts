/**
 * 自動画質：fps の見本（0.5 秒ごとの値）から、画質を下げるかどうかを決める（下げるだけ。上げ下げを繰り返さない）。
 * 一瞬の引っかかり（シェーダーの準備など）に振り回されないよう、平均ではなく中央値で見る。
 */
export type Quality = 'high' | 'medium' | 'low';

/** これより遅ければ下げる */
export const TARGET_FPS = 40;
/** これより遅ければ「中」を飛ばして「低」へ（「中」は解像度が違うだけなので、等倍の画面ではほとんど軽くならない） */
export const VERY_SLOW_FPS = 25;
/** 1 回の判断に使う見本の数（0.5 秒ごと × 4 ＝ 2 秒） */
export const SAMPLES = 4;

export function nextQuality(q: Quality, samples: number[]): Quality | null {
  if (q === 'low' || samples.length === 0) return null;
  const s = [...samples].sort((a, b) => a - b);
  const median = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  if (median >= TARGET_FPS) return null;
  if (q === 'high' && median >= VERY_SLOW_FPS) return 'medium';
  return 'low';
}
