import { describe, it, expect } from 'vitest';
import { PATHS, TILE_H, buildPathTile, pathIndex, pathOfIndex } from './paths';

describe('path tiles (v0.20.3)', () => {
  it('five kinds, numbered 1–5 for the save', () => {
    expect(PATHS.map((p) => p.id)).toEqual(['dirt', 'gravel', 'cobble', 'plank', 'brick']);
    for (const p of PATHS) expect(pathOfIndex(pathIndex(p.id))).toBe(p.id);
    expect(pathOfIndex(0)).toBeNull();
    expect(pathOfIndex(9)).toBeNull();
    expect(PATHS[0].cost).toBeNull(); // 土の道は素材が要らない
  });
  it('each tile is one block wide and only 1/8 block high', () => {
    for (const p of PATHS) {
      const g = buildPathTile(p.id);
      g.computeBoundingBox();
      const b = g.boundingBox!;
      expect(b.min.y).toBeCloseTo(0, 5);
      expect(b.max.y, p.id).toBeLessThanOrEqual(TILE_H * 1.2); // 砂利の粒だけ少しはみ出してよい
      expect(b.max.x - b.min.x, p.id).toBeLessThanOrEqual(1.0001);
      expect(b.max.z - b.min.z, p.id).toBeLessThanOrEqual(1.0001);
      expect(b.max.x - b.min.x, p.id).toBeGreaterThan(0.9);
    }
  });
});
