import { describe, it, expect } from 'vitest';
import { MATERIALS, RAWS, RECIPE, RECIPES, addPickup, buildCost, buildPoints, craft, craftable, matKey, missingMats, payMats, pickupPerDay, refundMats, spend } from './materials';
import { PALETTE } from '../build/palette';
import { buildingCharacter } from '../build/character';
import { parseBuilding } from '../build/geoParse';

describe('materials table', () => {
  it('12 raw materials and one material per palette color', () => {
    expect(RAWS).toHaveLength(12);
    expect(MATERIALS.map((m) => m.id).sort()).toEqual(PALETTE.map((p) => p.name).sort());
  });
  it('every material can be made from some raw material', () => {
    for (const m of MATERIALS) expect(RECIPES.some((r) => r.mat === m.id), m.id).toBe(true);
  });
});

describe('craft', () => {
  it('one log makes 4 wall boards, as many times as there are logs', () => {
    const inv: Record<string, number> = { log_broad: 3 };
    expect(craftable(inv, RECIPE['wall-broad'])).toBe(3);
    expect(craft(inv, RECIPE['wall-broad'], 2)).toBe(2);
    expect(inv).toEqual({ log_broad: 1, 'm:wall': 8 });
    expect(craft(inv, RECIPE['wall-broad'], 5)).toBe(1);
    expect(craft(inv, RECIPE['wall-broad'])).toBe(0);
  });
  it('straw needs two for one thatch; not enough means nothing happens', () => {
    const inv: Record<string, number> = { straw: 1 };
    expect(craft(inv, RECIPE['thatch-straw'])).toBe(0);
    expect(inv).toEqual({ straw: 1 });
  });
});

describe('building cost', () => {
  const cube = (name: string, size: number[]) => JSON.stringify({ format_version: '1.12.0', 'minecraft:geometry': [{ description: { identifier: 'geometry.t' }, bones: [{ name, cubes: [{ origin: [0, 0, 0], size }] }] }] });
  const ch = (name: string, size: number[]) => { const r = parseBuilding(cube(name, size)); if (!r.ok) throw new Error(); return buildingCharacter(r.design); };
  it('materials are the visible surface (1 per block²), points grow with the volume (2–15)', () => {
    const c = buildCost(ch('wall', [32, 32, 32])); // 2×2×2：見える面 4×4 + 上 4 = 20
    expect(c.mats).toEqual({ wall: 20 });
    expect(c.points).toBe(buildPoints(8));
    expect(buildPoints(0)).toBe(2);
    expect(buildPoints(1)).toBe(3);
    expect(buildPoints(100)).toBe(10);
    expect(buildPoints(10000)).toBe(15);
  });
  it('pay, missing and refund', () => {
    const cost = { mats: { wall: 5, glass: 2 }, points: 4 };
    const inv: Record<string, number> = { [matKey('wall')]: 5, [matKey('glass')]: 1 };
    expect(missingMats(inv, cost)).toEqual({ glass: 1 });
    expect(payMats(inv, cost)).toBe(false);
    expect(inv[matKey('wall')]).toBe(5);
    inv[matKey('glass')] = 2;
    expect(payMats(inv, cost)).toBe(true);
    expect([inv[matKey('wall')], inv[matKey('glass')]]).toEqual([0, 0]);
    refundMats(inv, cost);
    expect([inv[matKey('wall')], inv[matKey('glass')]]).toEqual([5, 2]);
  });
  it('spend refuses when there is not enough', () => {
    const inv: Record<string, number> = { soil: 1 };
    expect(spend(inv, 'soil', 2)).toBe(false);
    expect(spend(inv, 'soil')).toBe(true);
    expect(inv.soil).toBe(0);
  });
});

describe('pickup', () => {
  it('a little a day from forest, waterside and beach, keeping the fractions', () => {
    const per = pickupPerDay({ forest: 400, waterside: 400, beach: 0 });
    const inv: Record<string, number> = {}, frac: Record<string, number> = {};
    expect(addPickup(inv, frac, per, 0.5)).toBe(0); // 半日では丸太 0.25 本
    addPickup(inv, frac, per, 1.5);
    expect(inv.log_broad).toBe(1);
    expect(inv.rock).toBe(2);
    expect(inv.foliage).toBe(2);
    expect(inv.sand ?? 0).toBe(0);
  });
});
