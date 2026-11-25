/**
 * 住人の好きな家・仕事・おすそ分けと、訪問者が運んでくる原料（設計メモ 0 章・10 章。v0.16.1）。three.js に頼らない。
 *
 * - 好きな家：家の素材の割合・大きさ・建てる場所で決まる。好みに合う家があると、その種類は引っ越してきやすい
 *   （土地の割合の下限が 2 割ゆるくなり、引っ越しの順番で先になる）。引っ越してきた時に満足して、発見ポイントが入る
 * - 仕事：いるだけで効く（プレイヤーは割り当てない）
 * - おすそ分け：収穫物をあげると、その住人がしばらく（箱庭の 3 日）原料を多く拾ってくる
 * - 訪問者の贈り物：その箱庭にない原料を、来た訪問者がたまに少し運んでくる（運が悪くても詰まらないように）
 */
import type { Species } from '../creatures/animals';
import type { RawId } from '../game/materials';
import type { BuildingCharacter } from '../build/character';
import type { EnvCounts } from './environment';

/** 家の建つ場所（足元のまわり 3 列） */
export interface Site { water: boolean; forest: boolean; meadow: boolean; wetland: boolean; high: boolean }
export const SITE_NAMES: Record<keyof Site, string> = { water: '水辺', forest: '森', meadow: '草原', wetland: '湿地', high: '高い所' };

/** 素材の割合（見える表面の広さの割合、0..1） */
export function shares(c: Pick<BuildingCharacter, 'areas' | 'totalArea'>) {
  const a = (...ks: string[]) => ks.reduce((s, k) => s + (c.areas[k] ?? 0), 0) / Math.max(1e-9, c.totalArea);
  return { wood: a('wall', 'plank', 'wood'), stone: a('stone'), thatch: a('thatch'), green: a('leaf', 'flower'), brick: a('brick'), white: a('white') };
}

type Shape = Pick<BuildingCharacter, 'areas' | 'totalArea' | 'size' | 'height' | 'light'>;
interface HomePref { shape: (c: Shape, s: ReturnType<typeof shares>) => boolean; site?: keyof Site; text: string }

/** 好きな家（設計メモ 10 章のたたき台を、性格の値に直したもの） */
export const HOME_PREFS: Record<Species, HomePref> = {
  rabbit: { shape: (c) => c.size <= 2 && c.height <= 4, site: 'meadow', text: '小さく低い家' },
  tanuki: { shape: (_c, s) => s.thatch >= 0.15, site: 'forest', text: 'わらの多い家' },
  fox: { shape: (c) => c.height >= 6, text: '高い家' },
  deer: { shape: (c, s) => c.size >= 3 && s.wood >= 0.3, text: '大きめの木の家' },
  duck: { shape: () => true, site: 'water', text: 'どんな家でも' },
  squirrel: { shape: (c) => c.size <= 2 && c.height >= 4, site: 'forest', text: '小さく高い家' },
  hedgehog: { shape: (c, s) => c.size <= 2 && c.height <= 4 && s.green >= 0.08, text: '小さく低い、つたや花の多い家' },
  sheep: { shape: (c, s) => c.size >= 3 && s.wood >= 0.3 && c.height <= 6, text: '大きめの木の小屋' },
  bear: { shape: (c, s) => c.size >= 4 && s.wood + s.stone >= 0.45, text: '大きな丸太と石の家' },
  otter: { shape: (_c, s) => s.stone >= 0.25, site: 'water', text: '石の家' },
  mole: { shape: (c, s) => c.height <= 4 && s.stone >= 0.12, text: '低くて土台が石の家' },
  serow: { shape: (_c, s) => s.stone >= 0.35, site: 'high', text: '石の家' },
  stoat: { shape: (c, s) => c.size <= 2 && s.stone >= 0.25, text: '小さな石の家' },
  beaver: { shape: (_c, s) => s.wood >= 0.25 && s.brick >= 0.08, site: 'water', text: '丸太とれんがの家' },
  capybara: { shape: (c, s) => c.size >= 3 && s.thatch >= 0.15, text: 'わらの大きめの家' },
  cat: { shape: (c, s) => s.brick + s.white >= 0.25 && c.light >= 1, text: 'れんがかしっくいの、灯りのある家' },
};
/** 好きな家の文（図鑑） */
export const homeText = (sp: Species) => { const p = HOME_PREFS[sp]; return p.site ? `${p.text}・${SITE_NAMES[p.site]}のそば` : p.text; };

/** 形だけ見て好みそうな種類（棚の「好みそうな住人」。場所の条件は別に返す） */
export function likelyResidents(c: Shape): { species: Species; site?: keyof Site }[] {
  const s = shares(c);
  return (Object.keys(HOME_PREFS) as Species[]).filter((sp) => HOME_PREFS[sp].shape(c, s)).map((sp) => ({ species: sp, site: HOME_PREFS[sp].site }));
}

/** 建った家（形と場所）を気に入る種類 */
export function likedBy(c: Shape, site: Site): Species[] {
  return likelyResidents(c).filter((x) => !x.site || site[x.site]).map((x) => x.species);
}

/** 好みに合う家があると、土地の割合の下限をこの倍にゆるめる */
export const LIKED_RELAX = 0.8;
/** 好みに合う家がある所に引っ越してきた時の発見ポイント（カピバラがいると 2 倍） */
export const SATISFIED_POINTS = 5;

// ---------- 仕事（いるだけで効く） ----------

export const JOB_TEXT: Record<Species, string> = {
  rabbit: '近くの畑（8 マス以内）が 2 割速く育つ',
  tanuki: '木のまわりに苗木が生えやすくなる（森が広がる）',
  fox: '夜の見回りで、訪問者が 2 割長くいる',
  deer: '草地が森へ移り変わるのを遅らせる',
  duck: '水辺の小石を拾ってくる',
  squirrel: '落ち枝と葉を拾ってくる',
  hedgehog: '花が枯れにくくなる',
  sheep: '小麦を収穫すると、わらが 1 つ多くとれる',
  bear: '木を切ると、丸太が 1 本多くとれる',
  otter: '貝殻と小石を拾ってくる',
  mole: '水をやった畑が乾きにくくなる（1.5 倍長く湿る）',
  serow: '石を拾ってくる',
  stoat: '冬の間も、近くの畑（8 マス以内）が少し育つ',
  beaver: '粘土を拾ってくる',
  capybara: 'みんなが満足しやすくなる（満足した時の発見ポイントが 2 倍）',
  cat: 'たまに、いろいろな原料を拾ってくる',
};

/** 1 匹が箱庭の 1 日に拾ってくる原料（いるだけで） */
export const JOB_PICKUP: Partial<Record<Species, Partial<Record<RawId, number>>>> = {
  duck: { rock: 0.5 },
  squirrel: { log_broad: 0.6, foliage: 0.6 },
  otter: { shell: 0.5, rock: 0.4 },
  serow: { rock: 1 },
  beaver: { clay: 0.8 },
  cat: { blossom: 0.2, shell: 0.15, straw: 0.15, foliage: 0.15 },
};
/** おすそ分けをもらった住人が、ふだんの仕事に加えて拾ってくる原料（1 日あたり） */
export const TREAT_PICKUP: Record<Species, Partial<Record<RawId, number>>> = {
  rabbit: { blossom: 0.5 }, tanuki: { foliage: 0.5 }, fox: { log_broad: 0.4 }, deer: { foliage: 0.5 }, duck: { rock: 0.5 },
  squirrel: { log_broad: 0.6, foliage: 0.6 }, hedgehog: { blossom: 0.5 }, sheep: { straw: 0.5 }, bear: { log_broad: 0.6 },
  otter: { shell: 0.5, rock: 0.4 }, mole: { soil: 0.8 }, serow: { rock: 1 }, stoat: { rock: 0.4 }, beaver: { clay: 0.8 },
  capybara: { reed: 0.5 }, cat: { blossom: 0.2, shell: 0.15, straw: 0.15, foliage: 0.15 },
};

/** おすそ分けの効き目が続く時間（箱庭の時計で 3 日） */
export const TREAT_MS = 3 * 24 * 3600_000;
/** おすそ分けにあげられる収穫物 */
export const SHARE_CROPS = ['turnip', 'wheat', 'pumpkin'] as const;
const CROP_NAME: Record<string, string> = { カブ: 'turnip', 小麦: 'wheat', かぼちゃ: 'pumpkin' };

/** あげる収穫物を選ぶ：好きなものが収穫物で手持ちにあればそれ、無ければいちばん多いもの。何も無ければ null */
export function pickShareCrop(inv: Record<string, number>, favorite: string): (typeof SHARE_CROPS)[number] | null {
  const fav = CROP_NAME[favorite];
  if (fav && (inv[fav] ?? 0) > 0) return fav as (typeof SHARE_CROPS)[number];
  let best: (typeof SHARE_CROPS)[number] | null = null;
  for (const k of SHARE_CROPS) if ((inv[k] ?? 0) > 0 && (!best || (inv[k] ?? 0) > (inv[best] ?? 0))) best = k;
  return best;
}

export interface ResidentInfo { species: Species; col: number; treatedUntil?: number }

/**
 * 住人みんなが 1 日に拾ってくる原料。おすそ分けをもらっている間は、仕事のぶんに加えて TREAT_PICKUP を拾う
 */
export function residentPickupPerDay(rs: readonly ResidentInfo[], now: number): Partial<Record<RawId, number>> {
  const out: Partial<Record<RawId, number>> = {};
  const add = (p: Partial<Record<RawId, number>> | undefined, k = 1) => { for (const [r, n] of Object.entries(p ?? {})) out[r as RawId] = (out[r as RawId] ?? 0) + (n ?? 0) * k; };
  for (const r of rs) {
    add(JOB_PICKUP[r.species]);
    if ((r.treatedUntil ?? 0) > now) add(TREAT_PICKUP[r.species]);
  }
  return out;
}

const near = (a: number, b: number, size: number, r: number) => Math.abs((a % size) - (b % size)) <= r && Math.abs(Math.floor(a / size) - Math.floor(b / size)) <= r;

/** 仕事の効き目（ゲームの仕組みから使う） */
export function jobEffects(rs: readonly ResidentInfo[], size: number) {
  const has = (sp: Species) => rs.some((r) => r.species === sp);
  const rabbits = rs.filter((r) => r.species === 'rabbit'), stoats = rs.filter((r) => r.species === 'stoat');
  return {
    /** 作物の育つ速さの倍率（うさぎの近く 1.2） */
    growth: (col: number) => (rabbits.some((r) => near(r.col, col, size, 8)) ? 1.2 : 1),
    /** 冬でも育つ速さ（オコジョの近く 0.3。ふだんの冬は 0） */
    winterGrowth: (col: number) => (stoats.some((r) => near(r.col, col, size, 8)) ? 0.3 : 0),
    /** 水やりが続く時間の倍率（モグラ） */
    wetMul: has('mole') ? 1.5 : 1,
    /** 苗木が生える確率の倍率（たぬきで 1.5 倍、しかで半分） */
    treeSpreadMul: (has('tanuki') ? 1.5 : 1) * (has('deer') ? 0.5 : 1),
    /** 花が枯れる確率の倍率（はりねずみで半分） */
    flowerFadeMul: has('hedgehog') ? 0.5 : 1,
    /** 訪問者のいる時間の倍率（きつね） */
    stayMul: has('fox') ? 1.2 : 1,
    /** 木を切った時に増える丸太（くま）・小麦の収穫で増えるわら（ひつじ） */
    extraLogs: has('bear') ? 1 : 0,
    extraStraw: has('sheep') ? 1 : 0,
    /** 満足した時の発見ポイントの倍率（カピバラ） */
    satisfyMul: has('capybara') ? 2 : 1,
  };
}

// ---------- 訪問者の贈り物 ----------

/** 来た訪問者が贈り物を持ってくる確率 */
export const GIFT_CHANCE = 0.3;

/** その箱庭でとれない（その原料の出る土地が無い）原料 */
export function missingRaws(e: EnvCounts): RawId[] {
  const out: RawId[] = [];
  if (e.wetland === 0) out.push('clay', 'reed');
  if (e.beach === 0) out.push('sand', 'shell');
  if (e.rock === 0 && e.waterside === 0) out.push('rock');
  if (e.rock === 0) out.push('iron_ore');
  if (e.forest === 0) out.push('log_broad', 'log_conifer', 'foliage');
  if (e.flowerField === 0) out.push('blossom');
  return out;
}

/** 来た訪問者の贈り物（無ければ null）。とれない原料から 1 つ、1〜2 個（鉄鉱石は 1 個） */
export function visitorGift(e: EnvCounts, rand: () => number): { raw: RawId; n: number } | null {
  const miss = missingRaws(e);
  if (!miss.length || rand() >= GIFT_CHANCE) return null;
  const raw = miss[Math.floor(rand() * miss.length)];
  return { raw, n: raw === 'iron_ore' ? 1 : 1 + Math.floor(rand() * 2) };
}
