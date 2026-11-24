/**
 * 原料と素材（設計メモ 7 章）。three.js に頼らない。
 *   原料（12 種類）：土地の型からとる。拾う（放置で少し）か、切る・掘る・摘む（すぐ・景色が減る）
 *   素材（13 種類）：建物の色ごと。原料からボタン 1 つで加工する
 * 持ち物（Farm.inventory）のキー：原料はその id、素材は「m:」＋パレットの名前（例 m:wall）。上限は付けない。
 */
import type { BuildingCharacter } from '../build/character';

export type RawId = 'log_broad' | 'log_conifer' | 'foliage' | 'straw' | 'soil' | 'reed' | 'blossom' | 'rock' | 'clay' | 'sand' | 'shell' | 'iron_ore';

export interface RawDef { id: RawId; name: string; icon: string; from: string }

export const RAWS: RawDef[] = [
  { id: 'log_broad', name: '広葉樹の丸太', icon: '🪵', from: '森の低い所の木を切る・落ち枝を拾う' },
  { id: 'log_conifer', name: '針葉樹の丸太', icon: '🌲', from: '針葉樹を切る・落ち枝を拾う' },
  { id: 'foliage', name: '葉・つる', icon: '🍃', from: '木を切る・落ち葉を拾う' },
  { id: 'straw', name: '小麦わら', icon: '🌾', from: '小麦を収穫する' },
  { id: 'soil', name: '土', icon: '🟫', from: '掘る・整地で削る' },
  { id: 'reed', name: '葦', icon: '🎋', from: '湿地の葦を刈る（数日で生え戻る）' },
  { id: 'blossom', name: '花', icon: '🌸', from: '花を摘む' },
  { id: 'rock', name: '石', icon: '🪨', from: '岩を掘る・水辺の小石を拾う' },
  { id: 'clay', name: '粘土', icon: '🏺', from: '湿地の泥を掘る' },
  { id: 'sand', name: '砂', icon: '⏳', from: '砂を掘る・波打ち際で拾う' },
  { id: 'shell', name: '貝殻', icon: '🐚', from: '波打ち際で拾う' },
  { id: 'iron_ore', name: '鉄鉱石', icon: '⛓', from: '岩を深く掘る（まれ）' },
];
export const RAW = Object.fromEntries(RAWS.map((r) => [r.id, r])) as Record<RawId, RawDef>;

/** 素材：パレットの名前（build/palette.ts）。表示名と絵文字（アイコン画像が無い時に使う） */
export const MATERIALS: { id: string; name: string; icon: string }[] = [
  { id: 'wall', name: '木の壁', icon: '🟫' },
  { id: 'plank', name: '明るい木', icon: '🪵' },
  { id: 'wood', name: '濃い木', icon: '🚪' },
  { id: 'thatch', name: 'かやぶき', icon: '🌾' },
  { id: 'leaf', name: '植え込み・つた', icon: '🌿' },
  { id: 'flower', name: '花の飾り', icon: '💐' },
  { id: 'stone', name: '石', icon: '🧱' },
  { id: 'roof_blue', name: '青い屋根', icon: '🟦' },
  { id: 'roof', name: '赤い屋根', icon: '🟥' },
  { id: 'brick', name: 'れんが', icon: '🧱' },
  { id: 'white', name: 'しっくい', icon: '⬜' },
  { id: 'glass', name: 'ガラス', icon: '🪟' },
  { id: 'dark', name: '鉄', icon: '⛓' },
];
export const MATERIAL_NAME = Object.fromEntries(MATERIALS.map((m) => [m.id, m.name])) as Record<string, string>;
export const matKey = (id: string) => `m:${id}`;

/** 加工のしかた：原料 n 個 → 素材 out 個。同じ素材に 2 通りあるものもある */
export interface Recipe { id: string; mat: string; inputs: [RawId, number][]; out: number }
export const RECIPES: Recipe[] = [
  { id: 'wall-broad', mat: 'wall', inputs: [['log_broad', 1]], out: 4 },
  { id: 'wall-conifer', mat: 'wall', inputs: [['log_conifer', 1]], out: 4 },
  { id: 'plank', mat: 'plank', inputs: [['log_broad', 1]], out: 4 },
  { id: 'wood', mat: 'wood', inputs: [['log_conifer', 1]], out: 4 },
  { id: 'thatch-straw', mat: 'thatch', inputs: [['straw', 2]], out: 1 },
  { id: 'thatch-reed', mat: 'thatch', inputs: [['reed', 1]], out: 1 },
  { id: 'leaf', mat: 'leaf', inputs: [['foliage', 1]], out: 2 },
  { id: 'flower', mat: 'flower', inputs: [['blossom', 1]], out: 2 },
  { id: 'stone', mat: 'stone', inputs: [['rock', 1]], out: 4 },
  { id: 'roof_blue', mat: 'roof_blue', inputs: [['rock', 2]], out: 3 },
  { id: 'roof', mat: 'roof', inputs: [['clay', 2]], out: 3 },
  { id: 'brick', mat: 'brick', inputs: [['clay', 1]], out: 2 },
  { id: 'white-shell', mat: 'white', inputs: [['shell', 1]], out: 2 },
  { id: 'white-rock', mat: 'white', inputs: [['rock', 3]], out: 1 },
  { id: 'glass', mat: 'glass', inputs: [['sand', 2]], out: 1 },
  { id: 'dark', mat: 'dark', inputs: [['iron_ore', 1]], out: 2 },
];
export const RECIPE = Object.fromEntries(RECIPES.map((r) => [r.id, r])) as Record<string, Recipe>;

export type Inventory = Record<string, number>;
const have = (inv: Inventory, k: string) => inv[k] ?? 0;

/** その加工が何回できるか */
export const craftable = (inv: Inventory, r: Recipe) => Math.min(...r.inputs.map(([k, n]) => Math.floor(have(inv, k) / n)));

/** 加工する（times 回、できる分だけ）。実際にした回数を返す */
export function craft(inv: Inventory, r: Recipe, times = 1): number {
  const t = Math.max(0, Math.min(times, craftable(inv, r)));
  if (!t) return 0;
  for (const [k, n] of r.inputs) inv[k] = have(inv, k) - n * t;
  inv[matKey(r.mat)] = have(inv, matKey(r.mat)) + r.out * t;
  return t;
}

/** 建物のコスト（設計メモ 0 章・9 章）：素材は見える表面の広さ（1 素材＝1 マス²、切り上げ）、発見ポイントは体積の段階 */
export interface BuildCost { mats: Record<string, number>; points: number }

/** 発見ポイント：体積（マス³）が大きいほど多く、2〜15 */
export const buildPoints = (volume: number) => Math.max(2, Math.min(15, Math.round(2 + Math.sqrt(Math.max(0, volume)) * 0.8)));

export function buildCost(c: BuildingCharacter): BuildCost {
  const mats: Record<string, number> = {};
  for (const [m, a] of Object.entries(c.areas)) { const n = Math.ceil(a - 1e-9); if (n > 0) mats[m] = n; }
  return { mats, points: buildPoints(c.volume) };
}

/** 足りない素材（素材 → 足りない数）。足りていれば空 */
export function missingMats(inv: Inventory, cost: BuildCost): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [m, n] of Object.entries(cost.mats)) { const lack = n - have(inv, matKey(m)); if (lack > 0) out[m] = lack; }
  return out;
}

/** 素材を払う（足りなければ何もしないで false） */
export function payMats(inv: Inventory, cost: BuildCost): boolean {
  if (Object.keys(missingMats(inv, cost)).length) return false;
  for (const [m, n] of Object.entries(cost.mats)) inv[matKey(m)] = have(inv, matKey(m)) - n;
  return true;
}

/** 素材を戻す（建物を片付けた時。取られるのは時間だけ） */
export function refundMats(inv: Inventory, cost: BuildCost) {
  for (const [m, n] of Object.entries(cost.mats)) inv[matKey(m)] = have(inv, matKey(m)) + n;
}

/** 足す（原料を手に入れた時） */
export const gain = (inv: Inventory, k: string, n = 1) => { inv[k] = have(inv, k) + n; };
/** 使う（足りなければ false で何もしない） */
export function spend(inv: Inventory, k: string, n = 1): boolean {
  if (have(inv, k) < n) return false;
  inv[k] = have(inv, k) - n;
  return true;
}

/**
 * 拾う（放置で少し）：箱庭の 1 日あたりに拾える数。土地の型の列の数から
 *   森 → 落ち枝（丸太）・落ち葉、水辺 → 川原の小石、砂浜 → 砂・貝殻
 */
export function pickupPerDay(e: { forest: number; waterside: number; beach: number }): Partial<Record<RawId, number>> {
  return {
    log_broad: e.forest / 800, log_conifer: e.forest / 1600, foliage: e.forest / 300,
    rock: e.waterside / 400,
    sand: e.beach / 300, shell: e.beach / 800,
  };
}

/** 拾った分を足す。frac：端数のたまり（保存する）。dayFrac：進めた日数。足した原料の数を返す */
export function addPickup(inv: Inventory, frac: Record<string, number>, perDay: Partial<Record<RawId, number>>, dayFrac: number): number {
  let total = 0;
  for (const [k, r] of Object.entries(perDay)) {
    const v = (frac[k] ?? 0) + (r ?? 0) * dayFrac;
    const whole = Math.floor(v);
    frac[k] = v - whole;
    if (whole > 0) { gain(inv, k, whole); total += whole; }
  }
  return total;
}
