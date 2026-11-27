/**
 * 素材（v0.20。設計メモ 7 章を簡単にした）：木材・繊維・石材・鉱物・土の 5 つだけ。three.js に頼らない。
 *   v0.19 までの「原料 12 種類 → 加工 → 素材 13 種類（建物の色ごと）」はやめた。加工は無い
 *   手に入れ方：ブロックを掘る（ブロックごとに素材の割合がある）・木を切る・摘む・刈る・収穫する・拾う（放置で少し）
 *   建物：直方体ごとに素材がある（グループの名前の頭。build/palette.ts）。色は自由
 * 持ち物（Farm.inventory）のキー：素材はその id（wood など）、収穫物は作物の id（turnip など）。上限は付けない。
 */
import type { BuildingCharacter } from '../build/character';
import { MAT_IDS, type MatId } from '../build/palette';
import { COBBLE, CONIFER, DIRT, FARMLAND, GRASS, LEAVES, LOG, MUD, PATH, SAND, STONE, WET_FARMLAND } from '../world/blocks';

export { MAT_IDS, type MatId };

export interface MatDef { id: MatId; name: string; icon: string; from: string }
export const MATS: MatDef[] = [
  { id: 'wood', name: '木材', icon: '🪵', from: '木を切る・森で落ち枝を拾う・丸太のブロックを掘る' },
  { id: 'fiber', name: '繊維', icon: '🌾', from: '葉・わら・葦・花：木を切る・小麦を収穫する・葦を刈る・花を摘む・草地や葉のブロックを掘る' },
  { id: 'stone', name: '石材', icon: '🪨', from: '岩や石畳を掘る・水辺の小石を拾う' },
  { id: 'mineral', name: '鉱物', icon: '💎', from: '砂を掘る・岩を深く掘る（まれ）・波打ち際で砂や貝殻を拾う' },
  { id: 'soil', name: '土', icon: '🟫', from: '土・泥・畑・道を掘る（泥は粘土を多く含む）' },
];
export const MAT = Object.fromEntries(MATS.map((m) => [m.id, m])) as Record<MatId, MatDef>;
export const MAT_NAME = Object.fromEntries(MATS.map((m) => [m.id, m.name])) as Record<MatId, string>;
export const isMat = (k: string): k is MatId => (MAT_IDS as string[]).includes(k);

/** 素材の量（素材 → 数） */
export type MatAmounts = Partial<Record<MatId, number>>;
/** 「木材 3・繊維 2」 */
export const matsText = (a: MatAmounts) => MAT_IDS.filter((m) => (a[m] ?? 0) > 0).map((m) => `${MAT_NAME[m]} ${a[m]}`).join('・');

/**
 * ブロックを掘る・削ると手に入る素材（ブロック 1 つあたり。割合の合計が 1）。
 * 端数はたまっていき、1 になった所で持ち物に入る（たとえば草地を 5 回掘ると、土 4・繊維 1）
 */
export const BLOCK_YIELD: Record<number, MatAmounts> = {
  [GRASS]: { soil: 0.8, fiber: 0.2 },
  [DIRT]: { soil: 1 },
  [FARMLAND]: { soil: 1 }, [WET_FARMLAND]: { soil: 1 }, [PATH]: { soil: 1 },
  [MUD]: { soil: 0.8, mineral: 0.2 },
  [STONE]: { stone: 1 },
  [COBBLE]: { stone: 1 },
  [SAND]: { mineral: 0.7, soil: 0.3 },
  [LOG]: { wood: 1 },
  [LEAVES]: { fiber: 1 }, [CONIFER]: { fiber: 1 },
};
/** ブロックを置く・道を敷くのに要る素材（割合のいちばん大きい素材を 1 つ） */
export function blockCost(block: number): MatAmounts | null {
  const y = BLOCK_YIELD[block];
  if (!y) return null;
  let best: MatId | null = null;
  for (const m of MAT_IDS) if ((y[m] ?? 0) > (best ? y[best] ?? 0 : 0)) best = m;
  return best ? { [best]: 1 } : null;
}

/** 木を 1 本切ると（くまがいると木材がもう 1） */
export const TREE_YIELD: MatAmounts = { wood: 3, fiber: 2 };

/**
 * 建物のコスト（設計メモ 0 章・9 章）：素材は見える表面の広さ（2 マス²につき 1 素材、切り上げ）、発見ポイントは体積の段階。
 * v0.16.1：1 マス²につき 1 素材だと重すぎたので半分にした
 */
export const MATS_PER_AREA = 0.5;
export interface BuildCost { mats: MatAmounts; points: number }

/** 発見ポイント：体積（マス³）が大きいほど多く、2〜15 */
export const buildPoints = (volume: number) => Math.max(2, Math.min(15, Math.round(2 + Math.sqrt(Math.max(0, volume)) * 0.8)));

export function buildCost(c: Pick<BuildingCharacter, 'areas' | 'volume'>): BuildCost {
  const mats: MatAmounts = {};
  for (const m of MAT_IDS) { const n = Math.ceil((c.areas[m] ?? 0) * MATS_PER_AREA - 1e-9); if (n > 0) mats[m] = n; }
  return { mats, points: buildPoints(c.volume) };
}

export type Inventory = Record<string, number>;
const have = (inv: Inventory, k: string) => inv[k] ?? 0;

/** 足りない素材（素材 → 足りない数）。足りていれば空 */
export function missingMats(inv: Inventory, cost: { mats: MatAmounts }): MatAmounts {
  const out: MatAmounts = {};
  for (const m of MAT_IDS) { const lack = (cost.mats[m] ?? 0) - have(inv, m); if (lack > 0) out[m] = lack; }
  return out;
}

/** 素材を払う（足りなければ何もしないで false） */
export function payMats(inv: Inventory, cost: { mats: MatAmounts }): boolean {
  if (Object.keys(missingMats(inv, cost)).length) return false;
  for (const m of MAT_IDS) if (cost.mats[m]) inv[m] = have(inv, m) - cost.mats[m]!;
  return true;
}

/** 素材を戻す（建物を片付けた時。取られるのは時間だけ） */
export function refundMats(inv: Inventory, cost: { mats: MatAmounts }) {
  for (const m of MAT_IDS) if (cost.mats[m]) inv[m] = have(inv, m) + cost.mats[m]!;
}

/** 足す */
export const gain = (inv: Inventory, k: string, n = 1) => { inv[k] = have(inv, k) + n; };
/** 使う（足りなければ false で何もしない） */
export function spend(inv: Inventory, k: string, n = 1): boolean {
  if (have(inv, k) < n) return false;
  inv[k] = have(inv, k) - n;
  return true;
}

/** 端数のある量を足す（frac に端数をためる。キーは prefix＋素材）。持ち物に入った数を返す */
export function addFractional(inv: Inventory, frac: Record<string, number>, amounts: MatAmounts, times = 1, prefix = ''): MatAmounts {
  const got: MatAmounts = {};
  for (const m of MAT_IDS) {
    const r = amounts[m];
    if (!r) continue;
    const v = (frac[prefix + m] ?? 0) + r * times;
    const whole = Math.floor(v + 1e-9);
    frac[prefix + m] = v - whole;
    if (whole > 0) { gain(inv, m, whole); got[m] = whole; }
  }
  return got;
}

/**
 * 拾う（放置で少し）：箱庭の 1 日あたりに拾える数。土地の型の列の数から
 *   森 → 落ち枝（木材）・落ち葉（繊維）、水辺 → 川原の小石（石材）、砂浜 → 砂と貝殻（鉱物）
 */
export function pickupPerDay(e: { forest: number; waterside: number; beach: number }): MatAmounts {
  return { wood: e.forest / 600, fiber: e.forest / 300, stone: e.waterside / 400, mineral: e.beach / 250 };
}

/** 拾った分を足す。frac：端数のたまり（保存する）。dayFrac：進めた日数。足した数を返す */
export function addPickup(inv: Inventory, frac: Record<string, number>, perDay: MatAmounts, dayFrac: number): number {
  const got = addFractional(inv, frac, perDay, dayFrac);
  return Object.values(got).reduce((a, b) => a + (b ?? 0), 0);
}

/**
 * v0.19 までの持ち物（原料 12 種類・素材 13 種類「m:色」）を、5 つの素材に移す（保存の版 6）。
 * 原料 1 つ ≒ 素材 1 つ。加工した素材は、作るのに使った原料の数に戻す（丸太 1 → 壁 4 なら、壁 4 → 木材 1）
 */
const OLD_TO_MAT: Record<string, [MatId, number]> = {
  log_broad: ['wood', 1], log_conifer: ['wood', 1], foliage: ['fiber', 1], straw: ['fiber', 1], reed: ['fiber', 1], blossom: ['fiber', 1],
  soil: ['soil', 1], clay: ['soil', 1], rock: ['stone', 1], sand: ['mineral', 1], shell: ['mineral', 1], iron_ore: ['mineral', 2],
  'm:wall': ['wood', 0.25], 'm:plank': ['wood', 0.25], 'm:wood': ['wood', 0.25], 'm:thatch': ['fiber', 1], 'm:leaf': ['fiber', 0.5], 'm:flower': ['fiber', 0.5],
  'm:stone': ['stone', 0.25], 'm:roof_blue': ['stone', 0.67], 'm:roof': ['soil', 0.67], 'm:brick': ['soil', 0.5],
  'm:white': ['mineral', 0.5], 'm:glass': ['mineral', 2], 'm:dark': ['mineral', 0.5],
};
export function migrateInventory(inv: Inventory): Inventory {
  const out: Inventory = {};
  const add: Partial<Record<MatId, number>> = {};
  for (const [k, n] of Object.entries(inv)) {
    const to = OLD_TO_MAT[k];
    if (to) add[to[0]] = (add[to[0]] ?? 0) + n * to[1];
    else if (!isMat(k)) out[k] = n; // 収穫物などはそのまま
    else add[k] = (add[k] ?? 0) + n;
  }
  for (const m of MAT_IDS) { const v = Math.round(add[m] ?? 0); if (v > 0) out[m] = v; }
  return out;
}
