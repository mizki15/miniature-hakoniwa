import { describe, it, expect } from 'vitest';
import { CUES, normGain } from './bank';
import { MELODY, noteHz } from './tones';

/** public/sfx にあるファイル（Vite の glob で、読み込まずに名前だけ） */
const FILES = new Set(Object.keys(import.meta.glob('/public/sfx/*.ogg')).map((k) => k.replace(/^.*\/(.+)\.ogg$/, '$1')));

describe('sound bank (v0.21.1)', () => {
  it('every recorded cue has its file in public/sfx and a measured peak', () => {
    for (const [id, c] of Object.entries(CUES)) {
      if (!c.f) { expect(c.tones?.length, id).toBeGreaterThan(0); continue; }
      expect(FILES.has(c.f), `${id} → ${c.f}`).toBe(true);
      expect(normGain(c.f)).toBeGreaterThan(0);
      expect(normGain(c.f)).toBeLessThanOrEqual(4);
    }
  });
  it('covers the sounding ids of docs/エフェクト一覧.md (not the silent ones)', () => {
    for (const id of ['A01', 'A10', 'B05a', 'B05f', 'B07e', 'B08e', 'B12', 'B14', 'C02', 'D04', 'E07d', 'F02', 'F13']) expect(CUES[id], id).toBeTruthy();
    for (const id of ['C06', 'C07', 'C08', 'D06', 'D20']) expect(CUES[id], id).toBeUndefined();
  });
  it('notes parse to the right pitch', () => {
    expect(noteHz('A4')).toBeCloseTo(440);
    expect(noteHz('C5')).toBeCloseTo(523.25, 1);
    expect(noteHz('F#4')).toBeCloseTo(369.99, 1);
    for (const tones of Object.values(MELODY)) for (const t of tones) if (t.n) expect(Number.isFinite(noteHz(t.n))).toBe(true);
  });
});
