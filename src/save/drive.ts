/**
 * Google Drive との通信（サーバーを使わず、ブラウザから直接 Drive API を呼ぶ）。
 * - スコープは drive.appdata：アプリ専用の隠しフォルダだけを使い、ユーザーの他のファイルは見えない
 * - 認証は Google Identity Services（GIS）のトークンモデル。アクセストークンは約 1 時間で切れる
 * - トークンは sessionStorage にだけ置く（タブを閉じれば消える）。ポップアップを出すのは signIn() だけで、
 *   ほかの関数はトークンがなければ NeedsLoginError を投げる
 * - Client ID は環境変数 VITE_GOOGLE_CLIENT_ID で渡す（docs/保存とクラウド同期.md を参照）
 */
import { NeedsLoginError } from './driveErrors';
import { createTokenStore, type Account } from './syncState';
import type { RemoteInfo } from './cloudSync';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE_NAME = 'hakoniwa-save.bin';
/** デスクトップ版（Electron）か。file:// やアプリの窓では Google のログイン（GIS）が通らないので、同期を出さない */
const isDesktopApp = import.meta.env.MODE === 'electron' || /\bElectron\//.test(navigator.userAgent) || location.protocol === 'file:';
/** 同期に使う Client ID。ない時（設定がない・デスクトップ版）は「この版では Google 同期は使えません」と出す */
export const DRIVE_CLIENT_ID: string | undefined = isDesktopApp ? undefined : import.meta.env.VITE_GOOGLE_CLIENT_ID;

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const google: any;

const tokens = createTokenStore(sessionStorage);

let gisLoaded: Promise<void> | null = null;
function loadGis() {
  gisLoaded ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisLoaded = null; reject(new Error('Google のログイン部品を読み込めませんでした')); };
    document.head.appendChild(s);
  });
  return gisLoaded;
}

/** 有効なトークンがあるか（ポップアップなしで通信できるか） */
export const hasToken = () => tokens.get() !== null;

let client: any = null;
let pending: { resolve: () => void; reject: (e: Error) => void } | null = null;
function ensureClient() {
  client ??= google.accounts.oauth2.initTokenClient({
    client_id: DRIVE_CLIENT_ID,
    scope: SCOPE,
    callback: (res: any) => {
      const p = pending; pending = null;
      if (res.error) { p?.reject(new Error(res.error_description || res.error)); return; }
      tokens.set({ value: res.access_token, expires: Date.now() + (Number(res.expires_in) || 3600) * 1000 });
      p?.resolve();
    },
    error_callback: (err: any) => {
      const p = pending; pending = null;
      p?.reject(new Error(err?.type === 'popup_closed' ? 'ログインが中断されました' : err?.message || 'ログインできませんでした'));
    },
  });
}

/** 起動時に呼ぶ：ログインの部品を先に読み込んでおく（タップの中ですぐポップアップを開けるように。iPhone の Safari は待つと止める） */
export function prepareSignIn() {
  if (!DRIVE_CLIENT_ID) return;
  loadGis().then(ensureClient).catch(() => { /* 押した時にもう一度試す */ });
}

/** ログイン（トークンを取る）。ボタンのクリックの中から、await を挟まずに呼ぶこと。hint は前に使ったメールアドレス */
export function signIn(hint?: string): Promise<void> {
  if (!DRIVE_CLIENT_ID) return Promise.reject(new Error('Google 同期の設定（Client ID）がありません'));
  const open = () => new Promise<void>((resolve, reject) => {
    pending?.reject(new Error('ログインが中断されました'));
    pending = { resolve, reject };
    // 前にログインしていれば同意画面を省く（多くは一瞬で閉じる）。初めてなら同意を求める
    client.requestAccessToken({ prompt: hint ? '' : 'consent', login_hint: hint });
  });
  if (client) return open(); // 部品が読み込み済み：クリックの中でそのまま開く
  return loadGis().then(() => { ensureClient(); return open(); });
}

/** ログアウト：トークンを取り消して消す */
export async function signOut(): Promise<void> {
  const t = tokens.get();
  tokens.set(null);
  if (!t) return;
  try {
    await loadGis();
    await new Promise<void>((resolve) => google.accounts.oauth2.revoke(t.value, () => resolve()));
  } catch { /* 取り消せなくても、手元からは消えている */ }
}

async function api(path: string, init: RequestInit = {}) {
  const t = tokens.get();
  if (!t) throw new NeedsLoginError();
  const res = await fetch(path, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t.value}` } });
  if (res.status === 401) { tokens.set(null); throw new NeedsLoginError('ログインの期限が切れました'); }
  if (!res.ok) throw new Error(`Google Drive エラー（${res.status}）`);
  return res;
}

/** ログイン中のアカウント（追加のスコープなしで Drive の about から取る） */
export async function accountInfo(): Promise<Account> {
  const res = await api('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)');
  const json = await res.json();
  const email = json.user?.emailAddress;
  if (typeof email !== 'string') throw new Error('アカウントの情報を取れませんでした');
  return { email, name: typeof json.user?.displayName === 'string' ? json.user.displayName : undefined };
}

/** Drive 上のセーブデータの情報（なければ null） */
export async function remoteInfo(): Promise<RemoteInfo | null> {
  const q = encodeURIComponent(`name='${FILE_NAME}'`);
  const res = await api(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,version,appProperties,modifiedTime)&orderBy=modifiedTime desc`);
  const json = await res.json();
  const f = json.files?.[0];
  if (!f) return null;
  return { id: f.id, version: String(f.version), savedAt: Number(f.appProperties?.savedAt ?? Date.parse(f.modifiedTime)) };
}

/** アップロード（あれば上書き）。新しい版を返す */
export async function upload(data: Uint8Array, savedAt: number, existingId?: string): Promise<{ id: string; version: string }> {
  const meta = existingId
    ? { appProperties: { savedAt: String(savedAt) } }
    : { name: FILE_NAME, parents: ['appDataFolder'], appProperties: { savedAt: String(savedAt) } };
  const body = new FormData();
  body.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  body.append('file', new Blob([data as BlobPart], { type: 'application/octet-stream' }));
  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id,version`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,version';
  const res = await api(url, { method: existingId ? 'PATCH' : 'POST', body });
  const json = await res.json();
  return { id: json.id, version: String(json.version) };
}

export async function download(id: string): Promise<Uint8Array> {
  const res = await api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
  return new Uint8Array(await res.arrayBuffer());
}
