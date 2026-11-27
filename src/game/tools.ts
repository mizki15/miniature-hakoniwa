import { DIRT, FARMLAND, GRASS, WET_FARMLAND } from '../world/blocks';
import { CROPS, CROP_KINDS, type CropKind, type Farm } from './farm';
import type { MatId } from './materials';

/**
 * 道具の定義（v0.18。レジストリ）：名前・アイコン・説明・グループと、使えるかの判定（check）・使った時の処理（apply）を 1 か所に持つ。
 * GameController は、ここにある道具なら switch を通らずにこれを呼ぶ。main.ts の道具のグループもここから作る。
 * three.js に依存しない（テストで使えるように）。まずは畑の 4 つ（耕す・種まき・水やり・収穫）。ほかの道具は順に移す
 */
export type ToolGroup = 'build' | 'life' | 'terrain';

/** 道具を向けたマス */
export interface ToolAt {
  x: number; y: number; z: number; col: number;
  /** そのマスのブロックの種類 */
  block: number;
  /** 上の面を指しているか、そのマスが列のいちばん上か */
  topFace: boolean; isTop: boolean;
}

/** 道具が使える、箱庭の操作（GameController が渡す） */
export interface ToolCtx {
  farm: Farm;
  /** 種まきでまく作物（選んでいる種） */
  seed: CropKind;
  isTree(col: number): boolean;
  setVoxel(x: number, y: number, z: number, block: number): void;
  removeFlowersAt(x: number, z: number): void;
  addFarmland(col: number): void;
  /** 作物の作り直しの印（数が変わった） */
  markCrops(): void;
  gain(mat: MatId, n: number): void;
  /** 小麦を収穫した時に、わらがいくつ多いか（ひつじの仕事） */
  extraStraw(): number;
  /** 季節の目標に数える */
  goalEvent(e: { k: 'till' } | { k: 'harvest'; crop: CropKind }): void;
}

/** 道具のグループに並べる 1 項目（種まきは作物ごとに分かれる） */
export interface ToolOption { id: string; icon: string; name: string; help: string }

export interface ToolDef<Id extends string = string> {
  id: Id; name: string; icon: string; help: string; group: ToolGroup;
  /** グループに並べる項目（無ければ道具そのもの 1 つ） */
  options?(): ToolOption[];
  /** 使えるか（msg はカーソルの横に出す文） */
  check(ctx: ToolCtx, at: ToolAt): { ok: boolean; msg: string };
  /** 使う（check が ok の時だけ呼ぶ）。結果の文 */
  apply(ctx: ToolCtx, at: ToolAt): string | null;
}

const isFarm = (t: number) => t === FARMLAND || t === WET_FARMLAND;
const ok = (msg: string) => ({ ok: true, msg }), no = (msg: string) => ({ ok: false, msg });
export const CROP_ICONS: Record<CropKind, string> = { turnip: '⚪', carrot: '🥕', strawberry: '🍓', cabbage: '🥬', wheat: '🌾', tomato: '🍅', eggplant: '🍆', sunflower: '🌻', corn: '🌽', pumpkin: '🎃' };

const till: ToolDef<'till'> = {
  id: 'till', name: '耕す', icon: '⛏', help: '草地や土を耕して畑にする', group: 'life',
  check(ctx, a) {
    if (!a.topFace || !a.isTop) return no('地面の上面を選んでください');
    if (ctx.isTree(a.col)) return no('木の根元は耕せません');
    if (isFarm(a.block)) return no('もう耕してあります');
    if (a.block !== GRASS && a.block !== DIRT) return no('草地か土の所だけ耕せます');
    return ok('耕す');
  },
  apply(ctx, a) {
    ctx.removeFlowersAt(a.x, a.z);
    ctx.setVoxel(a.x, a.y, a.z, FARMLAND);
    ctx.addFarmland(a.col);
    ctx.goalEvent({ k: 'till' });
    return '耕しました';
  },
};

const seed: ToolDef<'seed'> = {
  id: 'seed', name: '種まき', icon: '🌱', help: '畑に種をまく', group: 'life',
  options: () => CROP_KINDS.map((k) => ({ id: `seed:${k}`, icon: CROP_ICONS[k], name: `${CROPS[k].name}の種`, help: `畑にまく。育つまで ${CROPS[k].hours} 時間` })),
  check(ctx, a) {
    if (!isFarm(a.block) || !a.isTop) return no('畑に種をまけます');
    if (ctx.farm.crops.has(a.col)) return no('もう植えてあります');
    return ok(`${CROPS[ctx.seed].name}の種をまく`);
  },
  apply(ctx, a) {
    ctx.farm.plant(a.col, ctx.seed);
    ctx.markCrops();
    return `${CROPS[ctx.seed].name}の種をまきました`;
  },
};

const water: ToolDef<'water'> = {
  id: 'water', name: '水やり', icon: '💧', help: '畑に水をやる（6 時間、倍の速さで育つ）', group: 'life',
  check(ctx, a) {
    if (!isFarm(a.block) || !a.isTop) return no('畑に水をやれます');
    return ok(ctx.farm.isWateredNow(a.col) ? 'もう湿っています（延長）' : '水をやる');
  },
  apply(ctx, a) {
    ctx.farm.water(a.col);
    ctx.setVoxel(a.x, a.y, a.z, WET_FARMLAND);
    return '水をやりました';
  },
};

const harvest: ToolDef<'harvest'> = {
  id: 'harvest', name: '収穫', icon: '🧺', help: '育ちきった作物を収穫する', group: 'life',
  check(ctx, a) {
    const c = ctx.farm.crops.get(a.col);
    if (!c || !a.isTop) return no('作物がありません');
    if (c.progress < 1) return no(`${CROPS[c.kind].name}：育ち具合 ${Math.floor(c.progress * 100)}%`);
    return ok(`${CROPS[c.kind].name}を収穫`);
  },
  apply(ctx, a) {
    const kind = ctx.farm.harvest(a.col);
    ctx.markCrops();
    if (!kind) return null;
    ctx.goalEvent({ k: 'harvest', crop: kind });
    // ひつじがいると、わらが 1 つ多い（住人の仕事）
    if (kind === 'wheat') { const n = 1 + ctx.extraStraw(); ctx.gain('fiber', n); return `小麦を収穫しました（わら：繊維 +${n}）`; }
    return `${CROPS[kind].name}を収穫しました`;
  },
};

/** レジストリに移した道具 */
export const TOOL_DEFS = [till, seed, water, harvest] as const;
export type RegistryTool = (typeof TOOL_DEFS)[number]['id'];
const BY_ID = new Map<string, ToolDef>(TOOL_DEFS.map((d) => [d.id, d as ToolDef]));
export const toolDef = (id: string): ToolDef | undefined => BY_ID.get(id);
/** グループに並べる項目（レジストリの道具だけ。並び順は TOOL_DEFS の順） */
export const registryOptions = (group: ToolGroup): ToolOption[] =>
  TOOL_DEFS.filter((d) => d.group === group).flatMap((d) => (d as ToolDef).options?.() ?? [{ id: d.id, icon: d.icon, name: d.name, help: d.help }]);
