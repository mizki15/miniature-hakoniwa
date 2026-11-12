/**
 * Google Drive との同期（サーバーを使わず、ブラウザから直接 Drive API を呼ぶ）。
 * - スコープは drive.appdata：アプリ専用の隠しフォルダだけを使い、ユーザーの他のファイルは見えない
 * - 認証は Google Identity Services（GIS）のトークンモデル。アクセストークンは約 1 時間で切れるので、
 *   同期の操作のたびに取り直す（多くの場合は確認なしで取れる）
 * - Client ID は環境変数 VITE_GOOGLE_CLIENT_ID で渡す（docs/保存とクラウド同期.md を参照）
 */
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE_NAME = 'hakoniwa-save.bin';
export const DRIVE_CLIENT_ID: string | undefined = import.meta.env.VITE_GOOGLE_CLIENT_ID;

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const google: any;

let gisLoaded: Promise<void> | null = null;
function loadGis() {
  gisLoaded ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Google のログイン部品を読み込めませんでした'));
    document.head.appendChild(s);
  });
  return gisLoaded;
}

let token: { value: string; expires: number } | null = null;

/** アクセストークンを取る（必要ならポップアップで同意を求める）。ユーザーの操作から呼ぶこと */
async function getToken(): Promise<string> {
  if (!DRIVE_CLIENT_ID) throw new Error('Google Drive の設定（Client ID）がありません');
  if (token && token.expires > Date.now() + 60_000) return token.value;
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: DRIVE_CLIENT_ID,
      scope: SCOPE,
      callback: (res: any) => {
        if (res.error) { reject(new Error(res.error_description || res.error)); return; }
        token = { value: res.access_token, expires: Date.now() + (res.expires_in ?? 3600) * 1000 };
        resolve(token.value);
      },
      error_callback: (err: any) => reject(new Error(err?.message || 'ログインが中断されました')),
    });
    client.requestAccessToken({ prompt: token ? '' : undefined });
  });
}

async function api(path: string, init: RequestInit = {}) {
  const t = await getToken();
  const res = await fetch(path, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` } });
  if (res.status === 401) { token = null; throw new Error('ログインの期限が切れました。もう一度お試しください'); }
  if (!res.ok) throw new Error(`Google Drive エラー（${res.status}）`);
  return res;
}

export interface RemoteInfo { id: string; savedAt: number; }

/** Drive 上のセーブデータの情報（なければ null） */
export async function remoteInfo(): Promise<RemoteInfo | null> {
  const q = encodeURIComponent(`name='${FILE_NAME}'`);
  const res = await api(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,appProperties,modifiedTime)`);
  const json = await res.json();
  const f = json.files?.[0];
  if (!f) return null;
  return { id: f.id, savedAt: Number(f.appProperties?.savedAt ?? Date.parse(f.modifiedTime)) };
}

/** アップロード（あれば上書き） */
export async function upload(data: Uint8Array, savedAt: number, existingId?: string) {
  const meta = existingId
    ? { appProperties: { savedAt: String(savedAt) } }
    : { name: FILE_NAME, parents: ['appDataFolder'], appProperties: { savedAt: String(savedAt) } };
  const body = new FormData();
  body.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  body.append('file', new Blob([data as BlobPart], { type: 'application/octet-stream' }));
  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  await api(url, { method: existingId ? 'PATCH' : 'POST', body });
}

export async function download(id: string): Promise<Uint8Array> {
  const res = await api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
  return new Uint8Array(await res.arrayBuffer());
}
