/**
 * 全世界共通の季節暦。
 * 基準日（仮：2027-01-01 UTC ＝ 春の始まり）からの経過月数で季節を決める。
 * 現実の 1 か月 ＝ 1 季節。月の最後の 3 日間で次の季節へ徐々に移る。
 */
export const SEASON_NAMES = ['春', '夏', '秋', '冬'] as const;
const EPOCH_YEAR = 2027;

export interface SeasonState {
  season: number; // 0..3
  next: number;
  blend: number; // 0..1（次の季節への移り具合）
}

export function seasonAt(date: Date): SeasonState {
  const months = (date.getUTCFullYear() - EPOCH_YEAR) * 12 + date.getUTCMonth();
  const season = ((months % 4) + 4) % 4;
  const daysInMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  const day = date.getUTCDate() - 1 + date.getUTCHours() / 24;
  const blend = Math.min(1, Math.max(0, (day - (daysInMonth - 3)) / 3));
  return { season, next: (season + 1) % 4, blend };
}

/** 季節ごとの草（上面）と葉の色 */
export const SEASON_COLORS: { grass: number; leaf: number }[] = [
  { grass: 0x8fd15a, leaf: 0x86c95a }, // 春
  { grass: 0x5fae3a, leaf: 0x3d8a30 }, // 夏
  { grass: 0xb8a64c, leaf: 0xd9772e }, // 秋
  { grass: 0xf0f4f7, leaf: 0xdfe9ee }, // 冬（雪）
];
