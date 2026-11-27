import type { Species } from '../creatures/animals';
import type { CropKind } from '../game/farm';
import { CROPS, CROP_KINDS } from '../game/farm';
import type { MatId } from '../game/materials';
import { LAND_NAMES, sharePct, type EnvCounts, type Land } from './environment';
import { scarceMats } from './residents';
import {
  RESIDENT_NEEDS, RESIDENT_ORDER, RESIDENT_TEXT, RESIDENT_WHEN, SHARE_STAR_MIN, VISITOR, VISITORS,
  shareStars, starText, visitorLikes, type DexId, type Needs, type VisitorId,
} from './species';
import type { Dex } from './dexState';

/**
 * 季節の目標（v0.17。設計メモ 11 章）。three.js に依存しない。
 * - 1 季節（暦の 1 か月）に、箱庭ごとに 3 つ：簡単・ふつう・難しい。季節が変わると、終わらなかった目標は静かに消える
 * - 達成はゲームが自動で判定する。ほうびは発見ポイント（10・20・40）と素材。難しいものには季節の記念の飾り
 * - 始めたばかりの箱庭の最初の 3 つは、操作を覚える目標
 */
export type Tier = 0 | 1 | 2;
export const TIER_NAMES = ['簡単', 'ふつう', '難しい'] as const;
export const TIER_POINTS = [10, 20, 40] as const;
/** ほうびの素材の数（鉱物は半分） */
export const TIER_RAWS = [3, 5, 8] as const;
/** 「まれ」の生き物の目標がある間、その生き物の来る確率にかける倍率 */
export const GOAL_BOOST = 3;

/** 目標の型（3 つが重ならないように選ぶ） */
export type GoalType = 'observe' | 'resident' | 'land' | 'harvest' | 'build' | 'combo' | 'count' | 'snow' | 'tutorial';

/** 達成の条件。すべてそろった時に達成 */
export type Cond =
  /** この季節に観察する（any：どれか 1 つでよい） */
  | { k: 'see'; ids: DexId[]; any?: boolean }
  /** 同じ日（朝 5 時から翌朝 5 時まで）に、全部観察する */
  | { k: 'sameDay'; ids: VisitorId[] }
  /** この季節に、訪問者を n 種類観察する */
  | { k: 'seeCount'; n: number }
  /** 雪の日に、家で暖まっている住人を観察する */
  | { k: 'warm' }
  /** 土地の割合（%） */
  | { k: 'land'; land: Land; min?: number; max?: number }
  /** その種類の住人がいる */
  | { k: 'resident'; sp: Species }
  /** この季節に収穫した数（crop が無ければ何でも） */
  | { k: 'harvest'; crop?: CropKind; n: number }
  /** この季節に建ち終わった家（飾りは除く。any なら飾りも）の数。nature：自然の星の下限、straw：わらを使っている */
  | { k: 'build'; n: number; nature?: number; straw?: boolean; any?: boolean }
  /** 畑を耕した・花を植えた（始めたばかりの箱庭） */
  | { k: 'till' } | { k: 'flower' };

export interface Goal { id: string; tier: Tier; type: GoalType; conds: Cond[]; /** 達成した現実の時刻 */ done?: number }

/** この季節にしたこと（目標の判定に使う。季節が変わると空にする） */
export interface GoalLog {
  /** 観察した生き物（この季節） */
  seen: string[];
  /** 今日（朝 5 時区切りの日の番号）に観察した生き物と、同じ日にそろった組（ids を + でつないだもの） */
  day: number; dayIds: string[]; pairs: string[];
  harvest: Record<string, number>;
  /** 建ち終わった建物（記念の飾りは数えない） */
  builds: { nature: number; straw: boolean; deco?: boolean }[];
  warm: boolean; till: boolean; flower: boolean;
}

export interface GoalsState { key: number; goals: Goal[]; log: GoalLog; /** 前の季節の目標（同じものを続けて出さない） */ prev: string[] }

export const emptyLog = (): GoalLog => ({ seen: [], day: 0, dayIds: [], pairs: [], harvest: {}, builds: [], warm: false, till: false, flower: false });

/** 暦の月の番号（2027 年 1 月 ＝ 0）。季節の目標はこの番号ごと */
export const seasonKey = (d: Date) => (d.getUTCFullYear() - 2027) * 12 + d.getUTCMonth();
export const seasonOfKey = (key: number) => ((key % 4) + 4) % 4;
/** 朝 5 時区切りの日の番号（端末の時計。夜の 19 時〜翌 5 時が同じ日になる） */
export const dayNumber = (ms: number, tzOffsetMin = new Date(ms).getTimezoneOffset()) => Math.floor((ms - tzOffsetMin * 60_000 - 5 * 3600_000) / 86_400_000);

/** 判定に使う箱庭の様子 */
export interface GoalCtx { env: EnvCounts; residents: readonly Species[] }

// ---------------------------------------------------------------- 文

const dexName = (id: DexId) => (id in VISITOR ? VISITOR[id as VisitorId].name : SPECIES_NAME[id as Species] ?? id);
/** 住人の名前（animals.ts は three.js に依存するので、ここに持つ） */
export const SPECIES_NAME: Record<Species, string> = {
  rabbit: 'うさぎ', tanuki: 'たぬき', fox: 'きつね', deer: 'しか', duck: 'あひる', squirrel: 'りす', hedgehog: 'はりねずみ',
  sheep: 'ひつじ', bear: 'くま', otter: 'カワウソ', mole: 'モグラ', serow: 'カモシカ', stoat: 'オコジョ', beaver: 'ビーバー', capybara: 'カピバラ', cat: 'ねこ',
};
const landPct = (l: Land, n: number) => `${LAND_NAMES[l]}を ${starText(Math.max(1, shareStars(n)))}（${n}%）`;

/**
 * 目標の文。known：観察したことのある生き物（まだの生き物は「？？？」。名前で答えが分からないように）
 */
export function goalText(g: Goal, known: (id: DexId) => boolean): string {
  const nm = (id: DexId) => (known(id) ? dexName(id) : '？？？');
  const parts: string[] = [];
  for (const c of g.conds) {
    switch (c.k) {
      case 'see': parts.push(`${c.ids.map(nm).join(c.any ? 'か' : 'と')}を観察する`); break;
      case 'sameDay': parts.push(`${c.ids.map(nm).join('と')}を、同じ日に観察する`); break;
      case 'seeCount': parts.push(`訪問者を ${c.n} 種類観察する`); break;
      case 'warm': parts.push('雪の日に、住人が家で暖まる様子を見る'); break;
      case 'land':
        if (c.min !== undefined) parts.push(`${landPct(c.land, c.min)}以上にする`);
        if (c.max !== undefined) parts.push(`${LAND_NAMES[c.land]}を ${starText(shareStars(c.max))}（${c.max}%）以下にする`);
        break;
      case 'resident': parts.push(`${nm(c.sp)}に引っ越してきてもらう`); break;
      case 'harvest': parts.push(c.crop ? `旬の${CROPS[c.crop].name}を ${c.n} 個収穫する` : c.n === 1 ? '畑を耕して、何か 1 つ収穫する' : `作物を ${c.n} 個収穫する`); break;
      case 'build':
        parts.push(c.straw ? `わら（繊維）を使った、自然 ${starText(c.nature ?? 1)} 以上の家を建てる`
          : c.nature ? `自然 ${starText(c.nature)} 以上の家を建てる` : c.n === 1 ? '建物を 1 つ読み込んで建てる' : `家を ${c.n} 棟建てる`);
        break;
      case 'till': parts.push('畑を耕す'); break;
      case 'flower': parts.push('花を植える'); break;
    }
  }
  // 「〇〇を ★ 以上にして、△△を観察する」のように、景色の条件を先に
  return parts.join('・').replace(/にする・/g, 'にして、').replace(/植える・/g, '植えて、').replace(/を観察する・/g, 'を観察し、');
}

/** 目標のヒント（図鑑と同じ。観察した生き物は好きな環境を星で） */
export function goalHint(g: Goal, known: (id: DexId) => boolean): string {
  const out: string[] = [];
  for (const c of g.conds) {
    const ids = c.k === 'see' || c.k === 'sameDay' ? c.ids : c.k === 'resident' ? [c.sp] : [];
    for (const id of ids) {
      if (id in VISITOR) { const v = VISITOR[id as VisitorId]; out.push(known(id) ? `${v.name}：${visitorLikes(v)}` : v.hint); }
      else out.push(RESIDENT_TEXT[id as Species].hint);
    }
    if (c.k === 'warm') out.push('雪の日は冬の各週に 1 日ずつある。家のそばにいる住人が、家に寄り添って暖まるらしい');
    if (c.k === 'seeCount') out.push('来ている訪問者にカーソルを合わせると観察できる。新しい季節に観察し直した生き物も数える');
  }
  return out.join('／');
}

// ---------------------------------------------------------------- 判定

const has = (a: readonly string[], ids: readonly string[], any?: boolean) => (any ? ids.some((i) => a.includes(i)) : ids.every((i) => a.includes(i)));
export const pairKey = (ids: readonly string[]) => [...ids].sort().join('+');

export function condMet(c: Cond, log: GoalLog, ctx: GoalCtx): boolean {
  switch (c.k) {
    case 'see': return has(log.seen, c.ids, c.any);
    case 'sameDay': return log.pairs.includes(pairKey(c.ids));
    case 'seeCount': return log.seen.filter((id) => id in VISITOR).length >= c.n;
    case 'warm': return log.warm;
    case 'land': {
      const p = sharePct(ctx.env, c.land);
      return (c.min === undefined || p + 1e-9 >= c.min) && (c.max === undefined || p <= c.max + 1e-9);
    }
    case 'resident': return ctx.residents.includes(c.sp);
    case 'harvest': return (c.crop ? log.harvest[c.crop] ?? 0 : Object.values(log.harvest).reduce((a, b) => a + b, 0)) >= c.n;
    case 'build': return log.builds.filter((b) => (c.any || !b.deco) && (c.nature === undefined || b.nature >= c.nature) && (!c.straw || b.straw)).length >= c.n;
    case 'till': return log.till;
    case 'flower': return log.flower;
  }
}

/** 進み具合の文（数える条件だけ。例：「3 / 10」） */
export function condProgress(c: Cond, log: GoalLog, ctx: GoalCtx): string | null {
  switch (c.k) {
    case 'harvest': return `${Math.min(c.n, c.crop ? log.harvest[c.crop] ?? 0 : Object.values(log.harvest).reduce((a, b) => a + b, 0))} / ${c.n}`;
    case 'build': return c.n > 1 ? `${Math.min(c.n, log.builds.filter((b) => c.any || !b.deco).length)} / ${c.n}` : null;
    case 'seeCount': return `${Math.min(c.n, log.seen.filter((id) => id in VISITOR).length)} / ${c.n}`;
    case 'see': return c.ids.length > 1 && !c.any ? `${c.ids.filter((i) => log.seen.includes(i)).length} / ${c.ids.length}` : null;
    case 'land': return `いま ${starText(shareStars(sharePct(ctx.env, c.land)))}（${Math.round(sharePct(ctx.env, c.land))}%）`;
    default: return null;
  }
}

export const goalMet = (g: Goal, log: GoalLog, ctx: GoalCtx) => g.conds.every((c) => condMet(c, log, ctx));

/** まだ達成していない目標のうち、いま達成したもの（done を付けて返す） */
export function checkGoals(s: GoalsState, ctx: GoalCtx, now: number): Goal[] {
  const out: Goal[] = [];
  for (const g of s.goals) if (!g.done && goalMet(g, s.log, ctx)) { g.done = now; out.push(g); }
  return out;
}

/** 観察した（カーソルを 1.5 秒合わせた）。warm：家で暖まっている住人だった */
export function logLook(log: GoalLog, id: DexId, warm: boolean, now: number, tz?: number) {
  if (!log.seen.includes(id)) log.seen.push(id);
  if (warm) log.warm = true;
  const day = dayNumber(now, tz);
  if (log.day !== day) { log.day = day; log.dayIds = []; }
  if (!log.dayIds.includes(id)) log.dayIds.push(id);
}

/** 同じ日の組がそろったかを、目標の組について確かめる（logLook の後に呼ぶ） */
export function updatePairs(s: GoalsState) {
  for (const g of s.goals) for (const c of g.conds) {
    if (c.k !== 'sameDay') continue;
    const key = pairKey(c.ids);
    if (!s.log.pairs.includes(key) && c.ids.every((i) => s.log.dayIds.includes(i))) s.log.pairs.push(key);
  }
}

/** 来る確率を上げる生き物：まだ達成していない目標にある「まれ」の訪問者 */
export function boostedVisitors(s: GoalsState | null): Set<VisitorId> {
  const out = new Set<VisitorId>();
  for (const g of s?.goals ?? []) {
    if (g.done) continue;
    for (const c of g.conds) if (c.k === 'see' || c.k === 'sameDay') for (const id of c.ids) if (id in VISITOR && VISITOR[id as VisitorId].rarity === 'rare') out.add(id as VisitorId);
  }
  return out;
}

// ---------------------------------------------------------------- ほうび

/** 手に入りにくい素材：その箱庭でとりにくいもの。全部とれるなら、出る土地（森・岩場と砂浜・岩場と水辺）がいちばん少ない素材 */
export function rewardMat(e: EnvCounts, rand: () => number): MatId {
  const miss = scarceMats(e);
  if (miss.length) return miss[Math.floor(rand() * miss.length)];
  const scarce: [number, MatId][] = [[e.forest, 'wood'], [e.rock + e.beach, 'mineral'], [e.rock + e.waterside, 'stone']];
  scarce.sort((a, b) => a[0] - b[0]);
  return scarce[0][1];
}
export function goalReward(g: Goal, e: EnvCounts, rand: () => number): { points: number; mat: MatId; n: number; memento: boolean } {
  const mat = rewardMat(e, rand);
  const n = mat === 'mineral' ? Math.ceil(TIER_RAWS[g.tier] / 2) : TIER_RAWS[g.tier];
  return { points: TIER_POINTS[g.tier], mat, n, memento: g.tier === 2 };
}

// ---------------------------------------------------------------- 選び方

/** 湿地・砂浜・岩場は作れない（区画のシード次第）。今の土地に無ければ、その土地が要る目標は出さない */
const SPECIAL: Land[] = ['rock', 'wetland', 'beach'];
export function reachable(n: Needs, e: EnvCounts): boolean {
  for (const l of n.land ?? []) {
    if (!l.min || !l.lands.every((k) => SPECIAL.includes(k) || k === 'deepWater')) continue;
    if (l.lands.reduce((a, k) => a + e[k], 0) <= 0) return false;
  }
  if (n.deep && e.deepWater <= 0) return false;
  if (n.high && e.high <= 0) return false;
  return true;
}

/** その季節のどこかの時刻・天気で来られるか */
export function visitsIn(id: VisitorId, season: number): boolean {
  const v = VISITOR[id];
  for (const p of [0.1, 0.4, 0.8]) for (let h = 0; h < 24; h++) for (const raining of [false, true]) if (v.when({ season, seasonProgress: p, hour: h + 0.5, raining })) return true;
  return false;
}
/** 2 種類を同じ日にそろえられるか：両方の割合の下限の合計が 100% 以下で、同じ土地の下限と上限が食い違わない */
export function compatible(a: Needs, b: Needs): boolean {
  const ls = [...(a.land ?? []), ...(b.land ?? [])];
  if (ls.reduce((s, l) => s + (l.min ?? 0), 0) > 90) return false;
  for (const x of ls) for (const y of ls) {
    if (x.min === undefined || y.max === undefined) continue;
    if (x.lands.some((k) => y.lands.includes(k)) && x.min > y.max) return false;
    // 暗い森・暗い水辺は森・水辺の一部
    if (x.lands.includes('darkForest') && y.lands.includes('forest') && x.min > y.max) return false;
  }
  if (a.wild?.min !== undefined && b.wild?.max !== undefined && a.wild.min > b.wild.max) return false;
  if (b.wild?.min !== undefined && a.wild?.max !== undefined && b.wild.min > a.wild.max) return false;
  return true;
}

/** 旬の作物を何個収穫するか（育つのが早いものほど多く） */
const HARVEST_N: Record<CropKind, number> = { turnip: 5, carrot: 5, strawberry: 6, cabbage: 4, wheat: 10, tomato: 6, eggplant: 5, sunflower: 4, corn: 4, pumpkin: 3 };
interface Cand extends Goal { w: number }

/** 選ぶ時の材料 */
export interface GenCtx { season: number; env: EnvCounts; residents: readonly Species[]; dex: Dex; prev: readonly string[] }

/** 候補をすべて挙げる（重み付き） */
export function goalCandidates(c: GenCtx): Cand[] {
  const out: Cand[] = [];
  const { season: s, env: e, dex } = c;
  /** まだ観察していない生き物を優先し、次に、この季節にまだ観察していない生き物 */
  const fresh = (id: DexId) => (dex[id]?.observedAt === undefined ? 3 : dex[id].seasons.includes(s) ? 0.4 : 1.5);
  const visitors = VISITORS.filter((v) => visitsIn(v.id, s) && reachable(v.need, e));
  // 観察する：珍しさで難度が決まる
  for (const v of visitors) {
    const tier: Tier = v.rarity === 'common' ? 0 : v.rarity === 'uncommon' ? 1 : 2;
    out.push({ id: `see:${v.id}`, tier, type: 'observe', conds: [{ k: 'see', ids: [v.id] }], w: fresh(v.id) });
  }
  // 組み合わせる（難しい）：同じ日に 2 種類
  for (let i = 0; i < visitors.length; i++) for (let j = i + 1; j < visitors.length; j++) {
    const a = visitors[i], b = visitors[j];
    if (a.id === 'kingfisher' || b.id === 'kingfisher' || a.rarity === 'rare' && b.rarity === 'rare') continue;
    if (a.rarity === 'common' && b.rarity === 'common') continue;
    if (!compatible(a.need, b.need)) continue;
    out.push({ id: `pair:${pairKey([a.id, b.id])}`, tier: 2, type: 'combo', conds: [{ k: 'sameDay', ids: [a.id, b.id] }], w: (fresh(a.id) + fresh(b.id)) / 4 });
  }
  // 住んでもらう：まだいない種類。ふつうの土地だけで来るならふつう、湿地・岩場・深い水・家などが要るなら難しい
  for (const sp of RESIDENT_ORDER) {
    if (sp === 'rabbit' || c.residents.includes(sp)) continue;
    const when = RESIDENT_WHEN[sp];
    if (when && !when.when({ season: s, seasonProgress: 0.5, hour: 12, raining: false })) continue;
    const n = RESIDENT_NEEDS[sp];
    if (!reachable(n, e)) continue;
    const plain = !n.deep && !n.high && n.houses === undefined && !n.wild && (n.land ?? []).every((l) => l.lands.every((k) => !SPECIAL.includes(k)));
    out.push({ id: `res:${sp}`, tier: plain || when ? 1 : 2, type: 'resident', conds: [{ k: 'resident', sp }], w: when ? 4 : dex[sp] ? 0.8 : 1.5 });
  }
  // 景色をつくる：森・草原・花畑を、次の星まで
  for (const land of ['forest', 'meadow', 'flowerField'] as Land[]) {
    const cur = sharePct(e, land);
    const t = SHARE_STAR_MIN.find((x) => x > cur + 1);
    if (t === undefined) continue;
    out.push({ id: `land:${land}:${t}`, tier: t - cur <= 6 ? 0 : 1, type: 'land', conds: [{ k: 'land', land, min: t }], w: 1 });
  }
  // 育てる・収穫する：旬の作物（冬は無し）
  for (const crop of CROP_KINDS) {
    if (!CROPS[crop].seasons.includes(s)) continue;
    out.push({ id: `harvest:${crop}`, tier: 0, type: 'harvest', conds: [{ k: 'harvest', crop, n: HARVEST_N[crop] }], w: 1 });
  }
  // 建てる（ふつう）
  out.push({ id: 'build:nature4', tier: 1, type: 'build', conds: [{ k: 'build', n: 1, nature: 4 }], w: 1 });
  if (s === 2) out.push({ id: 'build:straw4', tier: 1, type: 'build', conds: [{ k: 'build', n: 1, nature: 4, straw: true }], w: 2 });
  out.push(e.darkWaterside > 0 && s === 1
    ? { id: 'build:2dark', tier: 1, type: 'build', conds: [{ k: 'land', land: 'darkWaterside', min: 5 }, { k: 'build', n: 2 }], w: 2 }
    : { id: 'build:2', tier: 1, type: 'build', conds: [{ k: 'build', n: 2 }], w: 1 });
  // 数える（どの季節にも出せる控え）
  out.push({ id: 'count:2', tier: 0, type: 'count', conds: [{ k: 'seeCount', n: 2 }], w: 0.3 });
  out.push({ id: 'count:4', tier: 1, type: 'count', conds: [{ k: 'seeCount', n: 4 }], w: 0.3 });
  out.push({ id: 'count:6', tier: 2, type: 'count', conds: [{ k: 'seeCount', n: 6 }], w: 0.3 });
  // 冬の簡単：雪の日に、住人が家で暖まる様子を見る（冬でも箱庭を開く理由）
  if (s === 3) out.push({ id: 'snow:warm', tier: 0, type: 'snow', conds: [{ k: 'warm' }], w: 6 });
  return out;
}

const pickWeighted = <T extends { w: number }>(a: T[], rand: () => number): T | null => {
  const total = a.reduce((s, x) => s + x.w, 0);
  if (total <= 0) return a[0] ?? null;
  let r = rand() * total;
  for (const x of a) { r -= x.w; if (r <= 0) return x; }
  return a[a.length - 1] ?? null;
};

/** 3 つ選ぶ：難度ごとに 1 つ。型が重ならず、前の季節と同じ目標は出さない（足りなければゆるめる） */
export function generateGoals(c: GenCtx, rand: () => number): Goal[] {
  const all = goalCandidates(c);
  const out: Goal[] = [];
  for (const tier of [2, 1, 0] as Tier[]) {
    const used = new Set(out.map((g) => g.type));
    const ids = new Set(out.map((g) => g.id));
    const pool = all.filter((g) => g.tier === tier && !ids.has(g.id));
    const pick = pickWeighted(pool.filter((g) => !used.has(g.type) && !c.prev.includes(g.id)), rand)
      ?? pickWeighted(pool.filter((g) => !used.has(g.type)), rand) ?? pickWeighted(pool, rand);
    if (pick) { const { w: _w, ...g } = pick; out.push(structuredClone(g)); }
  }
  return out.sort((a, b) => a.tier - b.tier);
}

/** 始めたばかりの箱庭の 3 つ（操作を覚える）。冬は作物が育たないので、耕すだけ・スズメだけ */
export function tutorialGoals(season: number): Goal[] {
  const winter = season === 3;
  return [
    { id: 'tut:farm', tier: 0, type: 'tutorial', conds: winter ? [{ k: 'till' }] : [{ k: 'harvest', n: 1 }] },
    { id: 'tut:flower', tier: 1, type: 'tutorial', conds: [{ k: 'flower' }, { k: 'see', ids: winter ? ['sparrow'] : ['butterfly', 'sparrow'], any: true }] },
    { id: 'tut:build', tier: 2, type: 'tutorial', conds: [{ k: 'build', n: 1, any: true }] },
  ];
}

/**
 * 季節が変わっていれば、新しい 3 つにする（前のものは静かに消える）。変えたら true。
 * state が無ければ作る（tutorial：始めたばかりの箱庭なら、操作を覚える目標）
 */
export function ensureSeason(state: GoalsState | null, key: number, c: Omit<GenCtx, 'season' | 'prev'>, rand: () => number, tutorial = false): { state: GoalsState; changed: boolean } {
  if (state && state.key === key) return { state, changed: false };
  const season = seasonOfKey(key);
  const prev = state?.goals.map((g) => g.id) ?? [];
  const goals = tutorial && !state ? tutorialGoals(season) : generateGoals({ ...c, season, prev }, rand);
  return { state: { key, goals, log: emptyLog(), prev }, changed: true };
}

/** 保存データから読む（形が崩れていれば null。新しく作り直す） */
export function sanitizeGoals(v: unknown): GoalsState | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<GoalsState>;
  if (typeof o.key !== 'number' || !Array.isArray(o.goals) || !o.log || typeof o.log !== 'object') return null;
  const goals = o.goals.filter((g): g is Goal => !!g && typeof g.id === 'string' && [0, 1, 2].includes(g.tier) && Array.isArray(g.conds));
  const l = o.log as Partial<GoalLog>;
  const strs = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []);
  const log: GoalLog = {
    seen: strs(l.seen), day: typeof l.day === 'number' ? l.day : 0, dayIds: strs(l.dayIds), pairs: strs(l.pairs),
    harvest: l.harvest && typeof l.harvest === 'object' ? { ...l.harvest } : {},
    builds: Array.isArray(l.builds) ? l.builds.filter((b) => b && typeof b.nature === 'number').map((b) => ({ nature: b.nature, straw: !!b.straw, ...(b.deco ? { deco: true } : {}) })) : [],
    warm: !!l.warm, till: !!l.till, flower: !!l.flower,
  };
  return { key: o.key, goals, log, prev: strs(o.prev) };
}
