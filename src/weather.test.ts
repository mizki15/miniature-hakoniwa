import { describe, it, expect } from 'vitest';
import { isSnowDay, weatherAt } from './weather';
import { seasonAt } from './calendar';

const H = 3600_000;

describe('snow days (v0.17)', () => {
  // 2027〜2029 年の、冬になる月をすべて見る
  const winters: [number, number][] = [];
  for (let y = 2027; y <= 2029; y++) for (let m = 0; m < 12; m++) if (seasonAt(new Date(Date.UTC(y, m, 10))).season === 3) winters.push([y, m]);

  it('every week of winter has exactly one snow day', () => {
    expect(winters.length).toBe(9);
    for (const [y, m] of winters) {
      const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      for (let start = 0; start < dim; start += 7) {
        let n = 0;
        for (let d = start; d < Math.min(dim, start + 7); d++) if (isSnowDay(new Date(Date.UTC(y, m, d + 1, 12)))) n++;
        expect(n, `${y}-${m + 1} week from ${start + 1}`).toBe(1);
      }
    }
  });

  it('snows all day long (UTC), so daytime gets snow in any time zone', () => {
    for (const [y, m] of winters) {
      for (let d = 1; d <= 28; d++) {
        const t0 = Date.UTC(y, m, d);
        if (!isSnowDay(new Date(t0 + 12 * H))) continue;
        for (let h = 0; h < 24; h += 0.5) expect(weatherAt(new Date(t0 + h * H), 3)).toBe('snow');
        // 時差 −12〜+14 時間のどこでも、ある日の 10〜16 時のうち少なくとも 3 時間は雪
        for (let off = -12; off <= 14; off++) {
          let snowyDaytime = 0;
          for (let h = 0; h < 48; h += 0.5) {
            const local = (((h + off) % 24) + 24) % 24;
            if (local >= 10 && local < 16 && h < 24) snowyDaytime += 0.5;
          }
          expect(snowyDaytime).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('no snow days outside winter', () => {
    for (let d = 0; d < 365 * 2; d++) {
      const t = new Date(Date.UTC(2027, 0, 1 + d, 6));
      if (seasonAt(t).season !== 3) expect(isSnowDay(t)).toBe(false);
    }
  });
});
