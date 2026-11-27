import { describe, it, expect } from 'vitest';
import { MYBLOCK_BASE, PATTERNS, buildMyBlockPrompt, extractMyBlockJson, freeMyBlockId, isMyBlock, parseMyBlock, patternMask, sameLook, sanitizeMyBlock } from './myBlocks';
import { isOpaque, isWalkableTop } from './blocks';

const good = {
  name: '苔むした石',
  materials: { stone: 0.8, fiber: 0.2 },
  faces: {
    top: { base: '#6f8f4a', accent: '#4e6e34', pattern: 'speckle' },
    side: { base: '#8a9098', pattern: 'bricks' },
  },
};

describe('my-blocks (v0.20.4)', () => {
  it('reads the JSON from an AI reply (code block and words around it)', () => {
    const text = `はい、どうぞ。\n\`\`\`json\n${JSON.stringify(good, null, 2)}\n\`\`\`\nいかがでしょう？`;
    expect(extractMyBlockJson(text)).toEqual(good);
    const r = parseMyBlock(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.look.name).toBe('苔むした石');
    expect(r.look.mats).toEqual({ stone: 0.8, fiber: 0.2 });
    // accent が無い面は、base を少し暗くした色。bottom が無ければ side と同じ
    expect(r.look.side.accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(r.look.bottom).toEqual(r.look.side);
  });
  it('fractions are normalised to add up to 1 in 0.05 steps', () => {
    const r = parseMyBlock(JSON.stringify({ ...good, materials: { wood: 3, soil: 1, mineral: 0.0001 } }));
    expect(r.ok && r.look.mats).toEqual({ wood: 0.75, soil: 0.25 });
  });
  it('explains what is wrong (in Japanese)', () => {
    const r = parseMyBlock(JSON.stringify({ materials: { gold: 1 }, faces: { top: { base: 'red' } } }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.map((i) => i.message).join('\n')).toMatch(/gold/);
    expect(r.issues.map((i) => i.message).join('\n')).toMatch(/#rrggbb/);
    expect(parseMyBlock('ただの文').ok).toBe(false);
  });
  it('ids 64–127; save round trip; same look is found again', () => {
    expect(isMyBlock(MYBLOCK_BASE)).toBe(true);
    expect(isMyBlock(MYBLOCK_BASE - 1)).toBe(false);
    expect(isMyBlock(128)).toBe(false);
    expect(freeMyBlockId([64, 65, 67])).toBe(66);
    expect(freeMyBlockId(Array.from({ length: 64 }, (_, i) => 64 + i))).toBeNull();
    const r = parseMyBlock(JSON.stringify(good));
    if (!r.ok) throw new Error('bad');
    const def = { id: 70, ...r.look };
    expect(sanitizeMyBlock(JSON.parse(JSON.stringify(def)))).toEqual(def);
    expect(sanitizeMyBlock({ ...def, id: 3 })).toBeNull();
    expect(sameLook(def, r.look)).toBe(true);
  });
  it('acts like terrain: solid, can be walked on', () => {
    expect(isOpaque(70)).toBe(true);
    expect(isWalkableTop(70)).toBe(true);
  });
  it('patterns: plain is never accent, border hits the edge only, checker splits in four', () => {
    for (let i = 0; i < 20; i++) expect(patternMask('plain', i / 20, (i * 7 % 20) / 20)).toBe(false);
    expect(patternMask('border', 0.05, 0.5)).toBe(true);
    expect(patternMask('border', 0.5, 0.5)).toBe(false);
    expect(patternMask('checker', 0.25, 0.25)).toBe(false);
    expect(patternMask('checker', 0.75, 0.25)).toBe(true);
    expect(PATTERNS.length).toBe(8);
  });
  it('the prompt lists every pattern and material, and its example passes', () => {
    const p = buildMyBlockPrompt('青いタイル');
    for (const pat of PATTERNS) expect(p).toContain(`   * ${pat}: `);
    expect(p).toContain('\n青いタイル\n');
    expect(p.replace('\n青いタイル\n', '').replace(/"name": "[^"]*"/, '')).not.toMatch(/[぀-ヿ一-鿿]/);
    expect(parseMyBlock(p.slice(p.indexOf('## Example'))).ok).toBe(true);
  });
});
