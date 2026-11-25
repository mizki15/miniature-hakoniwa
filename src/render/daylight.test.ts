import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { snapToShadowTexel } from './daylight';

describe('shadow centre snapping (v0.18.1)', () => {
  const dir = new THREE.Vector3(0.6, 0.5, 0.3).normalize();
  const texel = (2 * 48) / 4096;

  it('moves the point by less than one texel, and keeps it along the light', () => {
    const p = new THREE.Vector3(37.3, 12.1, -81.7);
    const s = snapToShadowTexel(p, dir, texel);
    expect(s.distanceTo(p)).toBeLessThan(texel);
    expect(s.clone().sub(p).dot(dir)).toBeCloseTo(0, 9); // 光の向きにはずらさない
  });

  it('nearby points snap onto the same grid (so the shadow map does not shimmer)', () => {
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    for (let i = 0; i < 20; i++) {
      const p = new THREE.Vector3(i * 3.7, 5 + i, -i * 2.3);
      const s = snapToShadowTexel(p, dir, texel);
      for (const axis of [right, up]) {
        const k = s.dot(axis) / texel;
        expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
      }
    }
  });

  it('works when the light is straight above', () => {
    const s = snapToShadowTexel(new THREE.Vector3(1.234, 3, 5.678), new THREE.Vector3(0, 1, 0), 0.5);
    expect(s.x % 0.5).toBeCloseTo(0, 9);
    expect(s.y).toBeCloseTo(3, 9);
  });
});
