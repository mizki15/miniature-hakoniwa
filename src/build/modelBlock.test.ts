import { describe, it, expect } from 'vitest';
import { buildPrompt } from './aiPrompt';
import { extractJson } from './geoParse';
import { parseModelBlock, sanitizeModelDesign } from './modelBlock';
import { buildMesh } from '../world/mesher';
import { isMeshed, isWalkableTop } from '../world/blocks';
import { freeMyBlockId, isModelBlock, sameLook } from '../world/myBlocks';

const geo = (bones: unknown[]) => JSON.stringify({ format_version: '1.12.0', 'minecraft:geometry': [{ description: { identifier: 'geometry.t' }, bones }] });

describe('model my-blocks (v0.20.6)', () => {
  it('the block prompt asks for a small object inside one block, not a full cube, and its example passes', () => {
    const p = buildPrompt('小さな机', { block: true });
    expect(p).toContain('fits inside ONE block');
    expect(p).toContain('x and z from -8 to 8 units, y from 0 to 16 units');
    expect(p).toMatch(/does NOT have to fill the block/);
    expect(p).toContain('\n小さな机\n');
    const r = parseModelBlock(extractJson(p.slice(p.indexOf('## Example'))), '小さな机');
    expect(r.ok ? 'ok' : r.issues.map((i) => i.message)).toBe('ok');
    if (!r.ok) return;
    expect(r.look.name).toBe('小さな机');
    // 素材は部品の名前（木の天板と脚・布）から
    expect(r.look.mats.wood).toBeGreaterThan(0.6);
    expect(r.look.mats.fiber).toBeGreaterThan(0);
    // 机は立方体を埋めない
    expect(r.look.design.bounds.max[1]).toBeLessThanOrEqual(1);
  });
  it('the building prompt stays the same kind of prompt', () => {
    expect(buildPrompt('灯台')).toContain('a low-poly building');
    expect(buildPrompt('灯台')).not.toContain('ONE block');
  });
  it('rejects things bigger than one block or sticking out of it', () => {
    const tall = parseModelBlock(geo([{ name: 'wood_a07a4e', cubes: [{ origin: [-4, 0, -4], size: [8, 24, 8] }] }]));
    expect(tall.ok).toBe(false);
    const off = parseModelBlock(geo([{ name: 'stone_8a9098', cubes: [{ origin: [2, 0, -4], size: [12, 8, 8] }] }]));
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.issues.map((i) => i.message).join()).toMatch(/はみ出して/);
    const ok = parseModelBlock(geo([{ name: 'stone_8a9098', cubes: [{ origin: [-8, 0, -8], size: [16, 16, 16] }] }]));
    expect(ok.ok).toBe(true);
  });
  it('save round trip of the shape', () => {
    const r = parseModelBlock(geo([{ name: 'soil_a85a44_pot', cubes: [{ origin: [-4, 0, -4], size: [8, 10, 8] }] }]), 'つぼ');
    if (!r.ok) throw new Error('bad');
    expect(sanitizeModelDesign(JSON.parse(JSON.stringify(r.look.design)))).toEqual(r.look.design);
    expect(r.look.mats).toEqual({ soil: 1 });
    expect(sameLook(r.look, { ...r.look, name: 'ちがう名前' })).toBe(true);
  });
  it('ids 96–127; not drawn by the terrain mesher and do not hide the faces next to them; not walked on', () => {
    expect(isModelBlock(96)).toBe(true);
    expect(isModelBlock(95)).toBe(false);
    expect(freeMyBlockId([96, 97], true)).toBe(98);
    expect(freeMyBlockId([64], false)).toBe(65);
    expect(isMeshed(100)).toBe(false);
    expect(isMeshed(70)).toBe(true);
    expect(isWalkableTop(100)).toBe(false);
    // 地面（土）の上に形のあるマイブロック：地面の上面は描かれ、マイブロックの面は描かれない
    const data = new Uint8Array(1 * 2 * 1);
    data[0] = 2; data[1] = 100;
    const m = buildMesh({ sx: 1, sy: 2, sz: 1, data });
    const tops = [];
    for (let i = 0; i < m.normal.length; i += 3) if (m.normal[i + 1] > 0.5) tops.push(m.position[i + 1]);
    expect(tops.length).toBeGreaterThan(0);
    expect(Math.max(...tops)).toBe(1); // 土の上面（y = 1）だけ。マイブロックの上面（y = 2）は無い
  });
});
