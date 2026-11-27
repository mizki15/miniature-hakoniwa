import { describe, it, expect } from 'vitest';
import { BLOCK_YIELD, MATS, MAT_IDS, TREE_YIELD, addFractional, addPickup, blockCost, buildCost, buildPoints, migrateInventory, missingMats, payMats, pickupPerDay, refundMats } from './materials';
import { COBBLE, DIRT, GRASS, LEAVES, LOG, MUD, SAND, STONE } from '../world/blocks';

describe('five materials (v0.20)', () => {
  it('wood, fiber, stone, mineral, soil — each with a name, icon and how to get it', () => {
    expect(MAT_IDS).toEqual(['wood', 'fiber', 'stone', 'mineral', 'soil']);
    for (const m of MATS) { expect(m.name).toBeTruthy(); expect(m.icon).toBeTruthy(); expect(m.from).toBeTruthy(); }
  });
  it('every block yield adds up to one block', () => {
    for (const [b, y] of Object.entries(BLOCK_YIELD)) expect(Object.values(y).reduce((a, n) => a + (n ?? 0), 0), `block ${b}`).toBeCloseTo(1);
  });
  it('blocks give what they are made of', () => {
    expect(BLOCK_YIELD[DIRT]).toEqual({ soil: 1 });
    expect(BLOCK_YIELD[STONE]).toEqual({ stone: 1 });
    expect(BLOCK_YIELD[LOG]).toEqual({ wood: 1 });
    expect(BLOCK_YIELD[LEAVES]).toEqual({ fiber: 1 });
    expect(BLOCK_YIELD[GRASS].soil).toBeGreaterThan(BLOCK_YIELD[GRASS].fiber!);
    expect(BLOCK_YIELD[SAND].mineral).toBeGreaterThan(0.5);
    expect(BLOCK_YIELD[MUD].soil).toBeGreaterThan(0.5);
  });
  it('placing a block costs one of its main material', () => {
    expect(blockCost(DIRT)).toEqual({ soil: 1 });
    expect(blockCost(GRASS)).toEqual({ soil: 1 });
    expect(blockCost(SAND)).toEqual({ mineral: 1 });
    expect(blockCost(COBBLE)).toEqual({ stone: 1 });
    expect(blockCost(999)).toBeNull();
  });
  it('a tree gives wood and fiber', () => {
    expect(TREE_YIELD).toEqual({ wood: 3, fiber: 2 });
  });
});

describe('fractions pile up', () => {
  it('digging grass five times gives four soil and one fiber', () => {
    const inv: Record<string, number> = {}, frac: Record<string, number> = {};
    for (let i = 0; i < 5; i++) addFractional(inv, frac, BLOCK_YIELD[GRASS], 1, 'dig:');
    expect(inv).toEqual({ soil: 4, fiber: 1 });
  });
  it('pickups per day from the land', () => {
    const per = pickupPerDay({ forest: 600, waterside: 400, beach: 250 });
    expect(per).toEqual({ wood: 1, fiber: 2, stone: 1, mineral: 1 });
    const inv: Record<string, number> = {}, frac: Record<string, number> = {};
    expect(addPickup(inv, frac, per, 0.5)).toBe(1); // 繊維だけ 1 つ
    expect(addPickup(inv, frac, per, 0.5)).toBe(4);
    expect(inv).toEqual({ wood: 1, fiber: 2, stone: 1, mineral: 1 });
  });
});

describe('building cost', () => {
  it('one material per 2 m² of visible surface, by material', () => {
    const c = buildCost({ areas: { wood: 40, fiber: 13, mineral: 2 }, volume: 64 });
    expect(c.mats).toEqual({ wood: 20, fiber: 7, mineral: 1 });
    expect(c.points).toBe(buildPoints(64));
  });
  it('pay, lack, refund', () => {
    const inv: Record<string, number> = { wood: 25, fiber: 3 };
    const cost = { mats: { wood: 20, fiber: 7 }, points: 3 };
    expect(missingMats(inv, cost)).toEqual({ fiber: 4 });
    expect(payMats(inv, cost)).toBe(false);
    inv.fiber = 7;
    expect(payMats(inv, cost)).toBe(true);
    expect(inv).toEqual({ wood: 5, fiber: 0 });
    refundMats(inv, cost);
    expect(inv).toEqual({ wood: 25, fiber: 7 });
  });
});

describe('old saves (raws and 13 materials) move to the five', () => {
  it('raws one to one, crafted materials back to what they were made of; crops stay', () => {
    const inv = migrateInventory({ log_broad: 3, log_conifer: 1, 'm:wall': 8, straw: 2, reed: 1, 'm:thatch': 2, rock: 5, 'm:stone': 4, clay: 2, 'm:brick': 4, sand: 3, iron_ore: 1, turnip: 4 });
    expect(inv).toEqual({ wood: 6, fiber: 5, stone: 6, soil: 4, mineral: 5, turnip: 4 });
  });
  it('already new inventories stay', () => {
    expect(migrateInventory({ wood: 3, soil: 2, wheat: 1 })).toEqual({ wood: 3, soil: 2, wheat: 1 });
  });
});
