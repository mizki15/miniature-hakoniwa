import { describe, it, expect } from 'vitest';
import { UndoStack } from './undoStack';

describe('UndoStack', () => {
  it('popsInReverseOrder', () => {
    const s = new UndoStack<number>(5);
    s.push(1); s.push(2); s.push(3);
    expect([s.pop(), s.pop(), s.pop(), s.pop()]).toEqual([3, 2, 1, undefined]);
  });
  it('dropsOldestPastLimit', () => {
    const s = new UndoStack<number>(3);
    for (let i = 1; i <= 5; i++) s.push(i);
    expect(s.size).toBe(3);
    expect([s.pop(), s.pop(), s.pop(), s.pop()]).toEqual([5, 4, 3, undefined]);
  });
  it('clears', () => {
    const s = new UndoStack<number>(3);
    s.push(1); s.clear();
    expect(s.pop()).toBeUndefined();
  });
});
