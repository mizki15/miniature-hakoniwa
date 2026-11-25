import { describe, it, expect } from 'vitest';
import { Farm, SAPLING_HOURS } from './farm';

const HOUR = 3600_000;
const env = { season: 0, raining: false, isWet: () => true };

describe('Farm.advance tells what changed (v0.18)', () => {
  it('crop stages', () => {
    const f = new Farm();
    f.plant(1, 'turnip'); // 1.5 時間で育つ
    expect(f.advance(0.1 * HOUR, env)).toEqual({ crops: false, saplings: false, matured: false });
    expect(f.advance(0.4 * HOUR, env).crops).toBe(true); // 0.25 を越えた
  });
  it('saplings grow a little (size only) or change shape (matured)', () => {
    const f = new Farm();
    f.plantSapling(2, 0, 0);
    const small = f.advance((SAPLING_HOURS / 20) * 1.01 * HOUR, env);
    expect(small).toMatchObject({ saplings: true, matured: false });
    const tree = f.advance(SAPLING_HOURS * 0.2 * HOUR, env); // 0.25 を越えて小さな木に
    expect(tree).toMatchObject({ saplings: true, matured: true });
    expect(f.advance(SAPLING_HOURS * HOUR, env).matured).toBe(true); // 育ちきった
    expect(f.advance(HOUR, env)).toEqual({ crops: false, saplings: false, matured: false });
  });
});
