import { describe, it, expect } from 'vitest';
import html from '../index.html?raw';
import { DEFAULTS } from './defaults';
import { DEFAULT_PARAMS } from './world/terrain';

/** src/defaults.ts を GitHub で書き換えた時に、壊れていないかを確かめる（v0.18.1） */
const slider = (id: string) => {
  const m = html.match(new RegExp(`id="${id}" min="([0-9.]+)" max="([0-9.]+)"`));
  return m ? { min: parseFloat(m[1]), max: parseFloat(m[2]) } : null;
};
const F_STOPS = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22];

describe('defaults (src/defaults.ts)', () => {
  it('every terrain value has its slider, and fits in it', () => {
    for (const [k, v] of Object.entries(DEFAULTS.terrain)) {
      const s = slider(`p-${k}`);
      expect(s, `p-${k} のスライダーが無い`).not.toBeNull();
      expect(v, k).toBeGreaterThanOrEqual(s!.min);
      expect(v, k).toBeLessThanOrEqual(s!.max);
    }
    // スライダーのある地形のパラメータは、すべて初期値がある
    for (const m of html.matchAll(/id="p-([a-zA-Z]+)"/g)) expect(DEFAULTS.terrain, m[1]).toHaveProperty(m[1]);
  });
  it('plot counts are whole numbers', () => {
    for (const k of ['rockPlots', 'wetPlots', 'beachPlots'] as const) expect(Number.isInteger(DEFAULTS.terrain[k])).toBe(true);
  });
  it('the game uses them for new worlds', () => {
    for (const [k, v] of Object.entries(DEFAULTS.terrain)) expect(DEFAULT_PARAMS[k as keyof typeof DEFAULT_PARAMS]).toBe(v);
  });
  it('look and play values fit their controls', () => {
    const L = DEFAULTS.look, P = DEFAULTS.play;
    const pairs: [string, number][] = [['bump', L.bump], ['toonLine', L.toonLine], ['blend', L.blend], ['aoStrength', L.aoStrength], ['focusSpeed', L.focusSpeed],
      ['nightBright', L.nightBright], ['groundDensity', L.groundDensity], ['moveSpeed', P.moveSpeed], ['tipDelay', P.tipDelay], ['ecoAbundance', P.ecoAbundance]];
    for (const [id, v] of pairs) {
      const s = slider(id);
      expect(s, id).not.toBeNull();
      expect(v, id).toBeGreaterThanOrEqual(s!.min);
      expect(v, id).toBeLessThanOrEqual(s!.max);
    }
    expect(F_STOPS).toContain(L.fStop);
    expect([1, 60, 600]).toContain(P.simSpeed);
  });
});
