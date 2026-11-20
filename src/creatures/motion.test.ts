import { describe, it, expect } from 'vitest';
import { wrapAngle, turnToward, approach, hopArc, gaitPose, GAITS } from './motion';

describe('motion', () => {
  it('wrapAngleStaysInHalfTurn', () => {
    expect(Math.abs(wrapAngle(Math.PI * 3))).toBeCloseTo(Math.PI); // 半周ちょうどは ±π のどちらでもよい
    expect(wrapAngle(Math.PI * 2.5)).toBeCloseTo(Math.PI / 2);
    expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
    expect(wrapAngle(0.3)).toBeCloseTo(0.3);
  });
  it('turnTowardTakesShortWayWithoutOvershoot', () => {
    // 350° → 10° は 20° 回るだけ（反対回りしない）
    const from = (350 / 180) * Math.PI, to = (10 / 180) * Math.PI;
    const a = turnToward(from, to, 0.1);
    expect(wrapAngle(a - from)).toBeCloseTo(0.1);
    expect(wrapAngle(turnToward(from, to, 5) - to)).toBeCloseTo(0);
  });
  it('approachStopsAtTarget', () => {
    expect(approach(0, 1, 0.3)).toBeCloseTo(0.3);
    expect(approach(0.9, 1, 0.3)).toBe(1);
    expect(approach(1, 0, 0.3)).toBeCloseTo(0.7);
  });
  it('hopArcStartsAndEndsOnGround', () => {
    expect(hopArc(0)).toBe(0);
    expect(hopArc(1)).toBe(0);
    expect(hopArc(0.5)).toBe(1);
    expect(hopArc(-1)).toBe(0);
  });
  it('gaitIsStillWhenNotMoving', () => {
    for (const g of GAITS) {
      const p = gaitPose(g, 1.234, 0.3, 0);
      expect(p.lift).toBe(0);
      expect(p.pitch).toBe(0);
      expect(p.roll).toBe(0);
      expect(p.squash).toBe(1);
    }
  });
  it('hopGaitLeavesTheGround', () => {
    const lifts = Array.from({ length: 20 }, (_, i) => gaitPose('hop', i * 0.3, 0.3, 1).lift);
    expect(Math.max(...lifts)).toBeGreaterThan(0.25);
    expect(Math.min(...lifts)).toBeGreaterThanOrEqual(0);
  });
  it('waddleRocksSideToSide', () => {
    const rolls = Array.from({ length: 20 }, (_, i) => gaitPose('waddle', i * 0.3, 0.03, 1).roll);
    expect(Math.max(...rolls)).toBeGreaterThan(0.1);
    expect(Math.min(...rolls)).toBeLessThan(-0.1);
  });
});
