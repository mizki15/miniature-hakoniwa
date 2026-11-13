import type { SaveData } from '../save/format';
import { RARITY_POINTS, isVisitorId, rarityOf, type DexId } from './species';

/**
 * 図鑑の段階（設計書 2.5）と、観察で入る発見ポイント（3.1 のうち観察のぶん）。
 *   ？？？（まだ来ていない）→ 見かけた（箱庭に来た。名前はまだ出さない）→ 観察した（カーソルを 1.5 秒合わせた）
 */
export type Dex = SaveData['dex'];
export type DexStage = 'unknown' | 'seen' | 'observed';

export function dexStage(dex: Dex, id: DexId): DexStage {
  const e = dex[id];
  return !e ? 'unknown' : e.observedAt !== undefined ? 'observed' : 'seen';
}

/** 箱庭に来た（引っ越してきた）時に呼ぶ。初めてなら true */
export function markSeen(dex: Dex, id: DexId, now: number): boolean {
  if (dex[id]) return false;
  dex[id] = { seenAt: now, seasons: [] };
  return true;
}

/**
 * 観察した時に呼ぶ。入る発見ポイントを返す：
 * 初めて＝珍しさのポイント（ふつう 1・ややまれ 2・まれ 4。住人はふつう）、
 * 訪問者を新しい季節に観察＝1、それ以外＝0
 */
export function observe(dex: Dex, id: DexId, season: number, now: number): number {
  markSeen(dex, id, now);
  const e = dex[id];
  if (e.observedAt === undefined) {
    e.observedAt = now;
    e.seasons = [season];
    return RARITY_POINTS[rarityOf(id)];
  }
  if (e.seasons.includes(season)) return 0;
  e.seasons = [...e.seasons, season].sort((a, b) => a - b);
  return isVisitorId(id) ? 1 : 0;
}
