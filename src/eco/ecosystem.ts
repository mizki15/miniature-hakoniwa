import type { Species } from '../creatures/animals';
import type { EnvCounts } from './environment';
import { RARITY_CHANCE, RESIDENT_ORDER, RESIDENT_RULES, VISITOR, VISITORS, type Moment, type VisitorId } from './species';

/**
 * 生き物の判定（設計書 2.2・2.4）：誰が来るか、誰が去るか、誰が引っ越してくるか。
 * 箱庭内の時計で約 5 分ごとに 1 回。three.js に依存しない。
 */
export const CHECK_SIM_MS = 5 * 60 * 1000;
export const MAX_VISITORS = 8;
export const MAX_PER_SPECIES = 4;
/** 訪問者の滞在：現実の時間で 20〜60 分 */
export const stayMs = (rand: () => number) => (20 + rand() * 40) * 60_000;
export const residentCap = (openPlots: number) => Math.min(24, openPlots * 3);

/** homeOk：訪問者のいる場所が、まだその生き物に合っているか（埋めた水・耕した花など。false なら去る） */
/** abundance：生き物の多さの倍率（デバッグ、1 が普通）。来る確率・訪問者と住人の上限・1 回に引っ越してくる数をこの倍にする */
export interface EcoState { visitors: { id: VisitorId; leavesAt: number; homeOk?: boolean }[]; residents: Species[]; openPlots: number; abundance?: number }

/** 読み込んだ住人が 1 匹もいない時（段階 ① の保存データには住人が無い）は、新しい箱庭と同じくうさぎを置く */
export const needsStarterRabbits = (restored: Species[]) => restored.length === 0;

export function checkEcosystem(s: EcoState, e: EnvCounts, m: Moment, nowReal: number, rand: () => number): { arrive: VisitorId[]; leave: VisitorId[]; moveIn: Species | null; moveIns: Species[] } {
  const k = Math.max(1, s.abundance ?? 1);
  // 去る：時間切れか、必要な環境が無くなったか、いる場所が合わなくなった
  const leave: VisitorId[] = [];
  const stay = new Set<VisitorId>();
  for (const v of s.visitors) {
    if (v.leavesAt <= nowReal || !VISITOR[v.id].needs(e) || v.homeOk === false) leave.push(v.id);
    else stay.add(v.id);
  }
  // 来る：いない種類ごとに抽選。合わせて 8 匹（× 倍率）まで
  const arrive: VisitorId[] = [];
  for (const def of VISITORS) {
    if (stay.size + arrive.length >= MAX_VISITORS * k) break;
    if (stay.has(def.id) || !def.needs(e) || !def.when(m)) continue;
    // カワセミは魚のいる時だけ（同じ判定で魚が来た時も含む）
    if (def.id === 'kingfisher' && !stay.has('fish') && !arrive.includes('fish')) continue;
    const chance = Math.min(1, RARITY_CHANCE[def.rarity] * (def.id === 'frog' && m.raining ? 2 : 1) * k);
    if (rand() < chance) arrive.push(def.id);
  }
  // 引っ越し：上限に達していなければ、条件を満たす種類を 1 つだけ（1 匹）。
  // いろいろな種類が来るよう、今いる数がいちばん少ない種類から（同じなら図鑑の順）
  // 倍率を上げると、上限も、1 回に引っ越してくる数（倍率の数まで）も増える
  const moveIns: Species[] = [];
  const all = [...s.residents];
  for (let round = 0; round < Math.floor(k) && all.length < residentCap(s.openPlots) * k; round++) {
    const count = (sp: Species) => all.filter((r) => r === sp).length;
    let best = Infinity, pick: Species | null = null;
    for (const sp of RESIDENT_ORDER) {
      const n = count(sp);
      if (RESIDENT_RULES[sp](e, m) && n < MAX_PER_SPECIES * k && n < best) { best = n; pick = sp; }
    }
    if (!pick) break;
    moveIns.push(pick);
    all.push(pick);
  }
  return { arrive, leave, moveIn: moveIns[0] ?? null, moveIns };
}

/** 判定する時か：箱庭内の時計で 5 分たち、現実の時間で前回から 1 秒以上（時計を速めても続けて判定しない） */
export function dueChecks(lastSim: number, nowSim: number, lastRealCheck: number, nowReal: number): boolean {
  return nowSim - lastSim >= CHECK_SIM_MS && nowReal - lastRealCheck >= 1000;
}
