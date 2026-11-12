import type { TerrainParams } from '../world/terrain';
import type { CropKind } from '../game/farm';

/**
 * セーブデータの形式。
 * 地形はシード値から毎回同じものを作れるので、「生成の設定＋変えた所（差分）」だけを保存する。
 * 形式を変えた時は SAVE_VERSION を上げ、migrate() で古い形式を読めるようにする。
 */
export const SAVE_VERSION = 1;

export interface SaveData {
  version: number;
  savedAt: number; // 保存した現実の時刻（ミリ秒）
  world: {
    seed: number;
    size: number;
    height: number;
    detail: number;
    flowerStyle: string;
    params: TerrainParams;
  };
  /** 地形の差分：[ボクセルの番号, 種類, 番号, 種類, ...] */
  edits: number[];
  farm: {
    simMs: number; // 箱庭内の時計
    inventory: Record<string, number>;
    crops: [col: number, kind: CropKind, progress: number][];
    saplings: [col: number, variant: number, rot: number, progress: number][];
    wet: [col: number, until: number][];
  };
}

/** 古い形式のデータを今の形式にそろえる（今は v1 だけ） */
function migrate(d: SaveData): SaveData {
  if (d.version > SAVE_VERSION) throw new Error('新しいバージョンで保存されたデータです。アプリを更新してください。');
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
