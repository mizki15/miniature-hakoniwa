import { describe, it, expect } from 'vitest';
import { placeGround } from './groundDecor';
import { FARMLAND, GRASS, PATH, STONE, WATER } from '../world/blocks';

const N = 64, H = 16;
function world(top: number, waterAbove = false) {
  const v = new Uint8Array(N * N * H);
  v.fill(top, 3 * N * N, 4 * N * N);
  if (waterAbove) v.fill(WATER, 4 * N * N, 5 * N * N);
  const heights = new Int16Array(N * N).fill(4);
  return { v, heights };
}
const count = (p: ReturnType<typeof placeGround>) => [...p.pebbles, ...p.grass].reduce((n, l) => n + l.length / 5, 0);

describe('ground decor', () => {
  it('grass gets tufts (and a few pebbles), sitting on the top surface', () => {
    const { v, heights } = world(GRASS);
    const p = placeGround(v, heights, N, H, 1, () => false);
    const grass = p.grass.reduce((n, l) => n + l.length / 5, 0);
    expect(grass).toBeGreaterThan(N * N * 0.08);
    expect(grass).toBeLessThan(N * N * 0.2);
    for (const l of p.grass) for (let i = 1; i < l.length; i += 5) expect(l[i]).toBe(4);
  });
  it('density scales the amount; 0 places nothing', () => {
    const { v, heights } = world(STONE);
    const a = count(placeGround(v, heights, N, H, 1, () => false));
    const b = count(placeGround(v, heights, N, H, 3, () => false));
    expect(b).toBeGreaterThan(a * 2.5);
    expect(count(placeGround(v, heights, N, H, 0, () => false))).toBe(0);
  });
  it('nothing on artificial blocks, under water, or on skipped columns', () => {
    for (const t of [PATH, FARMLAND]) { const { v, heights } = world(t); expect(count(placeGround(v, heights, N, H, 4, () => false))).toBe(0); }
    const w = world(GRASS, true);
    expect(count(placeGround(w.v, w.heights, N, H, 4, () => false))).toBe(0);
    const g = world(GRASS);
    expect(count(placeGround(g.v, g.heights, N, H, 4, () => true))).toBe(0);
  });
  it('the same column always gets the same thing', () => {
    const { v, heights } = world(GRASS);
    expect(placeGround(v, heights, N, H, 1, () => false)).toEqual(placeGround(v, heights, N, H, 1, () => false));
  });
});
