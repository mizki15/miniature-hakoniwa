# 建物の読み込み 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Blockbench の Bedrock 形式（`.geo.json`）の建物を検査して読み込み、棚から箱庭の地面に置いて飾れるようにする。AI に渡す説明文と、直してもらう文もゲームから出せるようにする。

**Architecture:** 検査と変換（`src/build/` の純粋な関数）、メッシュ作り（`MeshData` を返す純粋な関数）、置き場所の計算（純粋な関数）を分け、すべて vitest で直接テストする。three.js・画面・保存へのつなぎ込みは `GameController` と `main.ts` に足す。説明文の中のパレットと上限は、検査と同じ定数から書き出す。

**Tech Stack:** TypeScript、three.js（`three/webgpu`、ノードマテリアル）、Vite、vitest

**Spec:** [docs/superpowers/specs/2026-11-19-building-import-design.md](../specs/2026-11-19-building-import-design.md)

## Global Constraints

- 形式は Bedrock のジオメトリ JSON。`format_version` は 1.12.0 以降。`"minecraft:geometry"` の最初の 1 つだけ使う
- 16 単位 = ボクセル 1 個。Y が上。底面は y = 0
- 形は直方体だけ。`poly_mesh` はエラーにする。`uv`・`mirror`・`texture_*`・`visible_bounds_*`・`locators`・`bind_pose_rotation` は無視する
- 色はグループ名で決める。`名前 === p` か `名前.startsWith(p + '_')` のとき色 p。照らし合わせはパレット名の長い順。決まらなければ親をたどり、それでも決まらなければエラー
- 上限：ファイル 64 KB、直方体 512、グループ 128、入れ子の深さ 16、外形は幅・奥行 各 8 ボクセル（128 単位）、高さ 12 ボクセル（192 単位）、底面は一番低い点が y = 0 ± 0.5 単位
- 読み込んだデータは数値と名前としてだけ読む。`eval`・`new Function`・`innerHTML` への名前の差し込みをしない（名前は `textContent` で出す）
- エラーは集めてから一覧で返す（最初の 1 つで止めない）。文は「どこが」「どう悪いか」「どう直すか」を含む日本語
- 色は sRGB の 16 進で持ち、表示するときにリニアに直す（`world/blocks.ts` と同じ式）
- 建物は風で揺れない
- 置いた建物は生き物の動きの計算に加えない
- セーブの版は 3。v2 は空の棚として読む
- スマホ（`isMobile`）では棚と置く操作を出さず、表示だけする
- コメント・画面の文は既存のコードと同じく、やさしい日本語で書く
- コミットは各タスクの最後に 1 回。メッセージは日本語で、末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. **左右・回転が Blockbench と逆になる**：Blockbench で右に付けた煙突が、ゲームでも（同じ向きから見て）右に出ること → Task 1 の実物と Task 3 のテストで固定する
2. **AI が JSON の前後に説明文やコードブロックの記号を付けて返す**：貼り付けた文に ```` ```json ```` や前置きの文が混ざっていても、最初の `{` から対応する最後の `}` までを読んで通る → Task 2 のテスト `extractsJsonFromChatText`
3. **親が見つからない・親子が輪になっている**：`parent` が存在しない名前、または A→B→A のとき、固まらずにエラーを返す → Task 2 のテスト `parentMissing`、`parentCycle`
4. **数値の代わりに文字列や欠けた配列**：`"origin": ["0", 1]` などで、例外で落ちずに、どの直方体かを示すエラーを返す → Task 2 のテスト `badNumbers`
5. **区画の端や開いていない区画にはみ出す置き方・坂の上**：建物の足元のどこかが開いていない区画なら置けない、と理由を出す → Task 6 のテスト `footprintOutsideOpenPlots`

---

## ファイル構成

| ファイル | 役割 |
|---|---|
| `src/build/palette.ts`（新規） | パレット（名前→色）と、グループ名から色を決める関数 |
| `src/build/limits.ts`（新規） | 上限の定数 |
| `src/build/geoParse.ts`（新規） | 文字列 → 検査済みの `BuildingDesign`、またはエラーの一覧 |
| `src/build/geoMesh.ts`（新規） | `BuildingDesign` → `MeshData`（直方体 1 個 12 三角形、フラット） |
| `src/build/aiPrompt.ts`（新規） | AI に渡す説明文、直してもらう文 |
| `src/build/placement.ts`（新規） | 回転した外形、足元の列、置けるかの判定、光線との当たり |
| `src/build/fixtures/*.geo.json`（新規） | Blockbench で書き出した実物（Task 1） |
| `src/build/*.test.ts`（新規） | 上のテスト |
| `src/world/blocks.ts` | sRGB → リニアの関数 `hexToLinear` を export する |
| `src/render/materials.ts` | `createDetailMaterial` に揺れを止めるオプションを足す |
| `src/save/format.ts`・`format.test.ts` | v3（`buildings`） |
| `src/game/controller.ts` | 棚・置いた建物・道具「建物を置く」「片付ける」・描画・保存 |
| `src/main.ts`・`index.html`・`src/style.css` | エディタの「建物」欄（説明文コピー・貼り付け・ファイル・エラー一覧・棚） |
| `docs/仕様書.md` | 実装したことを書き足す |

---

### Task 1: Blockbench の実物を確かめる

設計書 §5 の確認。後のタスクの座標の決まりはここで決まる。

**Files:**
- Create: `src/build/fixtures/asymmetric.geo.json`、`src/build/fixtures/rotated.geo.json`
- Modify: `docs/superpowers/specs/2026-11-19-building-import-design.md`（§5 に結果を書き足す）

**Interfaces:**
- Produces: 2 つの fixture と、設計書 §5 の「確かめた結果」。中身は (a) Bedrock の x と Blockbench で見た x の関係、(b) 回転の順番と各軸の符号、(c) 子のグループの `pivot` が絶対座標か、(d) 書き出された `format_version`。Task 3 はこれに従う

- [ ] **Step 1: `asymmetric.geo.json` を作る**

Blockbench の Web 版（https://web.blockbench.net）で「Bedrock Entity」の新しいモデルを作る。中身は次のとおり。
- グループ `stone`：土台 `origin [-24,0,-24] size [48,4,48]`
- グループ `wall`：本体 `[-20,4,-20] size [40,32,40]`
- グループ `wood`：扉。北の面（Blockbench の North）にだけ付ける
- グループ `brick`：煙突。Blockbench の画面で北から見て右側（East）にだけ付ける

書き出した JSON を `src/build/fixtures/asymmetric.geo.json` に保存する。

ブラウザを操作できない場合は、利用者に上の手順で書き出してもらう。

- [ ] **Step 2: `rotated.geo.json` を作る**

グループ `roof` に回転 `[0, 0, 30]`、その中の子グループ `roof_tilt`（pivot を親と別の点にする）に回転 `[15, 0, 0]` を付ける。その中に直方体 1 個を入れ、直方体自体にも回転 `[0, 22.5, 0]` を付ける。書き出して保存する。

- [ ] **Step 3: 結果を設計書 §5 に書き足す**

Blockbench の画面で見た各直方体の角の座標（数個）を、書き出した JSON の値と並べて書く。そこから (a)〜(d) を決めて書く。

- [ ] **Step 4: Commit**

```bash
git add src/build/fixtures docs/superpowers/specs/2026-11-19-building-import-design.md
git commit -m "建物の読み込み：Blockbench で書き出した見本と、座標の決まりの確認結果"
```

---

### Task 2: パレット・上限・JSON の検査（形の変換より前）

**Files:**
- Create: `src/build/palette.ts`、`src/build/limits.ts`、`src/build/geoParse.ts`、`src/build/geoParse.test.ts`
- Modify: `src/world/blocks.ts`（`hex` を `export const hexToLinear` にし、ファイル内の使い方はそのまま）

**Interfaces:**
- Produces:
  - `palette.ts`
    - `export const PALETTE: readonly { name: string; hex: number; use: string }[]`
      - 中身は設計書 §2.3 の 13 色（`wall #A07A4E 木の壁`、`wood #6E4C2E 柱・扉・濃い木`、`plank #C8A070`、`roof #C8403C`、`roof_blue #4A6A9A`、`thatch #C9A85A`、`stone #9298A0`、`brick #A85A44`、`white #F6F2EA`、`glass #BFD8E0`、`dark #3A3A40`、`leaf #4F9A3C`、`flower #F2C94C`。用途の文は §2.3 の表のとおり）
    - `export function colorOfName(boneName: string): string | null`
      - 大文字小文字を区別しない
  - `limits.ts`：`export const LIMITS = { fileBytes: 65536, cubes: 512, bones: 128, depth: 16, widthUnits: 128, heightUnits: 192, groundTolerance: 0.5 } as const`
  - `geoParse.ts`
    - `export interface ParseIssue { code: IssueCode; message: string }`
    - `export type IssueCode = 'json' | 'file_size' | 'no_geometry' | 'poly_mesh' | 'no_color' | 'too_many_cubes' | 'too_many_bones' | 'too_deep' | 'parent_missing' | 'parent_cycle' | 'bad_number' | 'negative_size' | 'too_wide' | 'too_tall' | 'not_grounded' | 'empty'`
    - `export type ParseResult = { ok: true; design: BuildingDesign } | { ok: false; issues: ParseIssue[] }`
    - `export function parseBuilding(text: string): ParseResult`
      - このタスクでは、形の変換の手前（`resolveBones`）まで作る。`BuildingDesign` の型と変換は Task 3
    - `export function extractJson(text: string): string`

- [ ] **Step 1: 失敗するテストを書く**

`geoParse.test.ts` に、規格どおりの最小の例を作る関数 `geo(bones)` を置く（`format_version: "1.12.0"`、identifier `geometry.test`）。テストは次のとおり。
- `colorOfName`：`roof`→`roof`、`roof_left`→`roof`、`roof_blue`→`roof_blue`、`Roof_Blue_2`→`roof_blue`、`roofing`→`null`、`door`→`null`
- `extractsJsonFromChatText`：```` "こちらです。\n```json\n" + JSON + "\n```\nいかがでしょう" ```` が通る
- `brokenJson`：`'{"format_version":'` → `issues[0].code === 'json'`
- `fileTooLarge`：65,537 バイトの文字列 → `file_size`
- `noGeometry`：`{}` → `no_geometry`
- `polyMesh`：bone に `poly_mesh` → `poly_mesh`
- `noColor`：bone `door`（親なし）→ `no_color` で、`message` に `door` を含む
- `inheritsParentColor`：`door` の親が `wood` → 通る
- `parentMissing`：`parent: "nai"` → `parent_missing`、`message` に `nai` を含む
- `parentCycle`：A の親 B、B の親 A → `parent_cycle`（固まらずに返る）
- `badNumbers`：`origin: ["0", 1]` → `bad_number`、`message` にグループ名を含む。`size: [1, NaN, 1]` 相当（`null`）も `bad_number`
- `negativeSize`：`size: [-1, 1, 1]` → `negative_size`
- `tooManyCubes`：513 個 → `too_many_cubes`
- `tooManyBones`：129 個 → `too_many_bones`
- `tooDeep`：深さ 17 → `too_deep`
- `collectsAllIssues`：`no_color` と `negative_size` を同時に含む例 → 2 件とも返る
- `ignoresUvAndTextures`：`uv`・`mirror`・`texture_width` があっても通る

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/build/geoParse.test.ts`
Expected: FAIL（モジュールがない）

- [ ] **Step 3: `palette.ts`・`limits.ts`・`extractJson`・`parseBuilding` の検査部分を書く**

`extractJson`：最初の `{` から、文字列リテラルを考えながら括弧の深さを数え、深さ 0 に戻ったところまでを返す。見つからなければ元の文字列を返す。

ファイルの大きさは `new TextEncoder().encode(text).length` で、`extractJson` の前に測る。

親をたどる処理は、訪れた名前の集合で輪を見つける。深さは `LIMITS.depth` を超えたら打ち切る。

エラーの文の例（この形にそろえる）：
- `no_color`：「グループ「${name}」の色が決まりません。wood などパレットの名前を付けるか、色のあるグループの中に入れてください。」
- `parent_missing`：「グループ「${name}」の親「${parent}」が見つかりません。」
- `bad_number`：「グループ「${name}」の ${n} 番目の直方体の ${field} が数になっていません。」
- `negative_size`：「グループ「${name}」の ${n} 番目の直方体の size に負の数があります。0 以上にしてください。」

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npx vitest run src/build/geoParse.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/build src/world/blocks.ts
git commit -m "建物の読み込み：パレット・上限・JSON の検査"
```

---

### Task 3: 形の変換（回転・pivot・inflate）と外形の検査

**Files:**
- Modify: `src/build/geoParse.ts`、`src/build/geoParse.test.ts`

**Interfaces:**
- Consumes:
  - Task 1 の決まり (a)〜(c)
  - Task 2 の `parseBuilding`・`LIMITS`・`colorOfName`
- Produces:
  - 型
    ```ts
    export interface BuildingCube { m: number[]; color: string } // m：単位立方体 [0,1]^3 → ボクセル単位の座標への 3×4 アフィン行列（行優先 12 個）。size・inflate・回転・親の回転を合成済み
    export interface BuildingDesign { id: string; name: string; cubes: BuildingCube[]; bounds: { min: [number, number, number]; max: [number, number, number] } } // bounds はボクセル単位
    ```
  - `parseBuilding` が `ok: true` のときに `design` を返すようになる
  - 座標の決まり
    - 底面は一番低い点がちょうど y = 0 になるよう、全体を y 方向にずらす（許す幅は ±0.5 単位）
    - x・z はずらさない
  - `name`：`identifier` から `geometry.` を除いたもの。空なら「名前のない建物」
  - `id`：`cubes` の行列を小数 4 桁に丸めた値と色を、順に並べた文字列の FNV-1a 32 ビットを 8 桁の 16 進にしたもの

- [ ] **Step 1: 失敗するテストを書く**

- `cubeCorners`：回転なしの直方体 `origin [-8,0,-8] size [16,16,16]` → `bounds` が `[-0.5,0,-0.5]`〜`[0.5,1,0.5]`
- `inflate`：同じ直方体に `inflate: 1` → 各方向に 1/16 ずつ広がる。底面は y = 0 にずらされる
- `asymmetricMatchesBlockbench`：`fixtures/asymmetric.geo.json`
  - 煙突（`brick`）の中心が、扉（`wood`）を正面に見たときの右側にある
  - 「正面」の向きと「右」の符号は Task 1 の (a) で決めたもの
- `rotatedMatchesBlockbench`：`fixtures/rotated.geo.json` の直方体の角 2 つが、Task 1 で記録した Blockbench の画面上の座標と ±0.01 ボクセルで一致する
- `tooWide`：幅 129 単位 → `too_wide`。`message` に幅（ボクセル）と上限 8 を含む
- `tooTall`：高さ 193 単位 → `too_tall`
- `rotationCountsForBounds`：幅 120 の板を y 軸で 45° 回す → 対角が 128 を超えるので `too_wide`
- `notGrounded`：一番低い点が y = 4 単位 → `not_grounded`。y = 0.4 なら通り、`bounds.min[1] === 0`
- `emptyAfterDroppingZeroCubes`：size `[0,0,0]` の直方体だけ → `empty`
- `sameDesignSameId`：同じ JSON の空白と順番違い（キーの順番）→ 同じ `id`。直方体を 1 つ動かす → 違う `id`

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/build/geoParse.test.ts`
Expected: FAIL（新しいテストだけ）

- [ ] **Step 3: 変換を書く**

各直方体の行列は「親のグループの変換 × 直方体の pivot まわりの回転 × 平行移動(origin − inflate) × 拡大(size + 2·inflate)」とし、最後に 1/16 倍する。グループの変換は、親から順に「pivot まわりの回転」を掛け合わせたもの。回転の順番と符号、x の向きは Task 1 の結果に従う。

外形は全直方体の 8 隅から求める。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npx vitest run src/build/geoParse.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/build
git commit -m "建物の読み込み：回転・pivot・inflate の変換と外形の検査"
```

---

### Task 4: メッシュ作り

**Files:**
- Create: `src/build/geoMesh.ts`、`src/build/geoMesh.test.ts`

**Interfaces:**
- Consumes:
  - Task 3 の `BuildingDesign`
  - Task 2 の `PALETTE`
  - `hexToLinear`（`world/blocks.ts`）
  - `MeshData`（`world/mesher.ts`）
- Produces：`export function buildBuildingMesh(d: BuildingDesign): MeshData`
  - 直方体 1 個につき 6 面 × 4 頂点、12 三角形
  - 面ごとに頂点を分ける
  - 法線は変換後の辺の外積を正規化したもの
  - 三角形は外向きに反時計回り
  - `ao` は 1、`veg` は 0、`index` は `Uint32Array`

- [ ] **Step 1: 失敗するテストを書く**

- `twelveTrianglesPerCube`：直方体 3 個 → `index.length === 108`、頂点 72
- `normalsPointOutward`：各三角形について、面の中心から立方体の中心への向きと法線の内積が負
- `windingMatchesNormal`：各三角形の外積と法線の内積が正
- `linearColor`：`roof` の直方体の頂点色が `hexToLinear(0xC8403C)` と一致
- `rotatedCubeNormalsUnit`：回転した直方体の法線の長さが 1 ± 1e-6

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/build/geoMesh.test.ts`
Expected: FAIL

- [ ] **Step 3: `buildBuildingMesh` を書く**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npx vitest run src/build/geoMesh.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/build/geoMesh.ts src/build/geoMesh.test.ts
git commit -m "建物の読み込み：直方体からフラットなメッシュを作る"
```

---

### Task 5: AI に渡す説明文と、直してもらう文

**Files:**
- Create: `src/build/aiPrompt.ts`、`src/build/aiPrompt.test.ts`

**Interfaces:**
- Consumes：`PALETTE`、`LIMITS`、`ParseIssue`
- Produces:
  - `export function buildPrompt(idea: string): string`
  - `export function buildFixPrompt(issues: ParseIssue[]): string`

- [ ] **Step 1: 失敗するテストを書く**

- `promptListsWholePalette`：`buildPrompt('')` が `PALETTE` の全部の名前と 16 進（`#A07A4E` の形）を含む
- `promptStatesLimits`：直方体 512、幅・奥行 128 単位（8 ボクセル）、高さ 192 単位、ファイル 64 KB の数字を含む
- `promptKeepsIdea`：`buildPrompt('青い屋根の灯台')` が `青い屋根の灯台` を含む
- `emptyIdeaPlaceholder`：`buildPrompt('')` は「（ここに作ってほしいものを書いてください）」を含む
- `fixPromptListsIssues`：2 件の issue の `message` を両方含み、「この点だけを直して、JSON 全体をもう一度出してください」を含む

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/build/aiPrompt.test.ts`
Expected: FAIL

- [ ] **Step 3: 説明文を書く**

構成は、2026-11-18 の実験で使ったプロンプトと同じ順番にする：役割 → 作ってほしいもの → 規格 → 出力。

規格の部分に書くこと：
- Bedrock のジオメトリ JSON であること（`format_version` "1.12.0"、`minecraft:geometry`、`bones`・`cubes`・`origin`・`size`・`pivot`・`rotation`）
- 16 単位が 1 マスであること
- 底面が y = 0 であること
- 正面が北（−Z）であること
- 色はグループ名で付けること（パレットの表）
- 直方体だけで、`poly_mesh` を使わないこと
- `uv` は不要なこと
- 上限

出力の部分には「JSON だけを 1 つのコードブロックで、省略せずに」と書く。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npx vitest run src/build/aiPrompt.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/build/aiPrompt.ts src/build/aiPrompt.test.ts
git commit -m "建物の読み込み：AI に渡す説明文と、直してもらう文"
```

---

### Task 6: 置き場所の計算

**Files:**
- Create: `src/build/placement.ts`、`src/build/placement.test.ts`

**Interfaces:**
- Consumes：`BuildingDesign`、`isOpenCol(mask, x, z)`（`world/plots.ts`）
- Produces:
  - `export type Rot = 0 | 1 | 2 | 3`
    - 90° 刻み。y 軸まわりに上から見て反時計回り
  - `export function rotatedBounds(d: BuildingDesign, rot: Rot): { min: [number, number, number]; max: [number, number, number] }`
  - `export function footprintCols(d: BuildingDesign, rot: Rot, x: number, z: number, size: number): number[]`
    - 置いた位置 `(x + 0.5, z + 0.5)` を建物の原点にしたとき、外形に一部でもかかる列の番号（`col = x + z*size`）
  - `export function canPlace(d: BuildingDesign, rot: Rot, x: number, z: number, size: number, plots: number): { ok: true } | { ok: false; msg: string }`
  - `export function rayHitPlaced(placed: { design: BuildingDesign; x: number; z: number; y: number; rot: Rot }[], origin: [number, number, number], dir: [number, number, number], half: number): number`
    - 当たった建物の番号。当たらなければ −1
    - 当たりは回転した外形の箱で判定する
    - `half` は箱庭の中心のずれ（`world.size / 2`）

- [ ] **Step 1: 失敗するテストを書く**

- `rotatedBoundsQuarterTurn`：外形 x `[-1, 3]`・z `[-2, 2]` を `rot 1` → x `[-2, 2]`・z `[-3, 1]`（回転の向きは上の定義）
- `footprintOneCube`：1×1 の建物 → その 1 列だけ
- `footprintOutsideOpenPlots`：開いた区画の端に置き、足元の一部が開いていない区画 → `ok: false`、`msg` は「開いていない土地にかかっています」
- `footprintOutsideFrame`：枠の外にかかる → `ok: false`
- `rayHitsNearest`：2 棟が光線上に並ぶ → 手前の番号
- `rayMisses`：→ −1

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/build/placement.test.ts`
Expected: FAIL

- [ ] **Step 3: 書く**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npx vitest run src/build/placement.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/build/placement.ts src/build/placement.test.ts
git commit -m "建物の読み込み：置き場所の計算（回転・足元・当たり）"
```

---

### Task 7: セーブデータ v3

**Files:**
- Modify: `src/save/format.ts`、`src/save/format.test.ts`

**Interfaces:**
- Consumes：`BuildingDesign`、`Rot`
- Produces:
  - `SAVE_VERSION = 3`
  - `SaveData.buildings: { designs: BuildingDesign[]; placed: [designId: string, x: number, z: number, rot: Rot][] }`
  - `migrate()` は v2 に `buildings: { designs: [], placed: [] }` を足す

- [ ] **Step 1: 失敗するテストを書く**

既存の `v2()` を `v3()` に直し、`buildings` を入れる。テストは次のとおり。
- `roundtrips`：`buildings` に 1 棟と配置 1 つを入れて往復
- `migratesV2`：`version: 2` で `buildings` のないデータ → 空の棚で読める、`version` は 3
- `rejects v1 with OldSaveError`：そのまま

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/save/format.test.ts`
Expected: FAIL

- [ ] **Step 3: 書く**

`main.ts` の `buildSave()` は、Task 8 で `game.exportState()` が `buildings` を返すようにするまで、型エラーになる。このタスクでは `buildSave()` に `buildings: { designs: [], placed: [] }` を仮に入れて、型を通す。

- [ ] **Step 4: テストと型を確かめる**

Run: `npx vitest run src/save/format.test.ts && npx tsc --noEmit`
Expected: PASS、型エラーなし

- [ ] **Step 5: Commit**

```bash
git add src/save src/main.ts
git commit -m "セーブデータ v3：建物の棚と配置"
```

---

### Task 8: 箱庭への組み込み（道具・描画・保存）

**Files:**
- Modify: `src/game/controller.ts`、`src/render/materials.ts`、`src/main.ts`

**Interfaces:**
- Consumes：`parseBuilding`、`buildBuildingMesh`、`canPlace`、`footprintCols`、`rotatedBounds`、`rayHitPlaced`、`toGeometry`（`controller.ts`）
- Produces（`GameController`）:
  - `Tool` に `'build' | 'unbuild'` を足す
    - `TOOLS` に `{ id: 'build', name: '建物を置く', icon: '🏠', key: '9', help: '棚で選んだ建物を地面に置く（R で向きを変える）' }`
    - `{ id: 'unbuild', name: '片付ける', icon: '🧹', key: '0', help: '置いた建物を取り除く（棚には残る）' }`
  - `designs: Map<string, BuildingDesign>`、`selectedDesign: string | null`、`buildRot: Rot`
  - `addDesign(d: BuildingDesign): 'added' | 'exists'`
  - `removeDesign(id: string): void`
    - 置いてある分も消す
  - `rotateBuild(): void`
  - `exportState()` が `buildings` も返す。`restore()` が戻す
  - `ControllerDeps` に `buildingMat: THREE.Material` を足す
- `materials.ts`：`createDetailMaterial(swayLinear = 0, opts: { sway?: boolean } = {})`
  - `sway === false` のときは `positionNode` を付けない
  - 近くで透かす処理（`alphaHash`）は残す

- [ ] **Step 1: 道具の判定と実行を書く**

`check()` と `use()` に `'build'`・`'unbuild'` を足す。

- `build`
  - 地面の上面だけ。`selectedDesign` がなければ「棚から建物を選んでください」
  - 置く位置は当たったマスの列、高さは `heights[col]`
  - `canPlace` の結果を `msg` にする
- `unbuild`
  - `rayHitPlaced` で当たった建物を消す
  - そのために `check` は光線を受け取る必要がある。`main.ts` で呼ぶ所を合わせる
- カーソル：`build` のときは、カーソルの枠を回転した外形の大きさに広げる

`main.ts:494` のキー処理で `r` が他に使われていないか確かめ、`'build'` のときだけ `rotateBuild()` を呼ぶ。

- [ ] **Step 2: 描画を書く**

- 建物の種類ごとに `toGeometry(buildBuildingMesh(d))` を 1 度だけ作り、置いた分の `InstancedMesh` にする
- 行列は「位置 `(x + 0.5 − half, heights[col], z + 0.5 − half)` × y 軸回転 `rot·90°`」
- 影は、木と同じ設定（`castShadow`・`receiveShadow`）にそろえる
- 置いた・片付けた・棚から消したときに作り直す

- [ ] **Step 3: 保存・読み込みをつなぐ**

- `exportState()` に `buildings` を足し、`main.ts` の仮の値を消す
- `restore()` で棚と配置を戻し、描画を作る
- `unsaved = true` は、置く・片付ける・棚に足す・棚から消すのそれぞれで立てる

- [ ] **Step 4: 型と全テストを確かめる**

Run: `npm run typecheck && npm test`
Expected: エラーなし、全テスト PASS

- [ ] **Step 5: Commit**

```bash
git add src/game/controller.ts src/render/materials.ts src/main.ts
git commit -m "建物の読み込み：建物を置く・片付ける道具、描画、保存"
```

---

### Task 9: エディタの「建物」欄

**Files:**
- Modify: `index.html`（`#editor` の `.side-body` に、`#seedBox` の後ろに `#buildBox`）、`src/main.ts`、`src/style.css`

**Interfaces:**
- Consumes：`buildPrompt`、`buildFixPrompt`、`parseBuilding`、`game.addDesign`・`removeDesign`・`selectedDesign`

`#buildBox` の中身：
- 見出し「建物」
- 欄「作ってほしいもの」（`textarea`、1 行程度）とボタン「AI に頼む文をコピー」
- 貼り付け欄（`textarea`、placeholder「AI の返事や .geo.json の中身をここに貼る」）とボタン「読み込む」
- 「ファイルを選ぶ」（`input type=file accept=".json,.geo.json"`）。箱庭の画面へのファイルの落とし込みも受け付ける
- 問題の一覧（`ul`）とボタン「AI に直してもらう文をコピー」。問題があるときだけ出す
- 棚：建物ごとに、名前のボタン（押すと選んで道具を `build` に）と「×」（棚から消す）

- [ ] **Step 1: 画面を書く**

- 名前と問題の文は `textContent` で入れる
- コピーは `navigator.clipboard.writeText` を使い、成功したら `toast('コピーしました')` を出す
- 読み込んだときの知らせ
  - 足したとき：「「${name}」を棚に入れました」
  - すでにあるとき：「同じ建物がもう棚にあります」
- `isMobile` のときは `#buildBox` を出さない

- [ ] **Step 2: ブラウザで確かめる**

`preview_start {name: "hakoniwa-dev"}` で開き、次を確かめる。
1. `fixtures/asymmetric.geo.json` の中身を貼って読み込むと、棚に入る
2. 選んで地面に置くと、Blockbench と同じ向きで、扉と煙突が正しい側に出る
3. R で回せる
4. 片付けられる
5. 保存して再読み込みすると、置いた建物が戻る
6. `door` という色のないグループの例を貼ると、問題の一覧が出る
7. コンソールにエラーがない

置いた建物のスクリーンショットを残す。

- [ ] **Step 3: 型と全テストを確かめる**

Run: `npm run typecheck && npm test`
Expected: エラーなし、全テスト PASS

- [ ] **Step 4: Commit**

```bash
git add index.html src/main.ts src/style.css
git commit -m "建物の読み込み：エディタの「建物」欄（AI 用の文・貼り付け・ファイル・問題の一覧・棚）"
```

---

### Task 10: AI で試す・仕様書に書く

**Files:**
- Modify: `docs/仕様書.md`、`docs/superpowers/specs/2026-11-19-building-import-design.md`（§5 の後ろに「AI で試した結果」）

- [ ] **Step 1: AI で試す**

「AI に頼む文をコピー」の文で、ChatGPT と Claude（無料版）に 2〜3 棟ずつ作らせる。それぞれを読み込み、合格したか、エラーの文が分かりやすかったか、「直してもらう文」で直ったかを表にする。

ブラウザで AI のサイトを操作するのは、利用者に頼む（ログインが必要なため）。Claude Code の中で作った JSON で試すのはよい。

- [ ] **Step 2: 結果を受けて、説明文を必要なだけ直す**

テストが通ったままであることを確かめる。

Run: `npm test`
Expected: PASS

- [ ] **Step 3: 仕様書に「建物」の節を足す**

形式、色の決まり、上限、道具、保存（v3）を書く。

- [ ] **Step 4: Commit**

```bash
git add docs src/build/aiPrompt.ts
git commit -m "建物の読み込み：AI で試した結果と仕様書"
```
