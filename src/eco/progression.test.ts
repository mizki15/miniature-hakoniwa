import { describe, it, expect } from 'vitest';
import { createWorld, generatePlot, DEFAULT_PARAMS, type World } from '../world/terrain';
import { FRAME, START_PLOT, openable, countOpen } from '../world/plots';
import { countEnvironment, habitatCols, type EnvInput } from './environment';
import { DEX_ORDER, RARITY_POINTS, RESIDENT_ORDER, RESIDENT_RULES, VISITORS, isVisitorId, rarityOf, type DexId, type Moment } from './species';
import { residentCap } from './ecosystem';

/**
 * 全部の進捗をたどれるか：最初の区画から、観察で入るポイントだけで土地を広げていき、
 * 16 区画すべてが開いて、図鑑の 19 種すべてに会えるかを確かめる。
 * 季節・時刻・天気は、いつかはそろうものとする（季節がひと巡りする）。
 */
const HOURS = Array.from({ length: 48 }, (_, i) => i / 2);
/** その訪問者に会える季節（季節・時刻・天気・季節の中の進み具合のどれかの組み合わせで when が true） */
function seasonsOf(def: (typeof VISITORS)[number]): number[] {
  const out: number[] = [];
  for (let season = 0; season < 4; season++) {
    const ok = HOURS.some((hour) => [false, true].some((raining) => [0.25, 0.75].some((seasonProgress) => def.when({ season, seasonProgress, hour, raining } as Moment))));
    if (ok) out.push(season);
  }
  return out;
}

function inputOf(w: World, farming: boolean): EnvInput {
  const treeCols = new Set(w.trees.map((t) => Math.floor(t.x) + Math.floor(t.z) * FRAME));
  const flowerCols = w.flowers.map((f) => Math.floor(f.x) + Math.floor(f.z) * FRAME);
  // 畑をする場合：最初の区画の草地を 10 マス耕して、5 マスに種をまいたことにする
  const farmland = new Set<number>();
  if (farming) for (let i = 0; i < 10; i++) farmland.add(90 + i + 100 * FRAME);
  return { world: w, flowerCols, treeCols, farmland, crops: farming ? 5 : 0 };
}

function simulate(seed: number, farming: boolean) {
  const w = createWorld(64);
  generatePlot(w, START_PLOT, seed, DEFAULT_PARAMS);
  const met = new Set<DexId>(['rabbit']);
  const seasonsMet = new Map<DexId, Set<number>>();
  let points = 0, rightsUsed = 0;
  const award = (id: DexId) => {
    if (!met.has(id) || seasonsMet.has(id)) return;
    seasonsMet.set(id, new Set());
    points += RARITY_POINTS[rarityOf(id)];
  };
  for (let round = 0; round < 40; round++) {
    const i = inputOf(w, farming);
    const e = countEnvironment(i);
    // 住人：うさぎ 2 匹がいる時の空き枠ぶんだけ、条件を満たす種類が来る（いちばん少ない種類から＝まず 1 匹ずつ）
    const slots = residentCap(countOpen(w.plots)) - 2;
    const eligible = RESIDENT_ORDER.filter((sp) => sp !== 'rabbit' && RESIDENT_RULES[sp](e));
    for (const sp of eligible.slice(0, Math.max(0, slots))) met.add(sp);
    // 訪問者：必要な環境があり、現れる場所があり、会える季節があれば、いつかは来る
    for (const def of VISITORS) {
      if (!def.needs(e) || habitatCols(i, def.habitat).length === 0 || seasonsOf(def).length === 0) continue;
      if (def.id === 'kingfisher' && !met.has('fish')) continue;
      met.add(def.id);
    }
    for (const id of met) award(id);
    // 訪問者は、会える季節ごとに 1 ポイント（1 季節目は初めての観察に含む）
    for (const id of met) {
      if (!isVisitorId(id)) continue;
      const def = VISITORS.find((v) => v.id === id)!;
      const s = seasonsMet.get(id)!;
      for (const season of seasonsOf(def)) if (!s.has(season)) { if (s.size > 0) points += 1; s.add(season); }
    }
    // 権利があるだけ区画を開く
    let opened = false;
    while (Math.floor(points / 3) - rightsUsed > 0) {
      const next = openable(w.plots);
      if (next.length === 0) break;
      generatePlot(w, next[0], seed, DEFAULT_PARAMS);
      rightsUsed++;
      opened = true;
    }
    if (!opened && round > 0) break;
  }
  return { plots: countOpen(w.plots), met, missing: DEX_ORDER.filter((id) => !met.has(id)), points };
}

describe('progression', () => {
  for (const seed of [1234, 1, 42, 777, 2027]) {
    it(`seed ${seed}: with a little farming, all 16 plots open and all 19 creatures can be met`, () => {
      const r = simulate(seed, true);
      expect(r.missing).toEqual([]);
      expect(r.plots).toBe(16);
    });
  }
  it('at full progress every resident species fits under the cap of 24 (7 species × up to 4)', () => {
    expect(residentCap(16)).toBe(24);
    expect(RESIDENT_ORDER.length).toBeLessThanOrEqual(24);
  });
  it('without farming, only the farm-bound visitors stay missing', () => {
    const r = simulate(1234, false);
    // スズメ（畑）とミツバチ（作物）は畑をしないと来ない
    expect(r.missing.filter((id) => id !== 'sparrow' && id !== 'bee')).toEqual([]);
  });
});
