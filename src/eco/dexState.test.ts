import { describe, it, expect } from 'vitest';
import { dexStage, markSeen, observe, partialName, type Dex } from './dexState';

describe('observe', () => {
  it('firstObservePointsByRarity', () => {
    const dex: Dex = {};
    expect(observe(dex, 'butterfly', 0, 1)).toBe(1);
    expect(observe(dex, 'dragonfly', 2, 1)).toBe(2);
    expect(observe(dex, 'owl', 0, 1)).toBe(4);
    expect(observe(dex, 'rabbit', 0, 1)).toBe(1);
  });
  it('newSeasonGivesOne', () => {
    const dex: Dex = {};
    observe(dex, 'butterfly', 0, 1);
    expect(observe(dex, 'butterfly', 1, 2)).toBe(1);
    expect(observe(dex, 'butterfly', 1, 3)).toBe(0);
    expect(dex.butterfly.seasons).toEqual([0, 1]);
  });
  it('residentNoSeasonPoints', () => {
    const dex: Dex = {};
    observe(dex, 'deer', 0, 1);
    expect(observe(dex, 'deer', 2, 2)).toBe(0);
  });
  it('observeMarksSeen', () => {
    const dex: Dex = {};
    expect(dexStage(dex, 'fish')).toBe('unknown');
    observe(dex, 'fish', 3, 7);
    expect(dexStage(dex, 'fish')).toBe('observed');
    expect(dex.fish.seenAt).toBe(7);
  });
});

describe('markSeen', () => {
  it('is true only the first time', () => {
    const dex: Dex = {};
    expect(markSeen(dex, 'frog', 1)).toBe(true);
    expect(markSeen(dex, 'frog', 2)).toBe(false);
    expect(dexStage(dex, 'frog')).toBe('seen');
  });
});

describe('partialName', () => {
  it('keeps the first character', () => {
    expect(partialName('シマエナガ')).toBe('シ？？？？');
    expect(partialName('魚の影')).toBe('魚？？');
  });
});
