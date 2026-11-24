/**
 * Google Drive との自動同期をまとめる。通信・保存・画面はすべて外から渡す（テストで差し替えられるように）。
 * - PC：編集するたびに、手が止まって少したったら送る。ページが隠れる時も送る
 * - 画面に戻った時・開いている間は時々、Drive が進んでいないか見る（開いたままの別の PC が古いままにならないように）
 * - スマホ（viewer）：Drive を読むだけで、決して送らない
 * - 同時に走る同期は 1 本だけ。走っている間に頼まれたら、終わった後にもう 1 回だけ走る
 *   どちらを残すか聞いている間も「走っている」に含める
 * - Drive が進んだかは、Drive の版の番号ではなく「保存した時刻」（ファイルの appProperties.savedAt）で見る。
 *   Drive の版はサーバー側の処理でも勝手に進むので、それで判断すると、何も変わっていないのに読み込み直したり
 *   「両方で変わっています」と聞いたりしてしまう（v0.14.1）
 * - 箱庭を作り直している・読み込んでいる間（busy）は同期しない。少し待ってからやり直す
 * - 読み込んでいる間に手を加えたら、読み込んだ箱庭で上書きせず、もう一度決め直す
 * 設計書：docs/superpowers/specs/2026-11-21-google-sync-design.md
 */
import { decideSync, decideViewer } from './syncDecision';
import { NeedsLoginError } from './driveErrors';
import type { Account, SyncState } from './syncState';

/** 編集が止まってから送るまで（筆でなぞる間に何度も送らないように） */
export const EDIT_DELAY_MS = 3000;
/** 作り直している間に頼まれた同期を、やり直すまで */
export const BUSY_RETRY_MS = 1000;

/** 同期の印：最後に同期した箱庭の保存時刻（v0.14.1〜）。前の版の印は Drive の版の番号 */
export const markerOf = (savedAt: number) => `s:${savedAt}`;
/** 印が、Drive の今のファイルと同じ箱庭を指しているか（前の版の印＝版の番号も、一度だけ受け付ける） */
export const sameAsMarker = (marker: string | null, remote: { version: string; savedAt: number }) =>
  marker !== null && (marker === markerOf(remote.savedAt) || marker === remote.version);

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
  buildEncoded(): Promise<{ data: Uint8Array; savedAt: number }>;
  /** Drive の箱庭を読み込んで表示し、端末内にも保存する。保存できなかったら投げること */
  applyRemote(data: Uint8Array): Promise<void>;
  /** localChangedAt：この端末で最後に手を加えた時刻（0 なら不明） */
  askConflict(remoteAt: number, localChangedAt: number): Promise<'remote' | 'local'>;
  /** スマホの初回：手の入った箱庭を Drive のものに入れ替えてよいか */
  askReplace(): Promise<boolean>;
  onStatus(s: CloudStatus): void;
  /** 箱庭を作り直している・読み込んでいる最中か（その間は同期しない） */
  busy?(): boolean;
}

export class CloudSync {
  private running: Promise<void> | null = null;
  private again = false;
  private editTimer: ReturnType<typeof setTimeout> | null = null;
  private busyTimer: ReturnType<typeof setTimeout> | null = null;

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
    const prev = this.d.state.account();
    try {
      await this.d.drive.signIn(prev?.email);
      const acc = await this.d.drive.accountInfo();
      // 別のアカウントを選んだ：前のアカウントの版の印は使えない（数字が偶然同じこともある）
      if (prev && prev.email !== acc.email) this.d.state.setMarker(null);
      this.d.state.setAccount(acc);
    } catch (err) {
      this.d.onStatus(!prev ? { kind: 'signedOut' } : this.d.drive.hasToken() ? { kind: 'error', email: prev.email, message: messageOf(err) } : { kind: 'needsLogin', email: prev.email });
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

  /** プレイヤーが手を加えた時（PC）：手が止まって EDIT_DELAY_MS たったら送る */
  onEdit() {
    if (this.d.viewer) return;
    if (this.editTimer) clearTimeout(this.editTimer);
    this.editTimer = setTimeout(() => { this.editTimer = null; void this.syncOnce(); }, EDIT_DELAY_MS);
  }

  /** ページが隠れる・閉じる時（PC）：変更があれば待たずに送る */
  onHidden() {
    if (this.d.viewer || !this.d.state.changed()) return;
    if (this.editTimer) { clearTimeout(this.editTimer); this.editTimer = null; }
    void this.syncOnce();
  }

  /** 画面に戻った時・開いている間の見回り：Drive が進んでいれば追いつく（PC・スマホとも） */
  onVisible() {
    void this.syncOnce();
  }

  syncNow() { return this.syncOnce(); }

  /** 走っている同期が終わるまで待つ */
  async idle() { while (this.running) await this.running; }

  private syncOnce(): Promise<void> {
    if (this.running) { this.again = true; return this.running; }
    const loop = async () => {
      do { this.again = false; await this.run(); } while (this.again);
    };
    this.running = loop().finally(() => { this.running = null; });
    return this.running;
  }

  private async run() {
    const acc = this.d.state.account();
    if (!acc) { this.d.onStatus({ kind: 'signedOut' }); return; }
    if (!this.d.drive.hasToken()) { this.d.onStatus({ kind: 'needsLogin', email: acc.email }); return; }
    // 箱庭を作り直している・読み込んでいる間は、少し待ってからやり直す
    if (this.d.busy?.()) { this.retryLater(); return; }
    this.d.onStatus({ kind: 'busy', email: acc.email });
    try {
      const remote = await this.d.drive.remoteInfo();
      const marker = this.d.state.marker();
      // 印と同じ箱庭なら印をそのまま、違えば保存時刻の印を、Drive の「版」として決め方に渡す
      const remoteVersion = remote ? (sameAsMarker(marker, remote) ? marker : markerOf(remote.savedAt)) : null;
      if (this.d.viewer) {
        const a = decideViewer({ remoteVersion, markerVersion: marker, localHasProgress: this.d.localHasProgress() });
        if (a === 'askReplace' && !(await this.d.askReplace())) { await this.signOut(); return; }
        if (a !== 'none' && remote) await this.download(remote, acc.email);
      } else {
        let a = decideSync({ remoteVersion, markerVersion: marker, localChanged: this.d.state.changed(), localHasProgress: this.d.localHasProgress() });
        if (a === 'ask' && remote) a = (await this.d.askConflict(remote.savedAt, this.d.state.changeStamp())) === 'remote' ? 'download' : 'upload';
        if (a === 'upload') await this.upload(remote?.id, acc.email);
        else if (a === 'download' && remote) await this.download(remote, acc.email);
      }
      if (!this.same(acc.email)) return; // 途中でログアウト・別のアカウントになった
      this.d.onStatus({ kind: 'ok', email: acc.email, lastSyncAt: this.d.state.lastSyncAt() });
    } catch (err) {
      if (err instanceof LocalChangedMeanwhile) { this.again = true; return; } // 決め直す
      if (err instanceof AccountChanged || !this.same(acc.email)) return;
      if (err instanceof NeedsLoginError) this.d.onStatus({ kind: 'needsLogin', email: acc.email });
      else this.d.onStatus({ kind: 'error', email: acc.email, message: messageOf(err) });
    }
  }

  private same(email: string) { return this.d.state.account()?.email === email; }

  private retryLater() {
    if (this.busyTimer) return;
    this.busyTimer = setTimeout(() => { this.busyTimer = null; void this.syncOnce(); }, BUSY_RETRY_MS);
  }

  private async upload(existingId: string | undefined, email: string) {
    // 印は送れた後に下ろす（タブを閉じて途中で終わっても残る）。送っている間に変えていたら残す
    const seen = this.d.state.changeStamp();
    const { data, savedAt } = await this.d.buildEncoded();
    const r = await this.d.drive.upload(data, savedAt, existingId);
    if (!this.same(email)) throw new AccountChanged();
    void r;
    this.d.state.setMarker(markerOf(savedAt));
    this.d.state.clearChangedIf(seen);
    this.d.state.setLastSyncAt(this.d.now());
  }

  private async download(remote: RemoteInfo, email: string) {
    // 読み込みを決めた時の変更の印。読んでいる間に手を加えたら（新しい箱庭を作った時も）、上書きしないで決め直す
    const seen = this.d.state.changeStamp();
    const data = await this.d.drive.download(remote.id);
    if (!this.same(email)) throw new AccountChanged();
    if (!this.d.viewer && (this.d.state.changeStamp() !== seen || this.d.busy?.())) throw new LocalChangedMeanwhile();
    await this.d.applyRemote(data); // 端末内に保存できなかったら投げる（印は進めない）
    this.d.state.setMarker(markerOf(remote.savedAt));
    this.d.state.clearChanged();
    this.d.state.setLastSyncAt(this.d.now());
  }
}

/** 同期の途中でログアウト・別のアカウントになった：結果を捨てる */
class AccountChanged extends Error {}
/** 読み込んでいる間に、この端末で手を加えた：読み込んだ箱庭で上書きせず、決め直す */
class LocalChangedMeanwhile extends Error {}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : '同期できませんでした');
