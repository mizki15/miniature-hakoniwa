/**
 * Drive との同期で「何をするか」を決める（副作用なし）。
 * 保存時刻どうしは比べない：開いただけの端末も自動保存で時刻が「今」になるため。
 * 代わりに「最後に同期した Drive の版（印）」と「その後にプレイヤーが手を加えたか」で決める。
 * 設計書：docs/superpowers/specs/2026-11-21-google-sync-design.md の 2.2b
 */
export type SyncAction = 'none' | 'upload' | 'download' | 'ask';

export interface SyncInput {
  /** Drive の今の版（ファイルがなければ null） */
  remoteVersion: string | null;
  /** この端末が最後に同期した版（初めてなら null） */
  markerVersion: string | null;
  /** 前回の同期のあとにプレイヤーが手を加えたか（時間が進んだだけは含めない） */
  localChanged: boolean;
  /** 端末内の箱庭に手が入っているか */
  localHasProgress: boolean;
}

/** PC（遊ぶ端末） */
export function decideSync(i: SyncInput): SyncAction {
  if (i.remoteVersion === null) return 'upload'; // Drive にない（初めて・消された）
  if (i.markerVersion === null) return i.localHasProgress || i.localChanged ? 'ask' : 'download'; // 初めて同期する端末
  const remoteChanged = i.remoteVersion !== i.markerVersion;
  if (remoteChanged) return i.localChanged ? 'ask' : 'download';
  return i.localChanged ? 'upload' : 'none';
}

export type ViewerAction = 'none' | 'download' | 'askReplace';

/** スマホ（見る端末）：Drive へは書き込まないので、読むか何もしないかだけ */
export function decideViewer(i: { remoteVersion: string | null; markerVersion: string | null; localHasProgress: boolean }): ViewerAction {
  if (i.remoteVersion === null) return 'none';
  if (i.markerVersion === null) return i.localHasProgress ? 'askReplace' : 'download';
  return i.remoteVersion !== i.markerVersion ? 'download' : 'none';
}
