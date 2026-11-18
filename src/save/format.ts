import type { TerrainParams } from '../world/terrain';
import type { CropKind } from '../game/farm';
import type { BuildingDesign } from '../build/geoParse';
import type { Rot } from '../build/placement';

/**
 * セーブデータの形式。
 * 地形はシード値から毎回同じものを作れるので、「生成の設定＋変えた所（差分）」だけを保存する。
 * 形式を変えた時は SAVE_VERSION を上げ、migrate() で古い形式を読めるようにする。
 */
export const SAVE_VERSION = 3;

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
  /** 地形の差分：[ボクセルの番号, 種類, 番号, 種類, ...]。番号は 256 の枠の座標 */
  edits: number[];
  /** 進み具合（発見ポイントと土地の権利。権利の残り = floor(points / 3) - rightsUsed） */
  progress: { points: number; rightsUsed: number; unlocks: string[]; firsts: string[]; newMarks: string[] };
  /** 図鑑（段階 ② で使う） */
  dex: Record<string, { seenAt: number; observedAt?: number; seasons: number[] }>;
  /** 住人（段階 ② で使う） */
  residents: [species: string, x: number, z: number, name: string][];
  farm: {
    simMs: number; // 箱庭内の時計
    inventory: Record<string, number>;
    crops: [col: number, kind: CropKind, progress: number][];
    saplings: [col: number, variant: number, rot: number, progress: number][];
    wet: [col: number, until: number][];
  };
  /** 建物（v3）：棚に入れた建物と、置いた場所（x, z は枠のボクセル座標、rot は 90° 刻み） */
  buildings: { designs: BuildingDesign[]; placed: [designId: string, x: number, z: number, rot: Rot][] };
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
  return d;
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
