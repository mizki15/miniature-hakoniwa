import { describe, it, expect } from 'vitest';
import { buildPrompt, buildFixPrompt } from './aiPrompt';
import { PALETTE } from './palette';

describe('buildPrompt', () => {
  it('promptListsWholePalette', () => {
    const p = buildPrompt('');
    for (const c of PALETTE) {
      expect(p).toContain(c.name);
      expect(p).toContain('#' + c.hex.toString(16).toUpperCase().padStart(6, '0'));
    }
  });
  it('promptStatesLimits', () => {
    const p = buildPrompt('');
    expect(p).toContain('512');
    expect(p).toContain('128 単位（8 マス）');
    expect(p).toContain('192 単位（12 マス）');
    expect(p).toContain('64 KB');
  });
  it('promptKeepsIdea', () => {
    expect(buildPrompt('青い屋根の灯台')).toContain('青い屋根の灯台');
  });
  it('emptyIdeaPlaceholder', () => {
    expect(buildPrompt('  ')).toContain('（ここに作ってほしいものを書いてください）');
  });
});

describe('buildFixPrompt', () => {
  it('fixPromptListsIssues', () => {
    const p = buildFixPrompt([{ code: 'no_color', message: 'グループ「door」の色が決まりません。' }, { code: 'too_wide', message: '幅が広すぎます。' }]);
    expect(p).toContain('グループ「door」の色が決まりません。');
    expect(p).toContain('幅が広すぎます。');
    expect(p).toContain('この点だけを直して、JSON 全体をもう一度出してください');
  });
});
