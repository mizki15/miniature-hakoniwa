import { createWorld, type World } from '../world/terrain';
import { DIRT, GRASS } from '../world/blocks';
import { FRAME, plotOfCol } from '../world/plots';

/**
 * テスト用の小さな世界：x, z = 64〜127 の区画だけを開いた、高さ 12 の草地。
 * x = 70〜73 は浅い水（地面の高さ 8）、x = 80 は深い水（地面の高さ 6）。水面は 10。
 */
export function testWorld(): World {
  const w = createWorld(16);
  w.plots = 1 << plotOfCol(64, 64);
  const NN = FRAME * FRAME;
  for (let z = 64; z < 128; z++) for (let x = 64; x < 128; x++) {
    const col = x + z * FRAME;
    const water = x >= 70 && x <= 73 ? 8 : x === 80 ? 6 : 0;
    const h = water || 12;
    w.heights[col] = h;
    w.walkable[col] = water ? 0 : 1;
    for (let y = 0; y < h; y++) w.voxels[col + y * NN] = y === h - 1 && !water ? GRASS : DIRT;
  }
  return w;
}
