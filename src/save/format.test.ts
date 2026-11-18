import { describe, it, expect } from 'vitest';
import { encodeSave, decodeSave, OldSaveError, SAVE_VERSION, type SaveData } from './format';

const v3 = (): SaveData => ({
  version: SAVE_VERSION, savedAt: 1,
  world: { seed: 1, height: 64, detail: 3, flowerStyle: 'voxel', params: { relief: 1, mountains: 1, water: 1, rocks: 1, forest: 1, flowers: 1 } },
  plots: (1 << 5) | (1 << 6), edits: [5, 3],
  progress: { points: 4, rightsUsed: 1, unlocks: [], firsts: [], newMarks: [] }, dex: {}, residents: [],
  farm: { simMs: 0, inventory: {}, crops: [], saplings: [], wet: [] },
  buildings: { designs: [], placed: [] },
});

describe('save v3', () => {
  it('versionIs3', () => {
    expect(SAVE_VERSION).toBe(3);
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
    expect(loaded.version).toBe(3);
    expect(loaded.buildings).toEqual({ designs: [], placed: [] });
  });
  it('rejects v1 with OldSaveError', async () => {
    const old = { ...v3(), version: 1 } as SaveData;
    await expect(decodeSave(await encodeSave(old))).rejects.toBeInstanceOf(OldSaveError);
  });
});
