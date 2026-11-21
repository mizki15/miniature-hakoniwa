/**
 * 端末ごとの同期の状態。
 * - localStorage：同期の印（最後に同期した Drive の版）、プレイヤーの変更の印、アカウント、最後に同期した時刻
 * - sessionStorage：アクセストークン（タブを閉じれば消える。localStorage には置かない）
 */
const K = {
  marker: 'hakoniwa.sync.marker',
  changed: 'hakoniwa.sync.changed',
  account: 'hakoniwa.sync.account',
  lastAt: 'hakoniwa.sync.lastAt',
  token: 'hakoniwa.sync.token',
};

export interface Account { email: string; name?: string; }

export interface SyncState {
  marker(): string | null; setMarker(v: string | null): void;
  changed(): boolean; markChanged(): void; clearChanged(): void;
  /** 最後にプレイヤーが手を加えた時刻（ミリ秒。変更がなければ 0）。毎回必ず増える */
  changeStamp(): number;
  /** 印が stamp のままなら下ろす（送っている間に変えていたら残す） */
  clearChangedIf(stamp: number): void;
  account(): Account | null; setAccount(a: Account | null): void;
  lastSyncAt(): number; setLastSyncAt(t: number): void;
}

function readJson<T>(s: Storage, key: string): T | null {
  try {
    const v = s.getItem(key);
    return v === null ? null : (JSON.parse(v) as T);
  } catch { return null; }
}

const put = (s: Storage, key: string, v: string | null) => {
  try { if (v === null) s.removeItem(key); else s.setItem(key, v); } catch { /* 容量不足・使えない時は諦める */ }
};

const stampOf = (s: Storage) => Number(s.getItem(K.changed)) || 0;

export function createSyncState(local: Storage): SyncState {
  return {
    marker: () => local.getItem(K.marker),
    setMarker: (v) => put(local, K.marker, v),
    changed: () => stampOf(local) > 0,
    markChanged: () => put(local, K.changed, String(Math.max(Date.now(), stampOf(local) + 1))),
    clearChanged: () => put(local, K.changed, null),
    changeStamp: () => stampOf(local),
    clearChangedIf: (stamp) => { if (stampOf(local) === stamp) put(local, K.changed, null); },
    account: () => {
      const a = readJson<Account>(local, K.account);
      return a && typeof a.email === 'string' ? a : null;
    },
    setAccount: (a) => put(local, K.account, a ? JSON.stringify(a) : null),
    lastSyncAt: () => Number(local.getItem(K.lastAt)) || 0,
    setLastSyncAt: (t) => put(local, K.lastAt, String(t)),
  };
}

export interface Token { value: string; expires: number; }
export interface TokenStore { get(): Token | null; set(t: Token | null): void; }

export function createTokenStore(session: Storage): TokenStore {
  return {
    get: () => {
      const t = readJson<Token>(session, K.token);
      return t && typeof t.value === 'string' && t.expires > Date.now() + 60_000 ? t : null;
    },
    set: (t) => put(session, K.token, t ? JSON.stringify(t) : null),
  };
}
