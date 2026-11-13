import type { Species } from '../creatures/animals';
import type { EnvCounts, Habitat } from './environment';

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

export interface VisitorDef {
  id: VisitorId; name: string; icon: string; rarity: Rarity; habitat: Habitat; motion: Motion;
  needs(e: EnvCounts): boolean;
  when(m: Moment): boolean;
  hint: string; note: string; likes: string;
}

export const isDay = (h: number) => h >= 6 && h < 18;
export const isNight = (h: number) => h >= 19 || h < 5;
export const isMorning = (h: number) => h >= 5 && h < 9;
const springSummer = (m: Moment) => m.season === 0 || m.season === 1;

export const VISITORS: VisitorDef[] = [
  { id: 'butterfly', name: 'チョウ', icon: '🦋', rarity: 'common', habitat: 'flower', motion: 'fly',
    needs: (e) => e.flowers >= 20, when: (m) => springSummer(m) && isDay(m.hour) && !m.raining,
    hint: '花がたくさん咲く所に来るらしい', note: 'ひらひらと花から花へ。晴れた春と夏の昼に来る。', likes: '花（20 以上）' },
  { id: 'bee', name: 'ミツバチ', icon: '🐝', rarity: 'common', habitat: 'flowerCrop', motion: 'fly',
    needs: (e) => e.flowers >= 40 && e.crops >= 1, when: (m) => springSummer(m) && isDay(m.hour) && !m.raining,
    hint: '花畑と作物がそろうと、羽音が聞こえるらしい', note: '花と作物の間をせわしなく行き来する。', likes: '花（40 以上）と作物' },
  { id: 'sparrow', name: 'スズメ', icon: '🐦', rarity: 'common', habitat: 'farm', motion: 'hop',
    needs: (e) => e.farmland >= 1, when: (m) => isDay(m.hour),
    hint: '畑のまわりでよく見かけるらしい', note: '畑のまわりをちょんちょん跳ねる。一年中いる。', likes: '畑' },
  { id: 'frog', name: 'カエル', icon: '🐸', rarity: 'common', habitat: 'waterside', motion: 'hop',
    needs: (e) => e.waterside >= 10, when: (m) => springSummer(m),
    hint: '水辺で、雨の日によく鳴いているらしい', note: '春と夏の水辺に来る。雨の日は来やすい。', likes: '水辺（10 以上）・雨' },
  { id: 'fish', name: '魚の影', icon: '🐟', rarity: 'common', habitat: 'deepWater', motion: 'swim',
    needs: (e) => e.deepWater >= 30, when: () => true,
    hint: '深い水の中に、何かが泳いでいるらしい', note: '深い水の中をゆっくり泳ぐ影。一年中いる。', likes: '深さ 3 以上の水（30 マス以上）' },
  { id: 'dragonfly', name: 'トンボ', icon: '🪰', rarity: 'uncommon', habitat: 'waterside', motion: 'fly',
    needs: (e) => e.waterside >= 10, when: (m) => m.season === 2 && isDay(m.hour),
    hint: '秋の水辺を、すいすい飛ぶものがいるらしい', note: '秋の昼、水辺の上をすいすい飛ぶ。', likes: '水辺（10 以上）・秋' },
  { id: 'woodpecker', name: 'キツツキ', icon: '🪶', rarity: 'uncommon', habitat: 'tree', motion: 'perch',
    needs: (e) => e.trees >= 30, when: (m) => isDay(m.hour),
    hint: '森の奥から、木をたたく音がするらしい', note: '木の幹にとまって、こつこつたたく。', likes: '木（30 本以上）' },
  { id: 'firefly', name: 'ホタル', icon: '✨', rarity: 'uncommon', habitat: 'grassNearWater', motion: 'glow',
    needs: (e) => e.waterside >= 10 && e.grass >= 1, when: (m) => m.season === 1 && m.seasonProgress < 0.5 && isNight(m.hour),
    hint: '初夏の夜、水辺の草むらが光るらしい', note: '初夏の夜だけ、水辺の草むらで光る。', likes: '水辺（10 以上）と草地・初夏の夜' },
  { id: 'snail', name: 'カタツムリ', icon: '🐌', rarity: 'uncommon', habitat: 'flowerOrFarm', motion: 'crawl',
    needs: (e) => e.flowers + e.farmland >= 10, when: (m) => m.raining && isNight(m.hour),
    hint: '雨の夜、花や畑のそばをはうものがいるらしい', note: '雨の夜だけ、花や畑のそばをゆっくりはう。', likes: '花か畑（10 以上）・雨の夜' },
  { id: 'longtailedTit', name: 'シマエナガ', icon: '🤍', rarity: 'rare', habitat: 'tree', motion: 'perch',
    needs: (e) => e.trees >= 20, when: (m) => m.season === 3 && isDay(m.hour),
    hint: '冬の木の枝に、白くて丸いものがいるらしい', note: '冬の昼、木の枝にとまる小さな白い鳥。', likes: '木（20 本以上）・冬' },
  { id: 'owl', name: 'フクロウ', icon: '🦉', rarity: 'rare', habitat: 'tree', motion: 'perch',
    needs: (e) => e.trees >= 60, when: (m) => isNight(m.hour),
    hint: '深い森の夜、木の上から見ているものがいるらしい', note: '夜、深い森の木の上にとまっている。', likes: '木（60 本以上）・夜' },
  { id: 'kingfisher', name: 'カワセミ', icon: '💎', rarity: 'rare', habitat: 'waterside', motion: 'fly',
    needs: (e) => e.waterside >= 1 && e.deepWater >= 30, when: (m) => isMorning(m.hour),
    hint: '魚のいる水辺に、朝だけ青い鳥が来るらしい', note: '魚のいる水辺に朝だけ来る、青く光る鳥。', likes: '魚のいる水辺・朝' },
];
export const VISITOR = Object.fromEntries(VISITORS.map((v) => [v.id, v])) as Record<VisitorId, VisitorDef>;

/** 住人が引っ越してくる条件（うさぎは最初からいるので引っ越してこない） */
export const RESIDENT_RULES: Record<Species, (e: EnvCounts) => boolean> = {
  rabbit: () => false,
  tanuki: (e) => e.trees >= 30,
  fox: (e) => e.grass >= 2500,
  deer: (e) => e.grass >= 1500,
  duck: (e) => e.waterside >= 20,
  squirrel: (e) => e.trees >= 15,
  hedgehog: (e) => e.flowers + e.farmland >= 30,
};

export const RESIDENT_TEXT: Record<Species, { hint: string; likes: string }> = {
  rabbit: { hint: '最初から箱庭にいる', likes: '畑のそば' },
  tanuki: { hint: '木がたくさんある所に住みたいらしい', likes: '木（30 本以上）' },
  fox: { hint: 'とても広い草地に住みたいらしい', likes: '草地（2500 列以上）' },
  deer: { hint: '広い草地に住みたいらしい', likes: '草地（1500 列以上）' },
  duck: { hint: '水辺の多い所に住みたいらしい', likes: '水辺（20 以上）' },
  squirrel: { hint: '木のある所に住みたいらしい', likes: '木（15 本以上）' },
  hedgehog: { hint: '花や畑のある所に住みたいらしい', likes: '花か畑（30 以上）' },
};

export const RESIDENT_ORDER: Species[] = ['rabbit', 'tanuki', 'fox', 'deer', 'duck', 'squirrel', 'hedgehog'];
export type DexId = Species | VisitorId;
/** 図鑑の並び：住人 7 種 → 訪問者 12 種 */
export const DEX_ORDER: DexId[] = [...RESIDENT_ORDER, ...VISITORS.map((v) => v.id)];
export const isVisitorId = (id: string): id is VisitorId => id in VISITOR;
export const rarityOf = (id: DexId): Rarity => (isVisitorId(id) ? VISITOR[id].rarity : 'common');
