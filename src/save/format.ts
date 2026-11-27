import type { TerrainParams } from '../world/terrain';
import type { CropKind } from '../game/farm';
import type { BuildingDesign } from '../build/geoParse';
import type { Rot } from '../build/placement';
import type { GoalsState } from '../eco/goals';
import { migrateInventory } from '../game/materials';
import { FIELD_SHIFT, FRAME, OLD_FRAME, PLOT, PLOTS_PER_SIDE } from '../world/plots';

/**
 * セーブデータの形式。
 * 地形はシード値から毎回同じものを作れるので、「生成の設定＋変えた所（差分）」だけを保存する。
 * 形式を変えた時は SAVE_VERSION を上げ、migrate() で古い形式を読めるようにする。
 */
export const SAVE_VERSION = 6;

export interface SaveData {
  version: number;
  savedAt: number; // 保存した現実の時刻（ミリ秒）
  world: {
    seed: number;
    height: number;
    detail: number;
    flowerStyle: string;
    params: TerrainParams;
  };
  /** 開いた区画のマスク（world/plots.ts） */
  plots: number;
  /** 地形の差分：[ボクセルの番号, 種類, 番号, 種類, ...]。番号は枠の座標（v4〜は 320 の枠、v3 までは 256 の枠） */
  edits: number[];
  /** 進み具合。points：使える発見ポイント（v5〜 は 10 倍の整数。区画を開く＝30・建物＝2〜15）。rightsUsed は v4 まで（v5 では 0） */
  progress: { points: number; rightsUsed: number; unlocks: string[]; firsts: string[]; newMarks: string[] };
  /** 図鑑（段階 ② で使う） */
  dex: Record<string, { seenAt: number; observedAt?: number; seasons: number[] }>;
  /** 住人（段階 ② で使う） */
  /** treatedUntil：おすそ分けの効き目が続く期限（箱庭の時計 simMs。v0.16.1。無ければ効いていない） */
  residents: [species: string, x: number, z: number, name: string, treatedUntil?: number][];
  farm: {
    simMs: number; // 箱庭内の時計
    inventory: Record<string, number>;
    crops: [col: number, kind: CropKind, progress: number][];
    saplings: [col: number, variant: number, rot: number, progress: number][];
    wet: [col: number, until: number][];
    /** 植えた花（列, 花の形）。無ければ無し */
    flowers?: [col: number, variant: number][];
    /** むき出しの土の列と、むき出しになった時刻（1 日ほどで草地になる。v0.13） */
    bare?: [col: number, since: number][];
    /** 移り変わりで枯れた、生成された花の列（v0.13） */
    faded?: number[];
    /** 移り変わりを最後に進めた日（箱庭の時計の日数。v0.13） */
    natureDay?: number;
    /** 刈った葦の列と、生え戻る時刻（v0.14） */
    reedCut?: [col: number, at: number][];
    /** 拾う：最後に足した時刻と、原料ごとの端数（v0.14） */
    pickup?: { at: number; frac: Record<string, number> };
  };
  /** 建物（v3）：棚に入れた建物と、置いた場所（x, z は枠のボクセル座標、rot は 90° 刻み）。
   *  progress は建設の進み具合（0〜1）。建ち終わった建物と古い記録には無い（＝完成）。
   *  paid は素材と発見ポイントを払って建てた印（1。v0.14〜。片付けると戻す） */
  buildings: { designs: BuildingDesign[]; placed: [designId: string, x: number, z: number, rot: Rot, progress?: number, paid?: number][] };
  /** 季節の目標（v0.17。eco/goals.ts。無ければ、読み込んだ時の季節で作る） */
  goals?: GoalsState;
}

/** v1（大きさを選んで作った箱庭）のデータ。地形の作り方が変わったので引き継げない */
export class OldSaveError extends Error {
  constructor() { super('古い形式のため新しく始めます'); this.name = 'OldSaveError'; }
}

/** 古い形式のデータを今の形式にそろえる */
function migrate(d: SaveData): SaveData {
  if (d.version > SAVE_VERSION) throw new Error('新しいバージョンで保存されたデータです。アプリを更新してください。');
  if (d.version < 2) throw new OldSaveError();
  // v2 → v3：建物の棚を空で足す
  if (d.version < 3) d = { ...d, version: 3, buildings: { designs: [], placed: [] } };
  // v3 → v4：枠を 256×256（4×4 区画）から 320×320（5×5 区画、最初の区画が真ん中）に広げた。座標を 1 区画ぶんずらす
  if (d.version < 4) d = toFrame5(d);
  // v4 → v5：土地の権利をなくし、発見ポイントに一本化（10 倍にし、使った権利 1 つ＝30 を引く）。木材は広葉樹の丸太に
  if (d.version < 5) d = toPoints10(d);
  // v5 → v6：原料 12 種類・素材 13 種類をやめ、素材 5 つ（木材・繊維・石材・鉱物・土）に（v0.20）
  if (d.version < 6) d = toMats6(d);
  return d;
}

export function toMats6(d: SaveData): SaveData {
  const pickup = d.farm.pickup ? { ...d.farm.pickup, frac: {} } : undefined;
  return { ...d, version: 6, farm: { ...d.farm, inventory: migrateInventory(d.farm.inventory), ...(pickup ? { pickup } : {}) } };
}

export function toPoints10(d: SaveData): SaveData {
  const inv = { ...d.farm.inventory };
  if (inv.wood) { inv.log_broad = (inv.log_broad ?? 0) + inv.wood; }
  delete inv.wood;
  return {
    ...d, version: 5,
    progress: { ...d.progress, points: Math.max(0, d.progress.points * 10 - d.progress.rightsUsed * 30), rightsUsed: 0 },
    farm: { ...d.farm, inventory: inv },
  };
}

/**
 * v3 までの保存（256 の枠）を、v4 の枠（320、1 区画ぶん右下へずらす）に移す。
 * 地形は場の座標（枠の座標 − FIELD_SHIFT）で作るので、ずらした所に前と同じ地形ができる
 */
export function toFrame5(d: SaveData): SaveData {
  const O = OLD_FRAME, N = FRAME, S = FIELD_SHIFT;
  const col = (c: number) => (c % O) + S + (Math.floor(c / O) + S) * N;
  const vox = (i: number) => { const x = i % O, z = Math.floor(i / O) % O, y = Math.floor(i / (O * O)); return x + S + (z + S) * N + y * N * N; };
  const oldSide = O / PLOT, shift = S / PLOT;
  let plots = 0;
  for (let p = 0; p < oldSide * oldSide; p++) if (d.plots & (1 << p)) plots |= 1 << ((p % oldSide) + shift + (Math.floor(p / oldSide) + shift) * PLOTS_PER_SIDE);
  const edits: number[] = [];
  for (let i = 0; i + 1 < d.edits.length; i += 2) edits.push(vox(d.edits[i]), d.edits[i + 1]);
  const f = d.farm;
  return {
    ...d, version: 4, plots, edits,
    residents: d.residents.map(([sp, x, z, name, t]) => (t === undefined ? [sp, x + S, z + S, name] : [sp, x + S, z + S, name, t])),
    farm: {
      ...f,
      crops: f.crops.map(([c, k, p]) => [col(c), k, p]),
      saplings: f.saplings.map(([c, v, r, p]) => [col(c), v, r, p]),
      wet: f.wet.map(([c, u]) => [col(c), u]),
      ...(f.flowers ? { flowers: f.flowers.map(([c, v]) => [col(c), v] as [number, number]) } : {}),
      ...(f.bare ? { bare: f.bare.map(([c, t]) => [col(c), t] as [number, number]) } : {}),
      ...(f.faded ? { faded: f.faded.map(col) } : {}),
    },
    buildings: { ...d.buildings, placed: d.buildings.placed.map(([id, x, z, rot, pr]) => (pr === undefined ? [id, x + S, z + S, rot] : [id, x + S, z + S, rot, pr])) },
  };
}

/** JSON → gzip 圧縮したバイト列 */
export async function encodeSave(d: SaveData): Promise<Uint8Array> {
  const json = new TextEncoder().encode(JSON.stringify(d));
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** gzip 圧縮したバイト列 → JSON */
export async function decodeSave(bytes: Uint8Array): Promise<SaveData> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  const text = await new Response(stream).text();
  const d = JSON.parse(text) as SaveData;
  if (typeof d.version !== 'number' || !d.world || !Array.isArray(d.edits)) throw new Error('箱庭のセーブデータではありません');
  return migrate(d);
}
