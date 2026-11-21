# Google アカウントでの同期と Cloudflare Pages への引っ越し Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同じ Google アカウントで、PC は Drive に自動で同期し、スマホは Drive の箱庭を見るだけで表示する。公開先を Cloudflare Pages に移す。

**Architecture:** 同期の判断（送る・読む・聞く・何もしない）は副作用のない関数 `decideSync` / `decideViewer` に切り出してテストする。端末ごとの同期の印などは `syncState.ts`（`Storage` を渡して使う）、Drive との通信は今の `drive.ts` を拡げ、それらを `CloudSync`（依存をすべて注入）がまとめる。`main.ts` は UI と `CloudSync` をつなぐだけ。

**Tech Stack:** TypeScript、Vite、vitest（node 環境）、Google Identity Services（トークンモデル）、Drive API v3、Cloudflare Pages。

**Spec:** [docs/superpowers/specs/2026-11-21-google-sync-design.md](../specs/2026-11-21-google-sync-design.md)

## Global Constraints

- スコープは `https://www.googleapis.com/auth/drive.appdata` のみ（アカウント名が取れない時に限り `email` を足す）
- Drive のファイルは `appDataFolder` の `hakoniwa-save.bin` の 1 つ
- 自動送信は「前回送ってから 5 分以上」かつ「プレイヤーの変更あり」の時だけ
- アクセストークンは `sessionStorage` にだけ置く（`localStorage` に置かない）。`localStorage` に置くのは同期の印・変更の印・メールアドレス・「前にログインした」印
- 自分からログインのポップアップを出すのは、ボタンのクリックの中だけ
- スマホ（`isMobile`）は Drive に一切書き込まない
- 時間が進んだだけ・生き物の発見（`eco.onChanged`）は「プレイヤーの変更」に数えない
- 公開 URL は `https://miniature-hakoniwa.pages.dev`、リポジトリは `mizki15/miniature-hakoniwa`（非公開）
- 画面の文言は日本語。設計書の例文：「Drive の箱庭に入れ替えますか？（今の箱庭は書き出しで控えを取れます）」「この端末と Google Drive の両方で箱庭が変わっています。Drive：… ／ この端末：…」「スマホは見るだけです」

## Review Focus

1. **開いただけの古い PC が Drive を上書きする**：印が一致せず変更もない時は download になり、upload にならない → Task 1 `stalePcNeverUploads`、Task 3 `startupWithStaleMarkerDownloadsNotUploads`
2. **送っている最中にもう一度送る（自動保存とページを隠す時が重なる）**：同時に 1 本だけ → Task 3 `concurrentSyncRunsOnce`
3. **ユーザーが「聞く」に答えている間に自動保存が走る**：聞いている間は送らない → Task 3 `noUploadWhileAsking`
4. **トークン切れの最中の自動同期**：ポップアップを出さず `needsLogin` 状態になる → Task 3 `expiredTokenGoesToNeedsLoginWithoutPopup`
5. **スマホで Drive の情報が取れない（オフライン）**：端末内の箱庭をそのまま見せ、黙って何もしない → Task 3 `viewerOfflineKeepsLocal`

---

### Task 1: 同期の判断（純粋関数）

**Files:**
- Create: `src/save/syncDecision.ts`
- Test: `src/save/syncDecision.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SyncAction = 'none' | 'upload' | 'download' | 'ask';
  export interface SyncInput {
    remoteVersion: string | null;   // Drive の今の版（ファイルがなければ null）
    markerVersion: string | null;   // この端末が最後に同期した版（初めてなら null）
    localChanged: boolean;          // 前回の同期のあとにプレイヤーが手を加えたか
    localHasProgress: boolean;      // 端末内の箱庭に手が入っているか（main の hasProgress）
  }
  export function decideSync(i: SyncInput): SyncAction;           // PC
  export type ViewerAction = 'none' | 'download' | 'askReplace';
  export function decideViewer(i: { remoteVersion: string | null; markerVersion: string | null; localHasProgress: boolean }): ViewerAction; // スマホ
  ```

- [ ] **Step 1: テストを書く**（`it` 名と期待値）
  - `nothingChanged`：remote='5', marker='5', changed=false → 'none'
  - `localOnlyUploads`：'5','5',true → 'upload'
  - `stalePcNeverUploads`：remote='7', marker='5', changed=false, progress=true → 'download'
  - `bothChangedAsks`：'7','5',true → 'ask'
  - `firstSyncEmptyDriveUploads`：remote=null, marker=null, changed=false, progress=false → 'upload'
  - `firstSyncFreshLocalDownloads`：'3', null, false, false → 'download'
  - `firstSyncWithProgressAsks`：'3', null, false, true → 'ask'
  - `driveFileDeletedUploads`：remote=null, marker='5', changed=false → 'upload'（Drive から消えていたら送り直す。Claude の判断）
  - viewer `viewerSameVersionNone`：'5','5' → 'none'
  - viewer `viewerNewVersionDownloads`：'6','5' → 'download'
  - viewer `viewerFirstTimeWithProgressAsks`：'6', null, progress=true → 'askReplace'
  - viewer `viewerFirstTimeFreshDownloads`：'6', null, progress=false → 'download'
  - viewer `viewerNoRemoteNone`：null, null → 'none'
- [ ] **Step 2:** `npx vitest run src/save/syncDecision.test.ts` → FAIL（モジュールがない）
- [ ] **Step 3:** 設計書 2.2b の表のとおりに実装する
- [ ] **Step 4:** 同じコマンド → PASS
- [ ] **Step 5:** コミット `同期の判断（送る・読む・聞く）を関数に`

### Task 2: 端末ごとの同期の状態と、プレイヤーの変更の印

**Files:**
- Create: `src/save/syncState.ts`
- Test: `src/save/syncState.test.ts`
- Modify: `src/game/controller.ts`（`unsaved = true` の 4 か所：`undoLast` 465、`use` 703、`addDesign` 777、`removeDesign` 788）
- Modify: `src/main.ts`（`onPlot` 211、`doRegen` の 1174・1181、ファイルから読み込んだ時 1309 付近）

**Interfaces:**
- Produces:
  ```ts
  export interface SyncState {
    marker(): string | null; setMarker(v: string | null): void;
    changed(): boolean; markChanged(): void; clearChanged(): void;
    account(): { email: string; name?: string } | null; setAccount(a: { email: string; name?: string } | null): void;
    lastSyncAt(): number; setLastSyncAt(t: number): void;
  }
  export function createSyncState(local: Storage): SyncState;
  export interface TokenStore { get(): { value: string; expires: number } | null; set(t: { value: string; expires: number } | null): void; }
  export function createTokenStore(session: Storage): TokenStore;
  ```
  - キー：`hakoniwa.sync.marker`、`hakoniwa.sync.changed`、`hakoniwa.sync.account`、`hakoniwa.sync.lastAt`、`hakoniwa.sync.token`（session 側）
  - `GameController.onPlayerChange?: () => void`（4 か所で `unsaved = true` と一緒に呼ぶ）
- [ ] **Step 1: テストを書く**（`Map` で作った偽の `Storage` を使う）
  - `markerRoundTrips`、`changedPersistsAcrossInstances`（同じ Storage から作り直しても true）、`accountClearsWithNull`
  - `tokenExpiredReturnsNull`：expires が今より 60 秒以内なら `get()` は null
  - `brokenJsonIsIgnored`：account のキーに壊れた文字列 → `account()` は null で例外を出さない
- [ ] **Step 2:** `npx vitest run src/save/syncState.test.ts` → FAIL
- [ ] **Step 3:** 実装する。`controller.ts` に `onPlayerChange` を足し、`main.ts` で `game.onPlayerChange = () => syncState.markChanged()`。`onPlot`・`doRegen`・ファイル読み込みでも `markChanged()` を呼ぶ。`eco.onChanged` では呼ばない
- [ ] **Step 4:** `npx vitest run` と `npm run typecheck` → PASS
- [ ] **Step 5:** コミット `同期の印と、プレイヤーの変更の印`

### Task 3: Drive の通信を拡げ、`CloudSync` でまとめる

**Files:**
- Modify: `src/save/drive.ts`
- Create: `src/save/cloudSync.ts`
- Test: `src/save/cloudSync.test.ts`

**Interfaces:**
- Consumes: Task 1 の `decideSync` / `decideViewer`、Task 2 の `SyncState` / `TokenStore`
- Produces（`drive.ts`）：
  ```ts
  export class NeedsLoginError extends Error {}
  export function hasToken(): boolean;
  export function signIn(hint?: string): Promise<void>;        // クリックの中からだけ呼ぶ。ポップアップを出す
  export function signOut(): Promise<void>;                     // revoke してトークンを消す
  export function accountInfo(): Promise<{ email: string; name?: string }>; // GET drive/v3/about?fields=user(emailAddress,displayName)
  export interface RemoteInfo { id: string; version: string; savedAt: number; }
  export function remoteInfo(): Promise<RemoteInfo | null>;     // fields に version を足す
  export function upload(data: Uint8Array, savedAt: number, existingId?: string): Promise<{ id: string; version: string }>; // ?fields=id,version
  export function download(id: string): Promise<Uint8Array>;
  ```
  - トークンは Task 2 の `TokenStore`（sessionStorage）に置く。トークンがない・期限切れ・401 の時、`signIn` 以外の関数はポップアップを出さずに `NeedsLoginError` を投げる
- Produces（`cloudSync.ts`）：
  ```ts
  export type CloudStatus =
    | { kind: 'signedOut' }
    | { kind: 'needsLogin'; email: string }
    | { kind: 'ok'; email: string; lastSyncAt: number }
    | { kind: 'busy'; email: string }
    | { kind: 'error'; email: string; message: string };
  export interface CloudDeps {
    drive: Pick<typeof import('./drive'), 'hasToken' | 'signIn' | 'signOut' | 'accountInfo' | 'remoteInfo' | 'upload' | 'download'>;
    state: SyncState;
    viewer: boolean;                                        // isMobile
    now(): number;
    localHasProgress(): boolean;
    buildEncoded(): Promise<{ data: Uint8Array; savedAt: number }>;
    applyRemote(data: Uint8Array): Promise<void>;           // decode → loadFrom → saveNow
    askConflict(remoteAt: number, localAt: number): Promise<'remote' | 'local'>;
    askReplace(): Promise<boolean>;                         // スマホの初回
    onStatus(s: CloudStatus): void;
  }
  export class CloudSync {
    constructor(d: CloudDeps);
    start(): Promise<void>;        // 起動時：トークンがあれば syncOnce、なければ印に応じて needsLogin / signedOut
    signIn(): Promise<void>;       // ボタン：signIn → accountInfo → syncOnce
    signOut(): Promise<void>;      // 印・アカウントを消す（端末内の箱庭はそのまま）
    afterLocalSave(): void;        // PC：5 分たっていて changed なら syncOnce
    onHidden(): void;              // PC：changed なら syncOnce（5 分の制限なし）
    onVisible(): void;             // スマホ：syncOnce
    syncNow(): Promise<void>;      // 手動
  }
  ```
  - `syncOnce` は同時に 1 本だけ（実行中に呼ばれたら、その結果を待つ）。`ask` の答えを待っている間も「実行中」に含める
  - upload 成功 → `setMarker(version)`、`clearChanged()`、`setLastSyncAt(now)`。download 成功 → 同じく印を更新し、changed を消す
  - スマホで `askReplace` が false → `signOut()` して今の箱庭のまま（設計書 2.5）
  - viewer は upload を決して呼ばない（`decideViewer` だけを使う）
  - `NeedsLoginError` → `needsLogin`。その他の失敗 → `error`（遊ぶのは止めない）
- [ ] **Step 1: テストを書く**（偽の drive・state・時計を使う）
  - `startupWithStaleMarkerDownloadsNotUploads`：remote v7、marker v5、changed=false → `download` と `applyRemote` が呼ばれ、`upload` は呼ばれない。marker は '7'
  - `bothChangedAsksAndLocalWins`：answer 'local' → `upload(…, existingId)`、marker 更新
  - `throttleFiveMinutes`：成功した同期の 4 分後の `afterLocalSave` は送らず、5 分後は送る
  - `concurrentSyncRunsOnce`：`afterLocalSave` と `onHidden` を同時に呼ぶ → `remoteInfo` は 1 回
  - `noUploadWhileAsking`：`askConflict` が終わる前に `afterLocalSave` → `upload` は呼ばれない
  - `expiredTokenGoesToNeedsLoginWithoutPopup`：`remoteInfo` が `NeedsLoginError` → status は `needsLogin`、`signIn` は呼ばれない
  - `viewerNeverUploads`：viewer=true、changed=true、remote=null → `upload` は呼ばれない
  - `viewerDeclineReplaceSignsOut`：初回、progress=true、`askReplace` → false → `applyRemote` は呼ばれず、status は `signedOut`
  - `viewerOfflineKeepsLocal`：`remoteInfo` が普通の Error → `applyRemote` は呼ばれず、status は `error`
- [ ] **Step 2:** `npx vitest run src/save/cloudSync.test.ts` → FAIL
- [ ] **Step 3:** `drive.ts` を上の形にし、`cloudSync.ts` を実装する。`signIn` は `initTokenClient` に `login_hint` を渡し、`requestAccessToken({ prompt: '' })`（初回は `'consent'`）。`signOut` は `google.accounts.oauth2.revoke(token)`
- [ ] **Step 4:** `npx vitest run` と `npm run typecheck` → PASS
- [ ] **Step 5:** コミット `Drive との自動同期（CloudSync）`

### Task 4: 画面につなぐ（ログイン表示・自動同期・スマホは見るだけ）

**Files:**
- Modify: `index.html`（300〜310 行の保存の欄。`#driveSync` を置き換える）
- Modify: `src/main.ts`（保存まわり 1253〜1345、起動 1395〜1410、モードと道具 422・456・601）
- Modify: `src/style.css`

**Interfaces:**
- Consumes: Task 3 の `CloudSync`・`CloudStatus`
- 新しい要素：`#cloudBox`（中に `#cloudStatus`、`#cloudSignIn`、`#cloudSyncNow`、`#cloudSignOut`）。文言は設計書 2.1 の 3 つの状態の例に沿う

- [ ] **Step 1:** `index.html` の `#driveSync` を `#cloudBox` に置き換える。`DRIVE_CLIENT_ID` がない時は、欄の中に「この版では Google 同期は使えません」と出してボタンを隠す
- [ ] **Step 2:** `main.ts` で `CloudSync` を作る。`viewer = isMobile`。`saveNow` が成功した後に `cloud.afterLocalSave()`、`visibilitychange` の hidden と `pagehide` で `cloud.onHidden()`、visible で `cloud.onVisible()`。起動で端末内の箱庭を表示したあとに `cloud.start()`（待たない）。`askConflict` と `askReplace` は今の `confirm` でよい（文言は Global Constraints）
- [ ] **Step 3:** スマホでログイン中（status が `ok`・`busy`・`needsLogin`・`error`）は `setMode('view')` にし、`#modes` のエディタのボタンと `e` キーを止め、「スマホは見るだけです」を出す。`signedOut` になったら元に戻す
- [ ] **Step 4:** 確かめる：`npm run typecheck`、`npx vitest run` → PASS。`.env.local` がまだなければ、Client ID なしで起動して「使えません」の表示と、今までどおり遊べることを preview で確かめる（`hakoniwa-dev`）。Client ID がある場合は localhost でログイン → 同期 → 時刻が出る → ログアウトを確かめる。スマホの見え方は `resize_window` の mobile で確かめる（`isMobile` は `maxTouchPoints` を見るので、mobile のプリセットで効く）
- [ ] **Step 5:** コミット `Google ログインの表示と自動同期、スマホは見るだけ`

### Task 5: 文書と、公開の準備

**Files:**
- Modify: `docs/保存とクラウド同期.md`（新しい動き、Pages の URL、生成元に `https://miniature-hakoniwa.pages.dev`）
- Modify: `docs/仕様書.md`（保存の節）
- Modify: `package.json`（`build:portfolio` を消す）

- [ ] **Step 1:** 文書を更新する。Cloudflare Pages の設定（ビルドコマンド `npm run build`、出力 `dist`、環境変数 `VITE_GOOGLE_CLIENT_ID`、Node のバージョンは `package.json` の vite が求めるもの）を `保存とクラウド同期.md` に書く
- [ ] **Step 2:** `npm run build` → 成功し、`dist/index.html` が `/assets/` を指している
- [ ] **Step 3:** コミット `文書：Google 同期と Cloudflare Pages`
- [ ] **Step 4: ご本人の了承を得てから** `git remote add origin https://github.com/mizki15/miniature-hakoniwa.git`。GitHub にある最初のコミット（1 行の README）は取り込まず、`git push --force-with-lease origin main` で置き換えてよいかを聞く（了承がなければ、`git pull --allow-unrelated-histories` で README をまとめてから push）

### Task 6: 公開して確かめる（ご本人の作業を含む）

- [ ] **Step 1（ご本人）:** Cloudflare で Pages のプロジェクト `miniature-hakoniwa` を作り、GitHub の `mizki15/miniature-hakoniwa` と連携する。Task 5 の設定値を入れる
- [ ] **Step 2（ご本人）:** Google Cloud でクライアント ID を作る。生成元：`http://localhost:5173`、`https://miniature-hakoniwa.pages.dev`。値を Pages の環境変数と `.env.local` に入れる
- [ ] **Step 3:** `https://miniature-hakoniwa.pages.dev` を開いて、ログイン → 同期 → 再読み込みでもログインが続く（同じタブ）→ ログアウトを確かめる
- [ ] **Step 4（ご本人のスマホ）:** 同じアカウントでログイン → PC の箱庭が見える、道具が出ない、PC で変えてから戻ると読み込み直される

### Task 7: Render の `/hakoniwa/` を転送する（legendary-pancake）

**Files（別のリポジトリ `mizki15/legendary-pancake`）:**
- Modify: `apps/hakoniwa/routes.py`（`/hakoniwa`・`/hakoniwa/`・`/hakoniwa/assets/<path>` を `https://miniature-hakoniwa.pages.dev/` へ 301 で転送）
- Delete: `apps/hakoniwa/dist/`
- `portfolio/projects.py` は変えない（カードは `hakoniwa.index` を指していて、転送されるので）。説明の「PC向け」を「PC で遊ぶ・スマホで見る」にするかはご本人に聞く

- [ ] **Step 1:** legendary-pancake を作業用の場所に clone し、`routes.py` を書き換え、`dist/` を消す
- [ ] **Step 2:** `tests/` に hakoniwa のテストがあれば転送に合わせて直し、`python -m unittest discover -s tests` → PASS
- [ ] **Step 3:** コミットし、**ご本人の了承を得てから** push する（Render が自動で公開する）
- [ ] **Step 4:** `https://〜.onrender.com/hakoniwa/` が Pages へ転送されることを確かめる
