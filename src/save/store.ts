/**
 * ブラウザ内の保存先（IndexedDB）。LocalStorage と違い容量が大きく、バイナリをそのまま置ける。
 * navigator.storage.persist() で「消さないで」とブラウザに頼む（自動削除されにくくなる）。
 */
const DB_NAME = 'hakoniwa';
const STORE = 'saves';

export interface StoredSave { key: string; data: Uint8Array; savedAt: number; version: number; }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    t.oncomplete = () => db.close();
  });
}

export const loadLocal = (key = 'main') => tx<StoredSave | undefined>('readonly', (s) => s.get(key));
export const saveLocal = (rec: StoredSave) => tx('readwrite', (s) => s.put(rec));
export const deleteLocal = (key = 'main') => tx('readwrite', (s) => s.delete(key));

/** 永続化を頼む。true なら容量逼迫時などにも消されにくい */
export async function requestPersist(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return false; }
}
