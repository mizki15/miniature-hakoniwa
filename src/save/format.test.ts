import { describe, it, expect } from 'vitest';
import { encodeSave, decodeSave, OldSaveError, SAVE_VERSION, type SaveData } from './format';
import { START_PLOT } from '../world/plots';

const v3 = (): SaveData => ({
  version: SAVE_VERSION, savedAt: 1,
  world: { seed: 1, height: 64, detail: 3, flowerStyle: 'voxel', params: { relief: 1, mountains: 1, water: 1, rocks: 1, forest: 1, flowers: 1 } },
  plots: (1 << 5) | (1 << 6), edits: [5, 3],
  progress: { points: 4, rightsUsed: 1, unlocks: [], firsts: [], newMarks: [] }, dex: {}, residents: [],
  farm: { simMs: 0, inventory: {}, crops: [], saplings: [], wet: [] },
  buildings: { designs: [], placed: [] },
});

describe('save v5', () => {
  it('versionIs5', () => {
    expect(SAVE_VERSION).toBe(6);
  });
  it('roundtrips', async () => {
    const d = v3();
    d.buildings = {
      designs: [{ id: 'abcd1234', name: '小屋', cubes: [{ m: [1, 0, 0, -0.5, 0, 1, 0, 0, 0, 0, 1, -0.5], color: 'wall' }], bounds: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] } }],
      placed: [['abcd1234', 90, 100, 1]],
    };
    expect(await decodeSave(await encodeSave(d))).toEqual(d);
  });
  it('dexAndResidentsRoundtrip', async () => {
    const d = { ...v3(), dex: { butterfly: { seenAt: 10, observedAt: 20, seasons: [0, 1] }, rabbit: { seenAt: 5, seasons: [] } }, residents: [['rabbit', 70, 90, 'こむぎ'], ['duck', 74, 80, 'もち']] as SaveData['residents'] };
    expect(await decodeSave(await encodeSave(d))).toEqual(d);
  });
  it('migratesV2', async () => {
    const { buildings: _, ...old } = v3();
    const loaded = await decodeSave(await encodeSave({ ...old, version: 2 } as SaveData));
    expect(loaded.version).toBe(6);
    expect(loaded.buildings).toEqual({ designs: [], placed: [] });
  });
  it('rejects v1 with OldSaveError', async () => {
    const old = { ...v3(), version: 1 } as SaveData;
    await expect(decodeSave(await encodeSave(old))).rejects.toBeInstanceOf(OldSaveError);
  });
});

describe('v3 → v4: the 4×4 frame becomes 5×5 with the start in the middle', () => {
  it('moves plots, edits, farm, residents and buildings by one plot', async () => {
    const old: SaveData = {
      ...v3(), version: 3,
      plots: (1 << 5) | (1 << 6) | (1 << 0), // (1,1)・(2,1)・(0,0)
      edits: [100 + 90 * 256 + 12 * 256 * 256, 2],
      residents: [['rabbit', 70.5, 90.25, 'こむぎ']],
      farm: { simMs: 0, inventory: {}, crops: [[100 + 90 * 256, 'wheat', 0.5]], saplings: [[80 + 70 * 256, 1, 0, 1]], wet: [[81 + 70 * 256, 9]], flowers: [[82 + 70 * 256, 2]], bare: [[83 + 70 * 256, 5]], faded: [84 + 70 * 256] },
      buildings: { designs: [], placed: [['abcd', 90, 100, 1], ['efgh', 91, 101, 0, 0.5]] },
    };
    const d = await decodeSave(await encodeSave(old));
    expect(d.version).toBe(6);
    expect(d.plots).toBe((1 << START_PLOT) | (1 << 13) | (1 << 6));
    expect(d.edits).toEqual([164 + 154 * 320 + 12 * 320 * 320, 2]);
    expect(d.residents).toEqual([['rabbit', 134.5, 154.25, 'こむぎ']]);
    expect(d.farm.crops).toEqual([[164 + 154 * 320, 'wheat', 0.5]]);
    expect(d.farm.saplings[0][0]).toBe(144 + 134 * 320);
    expect([d.farm.wet[0][0], d.farm.flowers![0][0], d.farm.bare![0][0], d.farm.faded![0]]).toEqual([145, 146, 147, 148].map((x) => x + 134 * 320));
    expect(d.buildings.placed).toEqual([['abcd', 154, 164, 1], ['efgh', 155, 165, 0, 0.5]]);
  });
});

describe('v4 → v5: land rights become discovery points (×10)', () => {
  it('points ×10 minus 30 for each right used; wood becomes broadleaf logs', async () => {
    const old: SaveData = { ...v3(), version: 4, progress: { points: 7, rightsUsed: 2, unlocks: [], firsts: [], newMarks: [] }, farm: { simMs: 0, inventory: { wood: 6, wheat: 2 }, crops: [], saplings: [], wet: [] } };
    const d = await decodeSave(await encodeSave(old));
    expect(d.progress.points).toBe(70 - 60);
    expect(d.progress.rightsUsed).toBe(0);
    // v5 で広葉樹の丸太に、v6（v0.20）で木材に
    expect(d.farm.inventory).toEqual({ wheat: 2, wood: 6 });
  });
  it('never goes below zero', async () => {
    const d = await decodeSave(await encodeSave({ ...v3(), version: 4, progress: { points: 2, rightsUsed: 1, unlocks: [], firsts: [], newMarks: [] } }));
    expect(d.progress.points).toBe(0);
  });
});

describe('v5 → v6: raws and 13 materials become the five (v0.20)', () => {
  it('moves the inventory and clears pickup fractions', async () => {
    const { decodeSave: dec, encodeSave: enc } = await import('./format');
    const base = { version: 5, savedAt: 0, world: { seed: 1, height: 64, detail: 3, flowerStyle: 'lowpoly', params: {} as never }, plots: 1, edits: [], progress: { points: 0, rightsUsed: 0, unlocks: [], firsts: [], newMarks: [] }, dex: {}, residents: [], buildings: { designs: [], placed: [] } };
    const d = await dec(await enc({ ...base, farm: { simMs: 0, inventory: { log_broad: 2, 'm:wall': 4, rock: 3, turnip: 1 }, crops: [], saplings: [], wet: [], pickup: { at: 0, frac: { rock: 0.5 } } } } as never));
    expect(d.version).toBe(6);
    expect(d.farm.inventory).toEqual({ wood: 3, stone: 3, turnip: 1 });
    expect(d.farm.pickup?.frac).toEqual({});
  });
});
