import { describe, it, expect } from 'vitest';
import {
  GOAL_BOOST, SPECIES_NAME, boostedVisitors, checkGoals, compatible, dayNumber, emptyLog, ensureSeason, generateGoals, goalCandidates,
  goalReward, goalText, logLook, reachable, sanitizeGoals, seasonKey, seasonOfKey, tutorialGoals, updatePairs, visitsIn,
  type GenCtx, type GoalsState,
} from './goals';
import { emptyEnv, type EnvCounts } from './environment';
import { RESIDENT_ORDER, VISITOR, type VisitorId } from './species';
import { checkEcosystem } from './ecosystem';
import { SPECIES } from '../creatures/animals';
import { seasonAt } from '../calendar';

/** 森・草原・花畑・水辺のある、ふつうの箱庭（岩場・湿地・砂浜は無い） */
const plainEnv = (): EnvCounts => ({ ...emptyEnv(), ground: 1000, forest: 80, meadow: 200, flowerField: 40, waterside: 120, deepWater: 30, farm: 20, crops: 4, wild: 4 });
const lcg = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const ctx = (season: number, o: Partial<GenCtx> = {}): GenCtx => ({ season, env: plainEnv(), residents: ['rabbit'], dex: {}, prev: [], ...o });
const known = () => true;

describe('season keys', () => {
  it('one key per calendar month; season follows the calendar', () => {
    for (let m = 0; m < 24; m++) {
      const d = new Date(Date.UTC(2027, m, 15));
      expect(seasonKey(d)).toBe(m);
      expect(seasonOfKey(seasonKey(d))).toBe(seasonAt(d).season);
    }
  });
  it('a day runs from 5 am to 5 am (a night is one day)', () => {
    const t = (h: number) => Date.UTC(2027, 5, 10, h); // 時差 0 で見る
    expect(dayNumber(t(20), 0)).toBe(dayNumber(t(27), 0)); // 夜 8 時と翌朝 3 時
    expect(dayNumber(t(4), 0)).not.toBe(dayNumber(t(6), 0));
  });
  it('resident names here match the animals', () => {
    for (const sp of RESIDENT_ORDER) expect(SPECIES_NAME[sp]).toBe(SPECIES[sp].name);
  });
});

describe('choosing goals', () => {
  it('three goals, easy / normal / hard, of different types, every season', () => {
    for (let s = 0; s < 4; s++) for (let seed = 1; seed < 40; seed++) {
      const g = generateGoals(ctx(s), lcg(seed));
      expect(g.map((x) => x.tier)).toEqual([0, 1, 2]);
      expect(new Set(g.map((x) => x.type)).size).toBe(3);
    }
  });
  it('only creatures that come in that season and can be reached with this land', () => {
    for (let s = 0; s < 4; s++) {
      for (const c of goalCandidates(ctx(s))) for (const k of c.conds) {
        if (k.k === 'see' || k.k === 'sameDay') for (const id of k.ids) { expect(visitsIn(id as VisitorId, s)).toBe(true); expect(reachable(VISITOR[id as VisitorId].need, plainEnv())).toBe(true); }
      }
    }
    // 岩場が無いので、カモシカ・ワシ・オコジョは出ない。冬でない季節にオコジョは出ない
    const ids = goalCandidates(ctx(1)).map((c) => c.id);
    expect(ids).not.toContain('see:eagle');
    expect(ids).not.toContain('res:serow');
    expect(ids).not.toContain('see:crab');
    expect(goalCandidates(ctx(3, { env: { ...plainEnv(), rock: 50 } })).map((c) => c.id)).toContain('res:stoat');
    expect(goalCandidates(ctx(1, { env: { ...plainEnv(), rock: 50 } })).map((c) => c.id)).not.toContain('res:stoat');
  });
  it('crops only in their season; none in winter', () => {
    expect(goalCandidates(ctx(3)).some((c) => c.type === 'harvest')).toBe(false);
    expect(goalCandidates(ctx(1)).filter((c) => c.type === 'harvest').map((c) => c.id).sort()).toEqual(['harvest:pumpkin', 'harvest:wheat']);
  });
  it('winter likes the snow-day goal for the easy one', () => {
    let n = 0;
    for (let seed = 1; seed < 60; seed++) if (generateGoals(ctx(3), lcg(seed))[0].id === 'snow:warm') n++;
    expect(n).toBeGreaterThan(20);
  });
  it('does not repeat the previous season', () => {
    for (let seed = 1; seed < 30; seed++) {
      const a = generateGoals(ctx(0), lcg(seed));
      const b = generateGoals(ctx(0, { prev: a.map((g) => g.id) }), lcg(seed + 100));
      for (const g of b) expect(a.map((x) => x.id)).not.toContain(g.id);
    }
  });
  it('prefers creatures not observed yet', () => {
    const all = Object.fromEntries(Object.keys(VISITOR).map((id) => [id, { seenAt: 0, observedAt: 0, seasons: [0, 1, 2, 3] }]));
    const { butterfly: _b, ...dex } = all;
    let n = 0;
    for (let seed = 1; seed < 80; seed++) if (generateGoals(ctx(0, { dex }), lcg(seed)).some((g) => g.id === 'see:butterfly')) n++;
    expect(n).toBeGreaterThan(15);
  });
  it('a resident already living there is not a goal', () => {
    expect(goalCandidates(ctx(0, { residents: ['rabbit', 'tanuki'] })).map((c) => c.id)).not.toContain('res:tanuki');
  });
  it('pairs never need contradicting land', () => {
    expect(compatible(VISITOR.skylark.need, VISITOR.owl.need)).toBe(false); // 森 10% まで × 暗い森 40%
    expect(compatible(VISITOR.mejiro.need, VISITOR.bee.need)).toBe(true);
    for (const c of goalCandidates(ctx(0))) expect(c.id).not.toBe('pair:owl+skylark');
  });
});

describe('progress and completion', () => {
  const st = (goals: GoalsState['goals']): GoalsState => ({ key: 0, goals, log: emptyLog(), prev: [] });
  it('observe goals are met by looking at the creature this season', () => {
    const s = st([{ id: 'see:butterfly', tier: 0, type: 'observe', conds: [{ k: 'see', ids: ['butterfly'] }] }]);
    const c = { env: plainEnv(), residents: [] };
    expect(checkGoals(s, c, 1)).toEqual([]);
    logLook(s.log, 'butterfly', false, Date.UTC(2027, 0, 3, 12), 0);
    expect(checkGoals(s, c, 2).map((g) => g.id)).toEqual(['see:butterfly']);
    expect(s.goals[0].done).toBe(2);
    expect(checkGoals(s, c, 3)).toEqual([]); // 2 回は達成しない
  });
  it('pairs must be on the same day', () => {
    const s = st([{ id: 'pair:bee+mejiro', tier: 2, type: 'combo', conds: [{ k: 'sameDay', ids: ['mejiro', 'bee'] }] }]);
    const c = { env: plainEnv(), residents: [] };
    logLook(s.log, 'mejiro', false, Date.UTC(2027, 0, 3, 12), 0); updatePairs(s);
    logLook(s.log, 'bee', false, Date.UTC(2027, 0, 4, 12), 0); updatePairs(s);
    expect(checkGoals(s, c, 1)).toEqual([]);
    logLook(s.log, 'mejiro', false, Date.UTC(2027, 0, 4, 15), 0); updatePairs(s);
    expect(checkGoals(s, c, 2)).toHaveLength(1);
  });
  it('land, harvest, build and resident goals', () => {
    const s = st([
      { id: 'a', tier: 0, type: 'land', conds: [{ k: 'land', land: 'flowerField', min: 5 }] },
      { id: 'b', tier: 0, type: 'harvest', conds: [{ k: 'harvest', crop: 'wheat', n: 2 }] },
      { id: 'c', tier: 1, type: 'build', conds: [{ k: 'build', n: 1, nature: 4, straw: true }] },
      { id: 'd', tier: 1, type: 'resident', conds: [{ k: 'resident', sp: 'tanuki' }] },
    ]);
    const env = { ...plainEnv(), flowerField: 40 }; // 4%
    expect(checkGoals(s, { env, residents: [] }, 1)).toEqual([]);
    s.log.harvest.wheat = 2;
    s.log.builds.push({ nature: 5, straw: false }, { nature: 3, straw: true });
    expect(checkGoals(s, { env: { ...env, flowerField: 50 }, residents: [] }, 2).map((g) => g.id)).toEqual(['a', 'b']);
    s.log.builds.push({ nature: 4, straw: true });
    expect(checkGoals(s, { env, residents: ['tanuki'] }, 3).map((g) => g.id)).toEqual(['c', 'd']);
  });
  it('the snow-day goal needs a resident warming at home', () => {
    const s = st([{ id: 'snow:warm', tier: 0, type: 'snow', conds: [{ k: 'warm' }] }]);
    logLook(s.log, 'rabbit', false, 0, 0);
    expect(checkGoals(s, { env: plainEnv(), residents: [] }, 1)).toEqual([]);
    logLook(s.log, 'rabbit', true, 0, 0);
    expect(checkGoals(s, { env: plainEnv(), residents: [] }, 1)).toHaveLength(1);
  });
});

describe('seasons change', () => {
  const c = { env: plainEnv(), residents: ['rabbit'] as const, dex: {} };
  it('a new world starts with the tutorial goals', () => {
    const { state } = ensureSeason(null, 0, c, lcg(1), true);
    expect(state.goals.map((g) => g.id)).toEqual(['tut:farm', 'tut:flower', 'tut:build']);
    expect(tutorialGoals(3)[0].conds).toEqual([{ k: 'till' }]); // 冬は作物が育たない
  });
  it('an older world without goals gets normal ones; a new month replaces them quietly', () => {
    const a = ensureSeason(null, 4, c, lcg(1));
    expect(a.changed).toBe(true);
    expect(a.state.goals[0].type).not.toBe('tutorial');
    a.state.log.seen.push('butterfly');
    expect(ensureSeason(a.state, 4, c, lcg(2)).changed).toBe(false);
    const b = ensureSeason(a.state, 5, c, lcg(2));
    expect(b.changed).toBe(true);
    expect(b.state.log.seen).toEqual([]);
    expect(b.state.prev).toEqual(a.state.goals.map((g) => g.id));
  });
  it('survives a save round trip, and broken data is rebuilt', () => {
    const { state } = ensureSeason(null, 7, c, lcg(3));
    state.log.harvest.turnip = 3;
    expect(sanitizeGoals(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(sanitizeGoals({ key: 'x' })).toBeNull();
    expect(sanitizeGoals(null)).toBeNull();
  });
});

describe('rewards and help', () => {
  it('points by tier; raws this world cannot get; a memento for the hard one', () => {
    const g = (tier: 0 | 1 | 2) => ({ id: 'x', tier, type: 'land' as const, conds: [] });
    const r = goalReward(g(2), plainEnv(), () => 0);
    expect(r).toMatchObject({ points: 40, memento: true, mat: 'mineral', n: 4 }); // 岩場も砂浜も無い：鉱物（鉱物は半分）
    expect(goalReward(g(0), plainEnv(), () => 0)).toMatchObject({ points: 10, memento: false, n: 2 });
    // 何でもとれる箱庭では、出る土地がいちばん少ない素材
    const rich = { ...plainEnv(), forest: 30, beach: 5, rock: 60 };
    expect(goalReward(g(1), rich, () => 0.3).mat).toBe('wood');
  });
  it('rare creatures in goals come more often', () => {
    const s: GoalsState = { key: 0, goals: [{ id: 'see:owl', tier: 2, type: 'observe', conds: [{ k: 'see', ids: ['owl'] }] }], log: emptyLog(), prev: [] };
    expect([...boostedVisitors(s)]).toEqual(['owl']);
    s.goals[0].done = 1;
    expect(boostedVisitors(s).size).toBe(0);
    // 生き物の判定で、確率が 3 倍に（まれ 0.05 → 0.15）
    const e = { ...plainEnv(), forest: 500, darkForest: 500 };
    const m = { season: 0, seasonProgress: 0.3, hour: 23, raining: false };
    const base = { visitors: [], residents: [], openPlots: 4 };
    const r = 0.05 * GOAL_BOOST - 0.01;
    expect(checkEcosystem(base, e, m, 0, () => r).arrive).not.toContain('owl');
    expect(checkEcosystem({ ...base, boost: new Set(['owl']) }, e, m, 0, () => r).arrive).toContain('owl');
  });
  it('texts hide names of creatures not observed yet', () => {
    const g = { id: 'x', tier: 0 as const, type: 'tutorial' as const, conds: [{ k: 'flower' as const }, { k: 'see' as const, ids: ['butterfly', 'sparrow'] as VisitorId[], any: true }] };
    expect(goalText(g, known)).toBe('花を植えて、チョウかスズメを観察する');
    expect(goalText(g, () => false)).toBe('花を植えて、？？？か？？？を観察する');
    expect(goalText({ id: 'y', tier: 0, type: 'land', conds: [{ k: 'land', land: 'flowerField', min: 5 }, { k: 'see', ids: ['butterfly'] }] }, known))
      .toBe('花畑を ★☆☆☆☆（5%）以上にして、チョウを観察する');
  });
});
