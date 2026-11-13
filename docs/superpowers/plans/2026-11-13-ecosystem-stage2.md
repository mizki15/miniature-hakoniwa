# 生態系（段階 ②）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 環境に応じて住人が引っ越してきて、訪問者 12 種がときどき来て、カーソルを 1.5 秒合わせると図鑑に「観察した」と載るようにする。

**Architecture:** 判定の中身（環境の数え方・来るかどうか・図鑑の段階とポイント）は three.js に依存しない純粋な関数として `src/eco/` に置き、Vitest で確かめる。見た目（訪問者のモデルと動き）は `src/creatures/visitors.ts`、つなぎ込みは `main.ts`。環境の数は「変わった時だけ」数え直す。

**Tech Stack:** TypeScript、three.js r187（WebGPU/TSL）、Vite、Vitest

**Spec:** `docs/superpowers/specs/2026-11-13-plots-ecosystem-design.md`（2 章。保存は 4 章）

## Global Constraints

- 訪問者の滞在は現実の時間で 20〜60 分。保存しない。閉じていた間に来たものはいなかったことにする
- 判定は箱庭内の時計（`farm.simMs`）で約 5 分ごと。確率：ふつう 40%、ややまれ 15%、まれ 5%。すでに来ている種類は抽選しない
- 同時にいる訪問者は最大 8 匹
- 住人：条件を満たした種類が 1 回の判定で 1 匹まで。上限は min(24, 開いた区画 × 3)、同じ種類は最大 4 匹。うさぎは最初から 1〜2 匹
- 住人の条件：りす 木 15、あひる 水辺 20、しか 草地 1500、たぬき 木 30、きつね 草地 2500、はりねずみ 畑か花 30
- 閉じていた間は住人も引っ越してこない（オフライン進行のあとに判定の基準時刻を今にそろえる）
- 図鑑：？？？（ヒントだけ）→ 見かけた（シルエットと名前の一部）→ 観察した（名前・説明・好きな環境・観察した季節）
- 初めて来た時は「何かの気配がする…」とだけ通知する。観察が済んだら「〇〇を観察した！ +N」
- 発見ポイント：初めての観察で ふつう 1・ややまれ 2・まれ 4（住人はふつう扱い）。訪問者を 2 季節目以降に初めて観察した季節ごとに +1
- 環境の数は、地形を変えた時・区画を開いた時・作物が増減した時にだけ数え直す（毎フレームは数えない）
- 「昼」6〜18 時、「夜」19〜5 時、「朝」5〜9 時（現実の時刻。デバッグの時刻・季節・天気の上書きも効く）。「初夏」＝夏の季節の前半（暦の月の前半）
- UI の文言は日本語。新しい依存パッケージは入れない
- 重さ：16 区画・訪問者 8 匹・住人 24 匹で、段階 ① の計測（高 1.00 / 中 0.93 / 低 0.63 ms）から +10% 以内

## 設計書からの判断

- **観察で入る発見ポイントは、この段階で入れる**（設計書 5 章では「ポイントと権利のつながり」は段階 ③）。観察のポイントは図鑑だけで決まり、入れればデバッグなしで土地を広げられるようになるため。初めての収穫・苗木のポイントと 6 つの解放は段階 ③ に残す
- **必要な環境が無くなった訪問者は、次の判定で去る**（設計書には無い）。花を全部耕した後もチョウが飛び続けないように

## Review Focus

1. **小さく速い訪問者にカーソルを合わせ続けられない**（チョウ・トンボ・ミツバチ）→ 画面上でマウスから 28px 以内のいちばん近い訪問者を対象にする。対象が少し動いても観察は途切れない（Task 6 のテスト：`pickNearestOnScreen`）
2. **箱庭内の時計が速い時（×60 など）に判定が毎フレーム続けて起きる** → 判定は 1 フレームに最大 1 回、現実の 1 秒に最大 1 回（Task 2 のテスト：`dueChecks`）
3. **保存した住人の場所が、読み込んだら水や木になっている**（差分の当て方が変わった・掘った）→ 歩ける一番近い列へ移し、なければ新しい場所を選ぶ（Task 4 のテスト：`restorePlace`）
4. **訪問者のいる場所が、その後の編集で無くなる**（花を耕して消す・水を埋める）→ 訪問者は場所を失っても去るまでそのまま動く（浮いてもよいが、木・水に関わるものは次の判定で去らせる）。判定の時に「必要な環境」を満たさなくなった訪問者は去る（Task 2 のテスト：`leavesWhenNeedsLost`）
5. **オフライン進行のあとに引っ越しがまとめて起きる** → 読み込み時に判定の基準を今の `simMs` にする（Task 2 の `dueChecks` のテストに「基準を今にそろえた直後は false」を足す。Task 4 のブラウザでの確認で、読み込み直後に引っ越しが起きないことを見る）

---

## ファイル構成

| ファイル | 役目 |
|---|---|
| `src/eco/environment.ts`（新） | 環境の数（花・木・草地・水辺・深い水・畑・作物）と、生き物の現れる場所の列 |
| `src/eco/species.ts`（新） | 住人 7 種と訪問者 12 種のデータ（名前・珍しさ・条件・ヒント・説明・場所・動き） |
| `src/eco/ecosystem.ts`（新） | 判定：誰が来るか、誰が引っ越してくるか、誰が去るか。判定の時刻 |
| `src/eco/dexState.ts`（新） | 図鑑の段階の進め方と発見ポイント |
| `src/creatures/visitors.ts`（新） | 訪問者のモデルと動き |
| `src/creatures/animals.ts` | 住人として 1 匹ずつ置く・保存から戻す |
| `src/creatures/dex.ts` | 図鑑の画面（3 段階） |
| `src/creatures/fireflies.ts` | ホタルの位置を外に出す（観察用） |
| `src/calendar.ts` | 季節の中の進み具合（初夏の判定） |
| `src/game/controller.ts` | 環境を数えるための材料と、変わったことの知らせ |
| `src/main.ts` | つなぎ込み、観察、通知、右パネル、デバッグ |
| `index.html` / `src/style.css` | 環境の欄、観察の輪、デバッグのボタン |
| `docs/仕様書.md` | 今の動きに合わせて直す |

---

### Task 1: 環境の数え方と季節の進み具合

**Files:**
- Create: `src/eco/environment.ts`
- Modify: `src/calendar.ts`
- Test: `src/eco/environment.test.ts`, `src/calendar.test.ts`

**Interfaces:**
- Produces:
  - `interface EnvInput { world: WorldData; flowerCols: number[]; treeCols: ReadonlySet<number>; farmland: ReadonlySet<number>; crops: number }`
  - `interface EnvCounts { flowers: number; trees: number; grass: number; waterside: number; deepWater: number; farmland: number; crops: number }`
  - `type Habitat = 'flower' | 'flowerCrop' | 'farm' | 'waterside' | 'deepWater' | 'tree' | 'grassNearWater' | 'flowerOrFarm'`
  - `countEnvironment(i: EnvInput): EnvCounts`
  - `habitatCols(i: EnvInput, h: Habitat): number[]`（列番号 `x + z*FRAME`。開いた区画の中だけ）
  - `SeasonState` に `progress: number`（0..1、季節＝暦の月の中の進み具合）を足す

決まり：
- 水の列 = `heights > 0 && heights < waterLevel`。深い水 = `heights > 0 && heights <= waterLevel - 3`
- 草地 = 一番上のブロックが `GRASS` の列
- 水辺 = 歩ける列（`walkable === 1`）で、上下左右のどれかが水の列
- 花 = `flowerCols.length`、木 = `treeCols.size`、畑 = `farmland.size`
- `grassNearWater` = 草地で、半径 4 以内に水の列がある列（今のホタルのすみかと同じ考え方）

- [ ] **Step 1: テストを書く**

`environment.test.ts`：`createWorld(64)` に区画 5 だけを手で作った小さな世界（高さ 12 の草地、x=70..73 を水 heights=7、x=80 を深い水 heights=6）を使う。
- `countEnvironment` が `grass`・`waterside`（水の列の両側の歩ける列の数）・`deepWater` を正しく数える
- 開いていない区画（heights 0）は水にも草地にも数えない
- `habitatCols(i, 'waterside')` の列はどれも歩ける列で、隣に水がある
- `flowers / trees / farmland / crops` は入力の数そのまま

`calendar.test.ts`：`seasonAt(new Date(Date.UTC(2027, 1, 1)))` の `progress` が 0 に近く、`Date.UTC(2027, 1, 20)` で 0.5 より大きい。

- [ ] **Step 2: 走らせて失敗を確かめる** — `npx vitest run src/eco/environment.test.ts src/calendar.test.ts` → 期待：`countEnvironment` が無い／`progress` が undefined で FAIL
- [ ] **Step 3: 実装する**（全体を 1 回なめるだけ。65536 列で 1〜2 ms 以内）
- [ ] **Step 4: 走らせて通るのを確かめる** — 同じコマンド → PASS。`npm test` 全体も PASS

---

### Task 2: 生き物のデータと判定

**Files:**
- Create: `src/eco/species.ts`, `src/eco/ecosystem.ts`
- Test: `src/eco/ecosystem.test.ts`

**Interfaces:**
- Consumes: `EnvCounts`, `Habitat`（Task 1）、`Species`（`creatures/animals.ts`）
- Produces:
  - `type Rarity = 'common' | 'uncommon' | 'rare'`、`RARITY_CHANCE = { common: 0.4, uncommon: 0.15, rare: 0.05 }`、`RARITY_POINTS = { common: 1, uncommon: 2, rare: 4 }`
  - `type VisitorId = 'butterfly' | 'bee' | 'sparrow' | 'frog' | 'fish' | 'dragonfly' | 'woodpecker' | 'firefly' | 'snail' | 'longtailedTit' | 'owl' | 'kingfisher'`
  - `type Motion = 'fly' | 'hop' | 'perch' | 'swim' | 'crawl' | 'glow'`
  - `interface Moment { season: number; seasonProgress: number; hour: number; raining: boolean }`
  - `interface VisitorDef { id: VisitorId; name: string; icon: string; rarity: Rarity; habitat: Habitat; motion: Motion; needs(e: EnvCounts): boolean; when(m: Moment): boolean; hint: string; note: string; likes: string }`
  - `VISITORS: VisitorDef[]`（2.3 の表の順）、`RESIDENT_RULES: Record<Species, (e: EnvCounts) => boolean>`、`RESIDENT_TEXT: Record<Species, { hint: string; likes: string }>`
  - `type DexId = Species | VisitorId`、`DEX_ORDER: DexId[]`（住人 7 種→訪問者 12 種）
  - `interface EcoState { visitors: { id: VisitorId; leavesAt: number }[]; residents: Species[]; openPlots: number }`
  - `checkEcosystem(s: EcoState, e: EnvCounts, m: Moment, nowReal: number, rand: () => number): { arrive: VisitorId[]; leave: VisitorId[]; moveIn: Species | null }`
  - `dueChecks(lastSim: number, nowSim: number, lastRealCheck: number, nowReal: number): boolean`（`nowSim - lastSim >= 5 分` かつ `nowReal - lastRealCheck >= 1000`）
  - `CHECK_SIM_MS = 5 * 60 * 1000`、`MAX_VISITORS = 8`、`stayMs(rand) = (20 + rand() * 40) * 60_000`

判定の決まり（`checkEcosystem`）：
1. 去る：`leavesAt <= nowReal` のもの、または `needs(e)` を満たさなくなったもの
2. 来る：残っていない種類ごとに、`needs && when` を満たせば `rand() < 確率` で来る。カエルは雨なら確率 ×2。カワセミは魚の影がいる（残っている、またはこの判定で来た）時だけ。合わせて 8 匹を超えない
3. 引っ越し：住人の上限 `min(24, openPlots × 3)` 未満なら、`DEX_ORDER` の順に条件を満たし 4 匹未満の種類を探し、最初の 1 種類を 1 匹だけ（うさぎは条件なし＝最初の配置だけで、引っ越しでは来ない）

時刻の決まり（`when`）：昼 `6 <= hour < 18`、夜 `hour >= 19 || hour < 5`、朝 `5 <= hour < 9`。ホタルは `season === 1 && seasonProgress < 0.5 && 夜`。カタツムリは `raining && 夜`。チョウ・ミツバチは雨以外。

- [ ] **Step 1: テストを書く**（`rand` は決まった値を返す関数を渡す）
  - `arrivesWhenChanceHits`：チョウの条件（花 20・春・昼・晴れ）で `rand=()=>0.39` なら来る、`0.41` なら来ない
  - `frogDoubleInRain`：カエル、`rand=()=>0.79`、雨なら来る・晴れなら来ない
  - `kingfisherNeedsFish`：魚がいない時は来ない。魚が同じ判定で来れば来られる
  - `maxEightVisitors`：8 匹いる時は誰も来ない
  - `alreadyPresentNotDrawn`：いる種類は `arrive` に入らない
  - `leavesWhenTimeUp` と `leavesWhenNeedsLost`：時間切れ、花が 0 になったチョウは `leave` に入る
  - `oneMoveInPerCheck`：木 40 本・水辺 30 で `moveIn` は 1 種類だけ。上限（区画 1 → 3 匹）に達していれば null。同じ種類 4 匹なら次の種類
  - `fireflyEarlySummerNight`：夏 `seasonProgress 0.3` の 22 時は true、`0.7` は false
  - `dueChecks`：5 分たっていなければ false。5 分たっても現実の 1 秒以内なら false
- [ ] **Step 2: 失敗を確かめる** — `npx vitest run src/eco/ecosystem.test.ts` → FAIL（モジュールが無い）
- [ ] **Step 3: 実装する**。文言（ヒント・説明・好きな環境）は 2.3 の表から日本語で書く（例：チョウのヒント「花がたくさん咲く所に来るらしい」）
- [ ] **Step 4: 通るのを確かめる** — 同じコマンド → PASS、`npm test` → PASS

---

### Task 3: 図鑑の段階と発見ポイント、保存

**Files:**
- Create: `src/eco/dexState.ts`
- Modify: `src/save/format.ts`（コメントだけ。形は v2 のまま）
- Test: `src/eco/dexState.test.ts`, `src/save/format.test.ts`

**Interfaces:**
- Consumes: `DexId`, `RARITY_POINTS`, `VISITORS`（Task 2）
- Produces:
  - `type Dex = SaveData['dex']`
  - `dexStage(dex: Dex, id: DexId): 'unknown' | 'seen' | 'observed'`
  - `markSeen(dex: Dex, id: DexId, now: number): boolean`（初めてなら true）
  - `observe(dex: Dex, id: DexId, season: number, now: number): number`（入る発見ポイント。初めて＝珍しさのポイント、2 季節目以降の訪問者で新しい季節＝1、それ以外＝0。見かけていなくても観察できる＝見かけたことにもする）
  - `partialName(name: string): string`（最初の 1 文字＋残りを「？」に。例：「シマエナガ」→「シ？？？？」）

- [ ] **Step 1: テストを書く**
  - `firstObservePointsByRarity`：チョウ 1、トンボ 2、フクロウ 4、うさぎ 1
  - `newSeasonGivesOne`：春に観察済みのチョウを夏に観察 → 1、もう一度夏 → 0
  - `residentNoSeasonPoints`：住人を別の季節に観察しても 0
  - `observeMarksSeen`：見かけていない種類を観察すると `dexStage` が observed、`seenAt` も入る
  - `format.test.ts` に `dexAndResidentsRoundtrip`：`dex` と `residents` を入れて encode → decode で同じ
- [ ] **Step 2: 失敗を確かめる** — `npx vitest run src/eco/dexState.test.ts src/save/format.test.ts` → FAIL（dexState が無い。roundtrip は通ってもよい）
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通るのを確かめる** → PASS、`npm test` → PASS

---

### Task 4: 住人（最初の配置・引っ越し・保存と復元）

**Files:**
- Modify: `src/creatures/animals.ts`, `src/main.ts`, `src/game/controller.ts`
- Test: `src/creatures/place.test.ts`

**Interfaces:**
- Consumes: `checkEcosystem`, `dueChecks`, `CHECK_SIM_MS`（Task 2）、`countEnvironment`, `habitatCols`（Task 1）、`markSeen`（Task 3）
- Produces:
  - `animals.ts`：`Animal` のコンストラクタに `name?: string`。`placeResident(world, species, rand?): [x, z] | null`（あひるは水辺、りす・たぬきは木の近く、ほかは歩ける列。今の `spawnAnimals` の場所選びを 1 匹ぶんにしたもの）、`restorePlace(world, x, z): [x, z] | null`（歩ける列ならそのまま、違えば半径 8 以内の一番近い歩ける列、なければ null）。`spawnAnimals` は消す
  - `controller.ts`：`envInput(): Omit<EnvInput, 'world'>`（花の列は木・花の配置から、耕して消した花は除く）、`onEnvChanged: (() => void) | null`（`setVoxel`・作物の増減・区画が開いた時に呼ぶ）
  - `main.ts`：`envDirty`, `env(): EnvCounts`（汚れている時だけ数え直す）、`residentsSave(): SaveData['residents']`、`__hakoniwa.ecoCheck(force: boolean)`（force なら確率を 1 にして判定）

流れ：
- 新しい箱庭：うさぎを 1〜2 匹（`placeResident`）。図鑑に「見かけた」
- 読み込み：`save.residents` を `restorePlace` で戻す。null の住人は `placeResident` で選び直す。それでも置けなければ捨てる
- 判定（毎フレーム `dueChecks` を見る）：`moveIn` があれば置いて `markSeen`、`toast('何かの気配がする…')`（初めての種類の時だけ。2 匹目以降は「〇〇が引っ越してきた」）
- オフライン進行（`catchUp`）のあとで `lastCheckSim = farm.simMs` にする
- 区画が開いた時の「動物を足す」（`fillCreatures` の数の式）は消す。ホタルの `setWorld` だけ残す
- 保存：`buildSave` の `residents` に `[species, x, z, name]`

- [ ] **Step 1: テストを書く**（`place.test.ts`。Task 1 と同じ小さな世界）
  - `restorePlaceKeepsWalkable`：歩ける列はそのまま
  - `restorePlaceMovesOffWater`：水の列 → 一番近い歩ける列
  - `restorePlaceGivesUpFar`：半径 8 以内に歩ける列が無い → null
  - `duckPlacedAtWaterside`：あひるの場所は水辺
- [ ] **Step 2: 失敗を確かめる** — `npx vitest run src/creatures/place.test.ts` → FAIL
- [ ] **Step 3: 実装する**（animals.ts は three を使うが、`placeResident`・`restorePlace` は `world` の配列だけを見る関数にして、テストでは three の読み込みだけで済ませる）
- [ ] **Step 4: 通るのを確かめる** → PASS、`npm test`・`npx tsc --noEmit` → PASS
- [ ] **Step 5: ブラウザで確かめる**：新しい箱庭でうさぎ 1〜2 匹。デバッグの「🐾 判定」（Task 7）を押すまでの代わりに `__hakoniwa.ecoCheck(true)`（確率を 1 にして判定）で引っ越しが 1 匹ずつ起きる。保存 → 再読み込みで同じ住人・同じ名前

---

### Task 5: 訪問者の見た目と動き

**Files:**
- Create: `src/creatures/visitors.ts`
- Modify: `src/creatures/fireflies.ts`, `src/creatures/animals.ts`（`mergeModel` を export）, `src/main.ts`

**Interfaces:**
- Consumes: `VisitorDef`, `Motion`, `VisitorId`（Task 2）、`habitatCols`（Task 1）、`mergeModel`
- Produces:
  - `class Visitor { readonly def: VisitorDef; readonly object: THREE.Group; leavesAt: number; constructor(def, world, home: number /* 列 */, leavesAt: number); update(dt: number, t: number): void; get anchor(): THREE.Vector3 /* 観察の基準点 */ }`。`object.userData.visitor = this`
  - `main.ts`：`visitors: Visitor[]`、`__hakoniwa.spawnVisitor(id: VisitorId)`（条件を見ずにすぐ 1 匹出す）
  - `Fireflies.positions(): THREE.Vector3[]`（見えている粒の位置。観察用）、`Fireflies.setPresent(on: boolean)`（ホタルの訪問者がいる時だけ光る）

動き（`motion`）：
- `fly`：すみかのまわり半径 3 を 8 の字に飛ぶ（高さ 1〜2.5）。チョウはひらひら上下、トンボは速く直線的、ミツバチは花と作物の列の間を行き来
- `hop`：地面を短く跳ねて移動（スズメ）。カエルは水辺で時々跳ねる
- `perch`：木の幹（キツツキ）・枝（シマエナガ）・木の上（フクロウ）に止まって、時々向きを変える
- `swim`：水面の少し下の暗い楕円（魚の影）。ゆっくり泳いで向きを変える
- `crawl`：ゆっくり進む（カタツムリ）
- `glow`：モデルなし。`Fireflies.setPresent(true)` にする（今のホタルの光を使う）
- モデルは基本形状の組み合わせ（仮）。部品は `mergeModel` で 1 つのメッシュにする（描画命令を増やさない）

- [ ] **Step 1: 実装する**（見た目の部分なので単体テストは書かない。下のブラウザでの確認で代える）
- [ ] **Step 2: `npx tsc --noEmit`** → エラーなし
- [ ] **Step 3: ブラウザで確かめる**：`__hakoniwa.spawnVisitor(id)` で 12 種を 1 匹ずつ出し、すみかの近くで動くこと、開いていない区画に出ないこと、魚の影が水の中に見えることを見る。ホタルは訪問者がいない夏の夜には光らない

---

### Task 6: 観察（1.5 秒）と通知

**Files:**
- Create: `src/eco/pick.ts`
- Modify: `src/main.ts`, `src/style.css`
- Test: `src/eco/pick.test.ts`

**Interfaces:**
- Consumes: `observe`, `dexStage`, `partialName`（Task 3）、`Visitor.anchor`, `Fireflies.positions()`（Task 5）
- Produces:
  - `pickNearestOnScreen(points: { x: number; y: number; id: number }[], mx: number, my: number, radius = 28): number | null`（一番近い点の id。radius より遠ければ null）
  - `main.ts`：`Target` に `{ kind: 'visitor'; visitor: Visitor }` と `{ kind: 'firefly' }` を足す。`observing: { key: string; t: number } | null`

決まり：
- 見る（view）モードで、同じ対象（住人は種類ではなくその 1 匹、訪問者はその 1 匹）にカーソルが合っている間だけ時間を足す。1.5 秒で `observe()`。離れたら 0 に戻す。右クリックで固定している対象も数える
- 対象の優先：画面上で 28px 以内の訪問者・ホタル → 動物（今のレイキャスト）→ 作物
- ホバー表示：観察済みならこれまでどおりの情報＋図鑑の説明。まだなら「？？？」（見かけていれば `partialName`）と、進み具合の輪（`conic-gradient`）
- 観察が済んだら `toast('〇〇を観察した！ +N')`（N が 0 なら「+N」を付けない）。`progress.points += N`、`game.unsaved = true`、`refreshGhosts()`、図鑑を描き直す
- 訪問者が初めて来た時（`markSeen` が true）は `toast('何かの気配がする…')`

- [ ] **Step 1: テストを書く**：`pickNearestOnScreen` が、28px 以内の 2 点から近い方を返す、28px より遠いと null、点が無いと null
- [ ] **Step 2: 失敗を確かめる** — `npx vitest run src/eco/pick.test.ts` → FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通るのを確かめる** → PASS、`npm test`・`npx tsc --noEmit` → PASS
- [ ] **Step 5: ブラウザで確かめる**：飛んでいるチョウにマウスを近づけて 1.5 秒で観察が済み、ポイントが増え、権利が 3 ポイントごとに増える。途中で離すと輪が 0 に戻る

---

### Task 7: 図鑑の画面、右パネルの「環境」、デバッグ

**Files:**
- Modify: `src/creatures/dex.ts`, `src/main.ts`, `index.html`, `src/style.css`

**Interfaces:**
- Consumes: `DEX_ORDER`, `VISITORS`, `RESIDENT_TEXT`, `SPECIES`（Task 2）、`dexStage`, `partialName`（Task 3）、`env()`（Task 4）
- Produces: `renderDex(grid: HTMLElement, detail: HTMLElement, dex: Dex, animals: Animal[], visitors: Visitor[])`

画面：
- 19 枚のカードを `DEX_ORDER` の順に並べる。上に「住人」、下に「訪問者」の見出し
- ？？？：アイコン「?」、名前「？？？」。選ぶとヒント
- 見かけた：アイコンをシルエット（CSS `filter: brightness(0) opacity(.55)`）、名前は `partialName`。選ぶとヒント
- 観察した：アイコン・名前・珍しさ（★1〜3）。選ぶと説明・好きな環境・観察した季節（春夏秋冬のうち観察した季節を濃く）。住人は今いる子の名前と様子（今の表示）。訪問者は「いま箱庭にいる」なら出す
- 図鑑の上に「観察 n / 19」
- 右パネルに「環境」：🌼 花・🌳 木・🌿 草地・💧 水辺・🐟 深い水・🟫 畑（`env()` の値。数え直した時だけ書き換える）
- 右パネルの土地の権利の横に「次の権利まで あと n ポイント」
- デバッグ：「🐾 生き物を呼ぶ」（確率を 1 にして 1 回判定。時刻・季節の条件はそのまま）、「訪問者を帰す」

- [ ] **Step 1: 実装する**
- [ ] **Step 2: `npx tsc --noEmit`・`npm test`** → PASS
- [ ] **Step 3: ブラウザで確かめる**：3 段階の見た目、環境の数が耕す・掘る・区画を開くで変わること、デバッグのボタン

---

### Task 8: 重さ・仕様書・仕上げ

**Files:**
- Modify: `docs/仕様書.md`, `docs/superpowers/plans/2026-11-13-plots-stage1-bench.md`（段階 ② の計測を足す）

- [ ] **Step 1: 計測**：16 区画・正午・訪問者 8 匹（`spawnVisitor` で）・住人 24 匹で、`bench(10)` を 7 回の中央値。高・中・低。期待：段階 ① から +10% 以内。超えたら原因（描画命令の数か、毎フレームの CPU か）を調べて直す
- [ ] **Step 2: 環境を数える時間**：16 区画で `countEnvironment` 1 回が 3 ms 以内
- [ ] **Step 3: 仕様書を直す**：7 章（住人・訪問者・図鑑・観察）、右パネル、デバッグ、保存（dex・residents を使うようになった）、15 章のファイル、16 章（段階 ② 済み）
- [ ] **Step 4: 全体の確認**：`npx tsc --noEmit`、`npm test`、`npm run build`
- [ ] **Step 5: コミット**（このラウンドで 1 回）

```bash
git add -A
git commit -m "生態系（段階2）：環境に応じた住人の引っ越し、訪問者12種、図鑑の3段階と観察"
```
