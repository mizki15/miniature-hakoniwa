import { describe, it, expect, vi } from 'vitest';
import { CloudSync, type CloudDeps, type CloudStatus } from './cloudSync';
import { NeedsLoginError } from './driveErrors';
import { createSyncState } from './syncState';

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; }, clear: () => m.clear(), getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null, removeItem: (k) => { m.delete(k); }, setItem: (k, v) => { m.set(k, String(v)); },
  };
}

interface Opts {
  remote?: { id: string; version: string; savedAt: number } | null;
  marker?: string | null;
  changed?: boolean;
  progress?: boolean;
  viewer?: boolean;
  token?: boolean;
  conflict?: () => Promise<'remote' | 'local'>;
  replace?: () => Promise<boolean>;
}

function setup(o: Opts = {}) {
  let now = 1_000_000;
  const state = createSyncState(fakeStorage());
  state.setAccount({ email: 'me@example.com' });
  if (o.marker) state.setMarker(o.marker);
  if (o.changed) state.markChanged();
  let remote = o.remote === undefined ? { id: 'f1', version: '5', savedAt: 500 } : o.remote;
  const drive = {
    hasToken: vi.fn(() => o.token ?? true),
    signIn: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    accountInfo: vi.fn(async () => ({ email: 'me@example.com' })),
    remoteInfo: vi.fn(async () => remote),
    upload: vi.fn(async (_d: Uint8Array, _s: number, id?: string) => {
      const v = String(Number(remote?.version ?? 0) + 1);
      remote = { id: id ?? 'new', version: v, savedAt: now };
      return { id: remote.id, version: v };
    }),
    download: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
  const statuses: CloudStatus[] = [];
  const deps: CloudDeps = {
    drive, state, viewer: o.viewer ?? false, now: () => now,
    localHasProgress: () => o.progress ?? true,
    localSavedAt: () => 400,
    buildEncoded: vi.fn(async () => ({ data: new Uint8Array([9]), savedAt: now })),
    applyRemote: vi.fn(async () => {}),
    askConflict: vi.fn(o.conflict ?? (async () => 'remote' as const)),
    askReplace: vi.fn(o.replace ?? (async () => true)),
    onStatus: (s) => statuses.push(s),
  };
  const cloud = new CloudSync(deps);
  return { cloud, deps, drive, state, statuses, advance: (ms: number) => { now += ms; }, last: () => statuses[statuses.length - 1] };
}

describe('CloudSync（PC）', () => {
  it('startupWithStaleMarkerDownloadsNotUploads', async () => {
    const t = setup({ remote: { id: 'f1', version: '7', savedAt: 900 }, marker: '5', changed: false });
    await t.cloud.start();
    expect(t.drive.download).toHaveBeenCalledWith('f1');
    expect(t.deps.applyRemote).toHaveBeenCalled();
    expect(t.drive.upload).not.toHaveBeenCalled();
    expect(t.state.marker()).toBe('7');
    expect(t.last().kind).toBe('ok');
  });

  it('bothChangedAsksAndLocalWins', async () => {
    const t = setup({ remote: { id: 'f1', version: '7', savedAt: 900 }, marker: '5', changed: true, conflict: async () => 'local' });
    await t.cloud.start();
    expect(t.deps.askConflict).toHaveBeenCalledWith(900, 400);
    expect(t.drive.upload).toHaveBeenCalledWith(expect.any(Uint8Array), expect.any(Number), 'f1');
    expect(t.state.marker()).toBe('8');
    expect(t.state.changed()).toBe(false);
  });

  it('bothChangedAsksAndRemoteWins', async () => {
    const t = setup({ remote: { id: 'f1', version: '7', savedAt: 900 }, marker: '5', changed: true, conflict: async () => 'remote' });
    await t.cloud.start();
    expect(t.deps.applyRemote).toHaveBeenCalled();
    expect(t.drive.upload).not.toHaveBeenCalled();
    expect(t.state.changed()).toBe(false);
  });

  it('throttleFiveMinutes', async () => {
    const t = setup({ marker: '5', changed: true });
    await t.cloud.start(); // 送る
    expect(t.drive.upload).toHaveBeenCalledTimes(1);
    t.state.markChanged();
    t.advance(4 * 60_000);
    t.cloud.afterLocalSave();
    await t.cloud.idle();
    expect(t.drive.upload).toHaveBeenCalledTimes(1);
    t.advance(60_000);
    t.cloud.afterLocalSave();
    await t.cloud.idle();
    expect(t.drive.upload).toHaveBeenCalledTimes(2);
  });

  it('noChangeNoUpload', async () => {
    const t = setup({ marker: '5', changed: false });
    t.advance(10 * 60_000);
    t.cloud.afterLocalSave();
    await t.cloud.idle();
    expect(t.drive.remoteInfo).not.toHaveBeenCalled();
  });

  it('concurrentSyncRunsOnce', async () => {
    const t = setup({ marker: '5', changed: true });
    t.advance(10 * 60_000);
    t.cloud.afterLocalSave();
    t.cloud.onHidden();
    await t.cloud.idle();
    expect(t.drive.remoteInfo).toHaveBeenCalledTimes(1);
  });

  it('noUploadWhileAsking', async () => {
    let answer!: (v: 'remote' | 'local') => void;
    const t = setup({ remote: { id: 'f1', version: '7', savedAt: 900 }, marker: '5', changed: true, conflict: () => new Promise((r) => { answer = r; }) });
    const started = t.cloud.start();
    await vi.waitFor(() => expect(t.deps.askConflict).toHaveBeenCalled());
    t.advance(10 * 60_000);
    t.cloud.afterLocalSave();
    t.cloud.onHidden();
    await Promise.resolve();
    expect(t.drive.upload).not.toHaveBeenCalled();
    answer('remote');
    await started;
    await t.cloud.idle();
    expect(t.drive.upload).not.toHaveBeenCalled();
  });

  it('expiredTokenGoesToNeedsLoginWithoutPopup', async () => {
    const t = setup({ marker: '5', changed: true });
    t.drive.remoteInfo.mockRejectedValueOnce(new NeedsLoginError());
    await t.cloud.start();
    expect(t.last()).toEqual({ kind: 'needsLogin', email: 'me@example.com' });
    expect(t.drive.signIn).not.toHaveBeenCalled();
  });

  it('noTokenAtStartupNeedsLogin', async () => {
    const t = setup({ token: false });
    await t.cloud.start();
    expect(t.last().kind).toBe('needsLogin');
    expect(t.drive.remoteInfo).not.toHaveBeenCalled();
    expect(t.drive.signIn).not.toHaveBeenCalled();
  });

  it('neverSignedInIsSignedOut', async () => {
    const t = setup();
    t.state.setAccount(null);
    await t.cloud.start();
    expect(t.last().kind).toBe('signedOut');
    expect(t.drive.remoteInfo).not.toHaveBeenCalled();
  });

  it('failedUploadKeepsChangedMark', async () => {
    const t = setup({ marker: '5', changed: true });
    t.drive.upload.mockRejectedValueOnce(new Error('network'));
    await t.cloud.start();
    expect(t.state.changed()).toBe(true);
    expect(t.state.marker()).toBe('5');
    expect(t.last().kind).toBe('error');
  });

  it('signInStoresAccountAndSyncs', async () => {
    const t = setup({ marker: '5', changed: true });
    t.state.setAccount(null);
    await t.cloud.signIn();
    expect(t.drive.signIn).toHaveBeenCalled();
    expect(t.state.account()?.email).toBe('me@example.com');
    expect(t.drive.upload).toHaveBeenCalled();
  });

  it('signOutClearsAccountAndMarker', async () => {
    const t = setup({ marker: '5' });
    await t.cloud.signOut();
    expect(t.drive.signOut).toHaveBeenCalled();
    expect(t.state.account()).toBeNull();
    expect(t.state.marker()).toBeNull();
    expect(t.last().kind).toBe('signedOut');
  });
});

describe('CloudSync（スマホ）', () => {
  it('viewerNeverUploads', async () => {
    const t = setup({ viewer: true, changed: true, remote: null });
    await t.cloud.start();
    t.advance(10 * 60_000);
    t.cloud.afterLocalSave();
    t.cloud.onHidden();
    await t.cloud.syncNow();
    expect(t.drive.upload).not.toHaveBeenCalled();
  });

  it('viewerDeclineReplaceSignsOut', async () => {
    const t = setup({ viewer: true, marker: null, progress: true, remote: { id: 'f1', version: '6', savedAt: 900 }, replace: async () => false });
    await t.cloud.start();
    expect(t.deps.applyRemote).not.toHaveBeenCalled();
    expect(t.last().kind).toBe('signedOut');
  });

  it('viewerAcceptReplaceDownloads', async () => {
    const t = setup({ viewer: true, marker: null, progress: true, remote: { id: 'f1', version: '6', savedAt: 900 } });
    await t.cloud.start();
    expect(t.deps.applyRemote).toHaveBeenCalled();
    expect(t.state.marker()).toBe('6');
  });

  it('viewerOnVisibleReloadsNewVersion', async () => {
    const t = setup({ viewer: true, marker: '5', remote: { id: 'f1', version: '6', savedAt: 900 } });
    t.cloud.onVisible();
    await t.cloud.idle();
    expect(t.deps.applyRemote).toHaveBeenCalledTimes(1);
    expect(t.deps.askReplace).not.toHaveBeenCalled();
  });

  it('viewerOfflineKeepsLocal', async () => {
    const t = setup({ viewer: true, marker: '5' });
    t.drive.remoteInfo.mockRejectedValueOnce(new Error('offline'));
    await t.cloud.start();
    expect(t.deps.applyRemote).not.toHaveBeenCalled();
    expect(t.last().kind).toBe('error');
  });
});
