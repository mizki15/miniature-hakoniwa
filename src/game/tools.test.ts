import { describe, it, expect } from 'vitest';
import { TOOL_DEFS, registryOptions, toolDef, type ToolAt, type ToolCtx } from './tools';
import { CROP_KINDS, Farm } from './farm';
import { DIRT, FARMLAND, GRASS, STONE, WET_FARMLAND } from '../world/blocks';

/** 道具を試すための、小さな箱庭の操作 */
function fakeCtx() {
  const voxels = new Map<string, number>();
  const log: string[] = [];
  const inv: Record<string, number> = {};
  const ctx: ToolCtx = {
    farm: new Farm(), seed: 'wheat',
    isTree: (col) => col === 99,
    setVoxel: (x, y, z, b) => { voxels.set(`${x},${y},${z}`, b); },
    removeFlowersAt: () => log.push('flowers'),
    addFarmland: (col) => log.push(`farmland:${col}`),
    markCrops: () => log.push('crops'),
    gain: (raw, n) => { inv[raw] = (inv[raw] ?? 0) + n; },
    extraStraw: () => 1,
    goalEvent: (e) => log.push(`goal:${e.k}`),
  };
  return { ctx, voxels, log, inv };
}
const at = (block: number, o: Partial<ToolAt> = {}): ToolAt => ({ x: 1, y: 12, z: 2, col: 5, block, topFace: true, isTop: true, ...o });

describe('tool registry (v0.18)', () => {
  it('the four farm tools, in order, with seed split by crop', () => {
    expect(TOOL_DEFS.map((d) => d.id)).toEqual(['till', 'seed', 'water', 'harvest']);
    expect(registryOptions('life').map((o) => o.id)).toEqual(['till', ...CROP_KINDS.map((k) => `seed:${k}`), 'water', 'harvest']);
    expect(registryOptions('terrain')).toEqual([]);
    expect(toolDef('dig')).toBeUndefined();
  });
  it('till: only grass or dirt on top, not under a tree', () => {
    const { ctx, voxels, log } = fakeCtx();
    const till = toolDef('till')!;
    expect(till.check(ctx, at(GRASS)).ok).toBe(true);
    expect(till.check(ctx, at(STONE)).msg).toBe('草地か土の所だけ耕せます');
    expect(till.check(ctx, at(DIRT, { topFace: false })).ok).toBe(false);
    expect(till.check(ctx, at(GRASS, { col: 99 })).msg).toBe('木の根元は耕せません');
    expect(till.check(ctx, at(FARMLAND)).msg).toBe('もう耕してあります');
    expect(till.apply(ctx, at(GRASS))).toBe('耕しました');
    expect(voxels.get('1,12,2')).toBe(FARMLAND);
    expect(log).toEqual(['flowers', 'farmland:5', 'goal:till']);
  });
  it('seed, water, harvest', () => {
    const { ctx, voxels, inv, log } = fakeCtx();
    const [seed, water, harvest] = ['seed', 'water', 'harvest'].map((id) => toolDef(id)!);
    expect(seed.check(ctx, at(GRASS)).ok).toBe(false);
    expect(seed.check(ctx, at(FARMLAND)).msg).toBe('小麦の種をまく');
    seed.apply(ctx, at(FARMLAND));
    expect(ctx.farm.crops.get(5)?.kind).toBe('wheat');
    expect(seed.check(ctx, at(FARMLAND)).msg).toBe('もう植えてあります');
    expect(water.check(ctx, at(FARMLAND)).msg).toBe('水をやる');
    water.apply(ctx, at(FARMLAND));
    expect(voxels.get('1,12,2')).toBe(WET_FARMLAND);
    expect(water.check(ctx, at(WET_FARMLAND)).msg).toBe('もう湿っています（延長）');
    expect(harvest.check(ctx, at(WET_FARMLAND)).msg).toBe('小麦：育ち具合 0%');
    ctx.farm.crops.get(5)!.progress = 1;
    expect(harvest.apply(ctx, at(WET_FARMLAND))).toBe('小麦を収穫しました（わら：繊維 +2）');
    expect(inv.fiber).toBe(2);
    expect(log).toContain('goal:harvest');
    expect(harvest.check(ctx, at(WET_FARMLAND)).msg).toBe('作物がありません');
  });
});

describe('watering stops when the crop is ripe (v0.20.2)', () => {
  it('a ripe crop can be harvested but not watered', () => {
    const { ctx } = fakeCtx();
    ctx.farm.plant(5, 'carrot');
    expect(toolDef('water')!.check(ctx, at(FARMLAND)).ok).toBe(true);
    ctx.farm.crops.get(5)!.progress = 1;
    expect(toolDef('water')!.check(ctx, at(FARMLAND))).toEqual({ ok: false, msg: '収穫できます' });
    expect(toolDef('harvest')!.check(ctx, at(FARMLAND)).ok).toBe(true);
  });
});
