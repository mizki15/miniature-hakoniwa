# 区画の拡張（段階 ①：枠と区画）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 256×256 の枠の中に 64×64 の区画を 1 枚ずつ足していけるようにし、16 区画を開いても今の 128 の箱庭と同じくらいの重さに収める。

**Architecture:**
- ボクセル配列と 3D テクスチャは常に 256 の枠で持つ。番号は `x + z*256 + y*256*256` で固定する。
- 地形は「座標とシード値だけで決まる」関数で区画ごとに生成する。
- ワーカーは世界の状態を持ち続け、区画の追加と編集の差分だけを受け取る。
- メインスレッドは、開いた区画を囲む四角（bounds）に合わせて、カメラ・霧・影・雨・鳥などの範囲を決める。

**Tech Stack:** TypeScript、three.js r187（WebGPU/TSL）、Vite 8、Web Worker。純粋なロジックのテストに Vitest を足す。

**Spec:** [docs/superpowers/specs/2026-11-13-plots-ecosystem-design.md](../specs/2026-11-13-plots-ecosystem-design.md)（この計画は 1 章、4 章の一部、5 章の段階 1 を実装する）

## Global Constraints

- `FRAME = 256`、`PLOT = 64`、区画は 4×4（区画の番号は `px + pz*4`）、最初の区画は (1,1) = 番号 5。
- 高さは `WORLD_HEIGHT = 64`、水面は `WL = 10`。
- ボクセルの番号は `x + z*FRAME + y*FRAME*FRAME`。セーブの差分・畑の列番号（`x + z*FRAME`）もこの座標で持つ。
- 開いていない区画のボクセルはすべて空気（0）。編集・水の流れ込み・生き物の配置は、開いた区画の中だけで行う。
- 権利の残り＝`floor(points / 3) - rightsUsed`。
- 区画を開いた時の演出は 0.6 秒。
- 影の範囲は、注目点を中心に半径 48〜160 ボクセル（カメラとの距離で決める）。
- 数の上限：動物 24、鳥と雨粒は今の 128 の時と同じ数まで。
- 重さの目標：16 区画を開いた時の 1 フレームの時間が、今の 128 の箱庭（基準値。Task 1 で測る）の 1.3 倍以内。測るのは高・中・低画質、1280×720。
- `SAVE_VERSION = 2`。v1 は読まずに「古い形式のため新しく始めます」と伝える。
- 文言や UI は日本語にし、今の言い回し（です・ます調の通知、絵文字付きのボタン）に合わせる。
- コミットはこの段階の最後に 1 回だけ行う（ユーザーの決まり：依頼 1 回につきコミット 1 回、確かめてから）。途中の Task ではコミットしない。

## Review Focus

1. **区画の境目での編集**：境目の列で、掘る・土を盛る・耕すを行った時。水は開いていない区画へ流れ込まず、土は開いていない列に置けないこと。→ Task 4 のテスト `edge edits stay inside open plots`。
2. **区画を開く時と編集が重なった時**：ドラッグ中や、作り直しの返事を待っている間に区画を開いた時。ワーカーとメインの地形がずれないこと。編集の差分を先に送ってから区画の追加を送る。→ Task 3 のテスト `edits sent before addPlot are kept`。
3. **保存と読み込み**：最初の区画以外の区画で編集したり畑を作ったりした後に、保存して読み込んだ時。同じ地形・同じ畑に戻ること。→ Task 6 のテストと、Task 8 の確認の項目。
4. **権利の扱い**：権利が 0 の時、離れた区画をクリックした時、素早く 2 回クリックした時。権利が負にならず、同じ区画が 2 回開かないこと。→ Task 2 の `canOpen` のテストと、Task 7 の「開いている途中は受け付けない」。
5. **開いていない区画の列を参照する処理**：ホタルのすみか探しで、空気の列を「水のそば」と数えないこと（高さ 0 が水面より低く見えるため）。動物が開いていない区画に配置されないこと。→ Task 5 のテスト `isOpenCol guards`。

---

### Task 1: テストの準備と、今の重さの基準値

**Files:**
- Modify: `package.json`（`"test": "vitest run"` と devDependency の `vitest`）
- Create: `docs/superpowers/plans/2026-11-13-plots-stage1-bench.md`（測った値の記録）

- [ ] **Step 1: Vitest を入れる**

Run: `npm i -D vitest`
Expected: `package.json` に `vitest` が入り、`npx vitest --version` が出る。Vite 8 と合わない場合は、合う最新版を `npm view vitest peerDependencies` で調べて指定する。

- [ ] **Step 2: `src/world/noise.test.ts` に最初のテストを書いて、テストが動くことを確かめる**

```ts
import { describe, it, expect } from 'vitest';
import { mulberry32 } from './noise';
describe('noise', () => {
  it('mulberry32 is deterministic', () => {
    const a = mulberry32(1), b = mulberry32(1);
    expect(a()).toBe(b());
  });
});
```

Run: `npm test`
Expected: 1 passed

- [ ] **Step 3: 今の 128 の箱庭の重さを測る（基準値）**

1. `preview_start` で `hakoniwa-dev` を開き、ペインを表示した状態で、デバッグウィンドウの大きさを 128 にする。
2. 高・中・低画質それぞれで、`await __hakoniwa.setSize(1280,720); await __hakoniwa.bench(2); await __hakoniwa.bench(6)` を実行する。
3. 戻ってきた 1 フレームの時間（ms）を `2026-11-13-plots-stage1-bench.md` の「基準（変更前・128）」の表に書く。

---

### Task 2: 区画の計算（`src/world/plots.ts`）

**Files:**
- Create: `src/world/plots.ts`
- Test: `src/world/plots.test.ts`

**Interfaces:**
- Produces:
  - `FRAME = 256`, `PLOT = 64`, `PLOTS_PER_SIDE = 4`, `START_PLOT = 5`, `ALL_PLOTS = 0xffff`
  - `plotOfCol(x: number, z: number): number`：枠の外なら -1
  - `isOpen(mask: number, plot: number): boolean`
  - `isOpenCol(mask: number, x: number, z: number): boolean`
  - `openable(mask: number): number[]`：開いた区画に上下左右で接し、まだ開いていない区画（昇順）
  - `canOpen(mask: number, plot: number, rightsLeft: number): boolean`
  - `plotRect(plot: number): { x0: number; z0: number; x1: number; z1: number }`：x1, z1 は含まない
  - `boundsOf(mask: number): { x0: number; z0: number; x1: number; z1: number; cx: number; cz: number; w: number; d: number }`：枠の座標
  - `chunksOfPlot(plot: number): [number, number][]`：チャンク（32）4 つ
  - `borderChunks(mask: number, plot: number): [number, number][]`：新しい区画に接する、開いた隣の区画のチャンク（隣 1 つにつき 2 つ）
  - `rightsLeft(points: number, rightsUsed: number): number`
  - `countOpen(mask: number): number`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, it, expect } from 'vitest';
import * as P from './plots';
describe('plots', () => {
  it('plotOfCol', () => {
    expect(P.plotOfCol(64, 64)).toBe(5);
    expect(P.plotOfCol(255, 255)).toBe(15);
    expect(P.plotOfCol(-1, 0)).toBe(-1);
    expect(P.plotOfCol(256, 0)).toBe(-1);
  });
  it('openable from start', () => {
    expect(P.openable(1 << P.START_PLOT)).toEqual([1, 4, 6, 9]);
  });
  it('canOpen needs a right and adjacency', () => {
    const m = 1 << 5;
    expect(P.canOpen(m, 6, 1)).toBe(true);
    expect(P.canOpen(m, 6, 0)).toBe(false);
    expect(P.canOpen(m, 15, 1)).toBe(false); // 離れている
    expect(P.canOpen(m, 5, 1)).toBe(false);  // もう開いている
  });
  it('boundsOf', () => {
    expect(P.boundsOf((1 << 5) | (1 << 6))).toMatchObject({ x0: 64, z0: 64, x1: 192, z1: 128, w: 128, d: 64, cx: 128, cz: 96 });
  });
  it('chunks', () => {
    expect(P.chunksOfPlot(5)).toEqual([[2, 2], [3, 2], [2, 3], [3, 3]]);
    // 区画 5 が開いていて区画 6 を足す：区画 5 の右端のチャンク (3,2),(3,3)
    expect(P.borderChunks(1 << 5, 6)).toEqual([[3, 2], [3, 3]]);
  });
  it('rightsLeft', () => {
    expect(P.rightsLeft(7, 1)).toBe(1);
    expect(P.rightsLeft(2, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: 失敗することを確かめる**

Run: `npm test -- plots`
Expected: FAIL（`./plots` がない）

- [ ] **Step 3: `src/world/plots.ts` を書く**

上の Interfaces どおりに書く。`borderChunks` は、上下左右の隣の区画が開いている時だけ、その区画の中で新しい区画に接する側のチャンク 2 つを返す。順番は「左・右・上・下の隣の順、各チャンクは z→x の昇順」とする。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npm test -- plots`
Expected: PASS

---

### Task 3: 地形を区画ごとに生成する（`terrain.ts`・`noise.ts`）

**Files:**
- Modify: `src/world/noise.ts`（`hash2` を足す）
- Modify: `src/world/terrain.ts`（全体を組み直す）
- Test: `src/world/terrain.test.ts`

**Interfaces:**
- Consumes: Task 2 の `FRAME`, `PLOT`, `plotRect`, `isOpenCol`
- Produces:
  - `hash2(seed: number, x: number, z: number, salt: number): number`（[0,1) の値。座標とシード値だけで決まる）
  - `interface World { size: number /* = FRAME */; height; waterLevel; voxels; heights; walkable; plots: number; trees: Placement[]; flowers: Placement[] }`
  - `createWorld(height: number): World`：枠のぶんの空の世界（plots = 0）
  - `generatePlot(world: World, plot: number, seed: number, params: TerrainParams): { trees: Placement[]; flowers: Placement[] }`：区画の 64×64 列を書き込み、`world.plots` に区画のビットを立て、その区画の木・花を `world.trees` と `world.flowers` にも足して返す
  - `applyEdits(world: World, edits: number[]): void`：開いた区画の中の差分だけを当てる
  - `WorldData = Omit<World, 'trees' | 'flowers'>`（今のまま）

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, it, expect } from 'vitest';
import { createWorld, generatePlot, applyEdits, DEFAULT_PARAMS } from './terrain';
import { FRAME } from './plots';
const gen = (order: number[]) => {
  const w = createWorld(64);
  for (const p of order) generatePlot(w, p, 1234, DEFAULT_PARAMS);
  return w;
};
const key = (p: { x: number; z: number; variant: number }) => `${p.x.toFixed(3)},${p.z.toFixed(3)},${p.variant}`;
describe('generatePlot', () => {
  it('is independent of plot order', () => {
    const a = gen([5, 6, 9]), b = gen([9, 6, 5]);
    expect(Buffer.from(a.voxels).equals(Buffer.from(b.voxels))).toBe(true);
    expect(a.trees.map(key).sort()).toEqual(b.trees.map(key).sort());
    expect(a.flowers.map(key).sort()).toEqual(b.flowers.map(key).sort());
  });
  it('leaves closed plots as air', () => {
    const w = gen([5]);
    // 区画 5（x, z = 64〜127）の外の列は、高さ 0・全部空気・歩けない
    for (const [x, z] of [[0, 0], [63, 64], [128, 100], [100, 128], [255, 255]]) {
      expect(w.heights[x + z * FRAME]).toBe(0);
      expect(w.walkable[x + z * FRAME]).toBe(0);
      for (let y = 0; y < 64; y++) expect(w.voxels[x + z * FRAME + y * FRAME * FRAME]).toBe(0);
    }
    expect(w.plots).toBe(1 << 5);
  });
  it('trees keep spacing across plot seams', () => {
    const w = gen([5, 6]);
    for (const a of w.trees) for (const b of w.trees) {
      if (a === b) continue;
      const d = Math.max(Math.abs(Math.floor(a.x) - Math.floor(b.x)), Math.abs(Math.floor(a.z) - Math.floor(b.z)));
      expect(d).toBeGreaterThan(2);
    }
  });
  it('has a river in the start plot with default params', () => {
    const w = gen([5]);
    let water = 0;
    for (let z = 64; z < 128; z++) for (let x = 64; x < 128; x++) if (w.heights[x + z * FRAME] < w.waterLevel) water++;
    expect(water).toBeGreaterThan(64);
  });
  it('applyEdits ignores closed plots', () => {
    const w = gen([5]);
    applyEdits(w, [0 + 0 * FRAME + 20 * FRAME * FRAME, 3]);
    expect(w.voxels[20 * FRAME * FRAME]).toBe(0);
  });
});
```

- [ ] **Step 2: 失敗することを確かめる**

Run: `npm test -- terrain`
Expected: FAIL（`createWorld` がない）

- [ ] **Step 3: `noise.ts` に `hash2(seed, x, z, salt)` を足す**

整数をかき混ぜるハッシュ（例：`Math.imul` を使う murmur 風の混ぜ方）で、0 以上 1 未満の値を返す。

- [ ] **Step 4: `terrain.ts` を組み直す**

1. 今の高さ・地表の計算（66〜94 行目）を、列ごとの純粋な関数 `column(x, z) → { h, top }` に切り出す。ノイズはシード値から作る。
2. 川の中心を `FRAME` 基準の固定値にする。
   - `cz = 96 + sin(x*0.07 + riverPhase) * 96*0.15 + n2(x*0.03, 5.3) * 128*0.08`
   - 中心の 96 は、区画 (1,1) の真ん中。
   - 幅の `(N > 128 ? 1 : 0)` は `1` に固定する。
   - `riverPhase` は `hash2(seed, 0, 0, 1) * 2π` から作る。
3. 木の候補は、`column` の結果とハッシュ値だけで決める。
   - 条件：草地で、`h - 1 > WL + 1`、`hash2(seed,x,z,10) < p`（p は今の式）。
   - 置くのは、候補の列のうち、5×5 の範囲の候補の中で `hash2(seed,x,z,11)` が最大の列だけ。これで順番に関係なく、間隔は 3 以上になる。
   - 範囲の列が別の区画（開いていなくてもよい）にあっても、`column` で計算する。
   - 枠の端 2 列には置かない。
4. 種類・向き・大きさは `hash2` の別の salt で決める。今の `rand()` の使い方は残さない。
5. 花も同じように、その列が木の列かどうかを計算し、`hash2` で決める。
6. `walkable` の決め方は今のままにする。
7. `applyEdits` は、`isOpenCol(world.plots, x, z)` が false の差分を飛ばす。今の高さや歩けるかの直し方は残す。
8. 古い `generateWorld` は消す。

- [ ] **Step 5: テストが通ることを確かめる**

Run: `npm test -- terrain`
Expected: PASS（5 件）

- [ ] **Step 6: 型を確かめる**

Run: `npm run typecheck`
Expected: worker.ts・main.ts・controller.ts で `generateWorld` や `size` の型エラーが出る。これは Task 4〜5 で直すので、ここでは出ることだけ確かめる。terrain.ts そのものにエラーがないこと。

---

### Task 4: ワーカーが世界を持ち続ける（`worker.ts`・`plotBuild.ts`）

**Files:**
- Create: `src/world/plotBuild.ts`（ワーカーの中身。テストできるように純粋な関数にする）
- Modify: `src/world/worker.ts`（メッセージの出入りだけにする）
- Test: `src/world/plotBuild.test.ts`

**Interfaces:**
- Consumes: Task 2（`chunksOfPlot`, `borderChunks`, `isOpen`, `plotRect`）、Task 3（`createWorld`, `generatePlot`, `applyEdits`）
- Produces（`plotBuild.ts`）：
  - `interface BuildState { world: World; seed: number; params: TerrainParams; detail: number }`
  - `initWorld(req: InitRequest): { state: BuildState; result: InitResult }`
  - `addPlot(state: BuildState, plot: number, edits: number[]): PlotResult`
  - `applyDelta(state: BuildState, delta: number[], chunks: [number, number][]): ChunkMesh[]`
- メッセージ（`worker.ts` から export する型）：
  - `InitRequest { type: 'init'; height; seed; detail; params; plots: number; edits?: number[] }`
    - 返事 `InitResult { type: 'init'; world: WorldData（voxels はコピー）; chunks: ChunkMesh[]; models: DetailModel[]; placements: PlotPlacements[]; counts; timings }`
  - `AddPlotRequest { type: 'addPlot'; plot: number; edits: number[] }`
    - 返事 `PlotResult { type: 'plot'; plot; voxels: Uint8Array（区画の 64×64×H。番号は lx + lz*64 + y*64*64）; heights: Int16Array（64×64）; walkable: Uint8Array（64×64）; chunks: ChunkMesh[]; placements: PlotPlacements }`
  - `RemeshRequest { type: 'remesh'; id: number; delta: number[] /* [番号, 種類, ...] */; chunks: [number, number][] }`
    - 返事は今と同じ `{ type: 'remesh'; id; chunks }`
  - `DetailModel { kind: 'tree' | 'flower'; variant: number; mesh: MeshData }`：種類ごとの形は一度だけ送る
  - `PlotPlacements { plot: number; trees: Float32Array[] /* variant ごと */; flowers: Float32Array[] }`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, it, expect } from 'vitest';
import { initWorld, addPlot, applyDelta } from './plotBuild';
import { DEFAULT_PARAMS } from './terrain';
import { FRAME } from './plots';
const init = () => initWorld({ type: 'init', height: 64, seed: 7, detail: 3, params: DEFAULT_PARAMS, plots: 1 << 5 });
describe('plotBuild', () => {
  it('init meshes only open plots', () => {
    const { result } = init();
    expect(result.chunks.map((c) => `${c.cx},${c.cz}`).sort()).toEqual(['2,2', '2,3', '3,2', '3,3']);
  });
  it('addPlot returns new + border chunks and the region', () => {
    const { state } = init();
    const r = addPlot(state, 6, []);
    expect(r.chunks.length).toBe(6);
    expect(r.voxels.length).toBe(64 * 64 * 64);
    expect(state.world.plots).toBe((1 << 5) | (1 << 6));
  });
  it('edits sent before addPlot are kept', () => {
    const { state } = init();
    const i = 100 + 100 * FRAME + 30 * FRAME * FRAME;
    applyDelta(state, [i, 3], []);
    addPlot(state, 6, []);
    expect(state.world.voxels[i]).toBe(3);
  });
  it('addPlot applies saved edits inside the new plot', () => {
    const { state } = init();
    const i = 130 + 70 * FRAME + 40 * FRAME * FRAME;
    addPlot(state, 6, [i, 3]);
    expect(state.world.voxels[i]).toBe(3);
  });
});
```

- [ ] **Step 2: 失敗することを確かめる**

Run: `npm test -- plotBuild`
Expected: FAIL

- [ ] **Step 3: `plotBuild.ts` を書き、`worker.ts` をそれを呼ぶだけにする**

1. `initWorld`：`createWorld` → マスクの区画を順に `generatePlot` → `applyEdits` → 開いた区画のチャンクだけ `buildChunk`。`buildChunk` は `N = FRAME` で呼べば、そのまま動く。
2. `voxels` は `slice()` で複製して送り、ワーカー側の配列は持ち続ける。
3. 木と花のモデルは、今のように種類ごとに一度だけ作って `models` にする。配置は区画ごとに `PlotPlacements` にする。
4. `addPlot`：`generatePlot` → その区画の差分を `applyEdits` → `chunksOfPlot` と `borderChunks` のチャンクを作る → 区画の範囲の `voxels`・`heights`・`walkable` を切り出す。
5. `applyDelta`：差分をワーカーの `voxels` に書き込み（高さ・歩けるかは不要）、指定したチャンクを作る。
6. `worker.ts` の `onmessage` は、`init`・`addPlot`・`remesh` を振り分け、transfer するバッファを付けて `postMessage` するだけにする。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npm test -- plotBuild`
Expected: PASS（4 件）

---

### Task 5: 編集と画面を枠に合わせる（`controller.ts`・`main.ts` ほか）

**Files:**
- Modify: `src/game/controller.ts`
- Modify: `src/main.ts`
- Modify: `src/creatures/animals.ts`（`spawnAnimals`）
- Modify: `src/creatures/fireflies.ts`（`setWorld`）
- Modify: `src/creatures/birds.ts`（`setWorld`）
- Modify: `src/render/sky.ts`（`createPrecipitation`）
- Create: `src/render/base.ts`
- Test: `src/game/edgeEdits.test.ts`（controller の中の、three.js に頼らない部分を切り出してテストする）

**Interfaces:**
- Consumes: Task 2、Task 3（`World` / `WorldData` の `plots`）、Task 4 のメッセージ型
- Produces:
  - `GameController.load(w: WorldData, chunks: ChunkMesh[], models: DetailModel[], placements: PlotPlacements[], lowPolyFlowers, typeTex, terrainMat)`
  - `GameController.addPlot(r: PlotResult): void`：ボクセルなどの書き戻し、チャンクの追加と差し替え、その区画の木と花の InstancedMesh を作る。新しいチャンクのメッシュは `userData.rise = 0` から 0.6 秒でせり上がる
  - `GameController.pendingDelta(): number[]`：まだワーカーに送っていない編集の差分（送ったら空にする）
  - `GameController.onPlotsChanged: (() => void) | null`：区画が増えた時に main が範囲を直すための呼び口
  - `src/game/edgeRules.ts`：`canSetCol(plots: number, x: number, z: number): boolean`、`floodAllowed(plots: number, x: number, z: number): boolean`
  - `buildBase(mask: number): THREE.Group`（`src/render/base.ts`）：開いた区画ごとの台座の板。外側（隣が開いていない側）だけ 1.5 はみ出させる
  - `spawnAnimals(world: World, count: number)`：開いた区画の歩ける列から選ぶ
  - `FireflyField.setWorld(w)`：`isOpenCol` で開いていない列を飛ばす
  - `Birds.setWorld(bounds, maxHeight)`：`bounds` の中心のまわりを飛ぶ
  - `createPrecipitation(kind, size, amount)` は今のまま。main がメッシュの `position` を bounds の中心に置き、`size = max(bounds.w, bounds.d)` で作る

- [ ] **Step 1: 境目の決まりのテストを書く**

```ts
import { describe, it, expect } from 'vitest';
import { canSetCol, floodAllowed } from './edgeRules';
describe('edge edits stay inside open plots', () => {
  const m = 1 << 5;
  it('canSetCol', () => {
    expect(canSetCol(m, 64, 64)).toBe(true);
    expect(canSetCol(m, 63, 64)).toBe(false);
    expect(canSetCol(m, 128, 100)).toBe(false);
  });
  it('flood stops at closed plots', () => {
    expect(floodAllowed(m, 127, 90)).toBe(true);
    expect(floodAllowed(m, 128, 90)).toBe(false);
  });
});
```

Run: `npm test -- edgeEdits`
Expected: FAIL → `edgeRules.ts` を書く（中身は `isOpenCol` を呼ぶだけ）→ PASS

- [ ] **Step 2: `controller.ts` を枠に合わせる**

1. `setVoxel` は `canSetCol` が false なら何もしない。`flood` の広がりは `floodAllowed` で止める。
2. `setVoxel` で変えた所を `delta: number[]` に貯める。`flushRemesh` は `voxels.slice()` の代わりに `{ type: 'remesh', id, delta: this.pendingDelta(), chunks }` を送る（4 MB の複製をやめる）。
3. `decor` を「区画ごと × 種類ごと」に分ける。`DecorSet` に `plot: number` を足す。`removeFlowersAt` は、その列の区画の花だけを作り直す。InstancedMesh は `computeBoundingSphere()` して、画面外の区画は描かないようにする。
4. `addPlot(r)` を足す。
   - `r.voxels` などを枠の配列の区画の範囲に書き戻し、`typeTex.needsUpdate = true` にする。
   - `setChunk` でチャンクを足して差し替え、その区画の decor を作る。
   - `world.plots` を更新して `onPlotsChanged` を呼ぶ。
5. `tick` で `userData.rise` を進め、新しいチャンクと台座の `position.y` を `-6 * (1 - ease(t))` にする。
6. `treeCols` は区画を足した時にも増やす。

- [ ] **Step 3: `main.ts` を枠に合わせる**

1. `regenerate(size, …)` を `startWorld(seed, detail, params, flowerStyle, plots, edits?)` にし、`init` を送る。
2. 台座は `buildBase(world.plots)` にする。
3. 範囲を直す関数 `applyBounds()` を 1 つ作り、`onPlotsChanged` と読み込みの時に呼ぶ。中身は次のとおり。
   - `boundsOf(world.plots)` から中心 `c = (cx - 128, cz - 128)` と大きさ `s = max(w, d)` を出す。
   - カメラの最大距離は `s * 3.2`、`camera.far` は `s * 8`。
   - 霧は今の式の `size` を `s` にする。
   - 雨と雪は大きさ `s` で作り直し、`position` を `c` にする。
   - 鳥は `birds.setWorld(bounds, maxH)`。
   - 最初の読み込みの時だけ、`controls.target` を `(c.x, 10, c.z)` にしてカメラを置き直す。
4. 影の範囲：`daylight.apply(hour, focusPoint, size * 0.78, …)` の `size * 0.78` を `clamp(camDist * 0.9, 48, 160)` にする（`camDist` は計算する場所を上に移す）。
5. 動物の数は `min(24, max(4, round(sqrt(開いた区画の数 × 4096) / 10)))` にする。
6. `centerDepth`・`isWaterAt`・カメラの地面の判定は、`N = world.size`（= 256）のままで動く。そのまま残してよい。
7. デバッグウィンドウの `#size` の選択を消し、代わりに「🔑 権利 +1」（`points += 3`）と「全区画を開く」ボタンを置く。全区画を開く時は、開ける区画を 1 つずつ `addPlot` で送る。

- [ ] **Step 4: 型とテストを確かめる**

Run: `npm run typecheck && npm test`
Expected: エラーなし、すべて PASS

- [ ] **Step 5: 画面で確かめる**

`preview_start` で開いて、次のことを確かめる。
- 64×64 の区画が 1 枚だけ表示され、外側の面に地層の断面が見える。
- 台座が区画に合っている。
- 掘る・土を盛る・耕すが境目の外で効かない。
- 境目の列を掘っても、水が外へ流れない。
- コンソールにエラーがない。

---

### Task 6: 保存の形式 v2

**Files:**
- Modify: `src/save/format.ts`
- Modify: `src/main.ts`（`buildSave`, `loadFrom`, `settingsFromUI`）
- Test: `src/save/format.test.ts`

**Interfaces:**
- Produces:
  - `SAVE_VERSION = 2`
  - `SaveData.world = { seed; height; detail; flowerStyle; params }`（`size` はなくす）
  - `SaveData.plots: number`
  - `SaveData.progress = { points: number; rightsUsed: number; unlocks: string[]; firsts: string[]; newMarks: string[] }`
  - `SaveData.dex: Record<string, { seenAt: number; observedAt?: number; seasons: number[] }>`（段階 ① では `{}` を書くだけ）
  - `SaveData.residents: [species: string, x: number, z: number, name: string][]`（段階 ① では `[]`）
  - `class OldSaveError extends Error`：`migrate` が v1 で投げる

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, it, expect } from 'vitest';
import { encodeSave, decodeSave, OldSaveError, SAVE_VERSION, type SaveData } from './format';
const v2 = (): SaveData => ({
  version: SAVE_VERSION, savedAt: 1,
  world: { seed: 1, height: 64, detail: 3, flowerStyle: 'voxel', params: { relief: 1, mountains: 1, water: 1, rocks: 1, forest: 1, flowers: 1 } },
  plots: (1 << 5) | (1 << 6), edits: [5, 3],
  progress: { points: 4, rightsUsed: 1, unlocks: [], firsts: [], newMarks: [] }, dex: {}, residents: [],
  farm: { simMs: 0, inventory: {}, crops: [], saplings: [], wet: [] },
});
describe('save v2', () => {
  it('roundtrips', async () => { expect(await decodeSave(await encodeSave(v2()))).toEqual(v2()); });
  it('rejects v1 with OldSaveError', async () => {
    const old = { ...v2(), version: 1 } as SaveData;
    await expect(decodeSave(await encodeSave(old))).rejects.toBeInstanceOf(OldSaveError);
  });
});
```

Run: `npm test -- format`
Expected: FAIL

- [ ] **Step 2: `format.ts` を直す**

`migrate` は、`version < 2` なら `OldSaveError('古い形式のため新しく始めます')` を投げる。`version > 2` の時は、今の「新しいバージョンです」のエラーのまま。

Run: `npm test -- format`
Expected: PASS

- [ ] **Step 3: `main.ts` の保存と読み込みを v2 にする**

1. `buildSave` に `plots: world.plots` と `progress`（main が持つ `progress` オブジェクト）を入れる。
2. `loadFrom` は `startWorld(…, save.plots, save.edits)` で始める。
3. 読み込みで `OldSaveError` が出た時（起動時・ファイル・Drive のどれでも）は、メッセージを toast で出して `newWorld` を確認なしで行う。
4. 右パネルの `st-farm` の下に「🔑 土地の権利 n」を出す。中身は `rightsLeft(progress.points, progress.rightsUsed)`。

---

### Task 7: 開ける区画の表示とクリックで開く（`src/render/plotGhosts.ts`）

**Files:**
- Create: `src/render/plotGhosts.ts`
- Modify: `src/main.ts`（エディタモードのクリックの処理）

**Interfaces:**
- Consumes: Task 2（`openable`, `plotRect`, `canOpen`, `rightsLeft`）、Task 5（`GameController.pendingDelta`, `addPlot`）
- Produces:
  - `class PlotGhosts { group: THREE.Group; update(mask: number, rights: number, heightAt: (plot: number) => number): void; pick(ray: THREE.Ray): number /* 区画の番号か -1 */; setHover(plot: number): void }`

- [ ] **Step 1: `PlotGhosts` を書く**

1. 開ける区画ごとに、64×12×64 の箱を置く。線は `EdgesGeometry`、面は不透明度 0.08 の白にする。
2. 高さは、隣の開いた区画の平均の地表の高さに合わせる。
3. 権利がない時は線を灰色にし、ホバーした時は不透明度を 0.18 にする。
4. `pick` は `THREE.Raycaster` で面に当てて調べる。

- [ ] **Step 2: `main.ts` につなぐ**

1. エディタモードの時だけ `ghosts.group.visible = true` にする。
2. 左クリックした時は、ボクセルを選ぶ前に `ghosts.pick` を調べる。区画に当たり、かつ `canOpen` が true で、`opening === false` の時に、次の順で処理する。
   1. `opening = true` にする。
   2. `flushRemesh` で残りの差分を送る。差分が残っていれば、`remesh` の送信と同じ流れで先に送る。
   3. `{ type: 'addPlot', plot, edits: その区画の保存済みの差分 }` を送る。
   4. `progress.rightsUsed++` にして、toast で「新しい土地が開きました」と出す。
   5. 返事 `plot` を受けたら `game.addPlot` を呼び、`opening = false` に戻す。
3. ホバーした時は、ツールのヒントに、開ける時は「クリックでこの土地を開く（権利 1）」、権利がない時は「土地の権利が足りません」と出す。

- [ ] **Step 3: 画面で確かめる**

`preview_start` で開いて、次のことを確かめる。
- エディタモードで、隣の 4 区画に枠が出る。
- 権利 0 の時はクリックしても開かない。
- 「権利 +1」の後にクリックすると、0.6 秒でせり上がって開く。
- 開いた区画との境目に、地層の断面や継ぎ目が残らない（色の馴染ませがつながっている）。
- 素早く 2 回クリックしても、権利は 1 つしか減らない。
- 開いた後に保存して読み込むと、同じ形に戻る。

---

### Task 8: 重さを測る・必要なら遠くの木を軽くする・仕様書を直す

**Files:**
- Modify: `docs/superpowers/plans/2026-11-13-plots-stage1-bench.md`
- Modify（必要な時だけ）：`src/world/plotBuild.ts`、`src/game/controller.ts`（遠くの区画の木を 1/1 のモデルにする）
- Modify: `docs/仕様書.md`

- [ ] **Step 1: 1・4・16 区画で測る**

1. 「全区画を開く」の前後で、高・中・低画質、1280×720 で `bench(6)` を測り、表に書く。4 区画は 2×2 に開いた状態にする。
2. あわせて、16 区画の時に次を測る。
   - エディタで 3 秒ドラッグして耕した時の fps（`performance.now()` で数える）
   - 区画を 1 つ開いた時の止まり（`addPlot` の返事を受けてから次のフレームまでの ms）

- [ ] **Step 2: 目標と比べる**

16 区画が、Task 1 の基準の 1.3 倍以内なら Step 4 へ。超えた画質があれば Step 3 を行う。

- [ ] **Step 3（超えた時だけ）: 遠くの区画の木を 1/1 のモデルにする**

1. `initWorld` で、細かさ 1 の木のモデルも `models` に入れる（`DetailModel` に `lod: 0 | 1` を足す）。
2. controller では、注目点から区画の中心までの距離が 96 を超える区画の木を、1/1 のモデルの InstancedMesh で描く。切り替えの判定は 0.5 秒に 1 回、区画単位で行う。
3. もう一度測る。それでも超えた時は、測った数字を表に書き、ユーザーに相談する。

- [ ] **Step 4: 仕様書を直す**

`docs/仕様書.md` の次の節を、今の動きに合わせて直す。
- 4 章（大きさ → 枠と区画、生成の決まり）
- 9 章（v2 の形式、v1 の扱い）
- 12 章（デバッグの「権利 +1」「全区画を開く」）
- 14 章（測った値）
- 15 章（新しいファイル）
- 16 章（段階 ② ③ が未実装であること）

- [ ] **Step 5: すべて確かめてコミットする**

Run: `npm run typecheck && npm test && npm run build`
Expected: エラーなし、すべて PASS、build が成功する

```bash
git add -A
git commit -m "区画の拡張（段階1）：256の枠に64×64の区画を足していけるようにし、重さを抑える"
```

（コミットメッセージの最後に `Co-Authored-By` の行を付ける）
