import { DEFAULT_PARAMS, type TerrainParams } from './terrain';

/**
 * テスト用：v0.16.1 までの地形のパラメータの初期値。
 * 地形が前と同じかを確かめるテストは、初期値が変わっても（v0.16.2）この値で作る（保存した箱庭は、作った時の値を持っている）
 */
export const V0161_PARAMS: TerrainParams = {
  ...DEFAULT_PARAMS,
  relief: 0.4, mountains: 0.8, water: 1, rocks: 0.8, forest: 0.5, flowers: 1.6,
  lakes: 1, cliffs: 1, wetland: 1, pools: 1, beachWidth: 1, islandEdge: 1, islandDetail: 1, biomeSize: 1,
};
