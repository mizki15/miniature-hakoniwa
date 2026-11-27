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

describe('ten crops (v0.20.1)', () => {
  it('each has a name, a growing time and seasons (none grow in winter)', async () => {
    const { CROPS, CROP_KINDS } = await import('./farm');
    expect(CROP_KINDS.length).toBe(10);
    for (const k of CROP_KINDS) { expect(CROPS[k].name).toBeTruthy(); expect(CROPS[k].hours).toBeGreaterThan(0); expect(CROPS[k].seasons.length).toBeGreaterThan(0); expect(CROPS[k].seasons).not.toContain(3); }
    // どの季節（冬以外）にも、旬の作物が 3 つ以上
    for (const s of [0, 1, 2]) expect(CROP_KINDS.filter((k) => CROPS[k].seasons.includes(s)).length).toBeGreaterThanOrEqual(3);
  });
});
