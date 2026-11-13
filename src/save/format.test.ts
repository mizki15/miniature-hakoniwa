import { describe, it, expect } from 'vitest';
import { encodeSave, decodeSave, OldSaveError, SAVE_VERSION, type SaveData } from './format';

const v2 = (): SaveData => ({
  version: SAVE_VERSION, savedAt: 1,
  world: { seed: 1, height: 64, detail: 3, flowerStyle: 'voxel', params: { relief: 1, mountains: 1, water: 1, rocks: 1, forest: 1, flowers: 1 } },
  plots: (1 << 5) | (1 << 6), edits: [5, 3],
  progress: { points: 4, rightsUsed: 1, unlocks: [], firsts: [], newMarks: [] }, dex: {}, residents: [],
  farm: { simMs: 0, inventory: {}, crops: [], saplings: [], wet: [] },
});

describe('save v2', () => {
  it('roundtrips', async () => {
    expect(await decodeSave(await encodeSave(v2()))).toEqual(v2());
  });
  it('dexAndResidentsRoundtrip', async () => {
    const d = { ...v2(), dex: { butterfly: { seenAt: 10, observedAt: 20, seasons: [0, 1] }, rabbit: { seenAt: 5, seasons: [] } }, residents: [['rabbit', 70, 90, 'こむぎ'], ['duck', 74, 80, 'もち']] as SaveData['residents'] };
    expect(await decodeSave(await encodeSave(d))).toEqual(d);
  });
  it('rejects v1 with OldSaveError', async () => {
    const old = { ...v2(), version: 1 } as SaveData;
    await expect(decodeSave(await encodeSave(old))).rejects.toBeInstanceOf(OldSaveError);
  });
});
