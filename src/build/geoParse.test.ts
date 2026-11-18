import { describe, it, expect } from 'vitest';
import { colorOfName } from './palette';
import { parseBuilding, type ParseResult } from './geoParse';

type Bone = { name: string; parent?: string; pivot?: unknown; rotation?: unknown; cubes?: unknown[]; poly_mesh?: unknown };

/** 規格どおりの最小の例 */
const geo = (bones: Bone[], extra: Record<string, unknown> = {}) => JSON.stringify({
  format_version: '1.12.0',
  'minecraft:geometry': [{ description: { identifier: 'geometry.test', ...extra }, bones }],
});
const cube = (origin = [-8, 0, -8], size = [16, 16, 16]) => ({ origin, size });
const ok = (r: ParseResult) => { if (!r.ok) throw new Error(r.issues.map((i) => i.message).join('\n')); return r.design; };
const codes = (r: ParseResult) => (r.ok ? [] : r.issues.map((i) => i.code));
const msgs = (r: ParseResult) => (r.ok ? '' : r.issues.map((i) => i.message).join('\n'));

describe('colorOfName', () => {
  it('matches palette names and prefixes', () => {
    expect(colorOfName('roof')).toBe('roof');
    expect(colorOfName('roof_left')).toBe('roof');
    expect(colorOfName('roof_blue')).toBe('roof_blue');
    expect(colorOfName('Roof_Blue_2')).toBe('roof_blue');
    expect(colorOfName('roofing')).toBeNull();
    expect(colorOfName('door')).toBeNull();
  });
});

describe('parseBuilding: checks', () => {
  it('accepts a minimal building', () => {
    expect(ok(parseBuilding(geo([{ name: 'wall', cubes: [cube()] }]))).name).toBe('test');
  });
  it('extractsJsonFromChatText', () => {
    const text = 'こちらです。\n```json\n' + geo([{ name: 'wall', cubes: [cube()] }]) + '\n```\nいかがでしょう { }';
    expect(parseBuilding(text).ok).toBe(true);
  });
  it('brokenJson', () => {
    expect(codes(parseBuilding('{"format_version":'))[0]).toBe('json');
  });
  it('fileTooLarge', () => {
    expect(codes(parseBuilding('x'.repeat(65537)))).toEqual(['file_size']);
  });
  it('noGeometry', () => {
    expect(codes(parseBuilding('{}'))).toEqual(['no_geometry']);
  });
  it('polyMesh', () => {
    expect(codes(parseBuilding(geo([{ name: 'wall', poly_mesh: { positions: [] } }])))).toContain('poly_mesh');
  });
  it('noColor', () => {
    const r = parseBuilding(geo([{ name: 'door', cubes: [cube()] }]));
    expect(codes(r)).toEqual(['no_color']);
    expect(msgs(r)).toContain('door');
  });
  it('inheritsParentColor', () => {
    expect(parseBuilding(geo([{ name: 'wood' }, { name: 'door', parent: 'wood', cubes: [cube()] }])).ok).toBe(true);
  });
  it('parentMissing', () => {
    const r = parseBuilding(geo([{ name: 'wall', parent: 'nai', cubes: [cube()] }]));
    expect(codes(r)).toContain('parent_missing');
    expect(msgs(r)).toContain('nai');
  });
  it('parentCycle', () => {
    const r = parseBuilding(geo([{ name: 'a', parent: 'b', cubes: [cube()] }, { name: 'b', parent: 'a' }]));
    expect(codes(r)).toContain('parent_cycle');
  });
  it('badNumbers', () => {
    const r = parseBuilding(geo([{ name: 'wall', cubes: [{ origin: ['0', 1], size: [1, 1, 1] }] }]));
    expect(codes(r)).toContain('bad_number');
    expect(msgs(r)).toContain('wall');
    const r2 = parseBuilding(geo([{ name: 'wall', cubes: [{ origin: [0, 0, 0], size: [1, null, 1] }] }]));
    expect(codes(r2)).toContain('bad_number');
    const r3 = parseBuilding(geo([{ name: 'wall', pivot: [0, 'x', 0], cubes: [cube()] }]));
    expect(codes(r3)).toContain('bad_number');
  });
  it('negativeSize', () => {
    expect(codes(parseBuilding(geo([{ name: 'wall', cubes: [cube([0, 0, 0], [-1, 1, 1]), cube()] }])))).toEqual(['negative_size']);
  });
  it('tooManyCubes', () => {
    const cubes = Array.from({ length: 513 }, () => cube([0, 0, 0], [1, 1, 1]));
    expect(codes(parseBuilding(geo([{ name: 'wall', cubes }])))).toContain('too_many_cubes');
  });
  it('tooManyBones', () => {
    const bones = Array.from({ length: 129 }, (_, i) => ({ name: `wall_${i}`, cubes: [cube([0, 0, 0], [1, 1, 1])] }));
    expect(codes(parseBuilding(geo(bones)))).toContain('too_many_bones');
  });
  it('tooDeep', () => {
    const bones: Bone[] = Array.from({ length: 17 }, (_, i) => ({ name: `wall_${i}`, parent: i ? `wall_${i - 1}` : undefined }));
    bones[16].cubes = [cube()];
    expect(codes(parseBuilding(geo(bones)))).toContain('too_deep');
  });
  it('collectsAllIssues', () => {
    const r = parseBuilding(geo([{ name: 'door', cubes: [cube()] }, { name: 'wall', cubes: [cube([0, 0, 0], [1, -2, 1])] }]));
    expect(codes(r).sort()).toEqual(['negative_size', 'no_color']);
  });
  it('ignoresUvAndTextures', () => {
    const r = parseBuilding(geo([{ name: 'wall', cubes: [{ ...cube(), uv: [0, 0], mirror: true }] }], { texture_width: 64, texture_height: 64 }));
    expect(r.ok).toBe(true);
  });
});
