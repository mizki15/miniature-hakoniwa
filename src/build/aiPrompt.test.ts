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
    expect(p).toContain('192 単位（12 マス）');
    expect(p).toContain('320 単位（20 マス）');
    expect(p).toContain('64 KB');
  });
  it('promptKeepsIdea', () => {
    expect(buildPrompt('青い屋根の灯台')).toContain('青い屋根の灯台');
  });
  it('emptyIdeaLeavesSectionBlank', () => {
    // 作ってほしいものが空なら、見出しの下は空けておく（利用者が書き足す）
    expect(buildPrompt('  ')).toContain('## 作ってほしいもの\n\n## 規格（必ず守る）');
  });
  it('followsTheTemplate', () => {
    const p = buildPrompt('灯台');
    expect(p.startsWith('あなたは 3D モデルを作るアシスタントです。次の規格を厳密に守って、ローポリの建物を\nMinecraft Bedrock のジオメトリ JSON（Blockbench の「Bedrock Entity」形式の .geo.json）で作ってください。\n## 作ってほしいもの\n灯台\n')).toBe(true);
    expect(p).toContain('   * wall：#A07A4E（木の壁）');
    expect(p).toContain('* めり込んでいる場合はそれが適切かどうか確かめてから出力する。');
    expect(p.trimEnd().endsWith('* Z-fightingを起こして変になっていないか確認する。')).toBe(true);
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
