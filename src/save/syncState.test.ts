import { describe, it, expect } from 'vitest';
import { createSyncState, createTokenStore } from './syncState';

/** Map で作った偽の Storage（テスト用） */
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, String(v)); },
  };
}

describe('SyncState', () => {
  it('markerRoundTrips', () => {
    const s = createSyncState(fakeStorage());
    expect(s.marker()).toBeNull();
    s.setMarker('12');
    expect(s.marker()).toBe('12');
    s.setMarker(null);
    expect(s.marker()).toBeNull();
  });

  it('changedPersistsAcrossInstances', () => {
    const store = fakeStorage();
    createSyncState(store).markChanged();
    expect(createSyncState(store).changed()).toBe(true);
    createSyncState(store).clearChanged();
    expect(createSyncState(store).changed()).toBe(false);
  });

  it('accountClearsWithNull', () => {
    const s = createSyncState(fakeStorage());
    s.setAccount({ email: 'a@example.com', name: 'A' });
    expect(s.account()).toEqual({ email: 'a@example.com', name: 'A' });
    s.setAccount(null);
    expect(s.account()).toBeNull();
  });

  it('brokenJsonIsIgnored', () => {
    const store = fakeStorage();
    store.setItem('hakoniwa.sync.account', '{broken');
    expect(createSyncState(store).account()).toBeNull();
  });

  it('lastSyncAtDefaultsToZero', () => {
    const s = createSyncState(fakeStorage());
    expect(s.lastSyncAt()).toBe(0);
    s.setLastSyncAt(1234);
    expect(s.lastSyncAt()).toBe(1234);
  });
});

describe('TokenStore', () => {
  it('tokenRoundTrips', () => {
    const t = createTokenStore(fakeStorage());
    const tok = { value: 'abc', expires: Date.now() + 3600_000 };
    t.set(tok);
    expect(t.get()).toEqual(tok);
    t.set(null);
    expect(t.get()).toBeNull();
  });

  it('tokenExpiredReturnsNull', () => {
    const t = createTokenStore(fakeStorage());
    t.set({ value: 'abc', expires: Date.now() + 30_000 }); // 60 秒以内に切れる
    expect(t.get()).toBeNull();
  });
});
