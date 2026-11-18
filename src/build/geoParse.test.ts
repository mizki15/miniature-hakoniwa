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

// ---------- 形の変換（Task 3） ----------
import asymmetricJson from './fixtures/asymmetric.geo.json?raw';
import rotatedJson from './fixtures/rotated.geo.json?raw';
import rotatedExpected from './fixtures/rotated.expected.json';
import { transformCubes, resolveBones as resolve } from './geoParse';

/** 行列 m で単位立方体の 8 隅を写す */
const cornersOf = (m: number[]) => {
  const out: [number, number, number][] = [];
  for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) {
    out.push([0, 1, 2].map((r) => m[r * 4] * x + m[r * 4 + 1] * y + m[r * 4 + 2] * z + m[r * 4 + 3]) as [number, number, number]);
  }
  return out;
};
const center = (m: number[]) => cornersOf(m).reduce<number[]>((a, p) => a.map((v, i) => v + p[i] / 8), [0, 0, 0]);

describe('parseBuilding: transforms', () => {
  it('cubeCorners', () => {
    const d = ok(parseBuilding(geo([{ name: 'wall', cubes: [cube([-8, 0, -8], [16, 16, 16])] }])));
    expect(d.bounds.min).toEqual([-0.5, 0, -0.5]);
    expect(d.bounds.max).toEqual([0.5, 1, 0.5]);
  });
  it('inflate', () => {
    const d = ok(parseBuilding(geo([{ name: 'wall', cubes: [{ ...cube([-8, 0, -8], [16, 16, 16]), inflate: 1 }] }])));
    // 1/16 ずつ広がり、底面を y = 0 にずらすので高さは 18/16
    expect(d.bounds.min[0]).toBeCloseTo(-9 / 16);
    expect(d.bounds.max[0]).toBeCloseTo(9 / 16);
    expect(d.bounds.min[1]).toBe(0);
    expect(d.bounds.max[1]).toBeCloseTo(18 / 16);
  });
  it('asymmetricMatchesBlockbench', () => {
    // Blockbench の画面では、扉（wood）は北（−Z）の面、煙突（brick）は東（+X）にある
    const d = ok(parseBuilding(asymmetricJson));
    const door = d.cubes.find((c) => c.color === 'wood')!;
    const chimney = d.cubes.find((c) => c.color === 'brick')!;
    expect(center(door.m)[2]).toBeLessThan(-1);
    expect(center(chimney.m)[0]).toBeGreaterThan(0.5);
  });
  it('rotatedMatchesBlockbench', () => {
    // 底面が y = 0 にない見本なので、ずらす前の変換（Blockbench の単位）で比べる
    const issues: never[] = [];
    const r = resolve(JSON.parse(rotatedJson), issues)!;
    const cubes = transformCubes(r.bones);
    const expected = rotatedExpected.cubes as [number, number, number][][];
    expect(cubes.length).toBe(2);
    cubes.forEach((c, k) => {
      const got = cornersOf(c.m);
      for (const e of expected[k]) {
        const best = Math.min(...got.map((p) => Math.hypot(p[0] - e[0], p[1] - e[1], p[2] - e[2])));
        expect(best).toBeLessThan(0.01 * 16);
      }
    });
  });
  it('tooWide', () => {
    const r = parseBuilding(geo([{ name: 'wall', cubes: [cube([-64, 0, -8], [129, 16, 16])] }]));
    expect(codes(r)).toEqual(['too_wide']);
    expect(msgs(r)).toContain('8.1');
    expect(msgs(r)).toContain('8 マス');
  });
  it('tooTall', () => {
    expect(codes(parseBuilding(geo([{ name: 'wall', cubes: [cube([-8, 0, -8], [16, 193, 16])] }])))).toEqual(['too_tall']);
  });
  it('rotationCountsForBounds', () => {
    const r = parseBuilding(geo([{ name: 'wall', cubes: [{ origin: [-60, 0, -60], size: [120, 2, 120], pivot: [0, 0, 0], rotation: [0, 45, 0] }] }]));
    expect(codes(r)).toEqual(['too_wide']);
  });
  it('notGrounded', () => {
    expect(codes(parseBuilding(geo([{ name: 'wall', cubes: [cube([-8, 4, -8])] }])))).toEqual(['not_grounded']);
    const d = ok(parseBuilding(geo([{ name: 'wall', cubes: [cube([-8, 0.4, -8])] }])));
    expect(d.bounds.min[1]).toBe(0);
  });
  it('emptyAfterDroppingZeroCubes', () => {
    expect(codes(parseBuilding(geo([{ name: 'wall', cubes: [cube([0, 0, 0], [0, 0, 0])] }])))).toEqual(['empty']);
  });
  it('keepsFlatPlanes', () => {
    // 厚さ 0 の板（Blockbench でよく使う）は残す
    expect(ok(parseBuilding(geo([{ name: 'wall', cubes: [cube([-8, 0, -8], [16, 16, 0])] }]))).cubes.length).toBe(1);
  });
  it('sameDesignSameId', () => {
    const a = ok(parseBuilding(geo([{ name: 'wall', cubes: [cube()] }])));
    const reordered = JSON.stringify({ 'minecraft:geometry': [{ bones: [{ cubes: [{ size: [16, 16, 16], origin: [-8, 0, -8] }], name: 'wall' }], description: { identifier: 'geometry.test' } }], format_version: '1.12.0' }, null, 2);
    const b = ok(parseBuilding(reordered));
    const moved = ok(parseBuilding(geo([{ name: 'wall', cubes: [cube([-7, 0, -8])] }])));
    expect(a.id).toMatch(/^[0-9a-f]{8}$/);
    expect(b.id).toBe(a.id);
    expect(moved.id).not.toBe(a.id);
  });
});
