import { describe, it, expect } from 'vitest';
import { Sfx, tierOf } from './sfx';

describe('sound hooks (v0.21.0)', () => {
  it('tiers by effect id', () => {
    expect(tierOf('F02')).toBe('reward');
    expect(tierOf('B12')).toBe('reward');
    expect(tierOf('E08a')).toBe('bed');
    expect(tierOf('C01')).toBe('passive');
    expect(tierOf('D04')).toBe('passive');
    expect(tierOf('A01')).toBe('action');
    expect(tierOf('F07')).toBe('action');
  });
  it('plays registered voices with pan and distance, quieter far away, silent beyond 60', () => {
    const s = new Sfx();
    const got: { pan: number; gain: number }[] = [];
    s.register('A01', (o) => got.push(o));
    s.listener = { x: 100, y: 10, z: 100 };
    s.play('A01', { x: 100, y: 10, z: 100 }, 0);
    s.play('A01', { x: 120, y: 10, z: 100 }, 1000); // 右へ 20
    s.play('A01', { x: 170, y: 10, z: 100 }, 2000); // 70 先
    expect(got.length).toBe(2);
    expect(got[0].pan).toBe(0);
    expect(got[1].pan).toBeCloseTo(1);
    expect(got[1].gain).toBeLessThan(got[0].gain);
  });
  it('not closer than 60 ms, at most 3 at once; passive sounds only near and not while fast-forwarding', () => {
    const s = new Sfx();
    let n = 0;
    s.register('B05a', () => n++);
    s.register('C01', () => n++);
    s.play('B05a', undefined, 0);
    s.play('B05a', undefined, 30); // 詰めすぎ
    s.play('B05a', undefined, 100);
    s.play('B05a', undefined, 200);
    s.play('B05a', undefined, 300); // 4 つ目（0.4 秒の中で）
    expect(n).toBe(3);
    s.listener = { x: 0, y: 0, z: 0 };
    s.play('C01', { x: 40, y: 0, z: 0 }, 5000); // 時間で起きる変化は 30 より遠いと鳴らさない
    expect(n).toBe(3);
    s.fastForward = true;
    s.play('C01', { x: 1, y: 0, z: 0 }, 6000);
    expect(n).toBe(3);
    s.fastForward = false;
    s.play('C01', { x: 1, y: 0, z: 0 }, 7000);
    expect(n).toBe(4);
  });
  it('unregistered ids are logged but silent', () => {
    const s = new Sfx();
    s.play('F01', undefined, 0);
    expect(s.log.map((x) => x.id)).toEqual(['F01']);
  });
});
