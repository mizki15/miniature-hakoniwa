import * as THREE from 'three/webgpu';
import { float, fog, packNormalToRGB, rangeFogFactor, unpackRGBToNormal, mix, mrt, normalView, output, pass, sample, uniform, vec4 } from 'three/tsl';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { Fireflies } from './creatures/fireflies';
import { Birds } from './creatures/birds';
import { Ambience } from './audio';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FIREFLIES_ON, RIPPLES, RIPPLES_ON, U, createDetailMaterial, createTerrainMaterial, createWaterMaterial, fireflyData, rippleData } from './render/materials';
import { SAMPLES as QUALITY_SAMPLES, nextQuality } from './render/autoQuality';
import { createDaylight } from './render/daylight';
import { SKY, createPrecipitation, createSkyNode } from './render/sky';
import { SEASON_COLORS, SEASON_NAMES, seasonAt } from './calendar';
import { WEATHER_NAMES, WEATHER_PARAMS, approachWeather, weatherAt, type WeatherKind } from './weather';
import { ACTIVITY_NAMES, type Animal } from './creatures/animals';
import { EcoManager } from './creatures/ecoManager';
import { RARITY_STARS, VISITOR, type DexId, type Moment, type VisitorId } from './eco/species';
import { dexStage } from './eco/dexState';
import { pickNearestOnScreen } from './eco/pick';
import type { Visitor } from './creatures/visitors';
import { renderDex } from './creatures/dex';
import { OldSaveError, SAVE_VERSION, decodeSave, encodeSave, type SaveData } from './save/format';
import { loadLocal, requestPersist, saveLocal } from './save/store';
import { DRIVE_CLIENT_ID, download, remoteInfo, upload } from './save/drive';
import { buildLowPolyFlower } from './creatures/flowers';
import { WATER, isOpaque } from './world/blocks';
import type { TerrainParams, WorldData } from './world/terrain';
import type { InitResult, PlotResult, RemeshResult } from './world/worker';
import { FRAME, PLOT, START_PLOT, boundsOf, canOpen, countOpen, isOpen, openable, plotOfCol, plotRect, rightsLeft } from './world/plots';
import { buildBase, disposeBase } from './render/base';
import { PlotGhosts } from './render/plotGhosts';
import { GameController, TOOLS, type Tool } from './game/controller';
import { parseBuilding, type ParseIssue } from './build/geoParse';
import { buildFixPrompt, buildPrompt } from './build/aiPrompt';
import { LIMITS } from './build/limits';
import { BuildingViewer } from './build/viewer';
import { designStats } from './build/stats';
import { CROPS, CROP_KINDS, type CropKind } from './game/farm';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const WORLD_HEIGHT = 64;
const F_STOPS = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22];


async function main() {
  // ---------- レンダラー ----------
  // ?webgl を付けると WebGL2 で動かす（WebGPU 非対応の端末での動作確認用）
  const forceWebGL = new URLSearchParams(location.search).has('webgl');
  // ?gputime を付けると GPU の処理時間を計測する（計測自体が重くなる環境があるので既定は OFF）
  const trackTimestamp = new URLSearchParams(location.search).has('gputime');
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL, trackTimestamp });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // 表示上の大きさは CSS（100%）に任せる。第 3 引数を false にしないと、最初の大きさが
  // canvas の style に px で固定され、全画面などで大きくなった時に余白（背景色）が出る
  renderer.setSize(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight), false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  await renderer.init();
  const appEl = $('app');
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  appEl.appendChild(renderer.domElement);
  const backendName = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2（フォールバック）';

  // ---------- シーン・カメラ ----------
  const scene = new THREE.Scene();
  // 空：青空と雲、夜は星と流れ星（方向ベースなので見上げても破綻しない）
  scene.backgroundNode = createSkyNode();
  // 空気遠近法：遠くの地形ほど空の色にかすむ（近づいて見渡した時の奥行き感）
  const uFogNear = uniform(200), uFogFar = uniform(800);
  scene.fogNode = fog(SKY.horizon, rangeFogFactor(uFogNear, uFogFar).mul(0.55));

  // 低 FOV の透視投影：ミニチュアらしさと奥行きのバランス
  const camera = new THREE.PerspectiveCamera(28, 1, 0.3, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  // 真上近くから、水平より下（見上げる）まで回せる
  controls.minPolarAngle = THREE.MathUtils.degToRad(5);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(105);
  controls.screenSpacePanning = true; // 右ドラッグで注視点を上下にも動かせる
  controls.zoomToCursor = true; // カーソルの位置に向かってズーム
  controls.autoRotateSpeed = 0.6;

  const daylight = createDaylight(scene);

  // ---------- ポストプロセス：AO（GTAO）→ 被写界深度（画面中央にピント） ----------
  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView) }));
  const color = scenePass.getTextureNode('output');
  const normalTex = scenePass.getTextureNode('normal');
  const depthTex = scenePass.getTextureNode('depth');
  const viewZ = scenePass.getViewZNode();

  const sceneNormal = sample((uv: N) => unpackRGBToNormal((normalTex as N).sample(uv)));
  const aoPass = ao(depthTex, sceneNormal, camera);
  aoPass.resolutionScale = 0.5;
  aoPass.radius.value = 1.6; // ボクセル 1〜2 個分くらいの範囲の隅を暗く
  aoPass.thickness.value = 2;
  aoPass.scale.value = 1.6;
  aoPass.distanceFallOff.value = 1;
  const uAO = uniform(1);
  // GTAO はサンプルのノイズが粒状に見えるので、深度と法線を見ながらぼかして消す
  const aoValue = (denoise(aoPass.getTextureNode(), depthTex, sceneNormal, camera) as N).r;
  const withAO = vec4((color as N).rgb.mul(mix(float(1), aoValue, uAO)), 1);

  const uFocus = uniform(100);
  const uFocal = uniform(30);
  const uBokeh = uniform(1.8);
  const isSky = (depthTex as N).r.greaterThanEqual(0.99999);
  let dofOn = true, aoOn = true, bloomOn = true;
  const updatePost = () => {
    const src: N = aoOn ? withAO : color;
    // 空（背景）はぼかさない：星や雲がくっきり見えるように
    let out: N = dofOn ? isSky.select(src, dof(src, viewZ, uFocus, uFocal, uBokeh)) : src;
    // ブルーム：明るい所（ホタル・太陽の照り返し）がにじんで光る
    if (bloomOn) out = out.add(bloom(out, 0.45, 0.4, 0.9));
    pipeline.outputNode = out;
    pipeline.needsUpdate = true;
  };
  updatePost();

  // ---------- 箱庭 ----------
  const waterMat = createWaterMaterial();
  const detailMat = createDetailMaterial();
  const flowerMat = createDetailMaterial(0.12); // 花は背が低いので高さに比例して揺らす
  const buildingMat = createDetailMaterial(0, { sway: false }); // 建物は風で揺らさない
  const lowPolyFlowers = [0, 1, 2].map((v) => buildLowPolyFlower(v));
  let precip: { rain: THREE.InstancedMesh; snow: THREE.InstancedMesh } | null = null;
  const rainAmount = uniform(0);
  const snowAmount = uniform(0);
  let terrainMat: THREE.MeshStandardNodeMaterial | null = null;
  let typeTex: THREE.Data3DTexture | null = null;
  const diorama = new THREE.Group();
  scene.add(diorama);
  const fireflies = new Fireflies();
  const birds = new Birds();
  scene.add(fireflies.mesh, birds.group);
  const ambience = new Ambience();
  let liteTerrain = false;
  let world: WorldData | null = null;
  let info = '';

  const worker = new Worker(new URL('./world/worker.ts', import.meta.url), { type: 'module' });
  const busy = document.createElement('div');
  busy.id = 'busy';
  busy.textContent = '生成中…';
  $('stage').appendChild(busy);

  // 触れる・育つ要素（道具・畑・植林・地形の編集）
  const game = new GameController({ diorama, worker, waterMat, detailMat, flowerMat, buildingMat });
  // 生き物（住人・訪問者・図鑑・来るかどうかの判定）
  const eco = new EcoManager({
    diorama, envInput: () => game.envInput(), toast: (m, ms) => toast(m, ms), fireflies, treeShape: (c) => game.treeShape(c),
    onChanged: () => { game.unsaved = true; refreshDex(); },
  });
  game.onEnvChanged = () => eco.envDirty();
  let onGenerated: ((r: InitResult) => void) | null = null;
  const onPlot = (r: PlotResult) => {
    game.addPlot(r);
    progress.rightsUsed++;
    game.unsaved = true;
    opening = false;
    openingDone = null;
    refreshGhosts();
    toast('新しい土地が開きました');
    plotResolve?.();
    plotResolve = null;
  };
  /** 箱庭を作るたびに増える番号。作り直しの最中に届いた、古い箱庭あての返事は捨てる */
  let gen = 0;
  worker.onmessage = (e: MessageEvent<InitResult | PlotResult | RemeshResult>) => {
    if (e.data.gen !== gen) return;
    if (e.data.type === 'remesh') game.onRemesh(e.data.chunks);
    else if (e.data.type === 'plot') onPlot(e.data);
    else onGenerated?.(e.data);
  };
  // 進み具合（発見ポイントと土地の権利）。段階 ② ③ で図鑑・解放につなぐ
  let progress: SaveData['progress'] = { points: 0, rightsUsed: 0, unlocks: [], firsts: [], newMarks: [] };
  let base: THREE.Group | null = null;
  // エディタモードで、開ける隣の区画を半透明の枠で見せる
  const ghosts = new PlotGhosts();
  scene.add(ghosts.group);
  /** 区画を開いている途中（ワーカーの返事待ち）。素早く 2 回押しても 1 回だけ開く */
  let opening = false;
  const rights = () => Math.max(0, rightsLeft(progress.points, progress.rightsUsed) - (opening ? 1 : 0));
  /** 開いた区画の地面の平均の高さ（枠を置く高さの目安） */
  const groundOf = (plot: number) => {
    const w = world!;
    let sum = 0, n = 0;
    for (let p = 0; p < 16; p++) {
      if (!isOpen(w.plots, p) || Math.abs((p % 4) - (plot % 4)) + Math.abs(Math.floor(p / 4) - Math.floor(plot / 4)) !== 1) continue;
      const r = plotRect(p);
      for (let z = r.z0; z < r.z1; z += 4) for (let x = r.x0; x < r.x1; x += 4) { sum += Math.max(w.heights[x + z * FRAME], w.waterLevel); n++; }
    }
    return n ? sum / n : w.waterLevel;
  };
  const refreshGhosts = () => { if (world) ghosts.update(world.plots, rights(), groundOf); };
  let plotResolve: (() => void) | null = null;
  /** 開いている途中の区画（作り直す前に、開き終わるのを待つ） */
  let openingDone: Promise<void> | null = null;
  /** 区画を開く（権利を 1 つ使う）。開けない時は理由を返す */
  const openPlot = (plot: number): Promise<void> | string => {
    if (!world) return '';
    if (game.locked) return 'いま箱庭を作っています';
    if (opening) return 'いま土地を開いています';
    if (!canOpen(world.plots, plot, rights())) return rights() > 0 ? 'この土地はまだ開けません' : '土地の権利が足りません';
    // 権利は開き終わった時（onPlot）に使う。それまでは rights() で 1 つ引いておく（途中で保存しても食い違わないように）
    opening = true;
    // 先に、まだ送っていない編集をワーカーに渡してから区画を足す（境目のチャンクが古い地形で作られないように）
    game.sendDeltaNow();
    const edits: number[] = [];
    for (const [i, t] of game.edits) { const c = i % (FRAME * FRAME); if (plotOfCol(c % FRAME, Math.floor(c / FRAME)) === plot) edits.push(i, t); }
    worker.postMessage({ type: 'addPlot', gen, plot, edits });
    openingDone = new Promise<void>((res) => { plotResolve = res; });
    return openingDone;
  };

  const clearDiorama = () => {
    diorama.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        if (!o.userData.sharedGeometry) o.geometry.dispose();
        if (o.userData.ownMaterial) (o.material as THREE.Material).dispose();
      }
    });
    diorama.clear();
  };

  const startWorld = (seed: number, detail: number, params: TerrainParams, flowerStyle: string, plots: number, edits?: number[]) =>
    new Promise<void>((resolve) => {
      busy.style.display = 'grid';
      gen++;
      game.locked = true;
      // 開いている途中だった区画は、古い箱庭あてなので取りやめる（権利は使っていない）
      if (opening) { opening = false; plotResolve?.(); plotResolve = null; openingDone = null; }
      onGenerated = (res: InitResult) => {
        const { world: w, chunks, models, placements, counts, timings } = res;
        world = w;
        clearDiorama();

        // ボクセルの種類を 3D テクスチャに（幅 = X, 高さ = Z, 奥行き = Y）
        typeTex?.dispose();
        typeTex = new THREE.Data3DTexture(w.voxels, w.size, w.size, w.height);
        typeTex.format = THREE.RedFormat;
        typeTex.type = THREE.UnsignedByteType;
        typeTex.minFilter = typeTex.magFilter = THREE.NearestFilter;
        typeTex.unpackAlignment = 1;
        typeTex.needsUpdate = true;
        terrainMat?.dispose();
        terrainMat = createTerrainMaterial(typeTex, w.size, w.height, liteTerrain);

        // 地形（チャンクごと）・木・花。ローポリの花はボクセルの花が作れない 1/1 でも使う
        const hasVoxelFlowers = models.some((d) => d.kind === 'flower');
        game.load(w, chunks, models, placements, flowerStyle === 'lowpoly' || !hasVoxelFlowers ? lowPolyFlowers : null, typeTex, terrainMat);
        game.onPlotsChanged = () => applyBounds(false);
        // ほかの区画がまだせり上がっている時は、全部そろってから足す（途中の区画に置くと浮いて見える）
        game.onPlotRisen = () => { if (!game.isRising()) fillCreatures(); };
        game.gen = res.gen;
        game.locked = false;

        U.waterLevel.value = w.waterLevel;
        U.worldSize.value = w.size;
        U.detail.value = detail;
        controls.minDistance = 3;
        applyBounds(true);
        eco.reset(w, game.farm.simMs);

        info = `チャンク ${chunks.length} · 木 ${counts.trees} · 花 ${counts.flowers}<br>` +
          `生成 ${timings.generate.toFixed(0)}ms / 地形メッシュ ${timings.mesh.toFixed(0)}ms / 小物 ${timings.details.toFixed(0)}ms`;
        busy.style.display = 'none';
        resolve();
      };
      worker.postMessage({ type: 'init', gen, height: WORLD_HEIGHT, seed, detail, params, plots, edits });
    });

  /**
   * 開いた区画の範囲に合わせて、台座・雨と雪・動物・ホタル・鳥・カメラの範囲を直す。
   * first：箱庭を作った時（カメラを置き直す）。区画を開いた時は false（今の視点のまま）
   */
  let bounds = boundsOf(1 << START_PLOT);
  /** 開いた範囲の大きさ（縦横の大きい方） */
  let extent = 64;
  /** ホタルのすみかを開いた範囲に合わせる（住人は引っ越しで増える。区画を開いても増やさない） */
  const fillCreatures = () => { fireflies.setWorld(world!); };

  const applyBounds = (first: boolean) => {
    const w = world!;
    bounds = boundsOf(w.plots);
    extent = Math.max(bounds.w, bounds.d);
    const cx = bounds.cx - FRAME / 2, cz = bounds.cz - FRAME / 2;

    if (base) disposeBase(base);
    base = buildBase(w.plots);
    diorama.add(base);

    // 雨・雪（開いた範囲の上だけに降らせる）
    if (precip) {
      for (const m of [precip.rain, precip.snow]) { scene.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    }
    precip = { rain: createPrecipitation('rain', extent, rainAmount), snow: createPrecipitation('snow', extent, snowAmount) };
    precip.rain.position.set(cx, 0, cz);
    precip.snow.position.set(cx, 0, cz);
    scene.add(precip.rain, precip.snow);

    // 動物・ホタルは、区画を開いた時はせり上がりきってから足す（onPlotRisen）
    if (first) fillCreatures();
    let maxH = 0; for (let i = 0; i < w.heights.length; i++) maxH = Math.max(maxH, w.heights[i]);
    birds.setWorld({ cx, cz, extent }, maxH);
    refreshGhosts();

    // カメラの距離を開いた範囲に合わせる（近づいて見上げられるよう最短距離は小さめ）
    camera.far = Math.max(512, extent * 8);
    camera.updateProjectionMatrix();
    controls.maxDistance = extent * 3.2;
    if (first) {
      // 縦長の画面（スマホ）では横幅に収まるよう遠めから
      const r = extent * 2.3 * Math.max(1, 1.1 / camera.aspect);
      controls.target.set(cx, 10, cz);
      camera.position.set(cx + r * 0.62, r * 0.55, cz + r * 0.62);
    }
  };

  // ---------- 画面中央の奥行き（ボクセルのレイマーチ） ----------
  const centerDepth = (): number | null => {
    if (!world) return null;
    const N = world.size, H = world.height, half = N / 2;
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const o = camera.position.clone().add(new THREE.Vector3(half, 0, half));
    // 箱との交差区間
    let t0 = 0, t1 = 1e9;
    const lo = [0, 0, 0], hi = [N, H, N];
    const oa = [o.x, o.y, o.z], da = [dir.x, dir.y, dir.z];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(da[a]) < 1e-9) { if (oa[a] < lo[a] || oa[a] > hi[a]) return null; continue; }
      let ta = (lo[a] - oa[a]) / da[a], tb = (hi[a] - oa[a]) / da[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    }
    if (t0 > t1) return null;
    const p = [oa[0] + da[0] * (t0 + 1e-4), oa[1] + da[1] * (t0 + 1e-4), oa[2] + da[2] * (t0 + 1e-4)];
    const cell = p.map((v, a) => Math.min(hi[a] - 1, Math.max(0, Math.floor(v))));
    const stepA = da.map((v) => (v > 0 ? 1 : -1));
    const tMax = da.map((v, a) => (Math.abs(v) < 1e-9 ? 1e9 : t0 + ((v > 0 ? cell[a] + 1 : cell[a]) - p[a]) / v));
    const tDelta = da.map((v) => (Math.abs(v) < 1e-9 ? 1e9 : Math.abs(1 / v)));
    let t = t0;
    for (let i = 0; i < N * 4; i++) {
      const v = world.voxels[cell[0] + cell[2] * N + cell[1] * N * N];
      if (isOpaque(v) || v === WATER) return t;
      const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
      t = tMax[a];
      cell[a] += stepA[a];
      if (cell[a] < 0 || cell[a] >= hi[a]) return null;
      tMax[a] += tDelta[a];
    }
    return null;
  };

  // ---------- 波紋 ----------
  let rippleIdx = 0;
  const addRipple = (x: number, z: number, strength: number) => {
    rippleData[rippleIdx].set(x, z, U.now.value, strength);
    rippleIdx = (rippleIdx + 1) % RIPPLES;
  };
  const isWaterAt = (wx: number, wz: number) => {
    if (!world) return false;
    const N = world.size;
    const x = Math.floor(wx + N / 2), z = Math.floor(wz + N / 2);
    if (x < 0 || z < 0 || x >= N || z >= N) return false;
    return world.voxels[x + z * N + (world.waterLevel - 1) * N * N] === WATER;
  };
  // ---------- モードと道具 ----------
  type Mode = 'view' | 'edit';
  let mode: Mode = 'view';
  const toolsEl = $('tools'), seedsEl = $('seeds'), hintEl = $('toolHint'), toastEl = $('toast'), tooltipEl = $('tooltip');
  let toastTimer = 0;
  const toast = (msg: string, ms = 1600) => {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), ms);
  };

  // エディタの道具一覧（「見る」はモードで切り替えるので除く）
  const EDIT_TOOLS = TOOLS.filter((t) => t.id !== 'look');
  let editTool: Tool = 'till';
  const toolButtons = new Map<Tool, HTMLButtonElement>();
  for (const t of EDIT_TOOLS) {
    const b = document.createElement('button');
    b.innerHTML = `<span class="ic">${t.icon}</span><span>${t.name}</span><span class="k">${t.key}</span><span class="d">${t.help}</span>`;
    b.addEventListener('click', () => selectTool(t.id));
    toolsEl.appendChild(b);
    toolButtons.set(t.id, b);
  }
  const CROP_ICONS: Record<CropKind, string> = { turnip: '🥬', wheat: '🌾', pumpkin: '🎃' };
  const renderSeeds = () => {
    seedsEl.innerHTML = '';
    for (const k of CROP_KINDS) {
      const b = document.createElement('button');
      b.innerHTML = `${CROP_ICONS[k]} ${CROPS[k].name}<span class="k">${CROPS[k].hours}時間</span>`;
      b.classList.toggle('on', game.seed === k);
      b.addEventListener('click', () => { game.seed = k; renderSeeds(); if (mode === 'edit') selectTool('seed'); });
      seedsEl.appendChild(b);
    }
  };
  renderSeeds();
  const selectTool = (t: Tool) => {
    if (t === 'look') { setMode('view'); return; }
    editTool = t;
    if (mode !== 'edit') setMode('edit');
    game.tool = t;
    for (const [id, b] of toolButtons) b.classList.toggle('on', id === t);
    hintEl.textContent = TOOLS.find((x) => x.id === t)!.help;
    renderShelf();
  };

  // ---------- 建物の棚と読み込み ----------
  // 読み込んだ建物の名前や問題の文は、すべて textContent で出す（HTML として読ませない）
  const shelfEl = $('shelf');
  const issuesBox = $('buildIssues'), issueList = $('buildIssueList');
  let lastIssues: ParseIssue[] = [];
  const copyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast('コピーしました'); } catch { toast('コピーできませんでした'); }
  };
  function renderShelf() {
    shelfEl.replaceChildren();
    for (const d of game.designs.values()) {
      const item = document.createElement('span');
      item.className = 'shelf-item';
      const b = document.createElement('button');
      b.textContent = `🏠 ${d.name}`;
      b.classList.toggle('on', game.selectedDesign === d.id && game.tool === 'build');
      b.addEventListener('click', () => { game.selectedDesign = d.id; selectTool('build'); });
      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '×';
      del.title = '棚から消す（置いた分も消えます）';
      del.addEventListener('click', () => {
        if (!confirm(`「${d.name}」を棚から消しますか？ 箱庭に置いた分も消えます。`)) return;
        game.removeDesign(d.id);
        renderShelf();
      });
      item.append(b, del);
      shelfEl.appendChild(item);
    }
  }
  const showIssues = (issues: ParseIssue[]) => {
    lastIssues = issues;
    issueList.replaceChildren(...issues.map((i) => { const li = document.createElement('li'); li.textContent = i.message; return li; }));
    issuesBox.hidden = issues.length === 0;
  };
  const importBuilding = (text: string) => {
    const r = parseBuilding(text);
    if (!r.ok) { showIssues(r.issues); toast(`読み込めませんでした（問題 ${r.issues.length} 件）`); return; }
    showIssues([]);
    const added = game.addDesign(r.design) === 'added';
    toast(added ? `「${r.design.name}」を棚に入れました` : '同じ建物がもう棚にあります');
    game.selectedDesign = r.design.id;
    selectTool('build');
  };
  $('buildCopyPrompt').addEventListener('click', () => copyText(buildPrompt($<HTMLTextAreaElement>('buildIdea').value)));
  $('buildCopyFix').addEventListener('click', () => copyText(buildFixPrompt(lastIssues)));
  $('buildLoad').addEventListener('click', () => {
    const ta = $<HTMLTextAreaElement>('buildPaste');
    if (!ta.value.trim()) { toast('AI の返事や .geo.json の中身を貼ってください'); return; }
    importBuilding(ta.value);
  });
  const readFile = async (f: File) => {
    if (f.size > LIMITS.fileBytes * 4) { showIssues([{ code: 'file_size', message: `ファイルが ${Math.ceil(f.size / 1024)} KB あります。${LIMITS.fileBytes / 1024} KB 以下にしてください。` }]); return; }
    importBuilding(await f.text());
  };
  $<HTMLInputElement>('buildFile').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) void readFile(f);
  });
  // 箱庭の画面に .geo.json を落としても読み込む（エディタのとき）
  const layoutDrop = $('layout');
  layoutDrop.addEventListener('dragover', (e) => {
    if (mode !== 'edit' || !e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    layoutDrop.classList.add('drop-target');
  });
  layoutDrop.addEventListener('dragleave', () => layoutDrop.classList.remove('drop-target'));
  layoutDrop.addEventListener('drop', (e) => {
    layoutDrop.classList.remove('drop-target');
    const f = e.dataTransfer?.files[0];
    if (mode !== 'edit' || !f) return;
    e.preventDefault();
    void readFile(f);
  });
  renderShelf();

  // ---------- 建物の棚のビューワー（エディタの「建物」欄から開く窓） ----------
  const viewerEl = $('viewer');
  const viewerList = $('viewerList');
  let viewer: BuildingViewer | null = null;
  let viewerSel: string | null = null;
  const viewerIsOpen = () => viewerEl.classList.contains('open');
  const renderViewer = () => {
    const designs = [...game.designs.values()];
    if (!viewerSel || !game.designs.has(viewerSel)) viewerSel = game.selectedDesign && game.designs.has(game.selectedDesign) ? game.selectedDesign : designs[0]?.id ?? null;
    viewerList.replaceChildren(...designs.map((d) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `🏠 ${d.name}`;
      b.title = d.name;
      b.classList.toggle('on', d.id === viewerSel);
      b.addEventListener('click', () => { viewerSel = d.id; renderViewer(); });
      li.appendChild(b);
      return li;
    }));
    const d = viewerSel ? game.designs.get(viewerSel)! : null;
    $('viewerEmpty').hidden = !!d;
    $('viewerName').textContent = d ? d.name : '';
    $('viewerStats').textContent = d ? designStats(d).label : '';
    $<HTMLButtonElement>('viewerPlace').disabled = !d;
    $<HTMLButtonElement>('viewerDelete').disabled = !d;
    viewer?.show(d);
  };
  const setViewer = async (open: boolean) => {
    viewerEl.classList.toggle('open', open);
    viewerEl.setAttribute('aria-hidden', String(!open));
    if (!open) { viewer?.close(); return; }
    viewer ??= new BuildingViewer($<HTMLCanvasElement>('viewerCanvas'), forceWebGL);
    await viewer.open();
    renderViewer();
  };
  $('openViewer').addEventListener('click', () => void setViewer(true));
  $('viewerClose').addEventListener('click', () => void setViewer(false));
  viewerEl.addEventListener('pointerdown', (e) => { if (e.target === viewerEl) void setViewer(false); });
  $('viewerPlace').addEventListener('click', () => {
    if (!viewerSel) return;
    game.selectedDesign = viewerSel;
    void setViewer(false);
    selectTool('build');
    toast('置く場所をクリックしてください（R で向きを変える）');
  });
  $('viewerDelete').addEventListener('click', () => {
    const d = viewerSel ? game.designs.get(viewerSel) : undefined;
    if (!d || !confirm(`「${d.name}」を棚から消しますか？ 箱庭に置いた分も消えます。`)) return;
    game.removeDesign(d.id);
    viewerSel = null;
    renderShelf();
    renderViewer();
  });

  const layoutEl = $('layout');
  const modeButtons = document.querySelectorAll<HTMLButtonElement>('#modes button[data-mode]');
  const setMode = (m: Mode) => {
    mode = m;
    layoutEl.classList.remove('mode-view', 'mode-edit');
    layoutEl.classList.add(`mode-${m}`);
    modeButtons.forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    // エディタでは左ドラッグを道具に使う（視点は右ドラッグで回す）
    controls.mouseButtons = m === 'edit'
      ? { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE } as unknown as typeof controls.mouseButtons
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    game.tool = m === 'edit' ? editTool : 'look';
    if (m === 'edit') selectTool(editTool);
    game.cursor.visible = false;
    tooltipEl.style.display = 'none';
    pinned = null;
    ghosts.group.visible = m === 'edit';
    ghosts.setHover(-1);
    if (m === 'view') refreshDex();
  };
  modeButtons.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode as Mode)));

  // Esc メニュー：画面全体をすりガラスにして、保存などのメニューを出す
  const menuEl = $('menu');
  const menuOpen = () => menuEl.classList.contains('open');
  const setMenu = (open: boolean) => {
    menuEl.classList.toggle('open', open);
    menuEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      stroke = null;
      game.endEdit();
      tooltipEl.style.display = 'none';
      game.cursor.visible = false;
      showSaveStatus();
    }
  };
  $('menuOpen').addEventListener('click', () => setMenu(true));
  $('menuClose').addEventListener('click', () => setMenu(false));
  // 全画面表示（Fullscreen API）。ブラウザの Esc などで抜けた時もスイッチの表示を合わせる
  const fsBtn = $<HTMLButtonElement>('fullscreen');
  const fsSupported = !!document.fullscreenEnabled && !!document.documentElement.requestFullscreen;
  const syncFullscreen = () => fsBtn.setAttribute('aria-checked', document.fullscreenElement ? 'true' : 'false');
  if (!fsSupported) {
    fsBtn.disabled = true;
    $('fullscreenNote').textContent = 'このブラウザでは使えません（iPhone の Safari など）';
  }
  fsBtn.addEventListener('click', async () => {
    // 埋め込みの画面などでは、要求が成功も失敗もせず止まることがあるので時間を区切る
    const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 1500));
    try {
      const req = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      if ((await Promise.race([req, timeout])) === 'timeout' && !document.fullscreenElement) toast('この画面では全画面にできませんでした（ブラウザの設定や埋め込み表示のため）', 3500);
    } catch {
      toast('全画面にできませんでした', 2500);
    }
    syncFullscreen();
  });
  document.addEventListener('fullscreenchange', syncFullscreen);

  // パネルの外（すりガラスの部分）を押しても閉じる
  menuEl.addEventListener('pointerdown', (e) => { if (e.target === menuEl) setMenu(false); });

  /** 押している移動キー（WASD・Space・Shift）。e.code で見るので、日本語入力中でも効く */
  const moveKeys = new Set<string>();
  const MOVE_CODES = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight'];
  window.addEventListener('keyup', (e) => moveKeys.delete(e.code));
  window.addEventListener('blur', () => moveKeys.clear());
  window.addEventListener('keydown', (e) => {
    if (viewerIsOpen()) { if (e.key === 'Escape') void setViewer(false); return; } // 棚を見ている間は、Esc で閉じるだけ
    if (e.key === 'Escape') { setMenu(!menuOpen()); return; }
    if (menuOpen()) return; // メニューを開いている間は他のキーを受け付けない
    if ((e.target as HTMLElement).closest?.('input[type="text"], input[type="number"], textarea, select')) return;
    // Ctrl+Z（Mac は ⌘Z）：エディタで、最後の編集を取り消す。押した位置（e.code）で見るので日本語入力中でも効く
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyZ') {
      e.preventDefault();
      if (mode !== 'edit' || stroke) return;
      toast(game.undoLast() ?? '取り消せる編集がありません');
      return;
    }
    if (MOVE_CODES.includes(e.code)) {
      moveKeys.add(e.code);
      // Space でボタンが押されたり、ページが動いたりしないように
      if (e.code === 'Space') e.preventDefault();
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'v') setMode('view');
    else if (k === 'e') setMode('edit');
    else if (k === 'r' && mode === 'edit' && game.tool === 'build') game.rotateBuild(); // 次に置く建物の向き（カーソルの枠は毎フレーム作り直す）
    else {
      const t = EDIT_TOOLS.find((x) => x.key === e.key);
      if (t) selectTool(t.id);
    }
  });

  // マウスの位置から光線を作る
  const mouse = new THREE.Vector2(), raycaster = new THREE.Raycaster();
  const mousePx = { x: 0, y: 0 };
  let mouseInside = false;
  const setMouse = (clientX: number, clientY: number) => {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    mousePx.x = clientX - rect.left; mousePx.y = clientY - rect.top;
  };
  const pickAtMouse = () => {
    raycaster.setFromCamera(mouse, camera);
    return game.pick(raycaster.ray.origin, raycaster.ray.direction);
  };
  /**
   * マウスの先にある「開ける区画の枠」（地形の方が手前なら -1）と、地形の当たり。
   * 地形の当たりはカーソルにも使うので、1 回だけ求めて返す
   */
  const ghostAtMouse = () => {
    const hit = pickAtMouse();
    if (mode !== 'edit' || !world) return { plot: -1, hit };
    const plot = ghosts.pick(raycaster.ray);
    // 開いた区画の地形に当たっているなら、そちらを優先する
    const terrainFirst = hit && plotOfCol(hit.x, hit.z) !== plot && isOpen(world.plots, plotOfCol(hit.x, hit.z));
    return { plot: plot < 0 || terrainFirst ? -1 : plot, hit };
  };

  // エディタ：左ドラッグでなぞった所にまとめて道具を使う（同じ列は 1 回だけ）
  let stroke: { visited: Set<number>; last: { x: number; y: number }; done: number; msg: string | null } | null = null;
  const applyStroke = (msg: string | null) => {
    if (!stroke || !msg) return;
    stroke.msg = msg;
    if (/した$/.test(msg)) stroke.done++;
  };
  const strokeAt = (cx: number, cy: number) => {
    if (!stroke) return;
    // 前の位置から今の位置まで、数ピクセルおきに調べる（速く動かしても抜けないように）
    const dx = cx - stroke.last.x, dy = cy - stroke.last.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 4));
    const from = stroke.last;
    for (let i = 1; i <= steps; i++) {
      setMouse(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
      applyStroke(game.use(pickAtMouse(), stroke.visited));
    }
    stroke.last = { x: cx, y: cy };
  };

  let downAt: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    downAt = { x: e.clientX, y: e.clientY };
    if (mode === 'edit' && e.button === 0 && world) {
      setMouse(e.clientX, e.clientY);
      const { plot } = ghostAtMouse();
      if (plot >= 0) {
        const r = openPlot(plot);
        if (typeof r === 'string') { if (r) toast(r); }

        return;
      }
      stroke = { visited: new Set(), last: { x: e.clientX, y: e.clientY }, done: 0, msg: null };
      game.beginEdit(TOOLS.find((x) => x.id === game.tool)!.name); // 1 回のなぞりを、取り消し（Ctrl+Z）の 1 つにする
      setMouse(e.clientX, e.clientY);
      applyStroke(game.use(pickAtMouse(), stroke.visited));
      try { renderer.domElement.setPointerCapture(e.pointerId); } catch { /* 合成イベントなどで失敗しても続ける */ }
    }
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    mouseInside = true;
    if (stroke) strokeAt(e.clientX, e.clientY);
    setMouse(e.clientX, e.clientY);
  });
  renderer.domElement.addEventListener('pointerleave', () => { mouseInside = false; game.cursor.visible = false; tooltipEl.style.display = 'none'; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (stroke) {
      // 複数マスに使った時はまとめて知らせる
      if (stroke.done > 1) toast(`${stroke.done} マスに「${TOOLS.find((x) => x.id === game.tool)!.name}」を使いました`);
      else if (stroke.msg) toast(stroke.msg);
      stroke = null;
      game.endEdit();
      return;
    }
    // エディタ：建物を右クリック（ドラッグで回した時は除く）すると、壊すかどうか聞く
    if (mode === 'edit' && e.button === 2 && downAt && world && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) <= 5) {
      setMouse(e.clientX, e.clientY);
      raycaster.setFromCamera(mouse, camera);
      const b = game.buildingAtRay(raycaster.ray.origin, raycaster.ray.direction);
      if (b && confirm(`「${b.name}」を壊しますか？（Ctrl+Z で元に戻せます）`)) {
        game.beginEdit('建物を壊す');
        const msg = game.removeBuildingAt(b.index);
        game.endEdit();
        if (msg) toast(msg);
      }
      return;
    }
    if (!downAt || !world || e.button !== 0 || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
    // 見る・ステータス：水面をクリックすると波紋
    setMouse(e.clientX, e.clientY);
    raycaster.setFromCamera(mouse, camera);
    const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(world.waterLevel - 0.15)), new THREE.Vector3());
    if (hit && isWaterAt(hit.x, hit.z)) addRipple(hit.x, hit.z, 1);
  });

  // 見るモード：作物・動物にホバーすると情報を小さく出す。右クリックで固定（他の所を触るまで）
  type Target = { kind: 'animal'; animal: Animal } | { kind: 'crop'; col: number } | { kind: 'visitor'; visitor: Visitor } | { kind: 'firefly'; pos: THREE.Vector3 };
  let pinned: Target | null = null;
  /** 同じ対象か（観察の時間を続けて数えるかどうかにも使う。ホタルはどの粒でも同じ） */
  const targetKey = (t: Target | null) =>
    !t ? '' : t.kind === 'animal' ? `a${t.animal.id}` : t.kind === 'crop' ? `c${t.col}` : t.kind === 'visitor' ? `v${t.visitor.def.id}` : 'firefly';
  const sameTarget = (a: Target | null, b: Target | null) => !!a && !!b && targetKey(a) === targetKey(b);
  /** 図鑑の対象（作物は対象外） */
  const dexIdOf = (t: Target | null): DexId | null =>
    !t ? null : t.kind === 'animal' ? t.animal.species : t.kind === 'visitor' ? t.visitor.def.id : t.kind === 'firefly' ? 'firefly' : null;
  const tmpP = new THREE.Vector3();
  /** 画面上でマウスから 28px 以内の訪問者・ホタル（小さく速いので、レイではなく画面の距離で選ぶ） */
  const visitorAtMouse = (): Target | null => {
    const r = renderer.domElement.getBoundingClientRect();
    const pts: { x: number; y: number; id: number }[] = [];
    const toScreen = (p: THREE.Vector3, id: number) => {
      tmpP.copy(p).project(camera);
      if (tmpP.z < 1) pts.push({ x: (tmpP.x + 1) / 2 * r.width, y: (1 - tmpP.y) / 2 * r.height, id });
    };
    eco.visitors.forEach((v, i) => { if (v.def.motion !== 'glow') toScreen(v.anchor, i); });
    const flies = eco.visitors.some((v) => v.def.id === 'firefly') ? fireflies.positions() : [];
    flies.forEach((p, i) => toScreen(p, 1000 + i));
    const id = pickNearestOnScreen(pts, mousePx.x, mousePx.y);
    if (id === null) return null;
    return id >= 1000 ? { kind: 'firefly', pos: flies[id - 1000] } : { kind: 'visitor', visitor: eco.visitors[id] };
  };

  /** マウスの下にある作物か動物（地面などは対象外） */
  const targetAtMouse = (): Target | null => {
    if (!world) return null;
    const vt = visitorAtMouse();
    if (vt) return vt;
    raycaster.setFromCamera(mouse, camera);
    const voxelHit = game.pick(raycaster.ray.origin, raycaster.ray.direction);
    const animalHit = raycaster.intersectObjects(eco.animals.map((a) => a.object), true)[0];
    if (animalHit && (!voxelHit || animalHit.distance < voxelHit.t + 0.5)) {
      let o: THREE.Object3D | null = animalHit.object;
      while (o && !o.userData.animal) o = o.parent;
      if (o) return { kind: 'animal', animal: o.userData.animal as Animal };
    }
    const col = game.cropColAt(voxelHit);
    return col !== null ? { kind: 'crop', col } : null;
  };

  /** 観察の進み具合の輪（まだ観察していない生き物にカーソルを合わせている間） */
  const ringHtml = (t: Target) => {
    const id = dexIdOf(t);
    if (!id || !eco.needsObserving(id, lastMoment.season)) return '';
    const k = observing && observing.key === targetKey(t) ? Math.min(1, observing.t / OBSERVE_SECONDS) : 0;
    return `<div class="tt-observe"><span class="ring" style="--p:${(k * 100).toFixed(0)}%"></span>観察中…</div>`;
  };
  const targetHtml = (t: Target): string | null => {
    if (t.kind === 'animal') {
      const a = t.animal, info = a.info;
      return `<div class="tt-title">${info.icon} ${a.name}</div><div class="tt-sub">${info.name}</div>` +
        `<div class="tt-line">いま：${ACTIVITY_NAMES[a.activity]}</div><div class="tt-line">好きなもの：${a.favorite}</div><div class="tt-line">得意：${info.skill}</div>` + ringHtml(t);
    }
    if (t.kind === 'visitor' || t.kind === 'firefly') {
      // 去った訪問者・消えたホタルは対象から外す
      if (t.kind === 'visitor' && !eco.visitors.includes(t.visitor)) return null;
      if (t.kind === 'firefly' && !eco.visitors.some((v) => v.def.id === 'firefly')) return null;
      const def = VISITOR[t.kind === 'visitor' ? t.visitor.def.id : 'firefly'];
      const stage = dexStage(eco.dex, def.id);
      if (stage !== 'observed') {
        return `<div class="tt-title">？？？</div><div class="tt-sub">${def.hint}</div>` + ringHtml(t);
      }
      return `<div class="tt-title">${def.icon} ${def.name}</div><div class="tt-sub">${RARITY_STARS[def.rarity]}</div><div class="tt-line">${def.note}</div>` + ringHtml(t);
    }
    const d = game.describeCrop(t.col, lastEnv);
    if (!d) return null;
    return `<div class="tt-title">${CROP_ICONS[game.farm.crops.get(t.col)!.kind]} ${d.title}</div>` + d.lines.map((l) => `<div class="tt-line">${l}</div>`).join('') +
      `<div class="bar"><i style="width:${Math.round(d.progress * 100)}%"></i></div>`;
  };

  const targetWorldPos = (t: Target) =>
    t.kind === 'animal' ? t.animal.object.position.clone().add(new THREE.Vector3(0, 1.2, 0))
      : t.kind === 'visitor' ? t.visitor.anchor.clone() : t.kind === 'firefly' ? t.pos.clone() : game.colTop(t.col).add(new THREE.Vector3(0, 0.4, 0));

  /** 観察：同じ生き物にカーソルを 1.5 秒合わせ続けると図鑑に「観察した」と載る */
  const OBSERVE_SECONDS = 1.5;
  let observing: { key: string; t: number } | null = null;
  let hoverTarget: Target | null = null;
  const updateObserve = (dt: number) => {
    const t = mode === 'view' ? hoverTarget : null;
    const id = dexIdOf(t);
    if (!t || !id || !eco.needsObserving(id, lastMoment.season)) { observing = null; return; }
    const key = targetKey(t);
    if (!observing || observing.key !== key) observing = { key, t: 0 };
    observing.t += dt;
    if (observing.t >= OBSERVE_SECONDS) {
      observing = null;
      const pts = eco.observe(id, lastMoment.season);
      if (pts > 0) { progress.points += pts; refreshGhosts(); }
    }
  };

  const statusCursorColor = new THREE.Color(0x7fd3ff);
  const tmpV = new THREE.Vector3();
  const updateHover = () => {
    if (mode !== 'view' || !world) { hoverTarget = null; return; }
    // 固定表示が優先。対象が消えたら（収穫など）固定をやめる
    if (pinned && !targetHtml(pinned)) pinned = null;
    const t = pinned ?? (mouseInside ? targetAtMouse() : null);
    hoverTarget = t;
    const html = t ? targetHtml(t) : null;
    if (!t || !html) { tooltipEl.style.display = 'none'; game.cursor.visible = false; return; }
    tooltipEl.innerHTML = (pinned ? '<span class="pin">📌 固定中</span>' : '') + html;
    tooltipEl.classList.toggle('pinned', !!pinned);
    tooltipEl.style.display = 'block';
    // 作物のマスは水色の枠で示す
    if (t.kind === 'crop') {
      game.cursor.visible = true;
      game.cursor.position.copy(game.colTop(t.col)).add(tmpV.set(0, -0.5, 0));
      game.cursor.scale.set(1, 1, 1); // 「建物を置く」で建物の大きさにした枠を、1 マスに戻す
      (game.cursor.material as THREE.LineBasicMaterial).color.copy(statusCursorColor);
    } else game.cursor.visible = false;
    // 位置：固定中は対象の横（動物は動くのでついていく）、ホバー中はマウスの横
    let px = mousePx.x, py = mousePx.y;
    if (pinned) {
      const v = targetWorldPos(pinned).project(camera);
      px = (v.x + 1) / 2 * appEl.clientWidth;
      py = (1 - v.y) / 2 * appEl.clientHeight;
    }
    const w = tooltipEl.offsetWidth, h = tooltipEl.offsetHeight;
    tooltipEl.style.left = `${Math.max(8, Math.min(appEl.clientWidth - w - 8, px + 16))}px`;
    tooltipEl.style.top = `${Math.max(8, Math.min(appEl.clientHeight - h - 8, py + 16))}px`;
  };

  // 短い右クリック（ドラッグではない時）だけで固定・解除する。左クリックでは変わらない
  //   作物・動物の上 → その情報を固定（固定中の物なら解除）／何もない所 → 解除
  let rightDown: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (mode !== 'view') return;
    if (e.button === 2) rightDown = { x: e.clientX, y: e.clientY };
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (mode !== 'view' || e.button !== 2 || !rightDown) return;
    const moved = Math.hypot(e.clientX - rightDown.x, e.clientY - rightDown.y) > 5;
    rightDown = null;
    if (moved) return; // 右ドラッグは視点の移動
    setMouse(e.clientX, e.clientY);
    const t = targetAtMouse();
    pinned = t && !sameTarget(t, pinned) ? t : null;
  });
  // ブラウザの右クリックメニューは出さない（文字を入力する欄だけは、貼り付けなどに使えるよう残す）
  document.addEventListener('contextmenu', (e) => {
    if (!(e.target as HTMLElement).closest?.('input[type="text"], input[type="number"], textarea')) e.preventDefault();
  });

  // 図鑑
  const refreshDex = () => renderDex($('dexGrid'), $('dexDetail'), eco.dex, eco.animals, eco.visitors);

  // 魚がはねる・虫が落ちる：ときどき勝手に波紋
  let nextAmbient = 1;
  // デバッグ用（開発者ツールから確認できるように）
  /** データ量の計測（デバッグ用）：保存データ・メモリ・GPU に載せる量 */
  const measure = async () => {
    if (!world) return null;
    const gz = async (data: Uint8Array) => {
      const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
      return (await new Response(stream).arrayBuffer()).byteLength;
    };
    let gpuBytes = 0, tris = 0;
    diorama.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const g = o.geometry as THREE.BufferGeometry;
      for (const a of Object.values(g.attributes)) gpuBytes += (a as THREE.BufferAttribute).array.byteLength;
      if (g.index) gpuBytes += g.index.array.byteLength;
      if (o instanceof THREE.InstancedMesh) gpuBytes += o.instanceMatrix.array.byteLength;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o instanceof THREE.InstancedMesh ? o.count : 1);
    });
    return {
      size: `${world.size}×${world.size}×${world.height}`,
      voxelsRaw: world.voxels.byteLength,
      voxelsGzip: await gz(world.voxels),
      gpuGeometry: gpuBytes,
      typeTexture: world.voxels.byteLength,
      triangles: Math.round(tris),
    };
  };
  (window as unknown as { __hakoniwa: unknown }).__hakoniwa = { addRipple, rippleData, get world() { return world; }, camera, controls, measure, renderer };

  // ---------- UI ----------
  let timeOverride: number | null = null;
  let seasonOverride: number | null = null;
  const timeInput = $<HTMLInputElement>('time');
  timeInput.addEventListener('input', () => { timeOverride = parseFloat(timeInput.value); });
  $('now').addEventListener('click', () => { timeOverride = null; });
  $<HTMLSelectElement>('season').addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    seasonOverride = v === 'auto' ? null : parseInt(v, 10);
  });
  $<HTMLInputElement>('round').addEventListener('change', (e) => { U.roundEdges.value = (e.target as HTMLInputElement).checked ? 1 : 0; });
  const blendInput = $<HTMLInputElement>('blend');
  blendInput.addEventListener('input', () => { U.blend.value = parseFloat(blendInput.value); });
  $<HTMLInputElement>('dof').addEventListener('change', (e) => { dofOn = (e.target as HTMLInputElement).checked; updatePost(); });
  $<HTMLInputElement>('ssao').addEventListener('change', (e) => { aoOn = (e.target as HTMLInputElement).checked; updatePost(); });
  const aoInput = $<HTMLInputElement>('aoStrength');
  aoInput.addEventListener('input', () => { uAO.value = parseFloat(aoInput.value); });
  $<HTMLInputElement>('bloom').addEventListener('change', (e) => { bloomOn = (e.target as HTMLInputElement).checked; updatePost(); });

  // ---------- 画質プリセット ----------
  type Quality = 'high' | 'medium' | 'low';
  const QUALITY: Record<Quality, { pixelRatio: number; ao: boolean; dof: boolean; bloom: boolean; shadow: number; lite: boolean }> = {
    high: { pixelRatio: Math.min(devicePixelRatio, 2), ao: true, dof: true, bloom: true, shadow: 4096, lite: false },
    medium: { pixelRatio: Math.min(devicePixelRatio, 1.25), ao: true, dof: true, bloom: true, shadow: 2048, lite: false },
    low: { pixelRatio: Math.min(devicePixelRatio, 1) * 0.8, ao: false, dof: false, bloom: false, shadow: 1024, lite: true },
  };
  const QUALITY_NAMES: Record<Quality, string> = { high: '高', medium: '中', low: '低' };
  const isMobile = navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 820;
  // スマホは閲覧限定：建物の棚と読み込みは出さない（置いた建物は表示する）
  if (isMobile) $('buildBox').hidden = true;
  let quality: Quality = 'high';
  let qualityAuto = true;
  const setChecked = (id: string, v: boolean) => { $<HTMLInputElement>(id).checked = v; };
  const applyQuality = (q: Quality, regenerateIfNeeded = true) => {
    quality = q;
    const p = QUALITY[q];
    renderer.setPixelRatio(p.pixelRatio);
    fit();
    aoOn = p.ao; dofOn = p.dof; bloomOn = p.bloom;
    setChecked('ssao', aoOn); setChecked('dof', dofOn); setChecked('bloom', bloomOn);
    updatePost();
    const sh = daylight.sun.shadow;
    if (sh.mapSize.x !== p.shadow) { sh.mapSize.setScalar(p.shadow); sh.map?.dispose(); (sh as { map: unknown }).map = null; }
    $('qualityLabel').textContent = qualityAuto ? `→ ${QUALITY_NAMES[q]}` : '';
    if (p.lite !== liteTerrain) { liteTerrain = p.lite; if (regenerateIfNeeded && world) doRegen(true); }
  };
  $<HTMLSelectElement>('quality').addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    qualityAuto = v === 'auto';
    applyQuality(qualityAuto ? (forceWebGL || isMobile ? 'medium' : 'high') : (v as Quality));
  });

  // ---------- 環境音 ----------
  const soundBtn = $('sound');
  soundBtn.addEventListener('click', async () => {
    if (ambience.running) { await ambience.stop(); soundBtn.classList.remove('on'); soundBtn.textContent = '🔈 環境音'; }
    else { await ambience.start(); soundBtn.classList.add('on'); soundBtn.textContent = '🔊 環境音'; }
  });

  // 時間の流れ（テスト用の早送り）
  let lastEnv = { season: 0, raining: false };
  /** いまの暦・時刻・天気（生き物の判定に使う） */
  let lastMoment: Moment = { season: 0, seasonProgress: 0, hour: 12, raining: false };
  $<HTMLSelectElement>('simSpeed').addEventListener('change', (e) => { game.farm.speed = parseFloat((e.target as HTMLSelectElement).value); });
  $('skip1').addEventListener('click', () => { game.skip(1, lastEnv); toast('1 時間進めました'); });
  $('skip6').addEventListener('click', () => { game.skip(6, lastEnv); toast('6 時間進めました'); });

  // 右パネル（ステータス）
  const dl = (rows: [string, string | number][]) => rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  const updateStatus = (hh: number, mm: number, season: number, calendarSeason: number) => {
    $('st-time').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    $('st-season').textContent = SEASON_NAMES[season] + (season !== calendarSeason ? '（手動）' : '');
    $('st-weather').textContent = WEATHER_NAMES[weatherOverride ?? weatherAt(new Date(), season)];
    const f = game.summary();
    $('st-farm').innerHTML = dl([['畑', `${f.fields} マス`], ['育っている', f.growing], ['収穫できる', f.ripe], ['育つ苗木', f.saplings], ['🔑 土地の権利', rights()], ['次の権利まで', `あと ${3 - (progress.points % 3)} ポイント`], ['開いた土地', `${world ? countOpen(world.plots) : 0} / 16`]]);
    const e = eco.env();
    $('st-env').innerHTML = dl([['🌼 花', e.flowers], ['🌳 木', e.trees], ['🌿 草地', e.grass], ['💧 水辺', e.waterside], ['🐟 深い水', e.deepWater], ['🟫 畑', e.farmland]]);
    $('st-inv').innerHTML = dl(CROP_KINDS.map((k) => [`${CROP_ICONS[k]} ${CROPS[k].name}`, f.inventory[k] ?? 0]));
    $('st-residents').innerHTML = dl(eco.animals.slice(0, 10).map((a) => [`${a.info.icon} ${a.name}`, ACTIVITY_NAMES[a.activity]]));
  };

  // 天気
  let weatherOverride: WeatherKind | null = null;
  $<HTMLSelectElement>('weather').addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    weatherOverride = v === 'auto' ? null : (v as WeatherKind);
  });
  const weatherNow = { ...WEATHER_PARAMS.clear };
  let weatherInit = false;

  // 流れ星（夜・晴れの時にときどき。ボタンでも流せる）
  let meteorT = -1, meteorDur = 1;
  const launchMeteor = () => {
    const az = Math.random() * Math.PI * 2;
    const el = 0.35 + Math.random() * 0.45;
    const a = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const az2 = az + (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.3);
    const el2 = el - 0.12 - Math.random() * 0.15;
    const b = new THREE.Vector3(Math.cos(az2) * Math.cos(el2), Math.sin(el2), Math.sin(az2) * Math.cos(el2));
    SKY.meteorA.value.copy(a);
    SKY.meteorB.value.copy(b);
    meteorT = 0;
    meteorDur = 0.7 + Math.random() * 0.6;
  };
  $('meteor').addEventListener('click', launchMeteor);

  // 地形のパラメータ
  const PARAM_KEYS: (keyof TerrainParams)[] = ['relief', 'mountains', 'water', 'rocks', 'forest', 'flowers'];
  const paramInput = (k: keyof TerrainParams) => $<HTMLInputElement>(`p-${k}`);
  const showParam = (k: keyof TerrainParams) => {
    const el = paramInput(k);
    (el.nextElementSibling as HTMLOutputElement).value = parseFloat(el.value).toFixed(1);
  };
  PARAM_KEYS.forEach((k) => { paramInput(k).addEventListener('input', () => showParam(k)); showParam(k); });
  $('paramsReset').addEventListener('click', () => PARAM_KEYS.forEach((k) => { paramInput(k).value = '1'; showParam(k); }));
  const readParams = () => Object.fromEntries(PARAM_KEYS.map((k) => [k, parseFloat(paramInput(k).value)])) as unknown as TerrainParams;
  const fInput = $<HTMLInputElement>('fstop');
  const fNumber = () => F_STOPS[parseInt(fInput.value, 10)];
  const showF = () => { $('fLabel').textContent = `f/${fNumber()}`; };
  fInput.addEventListener('input', showF);
  showF();
  // ピントの追従の速さ（1 秒あたり。大きいほど速く追いつく。3 で約 0.8 秒）
  const focusSpeedInput = $<HTMLInputElement>('focusSpeed');
  const focusSpeed = () => parseFloat(focusSpeedInput.value);
  const showFocusSpeed = () => { $('focusSpeedLabel').textContent = `${focusSpeed().toFixed(1)}（約 ${(2.3 / focusSpeed()).toFixed(1)} 秒）`; };
  focusSpeedInput.addEventListener('input', showFocusSpeed);
  showFocusSpeed();
  // 夜の明るさ（この端末に覚えておく）
  const nightInput = $<HTMLInputElement>('nightBright');
  const NIGHT_KEY = 'hakoniwa.nightBrightness';
  const storedNight = parseFloat(localStorage.getItem(NIGHT_KEY) ?? '');
  if (storedNight >= 0.3 && storedNight <= 3) nightInput.value = String(storedNight);
  const applyNight = () => {
    daylight.nightBrightness = parseFloat(nightInput.value);
    $('nightBrightLabel').textContent = `× ${daylight.nightBrightness.toFixed(1)}`;
  };
  nightInput.addEventListener('input', () => { applyNight(); localStorage.setItem(NIGHT_KEY, nightInput.value); });
  applyNight();
  const autoBtn = $('auto');
  autoBtn.addEventListener('click', () => {
    controls.autoRotate = !controls.autoRotate;
    autoBtn.classList.toggle('on', controls.autoRotate);
  });
  // ---------- 保存 ----------
  // いまの箱庭の生成設定（保存にはこれと差分を書く）
  let worldSettings: SaveData['world'] | null = null;
  const settingsFromUI = (): SaveData['world'] => ({
    seed: parseInt($<HTMLInputElement>('seed').value, 10) || 0,
    height: WORLD_HEIGHT,
    detail: parseInt($<HTMLSelectElement>('detail').value, 10),
    flowerStyle: $<HTMLSelectElement>('flowerStyle').value,
    params: readParams(),
  });
  const settingsToUI = (s: SaveData['world']) => {
    $<HTMLInputElement>('seed').value = String(s.seed);
    $<HTMLSelectElement>('detail').value = String(s.detail);
    $<HTMLSelectElement>('flowerStyle').value = s.flowerStyle;
    PARAM_KEYS.forEach((k) => { paramInput(k).value = String(s.params[k] ?? 1); showParam(k); });
  };
  const buildSave = (): SaveData => ({
    version: SAVE_VERSION, savedAt: Date.now(), world: worldSettings!, plots: world!.plots,
    ...game.exportState(), progress: { ...progress }, dex: structuredClone(eco.dex), residents: eco.residentsSave(),
  });

  // 閉じていた間の季節と天気（オフライン進行で使う）
  const envAt = (ms: number) => {
    const d = new Date(ms);
    const season = seasonAt(d).season;
    return { season, raining: weatherAt(d, season) === 'rain' };
  };
  const fmtHours = (h: number) => (h >= 24 ? `${Math.floor(h / 24)}日${Math.round(h % 24)}時間` : h >= 1 ? `${Math.floor(h)}時間${Math.round((h % 1) * 60)}分` : `${Math.round(h * 60)}分`);

  /** セーブデータから箱庭を作り直す。catchUp なら閉じていた間の時間を進める */
  const loadFrom = async (save: SaveData, catchUp: boolean) => {
    settingsToUI(save.world);
    const s = save.world;
    progress = { ...save.progress };
    await startWorld(s.seed, s.detail, s.params, s.flowerStyle, save.plots, save.edits);
    worldSettings = { ...s };
    game.restore(save);
    renderShelf();
    // 住人は畑・苗木を戻した後に（苗木の列に住人を戻さないように）
    eco.restore(save.dex ?? {}, save.residents ?? []);
    eco.resetClock(game.farm.simMs);
    if (!catchUp) return;
    const target = save.farm.simMs + Math.max(0, Date.now() - save.savedAt);
    const r = game.catchUp(target, envAt);
    if (r.hours >= 0.05) {
      const news = [r.ripened > 0 ? `${r.ripened} マスの作物が実りました` : '', r.grown > 0 ? `${r.grown} 本の木が育ちました` : ''].filter(Boolean).join('・');
      toast(`おかえりなさい。${fmtHours(r.hours)}たちました${news ? `：${news}` : ''}`, 5000);
    }
    // 閉じていた間は引っ越してこない（判定の基準をいまにそろえる）
    eco.resetClock(game.farm.simMs);
  };

  /** keep = true：今の状態（編集・畑）を保ったまま作り直す（小物の細かさ・花・画質の変更） */
  const doRegen = async (keep = true) => {
    if (openingDone) await openingDone;
    if (keep && world && worldSettings) {
      const s = buildSave();
      const ui = settingsFromUI();
      s.world = { ...worldSettings, detail: ui.detail, flowerStyle: ui.flowerStyle };
      // 来ていた訪問者は、作り直した後も残りの時間だけいる（画質の自動切り替えで消えないように）
      const stays = eco.visitorStays;
      await loadFrom(s, false);
      eco.readdVisitors(stays);
      game.unsaved = true;
    } else {
      const s = settingsFromUI();
      progress = { points: 0, rightsUsed: 0, unlocks: [], firsts: [], newMarks: [] };
      await startWorld(s.seed, s.detail, s.params, s.flowerStyle, 1 << START_PLOT);
      eco.restore({}, null);
      worldSettings = s;
      game.unsaved = true;
    }
  };
  const hasProgress = () => game.edits.size > 0 || game.farm.crops.size > 0 || game.farm.saplings.length > 0;
  /** 新しい箱庭を作る（今の箱庭は上書きされるので確認する） */
  const newWorld = async () => {
    if (hasProgress() && !confirm('新しい箱庭を作ると、今の箱庭（畑・植林・地形の変更）は上書きされます。よろしいですか？')) {
      if (worldSettings) settingsToUI(worldSettings);
      return;
    }
    await doRegen(false);
    await saveNow();
  };
  $('regen').addEventListener('click', newWorld);
  $('rightPlus').addEventListener('click', () => {
    progress.points += 3;
    game.unsaved = true;
    refreshGhosts();
    toast(`土地の権利：${rights()}`);
  });
  $('ecoCall').addEventListener('click', () => {
    // 確率を 1 にして 1 回判定する（時刻・季節・天気の条件はそのまま）
    const r = eco.check(lastMoment, performance.now(), () => 0);
    const parts = [r.arrived ? `訪問者が ${r.arrived} 匹来ました` : '', r.movedIn ? '住人が引っ越してきました' : '', r.left ? `${r.left} 匹が帰りました` : ''].filter(Boolean);
    toast(r.arrived || r.movedIn ? parts.join('・') : `いまの環境・時刻では、誰も来ませんでした${r.left ? `（${r.left} 匹が帰りました）` : ''}`);
  });
  $('ecoClear').addEventListener('click', () => { eco.clearVisitors(); toast('訪問者が帰りました'); });
  $<HTMLInputElement>('ecoHighlight').addEventListener('change', (e) => eco.setHighlight((e.target as HTMLInputElement).checked));
  // 生き物の多さ（倍率）。上げたらすぐ 1 回判定して、増えた上限まで引っ越してくるようにする
  $<HTMLInputElement>('ecoAbundance').addEventListener('change', (e) => {
    const k = parseInt((e.target as HTMLInputElement).value, 10) || 1;
    const up = k > eco.abundance;
    eco.abundance = k;
    $('ecoAbundanceLabel').textContent = `×${k}`;
    if (up) eco.check(lastMoment, performance.now(), Math.random);
  });
  $<HTMLInputElement>('ecoAbundance').addEventListener('input', (e) => { $('ecoAbundanceLabel').textContent = `×${(e.target as HTMLInputElement).value}`; });
  $('openAll').addEventListener('click', async () => {
    if (!world || opening) return;
    // 残りの区画を 1 つずつ開く（権利が足りなければ足す）。途中で箱庭が作り直されたら止める
    const startGen = gen;
    for (let next = openable(world.plots); next.length && gen === startGen; next = openable(world.plots)) {
      if (rights() === 0) progress.points += 3;
      const r = openPlot(next[0]);
      if (typeof r === 'string') break;
      await r;
    }
  });
  $('detail').addEventListener('change', () => doRegen(true));
  $('flowerStyle').addEventListener('change', () => doRegen(true));

  // この端末（IndexedDB）に保存
  let persisted = false;
  let lastSavedAt = 0;
  let saving = false;
  const saveStatusEl = $('saveStatus');
  const showSaveStatus = (extra = '') => {
    const t = lastSavedAt ? new Date(lastSavedAt) : null;
    const time = t ? `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : '—';
    saveStatusEl.innerHTML = `この端末に保存：${time}${persisted ? '' : '<br><small>（ブラウザに「消さないで」と頼めませんでした。書き出しで控えを）</small>'}${extra ? `<br>${extra}` : ''}`;
  };
  const saveNow = async () => {
    if (!world || !worldSettings || saving) return;
    saving = true;
    try {
      const save = buildSave();
      const data = await encodeSave(save);
      await saveLocal({ key: 'main', data, savedAt: save.savedAt, version: save.version });
      lastSavedAt = save.savedAt;
      game.unsaved = false;
      if (!persisted) persisted = await requestPersist();
      showSaveStatus(`${(data.byteLength / 1024).toFixed(1)} KB`);
    } catch (err) {
      console.error(err);
      toast('保存できませんでした');
    } finally {
      saving = false;
    }
  };
  $('saveNow').addEventListener('click', async () => { await saveNow(); toast('保存しました'); });
  // ページを離れる時・隠れる時にも保存
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
  window.addEventListener('pagehide', () => { saveNow(); });

  // ファイルに書き出す・ファイルから読み込む（どこでも使える控え）
  $('exportSave').addEventListener('click', async () => {
    if (!world) return;
    const save = buildSave();
    const data = await encodeSave(save);
    const d = new Date(save.savedAt);
    const p2 = (n: number) => String(n).padStart(2, '0');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/octet-stream' }));
    a.download = `hakoniwa-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.hakoniwa`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`書き出しました（${(data.byteLength / 1024).toFixed(1)} KB）`);
  });
  const importFile = $<HTMLInputElement>('importFile');
  $('importSave').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    importFile.value = '';
    if (!file) return;
    try {
      const save = await decodeSave(new Uint8Array(await file.arrayBuffer()));
      if (hasProgress() && !confirm('読み込むと、今の箱庭は上書きされます。よろしいですか？')) return;
      await loadFrom(save, true);
      await saveNow();
      toast('読み込みました');
    } catch (err) {
      toast(err instanceof OldSaveError ? '古い形式（v1）の保存データは読み込めません。今の箱庭はそのままです' : err instanceof Error ? err.message : '読み込めませんでした', 4000);
    }
  });

  // Google Drive と同期（アプリ専用フォルダ）
  const driveBtn = $<HTMLButtonElement>('driveSync');
  if (!DRIVE_CLIENT_ID) driveBtn.title = 'Google Drive の設定（Client ID）が必要です。docs/保存とクラウド同期.md を参照';
  driveBtn.addEventListener('click', async () => {
    if (!DRIVE_CLIENT_ID) { toast('Google Drive を使うには設定が必要です（docs/保存とクラウド同期.md）', 4000); return; }
    if (!world) return;
    driveBtn.disabled = true;
    try {
      const remote = await remoteInfo();
      if (remote && remote.savedAt > lastSavedAt + 5000) {
        const when = new Date(remote.savedAt).toLocaleString();
        if (confirm(`Google Drive に、この端末より新しい箱庭があります（${when}）。\nOK：Drive の箱庭を読み込む\nキャンセル：この端末の箱庭で Drive を上書きする`)) {
          const save = await decodeSave(await download(remote.id));
          await loadFrom(save, true);
          await saveNow();
          toast('Google Drive から読み込みました');
          return;
        }
      }
      await saveNow();
      const save = buildSave();
      await upload(await encodeSave(save), save.savedAt, remote?.id);
      showSaveStatus(`Google Drive に同期：${new Date().toLocaleTimeString().slice(0, 5)}`);
      toast('Google Drive に保存しました');
    } catch (err) {
      toast(err instanceof OldSaveError ? 'Google Drive の保存データは古い形式（v1）なので読み込めません。今の箱庭はそのままです' : err instanceof Error ? err.message : '同期できませんでした', 4000);
    } finally {
      driveBtn.disabled = false;
    }
  });

  // デバッグウィンドウの開閉（スマホでは最初はたたんでおく）
  const uiEl = $('ui');
  // 狭い画面では CSS で最初からたたまれている（.expanded でひらく）。広い画面では .collapsed でたたむ
  const narrow = window.matchMedia('(max-width: 760px)');
  $('uiTitle').addEventListener('click', () => uiEl.classList.toggle(narrow.matches ? 'expanded' : 'collapsed'));

  // 左右パネルの開閉
  const layout = $('layout');
  document.querySelectorAll<HTMLElement>('[data-target]').forEach((btn) => {
    btn.addEventListener('click', () => layout.classList.toggle(`${btn.dataset.target}-closed`));
  });

  // 90° スナップ回転
  let snapFrom = 0, snapTo = 0, snapT = 1;
  const snap = (dir: number) => {
    const cur = controls.getAzimuthalAngle();
    const q = Math.PI / 2;
    snapFrom = cur;
    snapTo = (Math.round(cur / q) + dir) * q;
    snapT = 0;
  };
  $('rotL').addEventListener('click', () => snap(-1));
  $('rotR').addEventListener('click', () => snap(1));
  const spherical = new THREE.Spherical();
  const offset = new THREE.Vector3();

  // 表示領域の大きさに追従（起動直後に 0×0 のことがあるので ResizeObserver で監視）
  const fit = () => {
    const w = appEl.clientWidth, h = appEl.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  };
  new ResizeObserver(fit).observe(appEl);
  fit();

  setMode('view');

  // 最初の画質：WebGL2 やスマホは「中」から。重ければ自動で下げる
  applyQuality(forceWebGL || isMobile || !(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'medium' : 'high', false);
  // 起動：この端末に保存があれば読み込み（閉じていた間の時間も進める）、なければ新しく作る
  try {
    const stored = await loadLocal();
    if (stored) {
      await loadFrom(await decodeSave(stored.data), true);
      lastSavedAt = stored.savedAt;
      persisted = await navigator.storage?.persisted?.() ?? false;
      showSaveStatus();
    } else {
      await doRegen(false);
      await saveNow();
    }
  } catch (err) {
    console.error(err);
    toast(err instanceof OldSaveError ? `保存データは${err.message}` : '保存データを読めなかったので、新しい箱庭を作りました', 4000);
    await doRegen(false);
    if (err instanceof OldSaveError) await saveNow();
  }

  // ---------- ループ ----------
  const timer = new THREE.Timer();
  timer.connect(document);
  let fpsFrames = 0, fpsTime = 0, fps = 0;
  const cA = new THREE.Color(), cB = new THREE.Color();
  let focusSmoothed = -1;
  let autosaveT = 0;
  let gpuMs = 0;
  const fpsWindow: number[] = [];
  let lastQualityChange = performance.now();
  const focusPoint = new THREE.Vector3(0, 10, 0);

  let cpuLogic = 0, cpuRender = 0;
  const loop = (t: number) => {
    const tl0 = performance.now();
    timer.update(t);
    const dt = Math.min(timer.getDelta(), 0.1);
    U.now.value = timer.getElapsed();
    // 広がっている途中の波紋があるか（10 秒でほぼ消える）。無ければ水面の波紋の計算を飛ばす
    RIPPLES_ON.value = rippleData.some((r) => r.w > 0 && U.now.value - r.z >= 0 && U.now.value - r.z < 10) ? 1 : 0;

    if (snapT < 1) {
      snapT = Math.min(1, snapT + dt * 2.2);
      const e = 1 - Math.pow(1 - snapT, 3);
      offset.copy(camera.position).sub(controls.target);
      spherical.setFromVector3(offset);
      spherical.theta = snapFrom + (snapTo - snapFrom) * e;
      offset.setFromSpherical(spherical);
      camera.position.copy(controls.target).add(offset);
    }
    // WASD：見ている向きに沿って水平に移動、Space：上へ、Shift：下へ。速さは注視点までの距離に比例
    if (moveKeys.size && !menuOpen()) {
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const has = (c: string) => moveKeys.has(c);
      const mv = new THREE.Vector3()
        .addScaledVector(fwd, (has('KeyW') ? 1 : 0) - (has('KeyS') ? 1 : 0))
        .addScaledVector(right, (has('KeyD') ? 1 : 0) - (has('KeyA') ? 1 : 0));
      if (mv.lengthSq() > 0) mv.normalize();
      mv.y = (has('Space') ? 1 : 0) - (has('ShiftLeft') || has('ShiftRight') ? 1 : 0);
      const speed = Math.max(6, camera.position.distanceTo(controls.target) * 0.9);
      mv.multiplyScalar(speed * dt);
      // 注視点が箱庭から離れすぎないように
      const lim = extent / 2 + 24;
      const cx = bounds.cx - FRAME / 2, cz = bounds.cz - FRAME / 2;
      const t = controls.target.clone().add(mv);
      t.x = Math.min(cx + lim, Math.max(cx - lim, t.x));
      t.z = Math.min(cz + lim, Math.max(cz - lim, t.z));
      t.y = Math.min(90, Math.max(0, t.y));
      const d = t.sub(controls.target);
      controls.target.add(d);
      camera.position.add(d);
    }
    controls.update(dt);
    // 地面の下にカメラが潜らないようにする（見上げる時）
    if (world) {
      const N = world.size;
      const cx = Math.floor(camera.position.x + N / 2), cz = Math.floor(camera.position.z + N / 2);
      const ground = cx >= 0 && cz >= 0 && cx < N && cz < N ? Math.max(world.heights[cx + cz * N], world.waterLevel) : 0;
      if (camera.position.y < ground + 0.5) camera.position.y = ground + 0.5;
    }

    // 時刻（端末の現在時刻と連動。スライダーで上書き可）
    const now = new Date();
    const hour = timeOverride ?? now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    if (timeOverride === null) timeInput.value = String(hour);
    const hh = Math.floor(hour), mm = Math.floor((hour - hh) * 60);
    $('timeLabel').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}${timeOverride === null ? '' : '（手動）'}`;

    // 季節（全世界共通の暦。セレクトで上書き可）
    const st = seasonAt(now);
    const s = seasonOverride ?? st.season;

    // 天気（全世界共通。セレクトで上書き可）。少しずつ移り変わる
    let wk: WeatherKind = weatherOverride ?? weatherAt(now, s);
    if (wk === 'snow' && s !== 3 && weatherOverride === null) wk = 'rain';
    if (!weatherInit) { Object.assign(weatherNow, WEATHER_PARAMS[wk]); weatherInit = true; }
    approachWeather(weatherNow, WEATHER_PARAMS[wk], dt, weatherOverride ? 1.2 : 0.35);
    rainAmount.value = weatherNow.rain;
    snowAmount.value = weatherNow.snow;
    if (precip) { precip.rain.visible = weatherNow.rain > 0.01; precip.snow.visible = weatherNow.snow > 0.01; }
    $('weatherLabel').textContent = `いま：${WEATHER_NAMES[weatherAt(now, st.season)]}`;

    const size = extent;
    // 影の範囲は箱庭全体ではなく、注目点のまわり（カメラとの距離で決める）。広くなっても影が粗くならない
    const shadowR = Math.min(160, Math.max(48, camera.position.distanceTo(controls.target) * 0.9));
    daylight.apply(hour, focusPoint, shadowR, weatherNow);
    // パネルの見た目を時間帯に合わせる（夜は暗いすりガラス）。明け方・夕方にちらつかないよう幅を持たせる
    const nightUI = document.body.classList.contains('night');
    if (!nightUI && SKY.night.value > 0.65) document.body.classList.add('night');
    else if (nightUI && SKY.night.value < 0.45) document.body.classList.remove('night');

    // 流れ星：夜で晴れている時、ときどき
    if (meteorT < 0 && SKY.night.value > 0.8 && weatherNow.cloudCover < 0.5 && Math.random() < dt * 0.08) launchMeteor();
    if (meteorT >= 0) {
      meteorT += dt / meteorDur;
      SKY.meteorP.value = meteorT;
      if (meteorT > 1) { meteorT = -1; SKY.meteorP.value = -1; }
    }
    const blend = seasonOverride === null ? st.blend : 0;
    const nextS = seasonOverride === null ? st.next : s;
    U.grassColor.value.copy(cA.setHex(SEASON_COLORS[s].grass).lerp(cB.setHex(SEASON_COLORS[nextS].grass), blend));
    U.leafColor.value.copy(cA.setHex(SEASON_COLORS[s].leaf).lerp(cB.setHex(SEASON_COLORS[nextS].leaf), blend));
    const snowNow = s === 3 ? 1 : 0, snowNext = nextS === 3 ? 1 : 0;
    U.snow.value = snowNow + (snowNext - snowNow) * blend;
    // 冬は花を隠す
    diorama.children.forEach((o) => { if (o.userData.kind === 'flower') o.visible = U.snow.value < 0.5; });
    $('seasonLabel').textContent = `いまの暦：${SEASON_NAMES[st.season]}${st.blend > 0 ? `→${SEASON_NAMES[st.next]}` : ''}`;

    lastMoment = { season: s, seasonProgress: seasonOverride === null ? st.progress : 0.3, hour, raining: weatherNow.rain > 0.5 };
    eco.update(dt, hour, lastMoment, game.farm.simMs, performance.now());

    // 畑・植林の時間を進める。道具を持っている時はカーソルを更新
    lastEnv = { season: s, raining: weatherNow.rain > 0.5 };
    game.tick(dt, lastEnv);
    // ドラッグ中もカーソル（白い枠）をマウスに追従させる。ドラッグ中は使った直後のマスが赤くならないよう白のまま
    if (mode === 'edit' && mouseInside) {
      const { plot: gp, hit } = stroke ? { plot: -1, hit: pickAtMouse() } : ghostAtMouse();
      ghosts.setHover(gp);
      if (gp >= 0) {
        game.cursor.visible = false;
        hintEl.textContent = rights() > 0 ? 'クリックでこの土地を開く（権利 1）' : '土地の権利が足りません';
      } else {
        const msg = game.updateCursor(hit, !!stroke);
        if (!stroke) hintEl.textContent = msg || TOOLS.find((x) => x.id === game.tool)!.help;
      }
    }
    updateHover();
    game.syncGhost(); // 建物の見本は、カーソルの枠と一緒に出し入れする
    updateObserve(dt);

    // ときどき勝手に波紋
    nextAmbient -= dt;
    if (nextAmbient <= 0 && world) {
      // 雨の時は雨粒の波紋がたくさん
      nextAmbient = weatherNow.rain > 0.3 ? 0.04 + Math.random() * 0.08 : 0.8 + Math.random() * 2.5;
      // 開いた範囲の中で探す（枠全体だと、区画が少ない時にほとんど見つからない）
      for (let tries = 0; tries < 30; tries++) {
        const x = bounds.x0 + Math.random() * bounds.w - FRAME / 2, z = bounds.z0 + Math.random() * bounds.d - FRAME / 2;
        if (isWaterAt(x, z)) { addRipple(x, z, 0.35 + Math.random() * 0.3); break; }
      }
    }

    // ピント：画面中央の奥行きに、なめらかに追従させる
    const target = centerDepth() ?? camera.position.distanceTo(controls.target);
    focusSmoothed = focusSmoothed < 0 ? target : focusSmoothed + (target - focusSmoothed) * (1 - Math.exp(-dt * focusSpeed()));
    uFocus.value = focusSmoothed;
    // f 値が大きいほどピントの合う範囲が広い
    uFocal.value = focusSmoothed * 0.05 * fNumber();

    // 遠くのかすみ：注視点より奥から少しずつ
    const camDist = camera.position.distanceTo(controls.target);
    uFogNear.value = camDist * 0.9 + 10;
    uFogFar.value = camDist * 2.5 + size * 1.5;

    // ホタル：夜・春〜秋（夏が一番多い）・雨でない時
    const night = SKY.night.value;
    const seasonFly = [0.4, 1, 0.35, 0][s];
    const tt = timer.getElapsed();
    fireflies.update(tt, Math.max(0, (night - 0.6) / 0.4) * seasonFly * (1 - weatherNow.rain) * (1 - weatherNow.snow));
    // 鳥：昼・晴れ〜くもり
    birds.update(tt, Math.max(0, 1 - night * 1.5) * (1 - weatherNow.rain) * (1 - weatherNow.snow * 0.7));
    ambience.update(dt, { day: 1 - night, rain: weatherNow.rain, wind: weatherNow.wind, season: s, volume: 0.6 });

    const tr0 = performance.now();
    if (appEl.clientWidth > 0 && appEl.clientHeight > 0) pipeline.render();
    const tr1 = performance.now();
    cpuLogic += ((tr0 - tl0) - cpuLogic) * 0.1;
    cpuRender += ((tr1 - tr0) - cpuRender) * 0.1;

    // 自動保存：変更があれば 1 分ごと、なくても 5 分ごと（早送り中は箱庭内の時計がずれるので 1 分ごと）
    autosaveT += dt;
    if ((autosaveT > 60 && (game.unsaved || game.farm.speed > 1)) || autosaveT > 300) { autosaveT = 0; saveNow(); }

    fpsFrames++; fpsTime += dt;
    if (fpsTime > 0.5) {
      fps = fpsFrames / fpsTime; fpsFrames = 0; fpsTime = 0;
      updateStatus(hh, mm, s, st.season);
      // GPU の処理時間（タイムスタンプが使える環境のみ）
      if (trackTimestamp) renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER).then(() => { gpuMs = renderer.info.render.timestamp; }).catch(() => {});
      $('stats').innerHTML = `${backendName} · ${fps.toFixed(0)} fps${gpuMs > 0 ? ` · GPU ${gpuMs.toFixed(1)}ms` : ''} · CPU 処理 ${cpuLogic.toFixed(1)}ms＋描画命令 ${cpuRender.toFixed(1)}ms · 画質 ${QUALITY_NAMES[quality]} · ピント ${focusSmoothed.toFixed(0)}<br>${info}`;
      // 自動画質：重い時は下げる（上げ下げを繰り返さないよう、下げるだけ）。
      // 変えた直後・箱庭を作っている間の 1.5 秒は見ない（シェーダーの準備で一瞬重くなるため）。2 秒ぶんの中央値で決める
      if (qualityAuto && fps > 0 && !game.locked && performance.now() - lastQualityChange > 1500) {
        fpsWindow.push(fps);
        if (fpsWindow.length >= QUALITY_SAMPLES) {
          const next = nextQuality(quality, fpsWindow);
          fpsWindow.length = 0;
          if (next) { applyQuality(next); lastQualityChange = performance.now(); }
        }
      } else fpsWindow.length = 0;
    }
  };
  renderer.setAnimationLoop(loop);

  /** ベンチマーク：描画を連続で frames 回行い、GPU の完了まで待って 1 フレームあたりの時間を測る（画面が隠れていても測れる） */
  const bench = async (frames = 60) => {
    renderer.setAnimationLoop(null);
    const backend = renderer.backend as N;
    const px = new Uint8Array(4);
    // WebGL は finish() だけでは GPU の完了を待たないので、1 画素読み出して同期させる
    const sync = async () => { if (backend.device) await backend.device.queue.onSubmittedWorkDone(); else { const gl = backend.gl as WebGL2RenderingContext; gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } };
    pipeline.render(); await sync();
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) { U.now.value += 1 / 60; pipeline.render(); }
    await sync();
    const ms = (performance.now() - t0) / frames;
    renderer.setAnimationLoop(loop);
    const w = renderer.domElement.width, h = renderer.domElement.height;
    return { msPerFrame: +ms.toFixed(2), fps: +(1000 / ms).toFixed(0), resolution: `${w}x${h}`, quality, backend: backendName };
  };
  const adapterInfo = async () => { const a = await (navigator as N).gpu?.requestAdapter(); return a?.info ? { vendor: a.info.vendor, architecture: a.info.architecture, description: a.info.description } : null; };
  Object.assign((window as N).__hakoniwa, { shaderFlags: { FIREFLIES_ON, RIPPLES_ON }, eco, spawnVisitor: (id: VisitorId) => eco.spawnVisitor(id), ecoCheck: (force = true) => eco.check(lastMoment, performance.now(), force ? () => 0 : Math.random), bench, adapterInfo, applyQuality, fireflyData, game, selectTool, saveNow, buildSave, encodeSave, saveLocal, setSize: (w: number, h: number) => { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); } });
}

main().catch((err) => {
  console.error(err);
  const el = document.createElement('div');
  el.id = 'error';
  el.textContent = `起動に失敗しました\n${err instanceof Error ? err.message : String(err)}`;
  document.body.appendChild(el);
});
