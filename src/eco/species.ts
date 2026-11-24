import type { Species } from '../creatures/animals';
import { LAND_NAMES, sharePct, type EnvCounts, type Habitat, type Land } from './environment';

/**
 * 住人 7 種と訪問者 12 種のデータ（設計書 2.2・2.3）。
 * three.js に依存しない（テストで使えるように）。
 */
export type Rarity = 'common' | 'uncommon' | 'rare';
export const RARITY_CHANCE: Record<Rarity, number> = { common: 0.4, uncommon: 0.15, rare: 0.05 };
export const RARITY_POINTS: Record<Rarity, number> = { common: 1, uncommon: 2, rare: 4 };
export const RARITY_STARS: Record<Rarity, string> = { common: '★', uncommon: '★★', rare: '★★★' };

export type VisitorId = 'butterfly' | 'bee' | 'sparrow' | 'frog' | 'fish' | 'dragonfly' | 'woodpecker' | 'firefly' | 'snail' | 'longtailedTit' | 'owl' | 'kingfisher';
export type Motion = 'fly' | 'hop' | 'perch' | 'swim' | 'crawl' | 'glow';

/** いまの暦・時刻・天気。season：0 春・1 夏・2 秋・3 冬。seasonProgress：その季節の中の進み具合 0..1 */
export interface Moment { season: number; seasonProgress: number; hour: number; raining: boolean }

/**
 * 来る条件（設計メモ 10 章）：土地の型が開いた地面に占める割合（%）の下限と上限、野生度の範囲、作物があるか。
 * lands に 2 つ以上あれば、その合計の割合で見る（例：花畑と畑の合計）。
 */
export interface LandNeed { lands: Land[]; min?: number; max?: number }
export interface Needs { land?: LandNeed[]; wild?: { min?: number; max?: number }; crops?: boolean }

export function meetsNeeds(n: Needs, e: EnvCounts): boolean {
  for (const l of n.land ?? []) {
    const p = l.lands.reduce((a, k) => a + sharePct(e, k), 0);
    if (l.min !== undefined && p < l.min) return false;
    if (l.max !== undefined && p > l.max) return false;
  }
  if (n.wild?.min !== undefined && e.wild < n.wild.min) return false;
  if (n.wild?.max !== undefined && e.wild > n.wild.max) return false;
  if (n.crops && e.crops < 1) return false;
  return true;
}

/** 割合を星 5 段階に（大まかに見せる）。この % 以上で ★1〜★5 */
export const SHARE_STAR_MIN = [5, 10, 20, 30, 40];
export const shareStars = (pct: number) => SHARE_STAR_MIN.filter((t) => pct + 1e-9 >= t).length;
export const starText = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

/** 好きな環境の文（星で大まかに）。例：「森 ★★★★☆ 以上・草原 ★★☆☆☆ まで・野生度 ★★★★☆ 以上」 */
export function needsText(n: Needs): string {
  const parts: string[] = [];
  for (const l of n.land ?? []) {
    const name = l.lands.map((k) => LAND_NAMES[k]).join('か');
    if (l.min !== undefined && l.max !== undefined) parts.push(`${name} ${starText(shareStars(l.min))}〜${starText(shareStars(l.max))}`);
    else if (l.min !== undefined) parts.push(`${name} ${starText(Math.max(1, shareStars(l.min)))} 以上`);
    else if (l.max !== undefined) parts.push(`${name} ${starText(shareStars(l.max))} まで`);
  }
  if (n.crops) parts.push('作物');
  const w = n.wild;
  if (w?.min !== undefined && w.max !== undefined) parts.push(`野生度 ${starText(w.min)}〜${starText(w.max)}`);
  else if (w?.min !== undefined) parts.push(`野生度 ${starText(w.min)} 以上`);
  else if (w?.max !== undefined) parts.push(`野生度 ${starText(w.max)} まで`);
  return parts.join('・');
}

export interface VisitorDef {
  id: VisitorId; name: string; icon: string; rarity: Rarity; habitat: Habitat; motion: Motion;
  need: Needs;
  needs(e: EnvCounts): boolean;
  when(m: Moment): boolean;
  hint: string; note: string;
  /** 好きな環境の文に足す、季節・時刻・天気 */
  likesWhen?: string;
}

export const isDay = (h: number) => h >= 6 && h < 18;
export const isNight = (h: number) => h >= 19 || h < 5;
export const isMorning = (h: number) => h >= 5 && h < 9;
const springSummer = (m: Moment) => m.season === 0 || m.season === 1;

type VisitorSpec = Omit<VisitorDef, 'needs'>;
const F = (min?: number, max?: number): LandNeed => ({ lands: ['forest'], min, max });
const M = (min?: number, max?: number): LandNeed => ({ lands: ['meadow'], min, max });
const FL = (min: number): LandNeed => ({ lands: ['flowerField'], min });
const W = (min: number): LandNeed => ({ lands: ['waterside'], min });
const D = (min: number): LandNeed => ({ lands: ['deepWater'], min });
const FARM = (min: number): LandNeed => ({ lands: ['farm'], min });
const FLFARM = (min: number): LandNeed => ({ lands: ['flowerField', 'farm'], min });

/** 条件の数値はたたき台（設計メモ 10 章）。自然な地形の割合（森 4〜10%・草原 17〜25%・花畑 3〜6%・水辺 11〜14%）に合わせて、草原だけ少し下げた */
const VISITOR_SPECS: VisitorSpec[] = [
  { id: 'butterfly', name: 'チョウ', icon: '🦋', rarity: 'common', habitat: 'flower', motion: 'fly',
    need: { land: [FL(5)] }, when: (m) => springSummer(m) && isDay(m.hour) && !m.raining,
    hint: '花畑の広い所に来るらしい', note: 'ひらひらと花から花へ。晴れた春と夏の昼に来る。', likesWhen: '春と夏の晴れた昼' },
  { id: 'bee', name: 'ミツバチ', icon: '🐝', rarity: 'common', habitat: 'flowerCrop', motion: 'fly',
    need: { land: [FL(10)], crops: true }, when: (m) => springSummer(m) && isDay(m.hour) && !m.raining,
    hint: '花畑と作物がそろうと、羽音が聞こえるらしい', note: '花と作物の間をせわしなく行き来する。', likesWhen: '春と夏の晴れた昼' },
  { id: 'sparrow', name: 'スズメ', icon: '🐦', rarity: 'common', habitat: 'farm', motion: 'hop',
    need: { land: [FARM(5)] }, when: (m) => isDay(m.hour),
    hint: '畑の多い所でよく見かけるらしい', note: '畑のまわりをちょんちょん跳ねる。一年中いる。', likesWhen: '昼' },
  { id: 'frog', name: 'カエル', icon: '🐸', rarity: 'common', habitat: 'waterside', motion: 'hop',
    need: { land: [W(5)] }, when: (m) => springSummer(m),
    hint: '水辺で、雨の日によく鳴いているらしい', note: '春と夏の水辺に来る。雨の日は来やすい。', likesWhen: '春と夏・雨' },
  { id: 'fish', name: '魚', icon: '🐟', rarity: 'common', habitat: 'deepWater', motion: 'swim',
    need: { land: [D(5)] }, when: () => true,
    hint: '深い水の中に、何かが泳いでいるらしい', note: '深い水の、水面の少し下をゆっくり泳ぐ魚。一年中いる。', likesWhen: '一年中' },
  { id: 'dragonfly', name: 'トンボ', icon: '🪰', rarity: 'uncommon', habitat: 'waterside', motion: 'fly',
    need: { land: [W(5)] }, when: (m) => m.season === 2 && isDay(m.hour),
    hint: '秋の水辺を、すいすい飛ぶものがいるらしい', note: '秋の昼、水辺の上をすいすい飛ぶ。', likesWhen: '秋の昼' },
  { id: 'woodpecker', name: 'キツツキ', icon: '🪶', rarity: 'uncommon', habitat: 'tree', motion: 'perch',
    need: { land: [F(25)] }, when: (m) => isDay(m.hour),
    hint: '森の奥から、木をたたく音がするらしい', note: '木の幹にとまって、こつこつたたく。', likesWhen: '昼' },
  { id: 'firefly', name: 'ホタル', icon: '✨', rarity: 'uncommon', habitat: 'grassNearWater', motion: 'glow',
    need: { land: [W(5), M(5)], wild: { min: 3 } }, when: (m) => m.season === 1 && m.seasonProgress < 0.5 && isNight(m.hour),
    hint: '初夏の夜、人の手の少ない水辺の草むらが光るらしい', note: '初夏の夜だけ、水辺の草むらで光る。畑や道が多いと来ない。', likesWhen: '初夏の夜' },
  { id: 'snail', name: 'カタツムリ', icon: '🐌', rarity: 'uncommon', habitat: 'flowerOrFarm', motion: 'crawl',
    need: { land: [FLFARM(10)] }, when: (m) => m.raining && isNight(m.hour),
    hint: '雨の夜、花や畑のそばをはうものがいるらしい', note: '雨の夜だけ、花や畑のそばをゆっくりはう。', likesWhen: '雨の夜' },
  { id: 'longtailedTit', name: 'シマエナガ', icon: '🤍', rarity: 'rare', habitat: 'tree', motion: 'perch',
    need: { land: [F(15)] }, when: (m) => m.season === 3 && isDay(m.hour),
    hint: '冬の木の枝に、白くて丸いものがいるらしい', note: '冬の昼、木の枝にとまる小さな白い鳥。', likesWhen: '冬の昼' },
  { id: 'owl', name: 'フクロウ', icon: '🦉', rarity: 'rare', habitat: 'tree', motion: 'perch',
    need: { land: [F(40)] }, when: (m) => isNight(m.hour),
    hint: 'とても深い森の夜、木の上から見ているものがいるらしい', note: '夜、深い森の木の上にとまっている。', likesWhen: '夜' },
  { id: 'kingfisher', name: 'カワセミ', icon: '💎', rarity: 'rare', habitat: 'waterside', motion: 'fly',
    need: { land: [W(5), D(5)], wild: { min: 4 } }, when: (m) => isMorning(m.hour),
    hint: '魚のいる、人の手の少ない水辺に、朝だけ青い鳥が来るらしい', note: '魚のいる水辺に朝だけ来る、青く光る鳥。畑や道が多いと来ない。', likesWhen: '朝・魚がいる' },
];
export const VISITORS: VisitorDef[] = VISITOR_SPECS.map((v) => ({ ...v, needs: (e: EnvCounts) => meetsNeeds(v.need, e) }));
/** 好きな環境の文（観察した後の図鑑に出す） */
export const visitorLikes = (v: VisitorDef) => [needsText(v.need), v.likesWhen].filter(Boolean).join('・');
export const VISITOR = Object.fromEntries(VISITORS.map((v) => [v.id, v])) as Record<VisitorId, VisitorDef>;

/** 住人が引っ越してくる条件（うさぎは最初からいるので引っ越してこない。条件は図鑑に出すためだけ） */
export const RESIDENT_NEEDS: Record<Species, Needs> = {
  rabbit: { land: [M(15)] },
  tanuki: { land: [F(30)] },
  fox: { land: [M(25), F(10, 30)] },
  deer: { land: [M(30), F(undefined, 15)] },
  duck: { land: [W(10)] },
  squirrel: { land: [F(20)] },
  hedgehog: { land: [FLFARM(15)] },
};
export const RESIDENT_RULES: Record<Species, (e: EnvCounts) => boolean> = Object.fromEntries(
  (Object.keys(RESIDENT_NEEDS) as Species[]).map((sp) => [sp, sp === 'rabbit' ? () => false : (e: EnvCounts) => meetsNeeds(RESIDENT_NEEDS[sp], e)]),
) as Record<Species, (e: EnvCounts) => boolean>;

export const RESIDENT_TEXT: Record<Species, { hint: string; likes: string }> = {
  rabbit: { hint: '最初から箱庭にいる', likes: `${needsText(RESIDENT_NEEDS.rabbit)}・畑のそば` },
  tanuki: { hint: '森の広い所に住みたいらしい', likes: needsText(RESIDENT_NEEDS.tanuki) },
  fox: { hint: '草原に、少しだけ森がある所に住みたいらしい。森が広すぎると来ないらしい', likes: needsText(RESIDENT_NEEDS.fox) },
  deer: { hint: '広い草原に住みたいらしい。森が広すぎると来ないらしい', likes: needsText(RESIDENT_NEEDS.deer) },
  duck: { hint: '水辺の多い所に住みたいらしい', likes: needsText(RESIDENT_NEEDS.duck) },
  squirrel: { hint: '森のある所に住みたいらしい', likes: needsText(RESIDENT_NEEDS.squirrel) },
  hedgehog: { hint: '花畑や畑のある所に住みたいらしい', likes: needsText(RESIDENT_NEEDS.hedgehog) },
};

export const RESIDENT_ORDER: Species[] = ['rabbit', 'tanuki', 'fox', 'deer', 'duck', 'squirrel', 'hedgehog'];
export type DexId = Species | VisitorId;
/** 図鑑の並び：住人 7 種 → 訪問者 12 種 */
export const DEX_ORDER: DexId[] = [...RESIDENT_ORDER, ...VISITORS.map((v) => v.id)];
export const isVisitorId = (id: string): id is VisitorId => id in VISITOR;
export const rarityOf = (id: DexId): Rarity => (isVisitorId(id) ? VISITOR[id].rarity : 'common');
