import { describe, it, expect } from 'vitest';
import { buildPrompt } from './aiPrompt';
import { extractJson, parseBuilding } from './geoParse';

const example = () => {
  const p = buildPrompt('');
  return parseBuilding(extractJson(p.slice(p.indexOf('## 例'))));
};

describe('buildPrompt example', () => {
  it('exampleInPromptPassesTheChecks', () => {
    // 説明文の例が規格に合っていないと、AI が間違いを真似するため
    const r = example();
    expect(r.ok ? 'ok' : r.issues.map((i) => i.message)).toBe('ok');
  });
  it('exampleRoofIsARidge', () => {
    // 例の屋根の板 2 枚は「へ」の字：内側の端が高く、外側の端が低い（X が反転する形式なので、回転の符号を間違えやすい）
    const r = example();
    if (!r.ok) throw new Error('example failed');
    const roofs = r.design.cubes.filter((c) => c.color === 'roof');
    expect(roofs.length).toBe(2);
    for (const { m } of roofs) {
      const at = (x: number) => [0, 1, 2].map((k) => m[k * 4] * x + m[k * 4 + 1] * 0.5 + m[k * 4 + 2] * 0.5 + m[k * 4 + 3]);
      const [a, b] = [at(0), at(1)];
      const [inner, outer] = Math.abs(a[0]) < Math.abs(b[0]) ? [a, b] : [b, a];
      expect(inner[1]).toBeGreaterThan(outer[1]);
    }
  });
});

describe('buildPrompt example roof', () => {
  it('exampleRoofRestsOnWalls', () => {
    // 屋根の板の下の面は、壁の端（x = ±20 単位）で壁の上（y = 32 単位）より下に潜らない
    const r = example();
    if (!r.ok) throw new Error('example failed');
    const wallTop = 32 / 16, wallEdge = 20 / 16;
    for (const { m, color } of r.design.cubes) {
      if (color !== 'roof') continue;
      const at = (x: number) => [0, 1, 2].map((k) => m[k * 4] * x + m[k * 4 + 1] * 0 + m[k * 4 + 2] * 0.5 + m[k * 4 + 3]);
      const [a, b] = [at(0), at(1)];
      const [inner, outer] = Math.abs(a[0]) < Math.abs(b[0]) ? [a, b] : [b, a];
      expect(Math.abs(outer[0])).toBeGreaterThan(wallEdge); // 軒が壁より外に出る
      const t = (wallEdge - Math.abs(inner[0])) / (Math.abs(outer[0]) - Math.abs(inner[0]));
      expect(inner[1] + (outer[1] - inner[1]) * t).toBeGreaterThan(wallTop - 0.05);
    }
  });
});
