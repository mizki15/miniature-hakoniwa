import { describe, it, expect } from 'vitest';
import { checkEcosystem, dueChecks, needsStarterRabbits, CHECK_SIM_MS, type EcoState } from './ecosystem';
import { RESIDENT_RULES, VISITORS, type Moment } from './species';
import { emptyEnv, type EnvCounts } from './environment';

/** 地面 100 列の箱庭：列の数がそのまま割合（%）になる */
const env = (o: Partial<EnvCounts> = {}): EnvCounts => ({ ...emptyEnv(), ground: 100, ...o });
const spring = (o: Partial<Moment> = {}): Moment => ({ season: 0, seasonProgress: 0.3, hour: 12, raining: false, ...o });
const state = (o: Partial<EcoState> = {}): EcoState => ({ visitors: [], residents: [], openPlots: 1, ...o });
const always = (v: number) => () => v;
const NOW = 1_000_000;

describe('visitors arrive', () => {
  it('arrivesWhenChanceHits: common visitor comes below 40%', () => {
    expect(checkEcosystem(state(), env({ flowerField: 5 }), spring(), NOW, always(0.39)).arrive).toContain('butterfly');
    expect(checkEcosystem(state(), env({ flowerField: 5 }), spring(), NOW, always(0.41)).arrive).not.toContain('butterfly');
  });
  it('frogDoubleInRain', () => {
    const e = env({ waterside: 5 });
    expect(checkEcosystem(state(), e, spring({ raining: true }), NOW, always(0.79)).arrive).toContain('frog');
    expect(checkEcosystem(state(), e, spring(), NOW, always(0.79)).arrive).not.toContain('frog');
  });
  it('kingfisherNeedsFish', () => {
    const e = env({ waterside: 5, deepWater: 5 });
    const morning = spring({ hour: 7 });
    // 魚が来ない（確率 0.04 は魚の 40% より小さいので来る…ので、魚がいない状態を作るには深い水を 0 に）
    expect(checkEcosystem(state(), env({ waterside: 5 }), morning, NOW, always(0.01)).arrive).not.toContain('kingfisher');
    // 同じ判定で魚が来れば、カワセミも来られる
    expect(checkEcosystem(state(), e, morning, NOW, always(0.01)).arrive).toEqual(expect.arrayContaining(['fish', 'kingfisher']));
  });
  it('maxEightVisitors', () => {
    // いる 8 匹は、みな環境が合っていて帰らない種類（帰ると空きができて、ほかの種類が来る）
    const e = env({ flowerField: 20, forest: 40, waterside: 20, deepWater: 10, farm: 10, crops: 10 });
    const visitors = VISITORS.filter((v) => v.needs(e)).slice(0, 8).map((v) => ({ id: v.id, leavesAt: NOW + 1e9 }));
    expect(visitors.length).toBe(8);
    const r = checkEcosystem(state({ visitors }), e, spring(), NOW, always(0));
    expect(r.arrive).toEqual([]);
  });
  it('never goes past eight in one check', () => {
    const r = checkEcosystem(state(), env({ flowerField: 20, forest: 40, waterside: 20, deepWater: 10, farm: 10, crops: 10, meadow: 30 }), spring({ hour: 7 }), NOW, always(0));
    expect(r.arrive.length).toBeLessThanOrEqual(8);
  });
  it('alreadyPresentNotDrawn', () => {
    const r = checkEcosystem(state({ visitors: [{ id: 'butterfly', leavesAt: NOW + 1e9 }] }), env({ flowerField: 5 }), spring(), NOW, always(0));
    expect(r.arrive).not.toContain('butterfly');
  });
  it('fireflyEarlySummerNight', () => {
    const e = env({ waterside: 5, darkWaterside: 5, meadow: 5 });
    expect(checkEcosystem(state(), e, { season: 1, seasonProgress: 0.3, hour: 22, raining: false }, NOW, always(0)).arrive).toContain('firefly');
    // 水辺が灯りに照らされていると来ない
    expect(checkEcosystem(state(), env({ waterside: 5, darkWaterside: 4, meadow: 5 }), { season: 1, seasonProgress: 0.3, hour: 22, raining: false }, NOW, always(0)).arrive).not.toContain('firefly');
    expect(checkEcosystem(state(), e, { season: 1, seasonProgress: 0.7, hour: 22, raining: false }, NOW, always(0)).arrive).not.toContain('firefly');
  });
});

describe('visitors leave', () => {
  it('leavesWhenTimeUp', () => {
    const r = checkEcosystem(state({ visitors: [{ id: 'butterfly', leavesAt: NOW - 1 }] }), env({ flowerField: 5 }), spring(), NOW, always(0.99));
    expect(r.leave).toEqual(['butterfly']);
  });
  it('leavesWhenNeedsLost', () => {
    const r = checkEcosystem(state({ visitors: [{ id: 'butterfly', leavesAt: NOW + 1e9 }] }), env(), spring(), NOW, always(0.99));
    expect(r.leave).toEqual(['butterfly']);
  });
});

describe('visitors leave when their own spot is gone', () => {
  it('leavesWhenHomeLost', () => {
    const r = checkEcosystem(state({ visitors: [{ id: 'fish', leavesAt: NOW + 1e9, homeOk: false }] }), env({ deepWater: 10 }), spring(), NOW, always(0.99));
    expect(r.leave).toEqual(['fish']);
  });
  it('stays while the home still fits', () => {
    const r = checkEcosystem(state({ visitors: [{ id: 'fish', leavesAt: NOW + 1e9, homeOk: true }] }), env({ deepWater: 10 }), spring(), NOW, always(0.99));
    expect(r.leave).toEqual([]);
  });
});

describe('needsStarterRabbits', () => {
  it('is true when no resident was restored (old stage-1 saves had none)', () => {
    expect(needsStarterRabbits([])).toBe(true);
    expect(needsStarterRabbits(['deer'])).toBe(false);
  });
});

describe('residents move in', () => {
  it('oneMoveInPerCheck', () => {
    const e = env({ forest: 40, waterside: 10 });
    const r = checkEcosystem(state({ residents: ['rabbit'] }), e, spring(), NOW, always(0.99));
    expect(r.moveIn).not.toBeNull();
  });
  it('stops at the cap of 3 per open plot', () => {
    const r = checkEcosystem(state({ residents: ['rabbit', 'rabbit', 'squirrel'] }), env({ forest: 40 }), spring(), NOW, always(0.99));
    expect(r.moveIn).toBeNull();
  });
  it('skips a species with 4 already', () => {
    // 森 20%：りすだけが条件を満たす（たぬきは 30% から）
    const sq = (n: number) => Array.from({ length: n }, () => 'squirrel' as const);
    expect(checkEcosystem(state({ residents: sq(3), openPlots: 4 }), env({ forest: 20 }), spring(), NOW, always(0.99)).moveIn).toBe('squirrel');
    expect(checkEcosystem(state({ residents: sq(4), openPlots: 4 }), env({ forest: 20 }), spring(), NOW, always(0.99)).moveIn).toBeNull();
  });
  it('prefers the eligible species with the fewest residents', () => {
    // しか・きつね・りす・あひるが条件を満たす。しかが 1 匹いるので、まだいないほかの種類が来る
    const e = env({ forest: 15, meadow: 30, waterside: 10 });
    const r = checkEcosystem(state({ residents: ['rabbit', 'deer'], openPlots: 4 }), e, spring(), NOW, always(0.99));
    expect(['fox', 'duck']).toContain(r.moveIn);
  });
  it('rabbits do not move in', () => {
    const r = checkEcosystem(state({ residents: [] }), env(), spring(), NOW, always(0));
    expect(r.moveIn).toBeNull();
  });
});

describe('dueChecks', () => {
  it('waits five sim minutes', () => {
    expect(dueChecks(0, CHECK_SIM_MS - 1, 0, 10_000)).toBe(false);
    expect(dueChecks(0, CHECK_SIM_MS, 0, 10_000)).toBe(true);
  });
  it('at most once per real second', () => {
    expect(dueChecks(0, CHECK_SIM_MS * 10, 9_500, 10_000)).toBe(false);
  });
  it('is false right after the base is reset to now (after offline catch-up)', () => {
    const nowSim = 123_456_789;
    expect(dueChecks(nowSim, nowSim, 0, 10_000)).toBe(false);
  });
});

describe('abundance (debug: how many creatures)', () => {
  const rich = env({ flowerField: 20, forest: 40, waterside: 20, deepWater: 10, farm: 10, crops: 10, meadow: 30 });
  it('moreChanceWithAbundance', () => {
    // 珍しくない訪問者（40%）は、2 倍なら 79% でも来る
    expect(checkEcosystem(state({ abundance: 2 }), env({ flowerField: 5 }), spring(), NOW, always(0.79)).arrive).toContain('butterfly');
    expect(checkEcosystem(state(), env({ flowerField: 5 }), spring(), NOW, always(0.79)).arrive).not.toContain('butterfly');
  });
  it('moreVisitorsAllowed', () => {
    const visitors = VISITORS.slice(0, 8).map((v) => ({ id: v.id, leavesAt: NOW + 1e9 }));
    const r = checkEcosystem(state({ visitors, abundance: 2 }), rich, spring({ hour: 7 }), NOW, always(0));
    expect(r.arrive.length).toBeGreaterThan(0);
  });
  it('moreResidentsAndSeveralMoveInsPerCheck', () => {
    // 1 区画の上限は 3 匹。3 倍なら 9 匹まで、1 回の判定で 3 匹まで引っ越してくる
    const full = state({ residents: ['rabbit', 'rabbit', 'rabbit'], openPlots: 1 });
    expect(checkEcosystem(full, rich, spring(), NOW, always(0)).moveIns).toEqual([]);
    const r = checkEcosystem({ ...full, abundance: 3 }, rich, spring(), NOW, always(0));
    expect(r.moveIns.length).toBe(3);
  });
});

describe('ratio conditions with caps', () => {
  it('deer stops coming once the forest is too wide', () => {
    expect(RESIDENT_RULES.deer(env({ meadow: 30, forest: 15 }))).toBe(true);
    expect(RESIDENT_RULES.deer(env({ meadow: 30, forest: 16 }))).toBe(false);
    expect(RESIDENT_RULES.deer(env({ meadow: 29, forest: 0 }))).toBe(false);
  });
  it('fox needs some forest but not too much', () => {
    const fox = (forest: number) => RESIDENT_RULES.fox(env({ meadow: 25, forest }));
    expect([fox(5), fox(10), fox(30), fox(31)]).toEqual([false, true, true, false]);
  });
  it('kingfisher needs wildness 4 or more', () => {
    const morning = spring({ hour: 7 });
    expect(checkEcosystem(state(), env({ waterside: 5, deepWater: 5, wild: 4 }), morning, NOW, always(0.01)).arrive).toContain('kingfisher');
    expect(checkEcosystem(state(), env({ waterside: 5, deepWater: 5, wild: 3 }), morning, NOW, always(0.01)).arrive).not.toContain('kingfisher');
  });
  it('a visitor leaves when its land grows past its share (counts scale with the ground)', () => {
    // 同じ 5 列の花畑でも、地面が 200 列なら 2.5% で足りない
    const r = checkEcosystem(state({ visitors: [{ id: 'butterfly', leavesAt: NOW + 1e9 }] }), env({ flowerField: 5, ground: 200 }), spring(), NOW, always(0.99));
    expect(r.leave).toEqual(['butterfly']);
  });
});
