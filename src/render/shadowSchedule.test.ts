import { describe, it, expect } from 'vitest';
import { ShadowSchedule } from './shadowSchedule';

const run = (s: ShadowSchedule, frames: number) => Array.from({ length: frames }, () => s.tick());

describe('ShadowSchedule', () => {
  it('everyFrameByDefault', () => {
    expect(run(new ShadowSchedule(), 4)).toEqual([true, true, true, true]);
  });
  it('everyNthFrame', () => {
    const s = new ShadowSchedule();
    s.interval = 4;
    expect(run(s, 9)).toEqual([true, false, false, false, true, false, false, false, true]);
  });
  it('forceRedrawsOnNextTick', () => {
    const s = new ShadowSchedule();
    s.interval = 4;
    s.tick();
    s.tick();
    s.force();
    // 強制した次のフレームで描き直し、そこから数え直す
    expect(run(s, 5)).toEqual([true, false, false, false, true]);
  });
  it('changingIntervalRedrawsAtOnce', () => {
    const s = new ShadowSchedule();
    s.interval = 8;
    s.tick(); s.tick();
    s.interval = 2;
    expect(run(s, 3)).toEqual([true, false, true]);
  });
  it('rejectsBadIntervals', () => {
    const s = new ShadowSchedule();
    s.interval = 0;
    expect(s.interval).toBe(1);
    s.interval = 2.7;
    expect(s.interval).toBe(2);
  });
});
