import type { Species } from '../creatures/animals';
import { LAND_NAMES, sharePct, type EnvCounts, type Habitat, type Land } from './environment';

/**
 * 住人 16 種と訪問者 24 種のデータ（設計メモ 10 章。v0.16 で 40 種に）。
 * three.js に依存しない（テストで使えるように）。
 */
export type Rarity = 'common' | 'uncommon' | 'rare';
export const RARITY_CHANCE: Record<Rarity, number> = { common: 0.4, uncommon: 0.15, rare: 0.05 };
/** 発見ポイント（v0.14〜 は 10 倍の整数。区画を開く＝30）：初めての観察 */
export const RARITY_POINTS: Record<Rarity, number> = { common: 10, uncommon: 20, rare: 40 };
/** 訪問者を新しい季節に観察した時 */
export const SEASON_POINTS = 10;
/** 訪問者が来るたび */
export const VISITOR_POINTS = 2;
export const RARITY_STARS: Record<Rarity, string> = { common: '★', uncommon: '★★', rare: '★★★' };

export type VisitorId = 'butterfly' | 'bee' | 'sparrow' | 'frog' | 'fish' | 'dragonfly' | 'woodpecker' | 'firefly' | 'snail' | 'longtailedTit' | 'owl' | 'kingfisher'
  | 'mejiro' | 'skylark' | 'cricket' | 'flyingSquirrel' | 'eagle' | 'heron' | 'crane' | 'crab' | 'gull' | 'seaTurtle' | 'swallow' | 'gecko';
/** 動き：飛ぶ・跳ねる・とまる・泳ぐ・はう・光る。v0.16：glide 滑空（ムササビ）、wade 浅瀬を歩く（サギ・ツル）、wall 壁に張り付く（ヤモリ） */
export type Motion = 'fly' | 'hop' | 'perch' | 'swim' | 'crawl' | 'glow' | 'glide' | 'wade' | 'wall';

/** いまの暦・時刻・天気。season：0 春・1 夏・2 秋・3 冬。seasonProgress：その季節の中の進み具合 0..1 */
export interface Moment { season: number; seasonProgress: number; hour: number; raining: boolean }

/**
 * 来る条件（設計メモ 10 章）：土地の型が開いた地面に占める割合（%）の下限と上限、野生度の範囲、作物があるか。
 * lands に 2 つ以上あれば、その合計の割合で見る（例：花畑と畑の合計）。
 */
export interface LandNeed { lands: Land[]; min?: number; max?: number }
/**
 * v0.16：deep 深い水がある（8 列以上）、high 高い所がある（16 列以上）、houses 建ち終わった建物の数の下限、
 * litHouses 灯りのある建物の数の下限
 */
export interface Needs { land?: LandNeed[]; wild?: { min?: number; max?: number }; crops?: boolean; deep?: boolean; high?: boolean; houses?: number; litHouses?: number }
export const DEEP_MIN_COLS = 8;
export const HIGH_MIN_COLS = 16;

/** relax：割合の下限にかける倍率（好きな家がある住人は 0.8。v0.16.1） */
export function meetsNeeds(n: Needs, e: EnvCounts, relax = 1): boolean {
  for (const l of n.land ?? []) {
    const p = l.lands.reduce((a, k) => a + sharePct(e, k), 0);
    if (l.min !== undefined && p < l.min * relax) return false;
    if (l.max !== undefined && p > l.max) return false;
  }
  if (n.wild?.min !== undefined && e.wild < n.wild.min) return false;
  if (n.wild?.max !== undefined && e.wild > n.wild.max) return false;
  if (n.crops && e.crops < 1) return false;
  if (n.deep && e.deepWater < DEEP_MIN_COLS) return false;
  if (n.high && e.high < HIGH_MIN_COLS) return false;
  if (n.houses !== undefined && e.houses < n.houses) return false;
  if (n.litHouses !== undefined && e.litHouses < n.litHouses) return false;
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
  if (n.deep) parts.push('深い水');
  if (n.high) parts.push('高い所');
  if (n.houses !== undefined) parts.push(`家 ${n.houses} 棟以上`);
  if (n.litHouses !== undefined) parts.push('灯りのともる家');
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
const notWinter = (m: Moment) => m.season !== 3;
/** 夕方〜夜（17〜翌 5 時） */
const isEvening = (h: number) => h >= 17 || h < 5;

type VisitorSpec = Omit<VisitorDef, 'needs'>;
const F = (min?: number, max?: number): LandNeed => ({ lands: ['forest'], min, max });
const M = (min?: number, max?: number): LandNeed => ({ lands: ['meadow'], min, max });
const FL = (min: number): LandNeed => ({ lands: ['flowerField'], min });
const W = (min: number): LandNeed => ({ lands: ['waterside'], min });
const D = (min: number): LandNeed => ({ lands: ['deepWater'], min });
const DARK_W = (min: number): LandNeed => ({ lands: ['darkWaterside'], min });
const DARK_F = (min: number): LandNeed => ({ lands: ['darkForest'], min });
const FARM = (min: number): LandNeed => ({ lands: ['farm'], min });
const FLFARM = (min: number): LandNeed => ({ lands: ['flowerField', 'farm'], min });
const R = (min: number): LandNeed => ({ lands: ['rock'], min });
const WET = (min: number): LandNeed => ({ lands: ['wetland'], min });
const B = (min: number): LandNeed => ({ lands: ['beach'], min });

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
    need: { land: [DARK_W(5), M(5)], wild: { min: 3 } }, when: (m) => m.season === 1 && m.seasonProgress < 0.5 && isNight(m.hour),
    hint: '初夏の夜、人の手の少ない暗い水辺の草むらが光るらしい', note: '初夏の夜だけ、水辺の草むらで光る。畑や道が多い所や、家の灯りの近くには来ない。', likesWhen: '初夏の夜' },
  { id: 'snail', name: 'カタツムリ', icon: '🐌', rarity: 'uncommon', habitat: 'flowerOrFarm', motion: 'crawl',
    need: { land: [FLFARM(10)] }, when: (m) => m.raining && isNight(m.hour),
    hint: '雨の夜、花や畑のそばをはうものがいるらしい', note: '雨の夜だけ、花や畑のそばをゆっくりはう。', likesWhen: '雨の夜' },
  { id: 'longtailedTit', name: 'シマエナガ', icon: '🤍', rarity: 'rare', habitat: 'tree', motion: 'perch',
    need: { land: [F(15)] }, when: (m) => m.season === 3 && isDay(m.hour),
    hint: '冬の木の枝に、白くて丸いものがいるらしい', note: '冬の昼、木の枝にとまる小さな白い鳥。', likesWhen: '冬の昼' },
  { id: 'owl', name: 'フクロウ', icon: '🦉', rarity: 'rare', habitat: 'darkTree', motion: 'perch',
    need: { land: [DARK_F(40)] }, when: (m) => isNight(m.hour),
    hint: 'とても深くて暗い森の夜、木の上から見ているものがいるらしい', note: '夜、深い森の木の上にとまっている。家の灯りの近くには来ない。', likesWhen: '夜' },
  { id: 'kingfisher', name: 'カワセミ', icon: '💎', rarity: 'rare', habitat: 'waterside', motion: 'fly',
    need: { land: [W(5), D(5)], wild: { min: 4 } }, when: (m) => isMorning(m.hour),
    hint: '魚のいる、人の手の少ない水辺に、朝だけ青い鳥が来るらしい', note: '魚のいる水辺に朝だけ来る、青く光る鳥。畑や道が多いと来ない。', likesWhen: '朝・魚がいる' },
  // ---- v0.16 で足した 12 種（設計メモ 10 章。割合は自然な地形に合わせて少し下げた） ----
  { id: 'mejiro', name: 'メジロ', icon: '🐤', rarity: 'uncommon', habitat: 'tree', motion: 'perch',
    need: { land: [FL(5), F(5)] }, when: (m) => (m.season === 3 || m.season === 0) && isDay(m.hour),
    hint: '冬から春、花のそばの木に、目のまわりが白い鳥が来るらしい', note: '目のまわりが白い、うぐいす色の小鳥。花の蜜が好き。', likesWhen: '冬から春の昼' },
  { id: 'skylark', name: 'ヒバリ', icon: '🎵', rarity: 'uncommon', habitat: 'meadow', motion: 'fly',
    need: { land: [M(30), F(undefined, 10)] }, when: (m) => m.season === 0 && isDay(m.hour) && !m.raining,
    hint: '春の晴れた日、広い草原の空高くで鳴いているものがいるらしい', note: '草原から真上へ舞い上がり、空でさえずり続ける。', likesWhen: '春の晴れた昼' },
  { id: 'cricket', name: 'コオロギ', icon: '🦗', rarity: 'common', habitat: 'meadow', motion: 'hop',
    need: { land: [M(15)] }, when: (m) => m.season === 2 && isNight(m.hour),
    hint: '秋の夜、草むらから鳴き声がするらしい', note: '秋の夜、草むらで鳴く。ぴょんと跳ねる。', likesWhen: '秋の夜' },
  { id: 'flyingSquirrel', name: 'ムササビ', icon: '🪂', rarity: 'uncommon', habitat: 'tree', motion: 'glide',
    need: { land: [F(30)] }, when: (m) => isNight(m.hour),
    hint: '森の夜、木から木へ空を滑るものがいるらしい', note: '夜の森で、大きな木から木へ、膜を広げて滑空する。', likesWhen: '夜' },
  { id: 'eagle', name: 'ワシ', icon: '🦅', rarity: 'rare', habitat: 'highRock', motion: 'fly',
    need: { land: [R(15)], high: true, wild: { min: 4 } }, when: (m) => isDay(m.hour) && !m.raining,
    hint: '高い岩場の上を、大きな影が回っているらしい。人の手が多いと来ないらしい', note: '高い岩場の上空を、大きな輪を描いて舞う。', likesWhen: '晴れた昼' },
  { id: 'heron', name: 'サギ', icon: '🩶', rarity: 'common', habitat: 'wetland', motion: 'wade',
    need: { land: [WET(10)] }, when: (m) => notWinter(m) && (isMorning(m.hour) || isDay(m.hour)),
    hint: '湿地の浅瀬を、足の長い鳥が歩いているらしい', note: '長い足で浅瀬をゆっくり歩き、じっと待って魚をとる。', likesWhen: '春から秋の朝と昼' },
  { id: 'crane', name: 'ツル', icon: '🕊', rarity: 'rare', habitat: 'wetland', motion: 'wade',
    need: { land: [WET(20), M(5)], wild: { min: 4 } }, when: (m) => m.season === 3,
    hint: '冬、広い湿地に、頭の赤い大きな鳥が来るらしい', note: '冬の湿地に来る。頭の赤い、白と黒の大きな鳥。', likesWhen: '冬' },
  { id: 'crab', name: 'カニ', icon: '🦀', rarity: 'common', habitat: 'beach', motion: 'crawl',
    need: { land: [B(5)] }, when: (m) => m.season === 1 && isEvening(m.hour),
    hint: '夏の夕方、砂浜を横歩きするものがいるらしい', note: '夏の夕方から夜、砂浜を横に歩く。はさみを振り上げる。', likesWhen: '夏の夕方から夜' },
  { id: 'gull', name: 'カモメ', icon: '🌊', rarity: 'common', habitat: 'beach', motion: 'fly',
    need: { land: [B(10)], deep: true }, when: (m) => isDay(m.hour),
    hint: '砂浜と深い水のある所の空を、白い鳥が飛んでいるらしい', note: '砂浜と深い水の上を、翼を広げてゆったり飛ぶ。', likesWhen: '昼' },
  { id: 'seaTurtle', name: 'ウミガメ', icon: '🐢', rarity: 'rare', habitat: 'beach', motion: 'crawl',
    need: { land: [B(12)], wild: { min: 4 } }, when: (m) => m.season === 1 && isNight(m.hour),
    hint: '夏の夜、静かな砂浜に大きなものが上がってくるらしい', note: '夏の夜、人の手の少ない砂浜にゆっくり上がってくる。', likesWhen: '夏の夜' },
  { id: 'swallow', name: 'ツバメ', icon: '🪁', rarity: 'common', habitat: 'nearHouse', motion: 'fly',
    need: { land: [FARM(1)], houses: 2 }, when: (m) => springSummer(m) && isDay(m.hour),
    hint: '家と畑のある所を、すいすい低く飛ぶ鳥がいるらしい', note: '家のまわりを、低く速く飛び回る。尾が長く二つに分かれている。', likesWhen: '春と夏の昼' },
  { id: 'gecko', name: 'ヤモリ', icon: '🦎', rarity: 'uncommon', habitat: 'houseWall', motion: 'wall',
    need: { litHouses: 1 }, when: (m) => m.season === 1 && isNight(m.hour),
    hint: '夏の夜、灯りのともる家の壁に、何かが張り付いているらしい', note: '夏の夜、灯りに集まる虫を待って、家の壁に張り付く。', likesWhen: '夏の夜' },
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
  // ---- v0.16 で足した 9 種（設計メモ 10 章。割合は自然な地形に合わせて少し下げた） ----
  sheep: { land: [M(35), F(undefined, 10)], wild: { max: 3 } },
  bear: { land: [F(35)], deep: true },
  otter: { land: [W(15)], deep: true, wild: { min: 3 } },
  mole: { land: [FARM(10), F(undefined, 20)] },
  serow: { land: [R(15)], high: true },
  stoat: { land: [R(10), F(10)] },
  beaver: { land: [WET(15), F(5)] },
  capybara: { land: [WET(20)], wild: { min: 2, max: 4 } },
  cat: { houses: 4, wild: { max: 2 } },
};
/** 季節などの決まりがある住人（オコジョは冬にだけ引っ越してくる） */
export const RESIDENT_WHEN: Partial<Record<Species, { when: (m: Moment) => boolean; text: string }>> = {
  stoat: { when: (m) => m.season === 3, text: '冬' },
};
export const RESIDENT_RULES: Record<Species, (e: EnvCounts, m?: Moment, relax?: number) => boolean> = Object.fromEntries(
  (Object.keys(RESIDENT_NEEDS) as Species[]).map((sp) => [sp, sp === 'rabbit' ? () => false
    : (e: EnvCounts, m?: Moment, relax = 1) => meetsNeeds(RESIDENT_NEEDS[sp], e, relax) && (!m || !RESIDENT_WHEN[sp] || RESIDENT_WHEN[sp]!.when(m))]),
) as Record<Species, (e: EnvCounts, m?: Moment, relax?: number) => boolean>;
const likesOf = (sp: Species) => [needsText(RESIDENT_NEEDS[sp]), RESIDENT_WHEN[sp]?.text].filter(Boolean).join('・');

export const RESIDENT_TEXT: Record<Species, { hint: string; likes: string }> = {
  rabbit: { hint: '最初から箱庭にいる', likes: `${needsText(RESIDENT_NEEDS.rabbit)}・畑のそば` },
  tanuki: { hint: '森の広い所に住みたいらしい', likes: needsText(RESIDENT_NEEDS.tanuki) },
  fox: { hint: '草原に、少しだけ森がある所に住みたいらしい。森が広すぎると来ないらしい', likes: needsText(RESIDENT_NEEDS.fox) },
  deer: { hint: '広い草原に住みたいらしい。森が広すぎると来ないらしい', likes: needsText(RESIDENT_NEEDS.deer) },
  duck: { hint: '水辺の多い所に住みたいらしい', likes: needsText(RESIDENT_NEEDS.duck) },
  squirrel: { hint: '森のある所に住みたいらしい', likes: needsText(RESIDENT_NEEDS.squirrel) },
  hedgehog: { hint: '花畑や畑のある所に住みたいらしい', likes: needsText(RESIDENT_NEEDS.hedgehog) },
  sheep: { hint: 'とても広い草原に住みたいらしい。森や、野生のままの土地は苦手らしい', likes: likesOf('sheep') },
  bear: { hint: '深い森と、深い水のある所に住みたいらしい', likes: likesOf('bear') },
  otter: { hint: '深い水のある、人の手の少ない水辺に住みたいらしい', likes: likesOf('otter') },
  mole: { hint: '畑の多い所に住みたいらしい。森が広すぎると来ないらしい', likes: likesOf('mole') },
  serow: { hint: '高い岩場に住みたいらしい', likes: likesOf('serow') },
  stoat: { hint: '岩場と森のある所に、冬にだけ来るらしい', likes: likesOf('stoat') },
  beaver: { hint: '森のそばの湿地に住みたいらしい', likes: likesOf('beaver') },
  capybara: { hint: '広い湿地に住みたいらしい。人の手が多すぎても少なすぎても来ないらしい', likes: likesOf('capybara') },
  cat: { hint: '家の多い、にぎやかな所に住みたいらしい', likes: likesOf('cat') },
};

export const RESIDENT_ORDER: Species[] = ['rabbit', 'tanuki', 'fox', 'deer', 'duck', 'squirrel', 'hedgehog', 'sheep', 'bear', 'otter', 'mole', 'serow', 'stoat', 'beaver', 'capybara', 'cat'];
export type DexId = Species | VisitorId;
/** 図鑑の並び：住人 16 種 → 訪問者 24 種 */
export const DEX_ORDER: DexId[] = [...RESIDENT_ORDER, ...VISITORS.map((v) => v.id)];
export const isVisitorId = (id: string): id is VisitorId => id in VISITOR;
export const rarityOf = (id: DexId): Rarity => (isVisitorId(id) ? VISITOR[id].rarity : 'common');
