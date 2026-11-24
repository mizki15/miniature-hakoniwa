import { describe, it, expect, vi } from 'vitest';
import { CloudSync, EDIT_DELAY_MS, type CloudDeps, type CloudStatus } from './cloudSync';
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
    expect(t.state.marker()).toBe('s:900');
    expect(t.last().kind).toBe('ok');
  });

  it('bothChangedAsksAndLocalWins', async () => {
    const t = setup({ remote: { id: 'f1', version: '7', savedAt: 900 }, marker: '5', changed: true, conflict: async () => 'local' });
    await t.cloud.start();
    expect(t.deps.askConflict).toHaveBeenCalledWith(900, t.state.changeStamp() || expect.any(Number));
    expect(t.drive.upload).toHaveBeenCalledWith(expect.any(Uint8Array), expect.any(Number), 'f1');
    expect(t.state.marker()).toBe('s:1000000');
    expect(t.state.changed()).toBe(false);
  });

  it('bothChangedAsksAndRemoteWins', async () => {
    const t = setup({ remote: { id: 'f1', version: '7', savedAt: 900 }, marker: '5', changed: true, conflict: async () => 'remote' });
    await t.cloud.start();
    expect(t.deps.applyRemote).toHaveBeenCalled();
    expect(t.drive.upload).not.toHaveBeenCalled();
    expect(t.state.changed()).toBe(false);
  });

  it('editUploadsShortlyAfter', async () => {
    vi.useFakeTimers();
    try {
      const t = setup({ marker: '5', changed: false });
      t.state.markChanged();
      t.cloud.onEdit();
      await vi.advanceTimersByTimeAsync(EDIT_DELAY_MS - 1);
      expect(t.drive.upload).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await t.cloud.idle();
      expect(t.drive.upload).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it('burstOfEditsUploadsOnce', async () => {
    vi.useFakeTimers();
    try {
      const t = setup({ marker: '5', changed: false });
      for (let i = 0; i < 5; i++) { t.state.markChanged(); t.cloud.onEdit(); await vi.advanceTimersByTimeAsync(500); }
      await vi.advanceTimersByTimeAsync(EDIT_DELAY_MS);
      await t.cloud.idle();
      expect(t.drive.upload).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it('editDuringUploadUploadsAgain', async () => {
    const t = setup({ marker: '5', changed: true });
    let release!: () => void;
    const realUpload = t.drive.upload.getMockImplementation()!;
    t.drive.upload.mockImplementationOnce((d, at, id) => new Promise((r) => { release = () => r(realUpload(d, at, id)); }));
    const first = t.cloud.syncNow();
    await vi.waitFor(() => expect(t.drive.upload).toHaveBeenCalledTimes(1));
    t.state.markChanged();
    void t.cloud.syncNow(); // 送っている間に次の変更
    release();
    await first;
    await t.cloud.idle();
    expect(t.drive.upload).toHaveBeenCalledTimes(2);
    expect(t.state.changed()).toBe(false);
  });

  it('noChangeNoUploadOnHidden', async () => {
    const t = setup({ marker: '5', changed: false });
    t.cloud.onHidden();
    await t.cloud.idle();
    expect(t.drive.remoteInfo).not.toHaveBeenCalled();
  });

  it('pcReturningToOpenTabCatchesUp', async () => {
    // 開いたままの PC に戻ってきた：別の PC が Drive を進めていれば、黙って追いつく
    const t = setup({ remote: { id: 'f1', version: '9', savedAt: 900 }, marker: '5', changed: false });
    t.cloud.onVisible();
    await t.cloud.idle();
    expect(t.deps.applyRemote).toHaveBeenCalledTimes(1);
    expect(t.state.marker()).toBe('s:900');
    expect(t.deps.askConflict).not.toHaveBeenCalled();
  });

  it('concurrentRequestsCoalesce', async () => {
    const t = setup({ marker: '5', changed: true });
    void t.cloud.syncNow();
    void t.cloud.syncNow();
    t.cloud.onHidden();
    t.cloud.onVisible();
    await t.cloud.idle();
    expect(t.drive.upload).toHaveBeenCalledTimes(1);
    expect(t.drive.remoteInfo.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('noUploadWhileAsking', async () => {
    let answer!: (v: 'remote' | 'local') => void;
    const t = setup({ remote: { id: 'f1', version: '7', savedAt: 900 }, marker: '5', changed: true, conflict: () => new Promise((r) => { answer = r; }) });
    const started = t.cloud.start();
    await vi.waitFor(() => expect(t.deps.askConflict).toHaveBeenCalled());
    t.state.markChanged();
    t.cloud.onHidden();
    t.cloud.onVisible();
    await Promise.resolve();
    expect(t.drive.upload).not.toHaveBeenCalled();
    answer('remote');
    await started;
    await t.cloud.idle();
    expect(t.drive.upload).not.toHaveBeenCalled();
  });

  it('killedUploadKeepsChangedMark', async () => {
    const t = setup({ marker: '5', changed: true });
    t.drive.upload.mockImplementationOnce(() => new Promise(() => {})); // タブを閉じて終わらない
    void t.cloud.start();
    await vi.waitFor(() => expect(t.drive.upload).toHaveBeenCalled());
    expect(t.state.changed()).toBe(true);
  });

  it('changeDuringUploadStaysChanged', async () => {
    const t = setup({ marker: '5', changed: true });
    t.drive.upload.mockImplementationOnce(async () => { t.state.markChanged(); return { id: 'f1', version: '6' }; });
    await t.cloud.start();
    expect(t.state.marker()).toBe('s:1000000');
    expect(t.state.changed()).toBe(true);
  });

  it('failedApplyRemoteKeepsMarker', async () => {
    const t = setup({ remote: { id: 'f1', version: '7', savedAt: 900 }, marker: '5', changed: false });
    (t.deps.applyRemote as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('保存できませんでした'));
    await t.cloud.start();
    expect(t.state.marker()).toBe('5');
    expect(t.last().kind).toBe('error');
  });

  it('conflictShowsWhenPlayerLastChanged', async () => {
    const t = setup({ remote: { id: 'f1', version: '7', savedAt: 900 }, marker: '5', changed: true, conflict: async () => 'remote' });
    const stamp = t.state.changeStamp();
    await t.cloud.start();
    expect(t.deps.askConflict).toHaveBeenCalledWith(900, stamp);
  });

  it('signInWithOtherAccountClearsMarker', async () => {
    const t = setup({ marker: '5', changed: false });
    t.drive.accountInfo.mockResolvedValueOnce({ email: 'other@example.com' });
    t.drive.remoteInfo.mockResolvedValueOnce({ id: 'g1', version: '5', savedAt: 900 }); // 版の数字が偶然同じ
    await t.cloud.signIn();
    expect(t.drive.upload).not.toHaveBeenCalled();
    expect(t.deps.askConflict).toHaveBeenCalled(); // 初めての端末として扱う（手が入っているので聞く）
  });

  it('signOutDuringSyncDiscardsResult', async () => {
    let release!: () => void;
    const t = setup({ remote: { id: 'f1', version: '7', savedAt: 900 }, marker: '5', changed: false });
    t.drive.download.mockImplementationOnce(() => new Promise((r) => { release = () => r(new Uint8Array([1])); }));
    const started = t.cloud.start();
    await vi.waitFor(() => expect(t.drive.download).toHaveBeenCalled());
    await t.cloud.signOut();
    release();
    await started;
    expect(t.state.marker()).toBeNull();
    expect(t.deps.applyRemote).not.toHaveBeenCalled();
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

describe('CloudSync：Drive の版が勝手に進んでも読み込まない（v0.14.1）', () => {
  it('a version bump with the same save time is not a change (no download, no conflict)', async () => {
    // 前に送った時の印（保存した時刻 500）。Drive 側の処理で版だけ 5 → 6 に進んだ
    const t = setup({ remote: { id: 'f1', version: '6', savedAt: 500 }, marker: 's:500', changed: false });
    t.cloud.onVisible();
    await t.cloud.idle();
    expect(t.drive.download).not.toHaveBeenCalled();
    // その後に手を加えても「両方で変わっています」は出ず、そのまま送る
    t.state.markChanged();
    await t.cloud.syncNow();
    expect(t.deps.askConflict).not.toHaveBeenCalled();
    expect(t.drive.upload).toHaveBeenCalledTimes(1);
  });
  it('after an upload, a later version bump on Drive is ignored', async () => {
    const t = setup({ marker: '5', changed: true });
    await t.cloud.syncNow();
    expect(t.drive.upload).toHaveBeenCalledTimes(1);
    const r = await t.drive.remoteInfo();
    t.drive.remoteInfo.mockResolvedValue({ ...r!, version: String(Number(r!.version) + 3) });
    t.cloud.onVisible();
    await t.cloud.idle();
    expect(t.drive.download).not.toHaveBeenCalled();
  });
  it('a marker from before v0.14.1 (a version number) still matches once', async () => {
    const t = setup({ remote: { id: 'f1', version: '5', savedAt: 500 }, marker: '5', changed: false });
    await t.cloud.start();
    expect(t.drive.download).not.toHaveBeenCalled();
  });
  it('another device really saved (different save time): downloads as before', async () => {
    const t = setup({ remote: { id: 'f1', version: '9', savedAt: 777 }, marker: 's:500', changed: false });
    await t.cloud.start();
    expect(t.deps.applyRemote).toHaveBeenCalledTimes(1);
  });
});

describe('CloudSync：作り直し・読み込みの間は待つ（v0.14.1）', () => {
  it('does nothing while busy, and tries again shortly after', async () => {
    vi.useFakeTimers();
    try {
      let busy = true;
      const t = setup({ remote: { id: 'f1', version: '9', savedAt: 777 }, marker: 's:500', changed: false, conflict: async () => 'local' });
      t.deps.busy = () => busy;
      t.cloud.onVisible();
      await vi.advanceTimersByTimeAsync(10);
      expect(t.drive.remoteInfo).not.toHaveBeenCalled();
      // 新しい箱庭を作っている間に、変更の印が立った
      t.state.markChanged();
      busy = false;
      await vi.advanceTimersByTimeAsync(1000);
      await t.cloud.idle();
      // 作った箱庭は消さない：Drive も進んでいたので聞く（黙って読み込まない）
      expect(t.deps.applyRemote).not.toHaveBeenCalled();
      expect(t.deps.askConflict).toHaveBeenCalledTimes(1);
      expect(t.drive.upload).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it('an edit made while downloading is not thrown away', async () => {
    const t = setup({ remote: { id: 'f1', version: '9', savedAt: 777 }, marker: 's:500', changed: false, conflict: async () => 'local' });
    t.drive.download.mockImplementationOnce(async () => { t.state.markChanged(); return new Uint8Array([1]); });
    await t.cloud.start();
    await t.cloud.idle();
    expect(t.deps.applyRemote).not.toHaveBeenCalled();
    expect(t.deps.askConflict).toHaveBeenCalledTimes(1);
    expect(t.drive.upload).toHaveBeenCalledTimes(1);
  });
});

describe('CloudSync（スマホ）', () => {
  it('viewerNeverUploads', async () => {
    const t = setup({ viewer: true, changed: true, remote: null });
    await t.cloud.start();
    t.cloud.onEdit();
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
    expect(t.state.marker()).toBe('s:900');
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
