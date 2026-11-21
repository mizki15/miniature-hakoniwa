/**
 * Google Drive との自動同期をまとめる。通信・保存・画面はすべて外から渡す（テストで差し替えられるように）。
 * - PC：変更があれば 5 分に 1 回まで送る。ページが隠れる時は 5 分を待たずに送る
 * - スマホ（viewer）：Drive を読むだけで、決して送らない
 * - 同時に走る同期は 1 本だけ。どちらを残すか聞いている間も「走っている」に含める
 * 設計書：docs/superpowers/specs/2026-11-21-google-sync-design.md
 */
import { decideSync, decideViewer } from './syncDecision';
import { NeedsLoginError } from './driveErrors';
import type { Account, SyncState } from './syncState';

export const UPLOAD_INTERVAL_MS = 5 * 60_000;

export type CloudStatus =
  | { kind: 'signedOut' }
  | { kind: 'needsLogin'; email: string }
  | { kind: 'ok'; email: string; lastSyncAt: number }
  | { kind: 'busy'; email: string }
  | { kind: 'error'; email: string; message: string };

export interface RemoteInfo { id: string; version: string; savedAt: number; }

export interface DriveApi {
  hasToken(): boolean;
  signIn(hint?: string): Promise<void>;
  signOut(): Promise<void>;
  accountInfo(): Promise<Account>;
  remoteInfo(): Promise<RemoteInfo | null>;
  upload(data: Uint8Array, savedAt: number, existingId?: string): Promise<{ id: string; version: string }>;
  download(id: string): Promise<Uint8Array>;
}

export interface CloudDeps {
  drive: DriveApi;
  state: SyncState;
  /** スマホ（見るだけ） */
  viewer: boolean;
  now(): number;
  localHasProgress(): boolean;
  /** 端末内の箱庭を最後に保存した時刻（聞く時に見せる） */
  localSavedAt(): number;
  buildEncoded(): Promise<{ data: Uint8Array; savedAt: number }>;
  /** Drive の箱庭を読み込んで表示し、端末内にも保存する */
  applyRemote(data: Uint8Array): Promise<void>;
  askConflict(remoteAt: number, localAt: number): Promise<'remote' | 'local'>;
  /** スマホの初回：手の入った箱庭を Drive のものに入れ替えてよいか */
  askReplace(): Promise<boolean>;
  onStatus(s: CloudStatus): void;
}

export class CloudSync {
  private running: Promise<void> | null = null;

  constructor(private d: CloudDeps) {}

  /** 起動時。トークンがなければ「タップして続ける」を待つ（ポップアップは出さない） */
  async start() {
    const acc = this.d.state.account();
    if (!acc) { this.d.onStatus({ kind: 'signedOut' }); return; }
    if (!this.d.drive.hasToken()) { this.d.onStatus({ kind: 'needsLogin', email: acc.email }); return; }
    await this.syncOnce();
  }

  /** ボタンから（クリックの中で呼ぶこと：ポップアップを出す） */
  async signIn() {
    try {
      await this.d.drive.signIn(this.d.state.account()?.email);
      const acc = await this.d.drive.accountInfo();
      this.d.state.setAccount(acc);
    } catch (err) {
      const acc = this.d.state.account();
      this.d.onStatus(acc ? { kind: 'error', email: acc.email, message: messageOf(err) } : { kind: 'signedOut' });
      throw err;
    }
    await this.syncOnce();
  }

  /** ログアウト。端末内の箱庭はそのまま。別のアカウントに入り直せるよう同期の印も消す */
  async signOut() {
    try { await this.d.drive.signOut(); } catch { /* 取り消せなくても、こちらの印は消す */ }
    this.d.state.setAccount(null);
    this.d.state.setMarker(null);
    this.d.onStatus({ kind: 'signedOut' });
  }

  /** 端末内に保存した後（PC）：変更があり、前回から 5 分たっていれば送る */
  afterLocalSave() {
    if (this.d.viewer || !this.d.state.changed()) return;
    if (this.d.now() - this.d.state.lastSyncAt() < UPLOAD_INTERVAL_MS) return;
    void this.syncOnce();
  }

  /** ページが隠れる・閉じる時（PC）：変更があれば 5 分を待たずに送る */
  onHidden() {
    if (this.d.viewer || !this.d.state.changed()) return;
    void this.syncOnce();
  }

  /** アプリに戻った時（スマホ）：Drive が変わっていれば読み直す */
  onVisible() {
    if (!this.d.viewer) return;
    void this.syncOnce();
  }

  syncNow() { return this.syncOnce(); }

  /** 走っている同期が終わるまで待つ */
  async idle() { while (this.running) await this.running; }

  private syncOnce(): Promise<void> {
    this.running ??= this.run().finally(() => { this.running = null; });
    return this.running;
  }

  private async run() {
    const acc = this.d.state.account();
    if (!acc) { this.d.onStatus({ kind: 'signedOut' }); return; }
    if (!this.d.drive.hasToken()) { this.d.onStatus({ kind: 'needsLogin', email: acc.email }); return; }
    this.d.onStatus({ kind: 'busy', email: acc.email });
    try {
      const remote = await this.d.drive.remoteInfo();
      const marker = this.d.state.marker();
      if (this.d.viewer) {
        const a = decideViewer({ remoteVersion: remote?.version ?? null, markerVersion: marker, localHasProgress: this.d.localHasProgress() });
        if (a === 'askReplace' && !(await this.d.askReplace())) { await this.signOut(); return; }
        if (a !== 'none' && remote) await this.download(remote);
      } else {
        let a = decideSync({ remoteVersion: remote?.version ?? null, markerVersion: marker, localChanged: this.d.state.changed(), localHasProgress: this.d.localHasProgress() });
        if (a === 'ask' && remote) a = (await this.d.askConflict(remote.savedAt, this.d.localSavedAt())) === 'remote' ? 'download' : 'upload';
        if (a === 'upload') await this.upload(remote?.id);
        else if (a === 'download' && remote) await this.download(remote);
      }
      this.d.onStatus({ kind: 'ok', email: acc.email, lastSyncAt: this.d.state.lastSyncAt() });
    } catch (err) {
      if (err instanceof NeedsLoginError) this.d.onStatus({ kind: 'needsLogin', email: acc.email });
      else this.d.onStatus({ kind: 'error', email: acc.email, message: messageOf(err) });
    }
  }

  private async upload(existingId?: string) {
    // 送っている間の変更を取りこぼさないよう、作る前に印を下ろし、失敗したら戻す
    this.d.state.clearChanged();
    try {
      const { data, savedAt } = await this.d.buildEncoded();
      const r = await this.d.drive.upload(data, savedAt, existingId);
      this.d.state.setMarker(r.version);
      this.d.state.setLastSyncAt(this.d.now());
    } catch (err) {
      this.d.state.markChanged();
      throw err;
    }
  }

  private async download(remote: RemoteInfo) {
    const data = await this.d.drive.download(remote.id);
    await this.d.applyRemote(data);
    this.d.state.setMarker(remote.version);
    this.d.state.clearChanged();
    this.d.state.setLastSyncAt(this.d.now());
  }
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : '同期できませんでした');
