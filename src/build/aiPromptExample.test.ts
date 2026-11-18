import { describe, it, expect } from 'vitest';
import { buildPrompt } from './aiPrompt';
import { extractJson, parseBuilding } from './geoParse';

describe('buildPrompt example', () => {
  it('exampleInPromptPassesTheChecks', () => {
    // 説明文の例が規格に合っていないと、AI が間違いを真似するため
    const p = buildPrompt('');
    const r = parseBuilding(extractJson(p.slice(p.indexOf('## 例'))));
    expect(r.ok ? 'ok' : r.issues.map((i) => i.message)).toBe('ok');
  });
});
