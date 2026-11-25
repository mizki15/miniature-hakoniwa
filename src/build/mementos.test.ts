import { describe, it, expect } from 'vitest';
import { mementoDesign, mementoId } from './mementos';
import { buildingCharacter } from './character';
import { footprintCols } from './placement';
import { sanitizeDesign } from './geoParse';

describe('season mementos (v0.17)', () => {
  it('one small decoration per season, named by the month', () => {
    const names = [0, 1, 2, 3].map((k) => mementoDesign(k).name);
    expect(names).toEqual(['2027年1月の記念：花の鉢', '2027年2月の記念：ひまわり', '2027年3月の記念：かかし', '2027年4月の記念：雪だるま']);
    expect(mementoDesign(15).name).toBe('2028年4月の記念：雪だるま');
    expect(mementoDesign(15).id).toBe(mementoId(15));
    for (let k = 0; k < 4; k++) {
      const d = mementoDesign(k);
      expect(d).toMatchObject({ kind: 'deco', memento: true });
      const c = buildingCharacter(d);
      expect(c.height).toBeGreaterThanOrEqual(1);
      expect(c.height).toBeLessThanOrEqual(4);
      // 足元は 1 マス（かかしは腕を広げて 3 マス）
      const cols = footprintCols(d, 0, 100, 100, 320);
      expect(cols.length).toBeGreaterThanOrEqual(1);
      expect(cols.length).toBe(k === 2 ? 3 : 1);
    }
  });
  it('keeps the memento mark through a save', () => {
    const d = mementoDesign(3);
    expect(sanitizeDesign(JSON.parse(JSON.stringify(d)))).toEqual(d);
    expect(sanitizeDesign({ ...d, memento: 'yes' })?.memento).toBeUndefined();
  });
});
