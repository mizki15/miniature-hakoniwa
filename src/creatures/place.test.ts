import { describe, it, expect } from 'vitest';
import { placeResident, restorePlace } from './place';
import { testWorld } from '../eco/testWorld';
import { FRAME } from '../world/plots';

describe('restorePlace', () => {
  it('restorePlaceKeepsWalkable', () => {
    expect(restorePlace(testWorld(), 90, 90)).toEqual([90, 90]);
  });
  it('restorePlaceMovesOffWater', () => {
    // x=71 は浅い水。一番近い歩ける列は x=69（距離 2）か x=74（距離 3）
    expect(restorePlace(testWorld(), 71, 90)).toEqual([69, 90]);
  });
  it('restorePlaceGivesUpFar', () => {
    // 開いていない区画のまん中（どこも歩けない）
    expect(restorePlace(testWorld(), 10, 10)).toBeNull();
  });
});

describe('placeResident', () => {
  it('duckPlacedAtWaterside', () => {
    const w = testWorld();
    for (let i = 0; i < 20; i++) {
      const p = placeResident(w, 'duck')!;
      const col = p[0] + p[1] * FRAME;
      expect(w.walkable[col]).toBe(1);
      expect([69, 74, 79, 81]).toContain(p[0]);
    }
  });
  it('squirrel goes near a tree', () => {
    const w = testWorld();
    const tree = 100 + 100 * FRAME;
    const p = placeResident(w, 'squirrel', Math.random, new Set([tree]))!;
    expect(Math.abs(p[0] - 100) + Math.abs(p[1] - 100)).toBeLessThanOrEqual(8);
  });
});
