import { describe, it, expect } from 'vitest';
import { GIFT_CHANCE, JOB_TEXT, HOME_PREFS, TREAT_MS, jobEffects, likedBy, likelyResidents, scarceMats, pickShareCrop, residentPickupPerDay, shares, visitorGift, type Site } from './residents';
import { emptyEnv } from './environment';
import { checkEcosystem } from './ecosystem';
import { RESIDENT_ORDER, type Moment } from './species';
import { sanitizeDesign } from '../build/geoParse';

/** 性格のうち、好みの判定に使うところだけ */
const house = (areas: Record<string, number>, o: { size?: number; height?: number; light?: number } = {}) => ({
  areas, totalArea: Object.values(areas).reduce((a, b) => a + b, 0), size: o.size ?? 3, height: o.height ?? 5, light: o.light ?? 0,
});
const site = (o: Partial<Site> = {}): Site => ({ water: false, forest: false, meadow: false, wetland: false, high: false, ...o });

describe('favourite houses', () => {
  it('every resident has a favourite house and a job', () => {
    for (const sp of RESIDENT_ORDER) { expect(HOME_PREFS[sp]).toBeDefined(); expect(JOB_TEXT[sp]).toBeTruthy(); }
  });
  it('material shares', () => {
    const s = shares(house({ wood: 40, stone: 20, fiber: 40 }));
    expect(s.wood).toBeCloseTo(0.4); expect(s.stone).toBeCloseTo(0.2); expect(s.fiber).toBeCloseTo(0.4);
  });
  it('a small low house in a meadow suits rabbits, but not away from the meadow', () => {
    const c = house({ wood: 50, soil: 50 }, { size: 1, height: 3 });
    expect(likelyResidents(c).map((x) => x.species)).toContain('rabbit');
    expect(likedBy(c, site({ meadow: true }))).toContain('rabbit');
    expect(likedBy(c, site())).not.toContain('rabbit');
  });
  it('a brick house with lights suits cats; a stone house by the water suits otters', () => {
    expect(likedBy(house({ soil: 80, mineral: 20 }, { light: 2 }), site())).toContain('cat');
    expect(likedBy(house({ soil: 80, mineral: 20 }, { light: 0 }), site())).not.toContain('cat');
    expect(likedBy(house({ stone: 40, soil: 60 }), site({ water: true }))).toEqual(expect.arrayContaining(['otter', 'duck']));
  });
});

describe('liked houses help residents move in', () => {
  const spring: Moment = { season: 0, seasonProgress: 0.3, hour: 12, raining: false };
  it('relaxes the land minimum by 20% and goes first', () => {
    // たぬき：森 30% が要る。森 25% では来ないが、好きな家があれば来る
    const e = { ...emptyEnv(), ground: 100, forest: 25 };
    const base = { visitors: [], residents: [], openPlots: 4 };
    expect(checkEcosystem(base, e, spring, 0, () => 0.99).moveIns).not.toContain('tanuki');
    expect(checkEcosystem({ ...base, liked: new Set(['tanuki']) }, e, spring, 0, () => 0.99).moveIns).toEqual(['tanuki']);
    // りす（森 20%）も条件を満たすが、好きな家のある たぬき が先
    const e2 = { ...emptyEnv(), ground: 100, forest: 30 };
    expect(checkEcosystem({ ...base, liked: new Set(['tanuki']) }, e2, spring, 0, () => 0.99).moveIns[0]).toBe('tanuki');
  });
});

describe('jobs', () => {
  it('rabbits make nearby crops grow faster; stoats keep them growing in winter', () => {
    const j = jobEffects([{ species: 'rabbit', col: 100 + 100 * 320 }, { species: 'stoat', col: 10 + 10 * 320 }], 320);
    expect(j.growth(105 + 104 * 320)).toBe(1.2);
    expect(j.growth(120 + 100 * 320)).toBe(1);
    expect(j.winterGrowth(12 + 12 * 320)).toBe(0.3);
    expect(j.winterGrowth(100 + 100 * 320)).toBe(0);
  });
  it('tanuki spreads the forest, deer slow it down; fox keeps visitors longer', () => {
    expect(jobEffects([{ species: 'tanuki', col: 0 }], 320).treeSpreadMul).toBe(1.5);
    expect(jobEffects([{ species: 'deer', col: 0 }], 320).treeSpreadMul).toBe(0.5);
    expect(jobEffects([{ species: 'fox', col: 0 }], 320).stayMul).toBe(1.2);
    expect(jobEffects([], 320)).toMatchObject({ treeSpreadMul: 1, stayMul: 1, extraLogs: 0, extraStraw: 0, wetMul: 1, satisfyMul: 1 });
  });
  it('pickers bring materials every day; a shared crop adds more for 3 days', () => {
    expect(residentPickupPerDay([{ species: 'serow', col: 0 }], 0)).toEqual({ stone: 1 });
    expect(residentPickupPerDay([{ species: 'rabbit', col: 0 }], 0)).toEqual({});
    expect(residentPickupPerDay([{ species: 'rabbit', col: 0, treatedUntil: TREAT_MS }], TREAT_MS - 1)).toEqual({ fiber: 0.5 });
    expect(residentPickupPerDay([{ species: 'serow', col: 0, treatedUntil: 10 }], 5)).toEqual({ stone: 2 });
  });
});

describe('sharing crops', () => {
  it('gives the favourite crop if there is one, else the crop we have most of', () => {
    expect(pickShareCrop({ turnip: 1, wheat: 5 }, 'カブ')).toBe('turnip');
    expect(pickShareCrop({ turnip: 1, wheat: 5 }, '星空')).toBe('wheat');
    expect(pickShareCrop({ turnip: 0, pumpkin: 0 }, 'カブ')).toBeNull();
  });
});

describe('visitors bring scarce materials (v0.20)', () => {
  it('only materials whose land is missing', () => {
    const e = { ...emptyEnv(), ground: 100, forest: 10, waterside: 10, flowerField: 5 };
    expect(scarceMats(e)).toEqual(['mineral']); // 岩場も砂浜も無い
    expect(scarceMats({ ...emptyEnv(), ground: 100 })).toEqual(['wood', 'stone', 'mineral']);
    expect(scarceMats({ ...e, beach: 5 })).toEqual([]);
  });
  it('sometimes, 1–2 of one of them', () => {
    const e = { ...emptyEnv(), ground: 100, waterside: 10, beach: 5 }; // 足りないのは木材だけ
    expect(visitorGift(e, () => GIFT_CHANCE)).toBeNull();
    const seq = [0, 0.6, 0.9];
    const g = visitorGift(e, () => seq.shift()!);
    expect(g).toEqual({ mat: 'wood', n: 2 });
    expect(visitorGift({ ...e, forest: 5 }, () => 0)).toBeNull();
  });
});

describe('house or decoration', () => {
  it('keeps the decoration mark when loading a saved design', () => {
    const cube = { m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], color: 'wall' };
    const d = { id: 'x', name: 'x', cubes: [cube], bounds: { min: [0, 0, 0], max: [1, 1, 1] } };
    expect(sanitizeDesign({ ...d, kind: 'deco' })?.kind).toBe('deco');
    expect(sanitizeDesign(d)?.kind).toBeUndefined();
    expect(sanitizeDesign({ ...d, kind: 'castle' })?.kind).toBeUndefined();
  });
});
