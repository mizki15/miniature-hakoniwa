import { describe, it, expect } from 'vitest';
import { createWorld, generatePlot, DEFAULT_PARAMS } from '../world/terrain';
import { FRAME, START_PLOT } from '../world/plots';
import { countEnvironment, emptyEnv, type EnvCounts, type Land } from './environment';
import { DEEP_MIN_COLS, HIGH_MIN_COLS, RESIDENT_NEEDS, RESIDENT_ORDER, RESIDENT_RULES, RESIDENT_WHEN, VISITORS, meetsNeeds, type Moment, type Needs } from './species';
import { residentCap } from './ecosystem';

/**
 * 割合と上限の条件（設計メモ 1・10 章）：
 *   ・どの生き物にも、会える箱庭がある
 *   ・取り合いになる生き物は、1 つの箱庭で同時には条件を満たせない
 *   ・始めたばかりの自然な箱庭でも、何種類かには会える（観察のポイントで土地を広げられる）
 */
const HOURS = Array.from({ length: 48 }, (_, i) => i / 2);
function seasonsOf(def: (typeof VISITORS)[number]): number[] {
  const out: number[] = [];
  for (let season = 0; season < 4; season++) {
    const ok = HOURS.some((hour) => [false, true].some((raining) => [0.25, 0.75].some((seasonProgress) => def.when({ season, seasonProgress, hour, raining } as Moment))));
    if (ok) out.push(season);
  }
  return out;
}

/** その条件をちょうど満たす箱庭（下限ぴったり・ほかは 0。地面 100 列なので列の数＝%） */
function envFor(n: Needs): EnvCounts {
  const e = {
    ...emptyEnv(), ground: 100, crops: n.crops ? 1 : 0, wild: n.wild?.min ?? n.wild?.max ?? 5,
    deepWater: n.deep ? DEEP_MIN_COLS : 0, high: n.high ? HIGH_MIN_COLS : 0, houses: n.houses ?? 0, litHouses: n.litHouses ?? 0,
  };
  for (const l of n.land ?? []) {
    const want = l.min ?? 0;
    // 合計で見る条件（花畑か畑）は、はじめの土地の型に寄せる
    e[l.lands[0] as Land] = Math.max(e[l.lands[0] as Land], want - l.lands.slice(1).reduce((a, k) => a + e[k as Land], 0));
  }
  return e;
}

/** 割合を 5% 刻みで動かした箱庭を全部（森・草原・花畑・畑・水辺・深い水）。野生度は畑から決まる */
function* allEnvs(): Generator<EnvCounts> {
  const steps = [0, 5, 10, 15, 20, 25, 30, 40];
  for (const forest of steps) for (const meadow of steps) for (const flowerField of [0, 5, 10, 15])
    for (const farm of [0, 1, 5, 10]) for (const waterside of [0, 5, 10]) for (const deepWater of [0, 5]) {
      if (forest + meadow + flowerField + farm + waterside + deepWater > 100) continue;
      for (const human of [0, 5]) {
        const share = farm + human;
        const wild = share < 2 ? 5 : share < 5 ? 4 : share < 10 ? 3 : share < 20 ? 2 : 1;
        yield { ...emptyEnv(), ground: 100, forest, meadow, flowerField, farm, waterside, deepWater, human, darkForest: forest, darkWaterside: waterside, crops: farm ? 1 : 0, wild };
      }
    }
}

describe('every creature can be met somewhere', () => {
  for (const sp of RESIDENT_ORDER) {
    it(`resident ${sp}`, () => { expect(meetsNeeds(RESIDENT_NEEDS[sp], envFor(RESIDENT_NEEDS[sp]))).toBe(true); });
  }
  for (const v of VISITORS) {
    it(`visitor ${v.id}`, () => {
      expect(v.needs(envFor(v.need))).toBe(true);
      expect(seasonsOf(v).length).toBeGreaterThan(0);
    });
  }
});

describe('some creatures compete for the same land', () => {
  const together = (a: (e: EnvCounts) => boolean, b: (e: EnvCounts) => boolean) => {
    for (const e of allEnvs()) if (a(e) && b(e)) return true;
    return false;
  };
  const visitor = (id: string) => VISITORS.find((v) => v.id === id)!.needs;
  it('deer (open meadow) never with tanuki or the owl (wide forest)', () => {
    expect(together(RESIDENT_RULES.deer, RESIDENT_RULES.tanuki)).toBe(false);
    expect(together(RESIDENT_RULES.deer, visitor('owl'))).toBe(false);
    expect(together(RESIDENT_RULES.deer, visitor('woodpecker'))).toBe(false);
  });
  it('fox never with the owl', () => {
    expect(together(RESIDENT_RULES.fox, visitor('owl'))).toBe(false);
  });
  it('a sparrow-sized farm keeps the kingfisher away', () => {
    expect(together(visitor('sparrow'), visitor('kingfisher'))).toBe(false);
  });
  it('compatible ones can share a diorama', () => {
    expect(together(RESIDENT_RULES.duck, visitor('kingfisher'))).toBe(true);
    expect(together(RESIDENT_RULES.squirrel, visitor('longtailedTit'))).toBe(true);
  });
});

describe('a fresh natural diorama', () => {
  for (const seed of [1234, 1, 42, 777, 2027]) {
    it(`seed ${seed}: some residents and visitors can come without changing the land`, () => {
      const w = createWorld(64);
      generatePlot(w, START_PLOT, seed, DEFAULT_PARAMS);
      const e = countEnvironment({
        world: w, crops: 0, farmland: new Set(),
        flowerCols: w.flowers.map((f) => Math.floor(f.x) + Math.floor(f.z) * FRAME),
        treeCols: new Set(w.trees.map((t) => Math.floor(t.x) + Math.floor(t.z) * FRAME)),
      });
      const visitors = VISITORS.filter((v) => v.needs(e)).map((v) => v.id);
      const residents = RESIDENT_ORDER.filter((sp) => RESIDENT_RULES[sp](e));
      // 水辺の生き物（あひる・カエル・トンボ）は自然な地形でも来る。森や草原の生き物は、木を植える・整地するなどして呼ぶ
      expect(residents).toContain('duck');
      expect(visitors).toEqual(expect.arrayContaining(['frog', 'dragonfly']));
      expect(e.wild).toBe(5);
    });
  }
});

describe('v0.16 conditions', () => {
  const base = () => ({ ...emptyEnv(), ground: 100 });
  it('deep water, high ground, houses and lit houses', () => {
    expect(meetsNeeds({ deep: true }, { ...base(), deepWater: DEEP_MIN_COLS - 1 })).toBe(false);
    expect(meetsNeeds({ deep: true }, { ...base(), deepWater: DEEP_MIN_COLS })).toBe(true);
    expect(meetsNeeds({ high: true }, { ...base(), high: HIGH_MIN_COLS - 1 })).toBe(false);
    expect(meetsNeeds({ high: true }, { ...base(), high: HIGH_MIN_COLS })).toBe(true);
    expect(meetsNeeds({ houses: 4 }, { ...base(), houses: 3 })).toBe(false);
    expect(meetsNeeds({ houses: 4 }, { ...base(), houses: 4 })).toBe(true);
    expect(meetsNeeds({ litHouses: 1 }, { ...base(), houses: 2 })).toBe(false);
    expect(meetsNeeds({ litHouses: 1 }, { ...base(), litHouses: 1 })).toBe(true);
  });
  it('the stoat moves in only in winter', () => {
    const e = envFor(RESIDENT_NEEDS.stoat);
    const m = (season: number): Moment => ({ season, seasonProgress: 0.5, hour: 12, raining: false });
    expect(RESIDENT_WHEN.stoat).toBeDefined();
    expect([0, 1, 2, 3].map((s) => RESIDENT_RULES.stoat(e, m(s)))).toEqual([false, false, false, true]);
    expect(RESIDENT_RULES.sheep(envFor(RESIDENT_NEEDS.sheep), m(1))).toBe(true);
  });
  it('40 creatures: 16 residents and 24 visitors, rarity 10 / 8 / 6', () => {
    expect(RESIDENT_ORDER.length).toBe(16);
    expect(VISITORS.length).toBe(24);
    const n = (r: string) => VISITORS.filter((v) => v.rarity === r).length;
    expect([n('common'), n('uncommon'), n('rare')]).toEqual([10, 8, 6]);
  });
  it('people-loving and wild creatures cannot be had together', () => {
    // ねこ（家 4 棟・野生度 ★2 以下）とカワウソ（野生度 ★3 以上）
    const cat = envFor(RESIDENT_NEEDS.cat);
    expect(RESIDENT_RULES.cat(cat)).toBe(true);
    expect(RESIDENT_RULES.otter({ ...cat, ...envFor(RESIDENT_NEEDS.otter), houses: cat.houses, wild: cat.wild })).toBe(false);
    // ひつじ（森 10% まで）とくま（森 35% 以上）
    expect(RESIDENT_RULES.bear({ ...envFor(RESIDENT_NEEDS.sheep), forest: 35, deepWater: DEEP_MIN_COLS })).toBe(true);
    expect(RESIDENT_RULES.sheep({ ...envFor(RESIDENT_NEEDS.sheep), forest: 35 })).toBe(false);
  });
});

describe('resident cap', () => {
  it('stays at plots × 3, up to 24', () => {
    expect(residentCap(1)).toBe(3);
    expect(residentCap(16)).toBe(24);
  });
});
