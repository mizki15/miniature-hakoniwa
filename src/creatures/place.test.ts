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

describe('leaving a building footprint', () => {
  it('movesOutOfTwelveWideBuilding', () => {
    // 12×12 の建物の足元（歩けない）のまん中にいても、半径 8 以内の外に出られる
    const w = testWorld();
    for (let z = 84; z < 96; z++) for (let x = 84; x < 96; x++) w.walkable[x + z * w.size] = 0;
    const to = restorePlace(w, 90, 90)!;
    expect(to).not.toBeNull();
    expect(w.walkable[to[0] + to[1] * w.size]).toBe(1);
  });
});

describe('placeResident by land type (v0.16)', () => {
  it('goes to its favourite land type when codes are given', () => {
    const w = testWorld();
    const codes = new Uint8Array(FRAME * FRAME);
    // 歩ける列のうち、x = 90 の列だけ湿地（9）、x = 95 の列だけ岩場（8）
    for (let z = 0; z < FRAME; z++) { codes[90 + z * FRAME] = 9; codes[95 + z * FRAME] = 8; }
    for (let i = 0; i < 10; i++) {
      expect(placeResident(w, 'capybara', Math.random, undefined, { codes })![0]).toBe(90);
      expect(placeResident(w, 'stoat', Math.random, undefined, { codes })![0]).toBe(95);
    }
  });
  it('the cat stays near the houses', () => {
    const w = testWorld();
    const b = new Set([100 + 100 * FRAME]);
    for (let i = 0; i < 10; i++) {
      const p = placeResident(w, 'cat', Math.random, undefined, { buildingCols: b })!;
      expect(Math.max(Math.abs(p[0] - 100), Math.abs(p[1] - 100))).toBeLessThanOrEqual(4);
    }
  });
});
