import { describe, it, expect } from 'vitest';
import { AA_MODES, AA_NAMES, aaSpec, isAAMode } from './antialias';

describe('antialias', () => {
  it('everyModeHasNameAndSpec', () => {
    for (const m of AA_MODES) {
      expect(AA_NAMES[m]).toBeTruthy();
      expect(aaSpec(m)).toBeTruthy();
    }
  });
  it('onlyMsaaUsesSamples', () => {
    for (const m of AA_MODES) expect(aaSpec(m).samples > 0).toBe(m === 'msaa');
  });
  it('temporalModesNeedVelocityAndNoMsaa', () => {
    for (const m of AA_MODES) {
      const s = aaSpec(m);
      expect(s.velocity).toBe(s.temporal !== 'none');
      if (s.temporal !== 'none') expect(s.samples).toBe(0);
    }
  });
  it('offDoesNothing', () => {
    expect(aaSpec('off')).toEqual({ samples: 0, velocity: false, post: 'none', temporal: 'none' });
  });
  it('isAAModeChecksNames', () => {
    expect(isAAMode('smaa')).toBe(true);
    expect(isAAMode('ssaa')).toBe(false);
  });
});
