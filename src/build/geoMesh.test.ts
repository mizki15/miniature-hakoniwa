import { describe, it, expect } from 'vitest';
import { buildBuildingMesh } from './geoMesh';
import { parseBuilding, type BuildingDesign } from './geoParse';
import { hexToLinear } from '../world/blocks';

const design = (cubes: object[], name = 'wall'): BuildingDesign => {
  const r = parseBuilding(JSON.stringify({ format_version: '1.12.0', 'minecraft:geometry': [{ description: { identifier: 'geometry.t' }, bones: [{ name, cubes }] }] }));
  if (!r.ok) throw new Error(r.issues[0].message);
  return r.design;
};
const box = (x: number) => ({ origin: [x, 0, 0], size: [16, 16, 16] });

type V = [number, number, number];
const at = (a: Float32Array, i: number): V => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** 三角形ごとに（3 頂点、1 つ目の頂点の法線）を返す */
function* triangles(d: BuildingDesign) {
  const m = buildBuildingMesh(d);
  for (let t = 0; t < m.index.length; t += 3) {
    const [a, b, c] = [m.index[t], m.index[t + 1], m.index[t + 2]];
    yield { p: [at(m.position, a), at(m.position, b), at(m.position, c)], n: at(m.normal, a), vertex: a };
  }
}

describe('buildBuildingMesh', () => {
  it('twelveTrianglesPerCube', () => {
    const m = buildBuildingMesh(design([box(0), box(20), box(40)]));
    expect(m.index.length).toBe(108);
    expect(m.position.length / 3).toBe(72);
    expect(m.ao.every((v) => v === 1)).toBe(true);
    expect(m.veg.every((v) => v === 0)).toBe(true);
    expect(m.index).toBeInstanceOf(Uint32Array);
  });
  it('normalsPointOutward', () => {
    const d = design([box(0)]);
    const c = [0, 1, 2].map((a) => (d.bounds.min[a] + d.bounds.max[a]) / 2) as V;
    for (const { p, n } of triangles(d)) {
      const mid = [0, 1, 2].map((a) => (p[0][a] + p[1][a] + p[2][a]) / 3) as V;
      expect(dot(sub(c, mid), n)).toBeLessThan(0);
    }
  });
  it('windingMatchesNormal', () => {
    const d = design([{ origin: [0, 0, 0], size: [16, 8, 4], pivot: [0, 0, 0], rotation: [10, 30, -20] }]);
    for (const { p, n } of triangles(d)) expect(dot(cross(sub(p[1], p[0]), sub(p[2], p[0])), n)).toBeGreaterThan(0);
  });
  it('linearColor', () => {
    const m = buildBuildingMesh(design([box(0)], 'roof'));
    const want = hexToLinear(0xc8403c);
    for (let i = 0; i < 3; i++) expect(m.color[i]).toBeCloseTo(want[i], 6);
  });
  it('rotatedCubeNormalsUnit', () => {
    const d = design([{ origin: [0, 0, 0], size: [16, 8, 4], pivot: [0, 0, 0], rotation: [10, 30, -20] }]);
    for (const { n } of triangles(d)) expect(Math.hypot(...n)).toBeCloseTo(1, 6);
  });
});
