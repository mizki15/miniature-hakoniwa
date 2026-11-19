import { describe, it, expect } from 'vitest';
import { checkEcosystem, dueChecks, needsStarterRabbits, CHECK_SIM_MS, type EcoState } from './ecosystem';
import { VISITORS, type Moment } from './species';
import type { EnvCounts } from './environment';

const env = (o: Partial<EnvCounts> = {}): EnvCounts => ({ flowers: 0, trees: 0, grass: 0, waterside: 0, deepWater: 0, farmland: 0, crops: 0, ...o });
const spring = (o: Partial<Moment> = {}): Moment => ({ season: 0, seasonProgress: 0.3, hour: 12, raining: false, ...o });
const state = (o: Partial<EcoState> = {}): EcoState => ({ visitors: [], residents: [], openPlots: 1, ...o });
const always = (v: number) => () => v;
const NOW = 1_000_000;

describe('visitors arrive', () => {
  it('arrivesWhenChanceHits: common visitor comes below 40%', () => {
    expect(checkEcosystem(state(), env({ flowers: 20 }), spring(), NOW, always(0.39)).arrive).toContain('butterfly');
    expect(checkEcosystem(state(), env({ flowers: 20 }), spring(), NOW, always(0.41)).arrive).not.toContain('butterfly');
  });
  it('frogDoubleInRain', () => {
    const e = env({ waterside: 10 });
    expect(checkEcosystem(state(), e, spring({ raining: true }), NOW, always(0.79)).arrive).toContain('frog');
    expect(checkEcosystem(state(), e, spring(), NOW, always(0.79)).arrive).not.toContain('frog');
  });
  it('kingfisherNeedsFish', () => {
    const e = env({ waterside: 30, deepWater: 30 });
    const morning = spring({ hour: 7 });
    // 魚が来ない（確率 0.04 は魚の 40% より小さいので来る…ので、魚がいない状態を作るには深い水を 0 に）
    expect(checkEcosystem(state(), env({ waterside: 30 }), morning, NOW, always(0.01)).arrive).not.toContain('kingfisher');
    // 同じ判定で魚が来れば、カワセミも来られる
    expect(checkEcosystem(state(), e, morning, NOW, always(0.01)).arrive).toEqual(expect.arrayContaining(['fish', 'kingfisher']));
  });
  it('maxEightVisitors', () => {
    const visitors = VISITORS.slice(0, 8).map((v) => ({ id: v.id, leavesAt: NOW + 1e9 }));
    const r = checkEcosystem(state({ visitors }), env({ flowers: 100, trees: 100, waterside: 100, deepWater: 100, farmland: 10, crops: 10 }), spring(), NOW, always(0));
    expect(r.arrive).toEqual([]);
  });
  it('never goes past eight in one check', () => {
    const r = checkEcosystem(state(), env({ flowers: 100, trees: 100, waterside: 100, deepWater: 100, farmland: 10, crops: 10, grass: 3000 }), spring({ hour: 7 }), NOW, always(0));
    expect(r.arrive.length).toBeLessThanOrEqual(8);
  });
  it('alreadyPresentNotDrawn', () => {
    const r = checkEcosystem(state({ visitors: [{ id: 'butterfly', leavesAt: NOW + 1e9 }] }), env({ flowers: 20 }), spring(), NOW, always(0));
    expect(r.arrive).not.toContain('butterfly');
  });
  it('fireflyEarlySummerNight', () => {
    const e = env({ waterside: 10, grass: 10 });
    expect(checkEcosystem(state(), e, { season: 1, seasonProgress: 0.3, hour: 22, raining: false }, NOW, always(0)).arrive).toContain('firefly');
    expect(checkEcosystem(state(), e, { season: 1, seasonProgress: 0.7, hour: 22, raining: false }, NOW, always(0)).arrive).not.toContain('firefly');
  });
});

describe('visitors leave', () => {
  it('leavesWhenTimeUp', () => {
    const r = checkEcosystem(state({ visitors: [{ id: 'butterfly', leavesAt: NOW - 1 }] }), env({ flowers: 20 }), spring(), NOW, always(0.99));
    expect(r.leave).toEqual(['butterfly']);
  });
  it('leavesWhenNeedsLost', () => {
    const r = checkEcosystem(state({ visitors: [{ id: 'butterfly', leavesAt: NOW + 1e9 }] }), env(), spring(), NOW, always(0.99));
    expect(r.leave).toEqual(['butterfly']);
  });
});

describe('visitors leave when their own spot is gone', () => {
  it('leavesWhenHomeLost', () => {
    const r = checkEcosystem(state({ visitors: [{ id: 'fish', leavesAt: NOW + 1e9, homeOk: false }] }), env({ deepWater: 100 }), spring(), NOW, always(0.99));
    expect(r.leave).toEqual(['fish']);
  });
  it('stays while the home still fits', () => {
    const r = checkEcosystem(state({ visitors: [{ id: 'fish', leavesAt: NOW + 1e9, homeOk: true }] }), env({ deepWater: 100 }), spring(), NOW, always(0.99));
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
    const e = env({ trees: 40, waterside: 30 });
    const r = checkEcosystem(state({ residents: ['rabbit'] }), e, spring(), NOW, always(0.99));
    expect(r.moveIn).not.toBeNull();
  });
  it('stops at the cap of 3 per open plot', () => {
    const r = checkEcosystem(state({ residents: ['rabbit', 'rabbit', 'squirrel'] }), env({ trees: 40 }), spring(), NOW, always(0.99));
    expect(r.moveIn).toBeNull();
  });
  it('skips a species with 4 already', () => {
    // 木 20 本：りすだけが条件を満たす（たぬきは 30 本から）
    const sq = (n: number) => Array.from({ length: n }, () => 'squirrel' as const);
    expect(checkEcosystem(state({ residents: sq(3), openPlots: 4 }), env({ trees: 20 }), spring(), NOW, always(0.99)).moveIn).toBe('squirrel');
    expect(checkEcosystem(state({ residents: sq(4), openPlots: 4 }), env({ trees: 20 }), spring(), NOW, always(0.99)).moveIn).toBeNull();
  });
  it('prefers the eligible species with the fewest residents', () => {
    // しか・りす・あひるが条件を満たす。しかが 1 匹いるので、まだいないりすかあひるが来る
    const e = env({ trees: 20, waterside: 30, grass: 1600 });
    const r = checkEcosystem(state({ residents: ['rabbit', 'deer'], openPlots: 4 }), e, spring(), NOW, always(0.99));
    expect(['squirrel', 'duck']).toContain(r.moveIn);
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
  const rich = env({ flowers: 100, trees: 100, waterside: 100, deepWater: 100, farmland: 10, crops: 10, grass: 3000 });
  it('moreChanceWithAbundance', () => {
    // 珍しくない訪問者（40%）は、2 倍なら 79% でも来る
    expect(checkEcosystem(state({ abundance: 2 }), env({ flowers: 20 }), spring(), NOW, always(0.79)).arrive).toContain('butterfly');
    expect(checkEcosystem(state(), env({ flowers: 20 }), spring(), NOW, always(0.79)).arrive).not.toContain('butterfly');
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
