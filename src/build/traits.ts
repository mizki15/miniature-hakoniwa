/**
 * 棚に出す建物の性格の文（設計メモ 9 章）。three.js に頼らない。
 * 星は自然・灯り・大きさの 3 行。遠のく生き物は図鑑と連動し、まだ観察していない生き物は「？」。
 */
import type { BuildingCharacter } from './character';
import { buildingWildWeight, lightReach } from '../eco/environment';
import { starText } from '../eco/species';
import type { VisitorId } from '../eco/species';

export interface TraitRow { label: string; stars: string; note: string }
export interface Traits { rows: TraitRow[]; away: { id: VisitorId; why: string }[] }

const r1 = (v: number) => Math.round(v * 10) / 10;

export function buildingTraits(c: BuildingCharacter): Traits {
  const rows: TraitRow[] = [
    { label: '自然', stars: starText(c.nature), note: c.nature >= 4 ? '野生の訪問者向き' : c.nature <= 2 ? '人の手：野生度を下げやすい' : '人の手と自然のあいだ' },
    { label: '灯り', stars: c.light ? starText(c.light) : 'なし', note: c.light ? `夜に窓が光る（まわり ${lightReach(c.light)} マス）` : '窓（ガラス）がない' },
    { label: '大きさ', stars: starText(c.size), note: `足元 ${c.footprint} マス・高さ ${r1(c.height)} マス` },
  ];
  const away: Traits['away'] = [];
  if (c.light > 0) away.push({ id: 'firefly', why: '灯りの近く' }, { id: 'owl', why: '灯りの近く' });
  // 足元の 6 割以上を野生度に数える建物（自然 ★3 以下）は、カワセミ・ホタルを遠ざけやすい
  if (buildingWildWeight(c.nature) >= 0.6) {
    for (const id of ['kingfisher', 'firefly'] as const) if (!away.some((a) => a.id === id)) away.push({ id, why: '野生度が下がる' });
  }
  return { rows, away };
}
