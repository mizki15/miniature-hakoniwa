import * as THREE from 'three/webgpu';
import { fog, rangeFogFactor, uniform } from 'three/tsl';
import { AA_NAMES, isAAMode } from './render/antialias';
import { createPost } from './render/post';
import { Fireflies } from './creatures/fireflies';
import { Birds } from './creatures/birds';
import { Ambience } from './audio';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FIREFLIES_ON, RIPPLES, RIPPLES_ON, U, createDetailMaterial, createTerrainMaterial, createToonWaterMaterial, createWaterMaterial, fireflyData, rippleData, windowGlowAt, type SurfaceMaterial } from './render/materials';
import { uLine } from './render/toon';
import { SAMPLES as QUALITY_SAMPLES, nextQuality } from './render/autoQuality';
import { createDaylight } from './render/daylight';
import { createShadowSystem } from './render/shadows';
import { SKY, createPrecipitation, createSkyNode } from './render/sky';
import { SEASON_COLORS, SEASON_NAMES, seasonAt } from './calendar';
import { WEATHER_NAMES, WEATHER_PARAMS, approachWeather, isSnowDay, weatherAt, type WeatherKind } from './weather';
import { TIER_NAMES, TIER_POINTS, boostedVisitors, checkGoals, condProgress, ensureSeason, goalHint, goalReward, goalText, logLook, sanitizeGoals, seasonKey, seasonOfKey, updatePairs, type Goal, type GoalsState } from './eco/goals';
import { mementoDesign } from './build/mementos';
import { ACTIVITY_NAMES, SPECIES, type Animal } from './creatures/animals';
import { EcoManager } from './creatures/ecoManager';
import { RARITY_STARS, VISITOR, type DexId, type Moment, type VisitorId } from './eco/species';
import { dexStage } from './eco/dexState';
import { pickNearestOnScreen } from './eco/pick';
import type { Visitor } from './creatures/visitors';
import { renderDex } from './creatures/dex';
import { OldSaveError, SAVE_VERSION, decodeSave, encodeSave, type SaveData } from './save/format';
import { loadLocal, requestPersist, saveLocal } from './save/store';
import { createSyncState } from './save/syncState';
import { DRIVE_CLIENT_ID, accountInfo, download, hasToken, prepareSignIn, remoteInfo, signIn, signOut, upload } from './save/drive';
import { CloudSync, type CloudStatus } from './save/cloudSync';
import { buildLowPolyFlower } from './creatures/flowers';
import { WATER, isOpaque } from './world/blocks';
import { PLOT_LAND_INFO, plotLands, type PlotLand } from './world/landPlan';
import { DEFAULT_PARAMS, LAND_VERSION, landCountsOf, type TerrainParams, type WorldData } from './world/terrain';
import type { InitResult, PlotResult, RemeshResult } from './world/worker';
import { FRAME, OPEN_PLOT_POINTS, PLOT, PLOTS_PER_SIDE, PLOT_COUNT, START_PLOT, boundsOf, canOpen, countOpen, isOpen, openable, plotOfCol, plotRect } from './world/plots';
import { buildBase, disposeBase } from './render/base';
import { PlotGhosts } from './render/plotGhosts';
import { FLOWER_KINDS, GameController, PATH_KINDS, PLACE_BLOCKS, TOOLS, type Tool } from './game/controller';
import { HoverTip } from './ui/hoverTip';
import { PickBar, type PickItem } from './ui/pickBar';
import { thumbOf } from './ui/thumb';
import { buildCropGeometry, buildSaplingGeometry } from './game/cropModels';
import { applyDefaultsToUI } from './ui/defaultsUI';
import { CROP_ICONS, registryOptions } from './game/tools';
import { createHud } from './ui/hud';
import { buildMinutes } from './build/construction';
import { parseBuilding, type BuildingDesign, type ParseIssue } from './build/geoParse';
import { buildFixPrompt, buildPrompt } from './build/aiPrompt';
import { LIMITS } from './build/limits';
import { BuildingViewer } from './build/viewer';
import { designStats } from './build/stats';
import { CharacterStore } from './build/characterStore';
import { buildingTraits } from './build/traits';
import { renderBag } from './ui/bag';
import { MAT_IDS, MAT_NAME, buildCost, gain } from './game/materials';
import { JOB_TEXT, SITE_NAMES, likelyResidents } from './eco/residents';
import { CROPS, CROP_KINDS, type CropKind } from './game/farm';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const WORLD_HEIGHT = 64;
const F_STOPS = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22];


async function main() {
  // 初期値（src/defaults.ts）を画面に入れる。端末に覚えた値・保存した箱庭の値は、この後で上書きする（v0.18.1）
  applyDefaultsToUI(F_STOPS);
  // ---------- レンダラー ----------
  // ?webgl を付けると WebGL2 で動かす（WebGPU 非対応の端末での動作確認用）
  const forceWebGL = new URLSearchParams(location.search).has('webgl');
  // ?gputime を付けると GPU の処理時間を計測する（計測自体が重くなる環境があるので既定は OFF）
  const trackTimestamp = new URLSearchParams(location.search).has('gputime');
  // 画面そのものには MSAA をかけない（場面はポストプロセスの中で描くので、アンチエイリアスはそこで選ぶ。render/antialias.ts）
  const renderer = new THREE.WebGPURenderer({ antialias: false, forceWebGL, trackTimestamp });
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
  /**
   * 描き方：ふつう（PBR と AO など）／トゥーン・高（試作。光を段に分け、線画を重ねる軽い描き方）／
   * トゥーン・軽（さらに、影を小さく間引き、遠くの小物をしまい、描く解像度 75%、空と雲の影のノイズを減らす）
   */
  type RenderStyle = 'standard' | 'toon' | 'toonLite';
  const isStyle = (v: string | null): v is RenderStyle => v === 'standard' || v === 'toon' || v === 'toonLite';
  const storedStyle = localStorage.getItem('hakoniwa.renderStyle');
  let renderStyle: RenderStyle = isStyle(storedStyle) ? storedStyle : 'standard';
  const isToon = () => renderStyle !== 'standard';
  /** トゥーン・軽で描く解像度 */
  const TOON_LITE_SCALE = 0.75;
  // 空（トゥーン・軽はノイズを減らした空。初めて使う時に作る）
  const skyNodes: Partial<Record<'full' | 'lite', N>> = {};
  const skyNodeOf = (s: RenderStyle) => (s === 'toonLite' ? (skyNodes.lite ??= createSkyNode(true)) : (skyNodes.full ??= createSkyNode()));
  scene.backgroundNode = skyNodeOf(renderStyle);
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
  // 影の描き方（ふつう／カスケード影、毎フレーム／間引き）。デバッグで切り替える
  const shadows = createShadowSystem(scene, daylight.sun);

  // ---------- ポストプロセス：（時間方向のアンチエイリアス）→ AO（GTAO）→ 被写界深度（画面中央にピント）→ ブルーム →（FXAA・SMAA） ----------
  // アンチエイリアスの方法と、場面を描く解像度はデバッグで切り替える。切り替えると場面の描き方ごと作り直す
  // render/post.ts（v0.18 で切り出した）
  const post = createPost(renderer, scene, camera, { toon: () => isToon(), sceneScale: () => (renderStyle === 'toonLite' ? TOON_LITE_SCALE : 1) });
  const { pipeline } = post;
  const { ao: uAO, focus: uFocus, focal: uFocal } = post.uniforms;
  const updatePost = post.update, setAntialias = post.setAntialias;

  // ---------- 箱庭 ----------
  // 描き方ごとのマテリアル（トゥーンは初めて切り替えた時に作る）
  // トゥーン・軽：花・草・作物は 90 より遠いとしまう（木は箱庭の見た目の要なので残す）。雲の影のノイズは 1 段
  const makeMats = (s: RenderStyle) => {
    const toon = s !== 'standard', lite = s === 'toonLite';
    const c = lite ? 1 : 3;
    return {
      waterMat: toon ? createToonWaterMaterial() : createWaterMaterial() as THREE.Material,
      detailMat: createDetailMaterial(0, { toon, cloudOctaves: c }) as THREE.Material,
      flowerMat: createDetailMaterial(0.12, { toon, far: lite ? 90 : 0, cloudOctaves: c }) as THREE.Material, // 花は背が低いので高さに比例して揺らす
      buildingMat: createDetailMaterial(0, { sway: false, windows: true, toon, cloudOctaves: c }) as THREE.Material, // 建物は風で揺らさない。窓は夜に光る
    };
  };
  const styleMats: Partial<Record<RenderStyle, ReturnType<typeof makeMats>>> = {};
  const matsOf = (s: RenderStyle) => (styleMats[s] ??= makeMats(s));
  const { waterMat, detailMat, flowerMat, buildingMat } = matsOf(renderStyle);
  const lowPolyFlowers = [0, 1, 2].map((v) => buildLowPolyFlower(v));
  let precip: { rain: THREE.InstancedMesh; snow: THREE.InstancedMesh } | null = null;
  const rainAmount = uniform(0);
  const snowAmount = uniform(0);
  let terrainMat: SurfaceMaterial | null = null;
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
  // 建物の性格（形ごとに 1 回、別のワーカーで計算して覚えておく）
  const characters = new CharacterStore(new Worker(new URL('./build/characterWorker.ts', import.meta.url), { type: 'module' }));
  game.characterOf = (d) => characters.get(d);
  // 発見ポイント：建物を建てる時に使い、片付けると戻る（progress は下で作る）
  game.wallet = { get: () => progress.points, add: (n) => { progress.points = Math.max(0, progress.points + n); refreshGhosts(); } };
  let onCharacterReady: () => void = () => {};
  characters.onReady = () => { game.characterReady(); onCharacterReady(); };
  /** 知らせを出す（toast を作るまでは何もしない） */
  let notify: (msg: string) => void = () => {};
  // Drive との同期：プレイヤーが手を加えたら印を立てる（生き物の発見や時間の経過では立てない）
  const syncState = createSyncState(localStorage);
  let cloud: CloudSync | null = null; // Google 同期（保存の所で作る）
  /** プレイヤーが手を加えた：印を立て、少したったら Drive に送る */
  const playerChanged = () => { syncState.markChanged(); cloud?.onEdit(); };
  game.onPlayerChange = playerChanged;
  // 建物が建ち終わった（時間の経過で）。toast は後で作るので、呼ばれた時に探す
  game.onBuildingDone = (name) => notify(`🏠「${name}」が完成しました`);
  game.farm.speed = parseFloat($<HTMLSelectElement>('simSpeed').value); // 時間の流れの初期値（画面の選択）
  // 生き物（住人・訪問者・図鑑・来るかどうかの判定）
  const eco = new EcoManager({
    diorama, envInput: () => game.envInput(), toast: (m, ms) => toast(m, ms), fireflies, treeShape: (c) => game.treeShape(c),
    onChanged: () => { game.unsaved = true; refreshDex(); },
    onPoints: (n) => { progress.points += n; refreshGhosts(); },
    // 訪問者が、その箱庭でとりにくい素材を運んできた（v0.16.1。v0.20 から素材）
    onGift: (id, mat, n) => {
      gain(game.farm.inventory, mat, n);
      game.unsaved = true;
      const who = dexStage(eco.dex, id) === 'observed' ? VISITOR[id].name : '訪問者';
      toast(`${who}が${MAT_NAME[mat]}を ${n} 個運んできた`);
      if (bagIsOpen()) renderBagNow();
    },
  });
  game.onEnvChanged = () => eco.envDirty();
  game.onBuildingsPlaced = (cols) => eco.evictFrom(cols); // 建物の足元にいた住人は外へ
  game.residents = () => eco.residentInfos(); // 住人の仕事（v0.16.1）
  let onGenerated: ((r: InitResult) => void) | null = null;
  const onPlot = (r: PlotResult) => {
    game.addPlot(r);
    progress.points = Math.max(0, progress.points - OPEN_PLOT_POINTS);
    game.unsaved = true; playerChanged();
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
  // 進み具合（発見ポイント。v0.14〜 は土地の権利をなくし、ポイントで区画を開き、建物を建てる）
  let progress: SaveData['progress'] = { points: 0, rightsUsed: 0, unlocks: [], firsts: [], newMarks: [] };
  let base: THREE.Group | null = null;
  // エディタモードで、開ける隣の区画を半透明の枠で見せる
  const ghosts = new PlotGhosts();
  scene.add(ghosts.group);
  /** 区画を開いている途中（ワーカーの返事待ち）。素早く 2 回押しても 1 回だけ開く */
  let opening = false;
  /** 使える発見ポイント（区画を開いている途中なら、その分を引いておく） */
  const points = () => Math.max(0, progress.points - (opening ? OPEN_PLOT_POINTS : 0));
  /** 開いた区画の地面の平均の高さ（枠を置く高さの目安） */
  const groundOf = (plot: number) => {
    const w = world!;
    let sum = 0, n = 0;
    const S = PLOTS_PER_SIDE;
    for (let p = 0; p < PLOT_COUNT; p++) {
      if (!isOpen(w.plots, p) || Math.abs((p % S) - (plot % S)) + Math.abs(Math.floor(p / S) - Math.floor(plot / S)) !== 1) continue;
      const r = plotRect(p);
      for (let z = r.z0; z < r.z1; z += 4) for (let x = r.x0; x < r.x1; x += 4) { sum += Math.max(w.heights[x + z * FRAME], w.waterLevel); n++; }
    }
    return n ? sum / n : w.waterLevel;
  };
  /** いまの箱庭の、区画ごとの土地の型（地形の作り方の版 2 だけ。版 1 の箱庭は区画で地形が変わらないので出さない） */
  let worldLands: PlotLand[] | null = null;
  /** いまの箱庭の、地形の作り方の版 */
  let worldLand = 1;
  const refreshGhosts = () => { if (world) ghosts.update(world.plots, points() >= OPEN_PLOT_POINTS ? 1 : 0, groundOf, worldLands); };
  let plotResolve: (() => void) | null = null;
  /** 開いている途中の区画（作り直す前に、開き終わるのを待つ） */
  let openingDone: Promise<void> | null = null;
  /** 区画を開く（発見ポイントを 30 使う）。開けない時は理由を返す */
  const openPlot = (plot: number): Promise<void> | string => {
    if (!world) return '';
    if (game.locked) return 'いま箱庭を作っています';
    if (opening) return 'いま土地を開いています';
    if (!canOpen(world.plots, plot, points())) return points() >= OPEN_PLOT_POINTS ? 'この土地はまだ開けません' : `発見ポイントが足りません（${OPEN_PLOT_POINTS} 要ります）`;
    // ポイントは開き終わった時（onPlot）に使う。それまでは points() で引いておく（途中で保存しても食い違わないように）
    opening = true;
    // 先に、まだ送っていない編集をワーカーに渡してから区画を足す（境目のチャンクが古い地形で作られないように）
    game.sendDeltaNow();
    // 区画の編集と、版 3 では作り直す隣の区画の編集も（作り直した列に当て直す。同じ値を書くだけなので、ほかの列は変わらない）
    const edits: number[] = [];
    const px = plot % PLOTS_PER_SIDE, pz = Math.floor(plot / PLOTS_PER_SIDE);
    for (const [i, t] of game.edits) {
      const c = i % (FRAME * FRAME), q = plotOfCol(c % FRAME, Math.floor(c / FRAME));
      if (q === plot || (worldLand >= 3 && Math.abs((q % PLOTS_PER_SIDE) - px) <= 1 && Math.abs(Math.floor(q / PLOTS_PER_SIDE) - pz) <= 1)) edits.push(i, t);
    }
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
      // 区画ごとの土地の型は版 2 だけ（版 3 の空島はノイズで広がるので、区画のアイコンを出さない）
      worldLands = (params.land ?? 1) === 2 ? plotLands(seed, landCountsOf(params)) : null;
      worldLand = params.land ?? 1;
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
        // 1 マス変えた時に、その高さの層だけを送れるように（v0.18。three の WebGPU は Data3DTexture でも layerUpdates を見る）
        { const lu = new Set<number>(); Object.assign(typeTex, { layerUpdates: lu, clearLayerUpdates: () => lu.clear() }); }
        typeTex.needsUpdate = true;
        terrainMat?.dispose();
        terrainMat = createTerrainMaterial(typeTex, w.size, w.height, liteTerrain, isToon(), renderStyle === 'toonLite');

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
    base = null;
    // 空島（版 3）には台座を出さない
    if (worldLand < 3) { base = buildBase(w.plots); diorama.add(base); }

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
  const tmpHalf = new THREE.Vector3();
  const cdDir = new THREE.Vector3(), cdO = new THREE.Vector3();
  const centerDepth = (): number | null => {
    if (!world) return null;
    const N = world.size, H = world.height, half = N / 2;
    const dir = cdDir;
    camera.getWorldDirection(dir);
    const o = cdO.copy(camera.position).add(tmpHalf.set(half, 0, half));
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

  /**
   * ホイールでズームする前に、注視点を画面中央に見えている地面へ置き直す（v0.16）。
   * カーソルへ向かうズームは、注視点を「カメラの前、いまの距離の所」に置くので、何度も寄ったり引いたりすると
   * 注視点が地面から離れた空中に残り、距離が最短（3）に張り付いてそれ以上寄れなくなっていた。
   * 見ている向きはそのまま（注視点は視線の上を動くだけ）なので、画面は変わらない
   */
  renderer.domElement.addEventListener('wheel', () => {
    const d = centerDepth();
    if (d === null || d < 1) return;
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    controls.target.copy(camera.position).addScaledVector(dir, d);
  }, { capture: true, passive: true });

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
  /** ログイン中のスマホは見るだけ（エディタに入れない） */
  let viewOnly = false;
  const hintEl = $('toolHint'), toastEl = $('toast'), tooltipEl = $('tooltip');
  let toastTimer = 0;
  notify = (msg: string) => toast(msg, 3000);
  const toast = (msg: string, ms = 1600) => {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), ms);
  };
  /** 読み込んだ建物の名前など、外から来た文字を HTML に入れる時に使う */
  const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

  let editTool: Tool = 'till';

  // 左のエディタパネル：上の Build｜Life｜Terrain（1〜3 キー）でグループを選び、その中の道具を選ぶ
  /** ホバーの説明（道具のボタン・図鑑のカード） */
  const hoverTip = new HoverTip($('hoverTip'));
  /** 道具の選択肢 1 つ。id：'till'・'seed:wheat'・'block:3'・'flower:1'・'path:15'・'build:<建物>' など */
  type ToolOption = { id: string; icon: string; name: string; help: string };
  const help = (t: Tool) => TOOLS.find((x) => x.id === t)!.help;
  /** 植栽（v0.20.1）：左の一覧では 1 つ。選ぶと画面下に植えるものが並ぶ */
  const PLANTING: ToolOption = { id: 'planting', icon: '🌱', name: '植栽', help: '作物の種をまく・苗木を植える。選ぶと画面の下に、植えるもの（作物 10 種類と苗木 2 種類）が並ぶ' };
  /** グループ（1〜3 キーもこの順） */
  const GROUPS: { id: string; name: string; options: () => ToolOption[] }[] = [
    { id: 'g:build', name: 'Build', options: () => [
      ...[...game.designs.values()].map((d) => ({ id: `build:${d.id}`, icon: '🏠', name: d.name, help: help('build') })),
      { id: 'unbuild', icon: '🧹', name: '片付ける', help: help('unbuild') },
    ] },
    { id: 'g:life', name: 'Life', options: () => [
      // 耕す・植栽（作物と苗木。画面下で選ぶ。v0.20.1）・水やり・収穫（game/tools.ts）
      ...registryOptions('life').filter((o) => !o.id.startsWith('seed:')).flatMap((o) => (o.id === 'till' ? [o, PLANTING] : [o])),
      ...FLOWER_KINDS.map((f) => ({ id: `flower:${f.variant}`, icon: f.icon, name: f.name, help: help('flower') })),
      { id: 'pick', icon: '✂', name: '摘む・刈る', help: help('pick') },
      { id: 'fell', icon: '🪓', name: '木を切る', help: help('fell') },
    ] },
    { id: 'g:terrain', name: 'Terrain', options: () => [
      { id: 'dig', icon: '🕳', name: '掘る', help: help('dig') },
      { id: 'level', icon: '📏', name: '整地', help: help('level') },
      ...PATH_KINDS.map((p) => ({ id: `path:${p.id}`, icon: p.icon, name: p.name, help: help('path') })),
      ...PLACE_BLOCKS.map((b) => ({ id: `block:${b.id}`, icon: b.icon, name: `${b.name}を置く`, help: `${b.name}のブロックを置く` })),
    ] },
  ];
  /** その道具が入っているグループ（Build は棚の建物で中身が変わるので、id の形でも見る） */
  const groupOf = (id: string) => (id.startsWith('build:') ? GROUPS[0] : GROUPS.find((g) => g.options().some((o) => o.id === id)) ?? GROUPS[1]);
  /** グループごとに、最後に選んだ道具 */
  const lastByGroup = new Map<string, string>();
  /** 植栽（v0.20.1）：作物の種と苗木を 1 つの道具にまとめ、何を植えるかは画面下の選択バーで選ぶ */
  const isPlanting = (id: string) => id === 'planting' || id.startsWith('seed:') || id.startsWith('sapling:');
  let lastPlant = 'seed:turnip';
  const SEASON_SHORT = ['春', '夏', '秋', '冬'];
  const plantItems = (): PickItem[] => [
    ...CROP_KINDS.map((k) => ({
      id: `seed:${k}`, name: CROPS[k].name, img: thumbOf(`crop:${k}`, () => buildCropGeometry(k, 3)),
      help: `${CROPS[k].name}の種をまく（畑に）。育つまで約 ${CROPS[k].hours} 時間・旬は ${CROPS[k].seasons.map((x) => SEASON_SHORT[x]).join('・')}`,
    })),
    { id: 'sapling:broad', name: '広葉樹', img: thumbOf('sapling:broad', () => buildSaplingGeometry('broad')), help: '広葉樹の苗木を植える（草地か土に）。約 1 日で丸い葉の木になる' },
    { id: 'sapling:conifer', name: '針葉樹', img: thumbOf('sapling:conifer', () => buildSaplingGeometry('conifer')), help: '針葉樹の苗木を植える（草地か土に）。約 1 日でとがった葉の木になる' },
  ];
  const pickBar = new PickBar($('pickBar'), (id) => pickTool(id), (it) => { if (it) hintEl.textContent = it.help ?? it.name; });
  /** 画面下の選択バーを、いまの道具に合わせる（エディタで植栽を持っている時だけ出す） */
  const syncPickBar = () => {
    const on = mode === 'edit' && isPlanting(editPick);
    if (on) pickBar.show(plantItems(), editPick); else pickBar.hide();
    layoutEl.classList.toggle('has-pickbar', on);
  };
  let editPick = 'till';
  /** 道具を持つ。グループの id（'g:life' など）なら、そのグループで最後に使った道具 */
  const pickTool = (id: string | null) => {
    if (!id || viewOnly) return;
    if (id.startsWith('g:')) {
      const g = GROUPS.find((x) => x.id === id)!;
      const opts = g.options();
      const last = lastByGroup.get(id);
      id = last && (opts.some((o) => o.id === last) || isPlanting(last)) ? last : opts[0].id;
    }
    if (id === 'planting') id = lastPlant;
    let t: Tool;
    if (id.startsWith('seed:')) { game.seed = id.slice(5) as CropKind; t = 'seed'; lastPlant = id; }
    else if (id.startsWith('sapling:')) { game.saplingKind = id.slice(8) === 'conifer' ? 'conifer' : 'broad'; t = 'plant'; lastPlant = id; }
    else if (id.startsWith('block:')) { game.block = parseInt(id.slice(6), 10); t = 'raise'; }
    else if (id.startsWith('flower:')) { game.flowerVariant = parseInt(id.slice(7), 10); t = 'flower'; }
    else if (id.startsWith('path:')) { game.pathBlock = parseInt(id.slice(5), 10); t = 'path'; }
    else if (id.startsWith('build:')) {
      const did = id.slice(6);
      if (!game.designs.has(did)) return;
      game.selectedDesign = did;
      t = 'build';
    } else t = id as Tool;
    editPick = id;
    lastByGroup.set(groupOf(id).id, id);
    selectTool(t);
  };

  /** 左のエディタパネル：いまのグループの道具を並べる。説明はホバーした時だけ出す */
  const toolsEl = $('tools');
  const renderEditor = () => {
    const g = groupOf(editPick);
    document.querySelectorAll<HTMLButtonElement>('[data-group]').forEach((b) => b.classList.toggle('on', b.dataset.group === g.id));
    hoverTip.hide();
    toolsEl.replaceChildren(...g.options().map((o) => {
      const b = document.createElement('button');
      b.type = 'button';
      const ic = Object.assign(document.createElement('span'), { className: 'ic', textContent: o.icon });
      const nm = Object.assign(document.createElement('span'), { className: 'n', textContent: o.name }); // 建物の名前は読み込んだ物なので textContent で
      b.append(ic, nm);
      b.classList.toggle('on', o.id === (isPlanting(editPick) ? 'planting' : editPick));
      b.addEventListener('click', () => pickTool(o.id));
      hoverTip.attach(b, () => o.help, 'right', false, $('editor'));
      return b;
    }));
    $('openBuildings').hidden = g.id !== 'g:build';
    hintEl.textContent = '';
    syncPickBar();
  };
  const renderChip = renderEditor;
  document.querySelectorAll<HTMLButtonElement>('[data-group]').forEach((b) => b.addEventListener('click', () => pickTool(b.dataset.group!)));
  $('openBuildings').addEventListener('click', () => void setViewer(true, game.designs.size ? 'shelf' : 'import'));
  const selectTool = (t: Tool) => {
    if (t === 'look' || viewOnly) { setMode('view'); return; }
    editTool = t;
    if (mode !== 'edit') setMode('edit');
    game.tool = t;
    renderEditor();
  };

  // ---------- 建物の窓（読み込み・見本・棚） ----------
  // 読み込んだ建物の名前や問題の文は、すべて textContent で出す（HTML として読ませない）
  const issuesBox = $('buildIssues'), issueList = $('buildIssueList');
  let lastIssues: ParseIssue[] = [];
  const copyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast('コピーしました'); } catch { toast('コピーできませんでした'); }
  };
  const showIssues = (issues: ParseIssue[]) => {
    lastIssues = issues;
    issueList.replaceChildren(...issues.map((i) => { const li = document.createElement('li'); li.textContent = i.message; return li; }));
    issuesBox.hidden = issues.length === 0;
  };
  const viewerEl = $('viewer');
  const viewerList = $('viewerList');
  const pasteEl = $<HTMLTextAreaElement>('buildPaste');
  let viewer: BuildingViewer | null = null;
  let viewerSel: string | null = null;
  let vtab: 'import' | 'shelf' = 'import';
  /** 読み込む欄に貼った建物の見本（まだ棚に入れていない） */
  let preview: BuildingDesign | null = null;
  let viewerShown: BuildingDesign | null | undefined;
  const viewerIsOpen = () => viewerEl.classList.contains('open');
  const renderViewer = () => {
    document.querySelectorAll<HTMLButtonElement>('[data-vtab]').forEach((b) => b.classList.toggle('on', b.dataset.vtab === vtab));
    $('vImport').hidden = vtab !== 'import';
    viewerList.hidden = vtab !== 'shelf';
    let d: BuildingDesign | null = null;
    if (vtab === 'shelf') {
      const designs = [...game.designs.values()];
      if (!viewerSel || !game.designs.has(viewerSel)) viewerSel = game.selectedDesign && game.designs.has(game.selectedDesign) ? game.selectedDesign : designs[0]?.id ?? null;
      viewerList.replaceChildren(...designs.map((x) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = `${x.kind === 'deco' ? '🪴' : '🏠'} ${x.name}`;
        b.title = x.name;
        b.classList.toggle('on', x.id === viewerSel);
        b.addEventListener('click', () => { viewerSel = x.id; renderViewer(); });
        li.appendChild(b);
        return li;
      }));
      d = viewerSel ? game.designs.get(viewerSel) ?? null : null;
      $('viewerEmpty').textContent = 'まだ建物がありません。「📥 読み込む」から入れてください';
    } else {
      d = preview;
      $('viewerEmpty').textContent = '左の欄に AI の返事や .geo.json の中身を貼ると、ここに見本が出ます';
    }
    $('viewerEmpty').hidden = !!d;
    $('viewerName').textContent = d ? d.name : '';
    $('viewerStats').textContent = d ? `${designStats(d).label}・建てるのに約 ${buildMinutes(d)} 分` : '';
    renderTraits(d);
    const add = $<HTMLButtonElement>('viewerAdd'), place = $<HTMLButtonElement>('viewerPlace'), del = $<HTMLButtonElement>('viewerDelete');
    add.hidden = vtab !== 'import';
    add.disabled = !d;
    add.textContent = d && game.designs.has(d.id) ? 'もう棚にあります（棚で見る）' : '棚に入れる';
    place.hidden = del.hidden = vtab !== 'shelf';
    place.disabled = del.disabled = !d;
    // 家か飾りか（棚に入れる前に選ぶ。棚でも変えられる）
    $('viewerKind').hidden = !d;
    document.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach((b) => b.classList.toggle('on', !!d && (b.dataset.kind === 'deco') === (d.kind === 'deco')));
    // 同じ建物なら見本を作り直さない（回した向きを保つ）
    if (viewer && d !== viewerShown) { viewer.show(d); viewerShown = d; }
  };
  // ---------- 持ち物・加工の窓（I キー） ----------
  const bagEl = $('bag');
  const bagIsOpen = () => bagEl.classList.contains('open');
  const renderBagNow = () => renderBag($('bagMats'), $('bagCrops'), game.farm.inventory, (el, html) => hoverTip.attach(el, html, 'left', true, bagEl));
  const setBag = (open: boolean) => {
    if (open && viewOnly) return;
    bagEl.classList.toggle('open', open);
    bagEl.setAttribute('aria-hidden', String(!open));
    hoverTip.hide();
    if (open) renderBagNow();
  };
  $('openBag').addEventListener('click', () => setBag(true));
  $('bagClose').addEventListener('click', () => setBag(false));
  bagEl.addEventListener('pointerdown', (e) => { if (e.target === bagEl) setBag(false); });

  /** 建物の性格（星 3 行と、遠のく生き物。まだ観察していない生き物は「？」） */
  const renderTraits = (d: BuildingDesign | null) => {
    const box = $('viewerTraits');
    box.hidden = !d;
    if (!d) return;
    const c = characters.get(d);
    if (!c) { box.textContent = '性格を計算しています…'; return; }
    const t = buildingTraits(c);
    const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
    const name = (id: VisitorId) => (dexStage(eco.dex, id) === 'observed' ? VISITOR[id].name : '？');
    const away = t.away.length ? t.away.map((a) => `${name(a.id)}（${a.why}）`).join('・') : 'なし';
    // 好みそうな住人（形から。場所の条件があれば「〇〇のそばに建てると」。まだ観察していない住人は「？」）
    const likes = likelyResidents(c).map((x) => `${dexStage(eco.dex, x.species) === 'observed' ? SPECIES[x.species].name : '？'}${x.site ? `（${SITE_NAMES[x.site]}のそばに建てると）` : ''}`).join('・') || 'いない';
    // コスト：素材ごとの必要量と手持ち、発見ポイント、時間（数字で）
    const cost = buildCost(c);
    const inv = game.farm.inventory;
    const matRows = MAT_IDS.filter((m) => (cost.mats[m] ?? 0) > 0).sort((a, b) => (cost.mats[b] ?? 0) - (cost.mats[a] ?? 0)).map((m) => {
      const n = cost.mats[m] ?? 0, have = Math.floor(inv[m] ?? 0);
      return `<span class="tr-cost${have >= n ? '' : ' lack'}">${esc(MAT_NAME[m])} ${have}/${n}</span>`;
    }).join('');
    const pts = progress.points;
    box.innerHTML = t.rows.map((r) => `<div class="tr-row"><span class="tr-label">${esc(r.label)}</span><span class="tr-stars">${esc(r.stars)}</span><span class="tr-note">${esc(r.note)}</span></div>`).join('') +
      `<div class="tr-away">遠のく生き物：${esc(away)}</div>` +
      `<div class="tr-away">${d.kind === 'deco' ? '飾り：住人の住まいにはならない（性格は弱め）' : `好みそうな住人：${esc(likes)}`}</div>` +
      `<div class="tr-costs"><div class="tr-cost-head">建てるのに要るもの（手持ち/必要）</div>${matRows}` +
      `<span class="tr-cost${pts >= cost.points ? '' : ' lack'}">✨ 発見ポイント ${pts}/${cost.points}</span><span class="tr-cost">⏱ 約 ${buildMinutes(d)} 分</span></div>`;
  };
  onCharacterReady = () => { if (viewerIsOpen()) renderViewer(); };
  const setViewer = async (open: boolean, tab?: 'import' | 'shelf') => {
    if (tab) vtab = tab;
    viewerEl.classList.toggle('open', open);
    viewerEl.setAttribute('aria-hidden', String(!open));
    if (!open) { viewer?.close(); return; }
    stroke = null;
    game.endEdit();
    viewer ??= new BuildingViewer($<HTMLCanvasElement>('viewerCanvas'), forceWebGL);
    await viewer.open();
    viewerShown = undefined;
    renderViewer();
  };
  document.querySelectorAll<HTMLButtonElement>('[data-vtab]').forEach((b) => b.addEventListener('click', () => { vtab = b.dataset.vtab as 'import' | 'shelf'; renderViewer(); }));
  /** 貼った文を読んで、見本を出す（問題があれば並べる） */
  const updatePreview = () => {
    const text = pasteEl.value;
    if (!text.trim()) { preview = null; showIssues([]); renderViewer(); return; }
    const r = parseBuilding(text);
    if (r.ok) { preview = r.design; showIssues([]); } else { preview = null; showIssues(r.issues); }
    renderViewer();
  };
  let previewTimer = 0;
  pasteEl.addEventListener('input', () => { clearTimeout(previewTimer); previewTimer = window.setTimeout(updatePreview, 250); });
  $('buildCopyPrompt').addEventListener('click', () => copyText(buildPrompt($<HTMLTextAreaElement>('buildIdea').value)));
  $('buildCopyFix').addEventListener('click', () => copyText(buildFixPrompt(lastIssues)));
  const readFile = async (f: File) => {
    if (f.size > LIMITS.fileBytes * 4) {
      preview = null;
      showIssues([{ code: 'file_size', message: `ファイルが ${Math.ceil(f.size / 1024)} KB あります。${LIMITS.fileBytes / 1024} KB 以下にしてください。` }]);
      renderViewer();
      return;
    }
    pasteEl.value = await f.text();
    updatePreview();
  };
  $<HTMLInputElement>('buildFile').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) void readFile(f);
  });
  // 箱庭の画面に .geo.json を落としても、建物の窓を開いて見本を出す（エディタのとき）
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
    void setViewer(true, 'import').then(() => readFile(f));
  });
  $('viewerClose').addEventListener('click', () => void setViewer(false));
  viewerEl.addEventListener('pointerdown', (e) => { if (e.target === viewerEl) void setViewer(false); });
  $('viewerAdd').addEventListener('click', () => {
    if (!preview) return;
    const added = game.addDesign(preview) === 'added';
    if (added) toast(`「${preview.name}」を棚に入れました`);
    viewerSel = preview.id;
    renderEditor();
    vtab = 'shelf';
    renderViewer();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach((b) => b.addEventListener('click', () => {
    const kind = b.dataset.kind === 'deco' ? 'deco' : 'house';
    if (vtab === 'import' && preview) { if (kind === 'deco') preview.kind = 'deco'; else delete preview.kind; if (game.designs.has(preview.id)) game.setDesignKind(preview.id, kind); }
    else if (vtab === 'shelf' && viewerSel) game.setDesignKind(viewerSel, kind);
    renderEditor();
    renderViewer();
  }));
  $('viewerPlace').addEventListener('click', () => {
    if (!viewerSel) return;
    const id = viewerSel;
    void setViewer(false);
    pickTool(`build:${id}`);
    toast('置く場所をクリックしてください（R で向きを変える）');
  });
  $('viewerDelete').addEventListener('click', () => {
    const d = viewerSel ? game.designs.get(viewerSel) : undefined;
    if (!d || !confirm(`「${d.name}」を棚から消しますか？ 箱庭に置いた分も消えます。`)) return;
    game.removeDesign(d.id);
    viewerSel = null;
    renderEditor();
    renderViewer();
  });

  const layoutEl = $('layout');
  const setViewOnly = (on: boolean) => {
    if (viewOnly === on) return;
    viewOnly = on;
    layoutEl.classList.toggle('view-only', on);
    if (on && mode === 'edit') setMode('view');
  };
  const setMode = (m: Mode) => {
    if (viewOnly && m === 'edit') m = 'view';
    mode = m;
    layoutEl.classList.remove('mode-view', 'mode-edit');
    layoutEl.classList.add(`mode-${m}`);
    // 視点は両方のモードで同じ：右ドラッグで回す、中ドラッグで動かす（エディタの左ドラッグは道具）
    controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE } as unknown as typeof controls.mouseButtons;
    game.tool = m === 'edit' ? editTool : 'look';
    if (m === 'edit') selectTool(editTool);
    hoverTip.hide();
    game.cursor.visible = false;
    tooltipEl.style.display = 'none';
    pinned = null;
    ghosts.group.visible = m === 'edit';
    ghosts.setHover(-1);
    syncPickBar();
    if (m === 'view') refreshDex();
  };

  // Esc メニュー：画面全体をすりガラスにして、保存などのメニューを出す
  const menuEl = $('menu');
  const menuOpen = () => menuEl.classList.contains('open');
  const setMenu = (open: boolean) => {
    menuEl.classList.toggle('open', open);
    menuEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      stroke = null;
      game.endEdit();
      hoverTip.hide();
      tooltipEl.style.display = 'none';
      game.cursor.visible = false;
      showSaveStatus();
    }
  };
  $('menuOpen').addEventListener('click', () => setMenu(true));
  $('menuFab').addEventListener('click', () => setMenu(true));
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
    const entering = !document.fullscreenElement;
    // 全画面にする時は、その場でメニューを閉じる（全画面になった箱庭がすぐ見えるように）
    if (entering) setMenu(false);
    // 埋め込みの画面などでは、要求が成功も失敗もせず止まることがあるので時間を区切る
    const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 1500));
    try {
      const req = entering ? document.documentElement.requestFullscreen({ navigationUI: 'hide' }) : document.exitFullscreen();
      if ((await Promise.race([req, timeout])) === 'timeout' && !document.fullscreenElement) toast('この画面では全画面にできませんでした（ブラウザの設定や埋め込み表示のため）', 3500);
    } catch {
      toast('全画面にできませんでした', 2500);
    }
    syncFullscreen();
  });
  document.addEventListener('fullscreenchange', syncFullscreen);

  // パネルの外（すりガラスの部分）を押しても閉じる
  menuEl.addEventListener('pointerdown', (e) => { if (e.target === menuEl) setMenu(false); });

  /** 押している移動キー（WASD）。e.code で見るので、日本語入力中でも効く */
  const moveKeys = new Set<string>();
  const MOVE_CODES = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
  window.addEventListener('keyup', (e) => moveKeys.delete(e.code));
  window.addEventListener('blur', () => { moveKeys.clear(); hoverTip.hide(); });
  window.addEventListener('keydown', (e) => {
    if (viewerIsOpen()) { if (e.key === 'Escape') void setViewer(false); return; } // 建物の窓を開いている間は、Esc で閉じるだけ
    if (bagIsOpen()) { if (e.key === 'Escape' || e.code === 'KeyI') setBag(false); return; } // 持ち物の窓も同じ
    if (e.key === 'Escape') { setMenu(!menuOpen()); return; }
    if (menuOpen()) return; // メニューを開いている間は他のキーを受け付けない
    if ((e.target as HTMLElement).closest?.('input[type="text"], input[type="number"], textarea, select')) return;
    // Tab：見るモード ⇄ エディタモード（ブラウザのフォーカス移動はさせない）
    // I：持ち物・加工の窓
    if (e.code === 'KeyI' && !e.ctrlKey && !e.metaKey) { setBag(true); return; }
    if (e.code === 'Tab') {
      e.preventDefault();
      if (!e.repeat) setMode(mode === 'view' ? 'edit' : 'view');
      return;
    }
    // 1〜3（テンキーも）：Build・Life・Terrain（見るモードからでもエディタに入る）。押す位置（e.code）で見るので、日本語入力中でも効く
    const g = /^(?:Digit|Numpad)([1-3])$/.exec(e.code);
    if (g && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      pickTool(GROUPS[+g[1] - 1].id);
      return;
    }
    // Ctrl+Z（Mac は ⌘Z）：エディタで、最後の編集を取り消す。押した位置（e.code）で見るので日本語入力中でも効く
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyZ') {
      e.preventDefault();
      if (mode !== 'edit' || stroke) return;
      toast(game.undoLast() ?? '取り消せる編集がありません');
      return;
    }
    // Ctrl+Y・Ctrl+Shift+Z（Mac は ⌘⇧Z）：取り消した編集をやり直す
    if ((e.ctrlKey || e.metaKey) && ((!e.shiftKey && e.code === 'KeyY') || (e.shiftKey && e.code === 'KeyZ'))) {
      e.preventDefault();
      if (mode !== 'edit' || stroke) return;
      toast(game.redoLast() ?? 'やり直せる編集がありません');
      return;
    }
    if (MOVE_CODES.includes(e.code)) { moveKeys.add(e.code); return; }
    if (e.code === 'KeyR' && mode === 'edit' && game.tool === 'build') game.rotateBuild(); // 次に置く建物の向き（カーソルの枠は毎フレーム作り直す）
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
        // 開く前に確かめる（v0.16.2）。開けない時（ポイントが足りないなど）は理由だけ出す
        if (world && canOpen(world.plots, plot, points()) && !game.locked && !opening) {
          const land = worldLands ? PLOT_LAND_INFO[worldLands[plot]] : null;
          if (!confirm(`この土地を開きますか？${land ? `（${land.icon} ${land.text}）` : ''}
発見ポイントを ${OPEN_PLOT_POINTS} 使います（いま ${points()}）。`)) return;
        }
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
    if (!downAt || !world || e.button !== 0 || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
    setMouse(e.clientX, e.clientY);
    // 住人をクリック：収穫物をおすそ分けする（v0.16.1。好きなものがあればそれ）
    const t = targetAtMouse();
    if (t?.kind === 'animal' && !viewOnly) {
      const crop = eco.share(t.animal, game.farm.inventory, game.farm.simMs);
      if (!crop) { toast('おすそ分けできる収穫物がありません（作物を収穫すると持ち物に入る）'); return; }
      game.unsaved = true; playerChanged();
      const liked = CROPS[crop as CropKind].name === t.animal.favorite;
      toast(`${t.animal.name}に${CROPS[crop as CropKind].name}をおすそ分けした${liked ? '（大好物！）' : ''}。しばらく素材を多く拾ってくる`);
      return;
    }
    // 見る・ステータス：水面をクリックすると波紋
    raycaster.setFromCamera(mouse, camera);
    const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(world.waterLevel - 0.15)), new THREE.Vector3());
    if (hit && isWaterAt(hit.x, hit.z)) addRipple(hit.x, hit.z, 1);
  });

  // 見るモード：作物・動物にホバーすると情報を小さく出す。右クリックで固定（他の所を触るまで）
  type Target = { kind: 'animal'; animal: Animal } | { kind: 'crop'; col: number } | { kind: 'visitor'; visitor: Visitor } | { kind: 'firefly'; pos: THREE.Vector3 } | { kind: 'site'; key: string };
  let pinned: Target | null = null;
  /** 同じ対象か（観察の時間を続けて数えるかどうかにも使う。ホタルはどの粒でも同じ） */
  const targetKey = (t: Target | null) =>
    !t ? '' : t.kind === 'animal' ? `a${t.animal.id}` : t.kind === 'crop' ? `c${t.col}` : t.kind === 'visitor' ? `v${t.visitor.def.id}` : t.kind === 'site' ? `s${t.key}` : 'firefly';
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
    // 建設中の建物（地形より手前にある時）
    const site = game.siteAt(raycaster.ray.origin, raycaster.ray.direction, voxelHit ? voxelHit.t : Infinity);
    if (site) return { kind: 'site', key: site.key };
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
        `<div class="tt-line">いま：${ACTIVITY_NAMES[a.activity]}</div><div class="tt-line">好きなもの：${a.favorite}</div><div class="tt-line">仕事：${JOB_TEXT[a.species]}</div>` +
        (a.treatedUntil > game.farm.simMs ? `<div class="tt-line">🧺 おすそ分けをもらってうれしそう（あと約 ${Math.ceil((a.treatedUntil - game.farm.simMs) / 3600_000)} 時間）</div>` : '') +
        (viewOnly ? '' : '<div class="tt-line tt-muted">クリック：収穫物をおすそ分け</div>') + ringHtml(t);
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
    if (t.kind === 'site') {
      // 建ち終わった・片付けた建物は対象から外す
      const s = game.siteInfo(t.key);
      if (!s) return null;
      const left = s.minutes >= 60 ? `${Math.floor(s.minutes / 60)}時間${s.minutes % 60}分` : `${s.minutes}分`;
      return `<div class="tt-title">🏗 ${esc(s.name)}</div><div class="tt-sub">建設中</div><div class="tt-line">組み上がったパーツ ${s.built} / ${s.total}</div>` +
        `<div class="tt-line">完成まで あと約 ${left}</div><div class="bar"><i style="width:${Math.round(s.progress * 100)}%"></i></div>`;
    }
    const d = game.describeCrop(t.col, lastEnv);
    if (!d) return null;
    return `<div class="tt-title">${CROP_ICONS[game.farm.crops.get(t.col)!.kind]} ${d.title}</div>` + d.lines.map((l) => `<div class="tt-line">${l}</div>`).join('') +
      `<div class="bar"><i style="width:${Math.round(d.progress * 100)}%"></i></div>`;
  };

  const targetWorldPos = (t: Target) =>
    t.kind === 'animal' ? t.animal.object.position.clone().add(new THREE.Vector3(0, 1.2, 0))
      : t.kind === 'visitor' ? t.visitor.anchor.clone() : t.kind === 'firefly' ? t.pos.clone()
      : t.kind === 'site' ? game.siteInfo(t.key)?.top ?? new THREE.Vector3() : game.colTop(t.col).add(new THREE.Vector3(0, 0.4, 0));

  /** 観察：同じ生き物にカーソルを 1.5 秒合わせ続けると図鑑に「観察した」と載る */
  const OBSERVE_SECONDS = 1.5;
  let observing: { key: string; t: number } | null = null;
  /** 観察し終えた対象（カーソルを外すまで、もう一度は数えない） */
  let looked: string | null = null;
  let hoverTarget: Target | null = null;
  const updateObserve = (dt: number) => {
    const t = mode === 'view' ? hoverTarget : null;
    const id = dexIdOf(t);
    if (!t || !id) { observing = null; looked = null; return; }
    const key = targetKey(t);
    if (looked === key) return;
    if (!observing || observing.key !== key) observing = { key, t: 0 };
    observing.t += dt;
    if (observing.t >= OBSERVE_SECONDS) {
      observing = null;
      looked = key;
      if (eco.needsObserving(id, lastMoment.season)) {
        const pts = eco.observe(id, lastMoment.season);
        if (pts > 0) { progress.points += pts; refreshGhosts(); }
      }
      // 季節の目標（観察した生き物・家で暖まっている住人）は、図鑑で観察済みでも数える
      if (goals) {
        logLook(goals.log, id, t.kind === 'animal' && t.animal.activity === 'warm', Date.now());
        updatePairs(goals);
        game.unsaved = true;
        goalsAt = -Infinity;
      }
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
  const refreshDex = () => { hoverTip.hide(); renderDex($('dexGrid'), eco.dex, eco.animals, eco.visitors, eco.env(), (card, html) => hoverTip.attach(card, html, 'left', true, $('right'))); };

  // ---------- 季節の目標（v0.17。eco/goals.ts。右のパネルの図鑑の上） ----------
  let goals: GoalsState | null = null;
  /** 始めたばかりの箱庭か（最初の 3 つを、操作を覚える目標にする） */
  let goalsTutorial = false;
  const goalCtx = () => ({ env: eco.env(), residents: eco.animals.map((a) => a.species) });
  const knownDex = (id: DexId) => dexStage(eco.dex, id) === 'observed';
  let goalsHtml = '';
  const renderGoals = () => {
    const now = new Date();
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    $('goalsLeft').textContent = `${SEASON_NAMES[seasonAt(now).season]}・あと ${Math.max(1, Math.ceil((end - now.getTime()) / 86_400_000))} 日`;
    const c = goalCtx();
    const html = (goals?.goals ?? []).map((g, i) => {
      // まだ観察していない生き物（「？？？」）は、図鑑と同じヒントを小さく添える
      const unknownHint = !g.done && g.conds.some((k) => (k.k === 'see' || k.k === 'sameDay' || k.k === 'resident') && (k.k === 'resident' ? [k.sp] : k.ids).some((id) => !knownDex(id))) ? goalHint(g, knownDex) : '';
      const prog = g.done ? '' : [...g.conds.map((k) => condProgress(k, goals!.log, c)), unknownHint].filter(Boolean).join('・');
      return `<li class="goal${g.done ? ' done' : ''}" data-i="${i}"><span class="goal-tier t${g.tier}">${TIER_NAMES[g.tier]}</span>` +
        `<span class="goal-text">${esc(goalText(g, knownDex))}${prog ? `<small class="goal-prog">${esc(prog)}</small>` : ''}</span>${g.done ? '<span class="goal-check">✓</span>' : ''}</li>`;
    }).join('');
    if (html === goalsHtml) return; // 変わっていなければ描き直さない（説明の表示が途切れないように）
    goalsHtml = html;
    const box = $('goalsList');
    box.innerHTML = html;
    box.querySelectorAll<HTMLElement>('li').forEach((li) => {
      const i = Number(li.dataset.i);
      hoverTip.attach(li, () => {
        const g = goals?.goals[i];
        if (!g) return '';
        const hint = goalHint(g, knownDex);
        const reward = `ほうび：発見ポイント ${TIER_POINTS[g.tier]}・手に入りにくい素材${g.tier === 2 ? '・季節の記念の飾り' : ''}`;
        return `<div class="tt-title">🎯 ${esc(goalText(g, knownDex))}</div>${hint ? `<div class="tt-line">${esc(hint)}</div>` : ''}<div class="tt-line tt-muted">${g.done ? '達成しました' : reward}</div>`;
      }, 'left', true, $('right'));
    });
  };
  /** 達成した：発見ポイント・素材（その箱庭で手に入りにくいもの）・難しいものは記念の飾り */
  const rewardGoal = (g: Goal) => {
    const r = goalReward(g, eco.env(), Math.random);
    progress.points += r.points;
    refreshGhosts();
    gain(game.farm.inventory, r.mat, r.n);
    let extra = '';
    if (r.memento && goals) {
      const d = mementoDesign(goals.key);
      if (game.addDesign(d) === 'added') extra = `。記念の飾り「${d.name}」を棚に入れました`;
    }
    toast(`🎯 今季の目標を達成！「${goalText(g, knownDex)}」 +${r.points}・${MAT_NAME[r.mat]} ×${r.n}${extra}`, 6000);
    if (bagIsOpen()) renderBagNow();
    game.unsaved = true;
  };
  let goalsAt = -Infinity;
  let snowDayTold = false;
  /** 2 秒ごと（何かあればすぐ）：季節が変わっていれば新しい 3 つにし、達成を確かめる */
  const tickGoals = () => {
    if (!world || regenerating) return;
    const nowR = performance.now();
    if (nowR - goalsAt < 2000) return;
    goalsAt = nowR;
    const c = goalCtx();
    const r = ensureSeason(goals, seasonKey(new Date()), { ...c, dex: eco.dex }, Math.random, goalsTutorial);
    const had = goals !== null;
    goals = r.state;
    if (r.changed) {
      goalsTutorial = false;
      game.unsaved = true;
      if (had) toast(`🎯 ${SEASON_NAMES[seasonOfKey(goals.key)]}になりました。今季の目標が新しく 3 つ出ています`, 5000);
    }
    eco.goalBoost = boostedVisitors(goals);
    for (const g of checkGoals(goals, c, Date.now())) rewardGoal(g);
    renderGoals();
    if (!snowDayTold && isSnowDay(new Date())) {
      snowDayTold = true;
      toast('❄ 今日は雪の日。家のそばの住人が、家に寄り添って暖まっています', 5000);
    }
  };
  // 収穫・耕す・花を植える・建物が建ち終わった（記念の飾りは数えない）
  game.onGoalEvent = (e) => {
    if (!goals) return;
    const log = goals.log;
    if (e.k === 'harvest') log.harvest[e.crop] = (log.harvest[e.crop] ?? 0) + 1;
    else if (e.k === 'till') log.till = true;
    else if (e.k === 'flower') log.flower = true;
    else if (!e.design.memento) {
      const ch = game.characterOf?.(e.design);
      log.builds.push({ nature: ch?.nature ?? 1, straw: (ch?.areas.fiber ?? 0) > 0, ...(e.design.kind === 'deco' ? { deco: true } : {}) });
    }
    game.unsaved = true;
    goalsAt = -Infinity;
  };
  $('goalsReset').addEventListener('click', () => {
    if (!world) return;
    const prev = goals?.goals.map((g) => g.id) ?? [];
    goals = { ...ensureSeason(null, seasonKey(new Date()), { ...goalCtx(), dex: eco.dex }, Math.random).state, prev };
    goalsAt = -Infinity;
    game.unsaved = true;
    toast('今季の目標を作り直しました');
  });

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
      if (!g.attributes.position) return; // 中身のない形（建物の見本を出す前など）は数えない
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
  const bumpInput = $<HTMLInputElement>('bump');
  bumpInput.addEventListener('input', () => { U.bump.value = parseFloat(bumpInput.value); });
  $<HTMLInputElement>('dof').addEventListener('change', (e) => { post.effects.dof = (e.target as HTMLInputElement).checked; updatePost(); });
  $<HTMLInputElement>('ssao').addEventListener('change', (e) => { post.effects.ao = (e.target as HTMLInputElement).checked; updatePost(); });
  const aoInput = $<HTMLInputElement>('aoStrength');
  aoInput.addEventListener('input', () => { uAO.value = parseFloat(aoInput.value); });
  $<HTMLInputElement>('bloom').addEventListener('change', (e) => { post.effects.bloom = (e.target as HTMLInputElement).checked; updatePost(); });

  // ---------- 描き方（ふつう／トゥーン・高／トゥーン・軽） ----------
  /** 影の地図の大きさ（トゥーン・軽は 1024 まで） */
  function shadowSizeOf(size: number) { return renderStyle === 'toonLite' ? Math.min(1024, size) : size; }
  const styleSelect = $<HTMLSelectElement>('renderStyle');
  const lineInput = $<HTMLInputElement>('toonLine');
  const setRenderStyle = (s: RenderStyle) => {
    renderStyle = s;
    localStorage.setItem('hakoniwa.renderStyle', s);
    styleSelect.value = s;
    $('toonLineRow').hidden = s === 'standard';
    // トゥーンでは、重い後処理（被写界深度・ブルーム）を切っておく（AO は使わない）。ふつうに戻したら画質のプリセットどおり
    if (s !== 'standard') { post.effects.dof = false; post.effects.bloom = false; setChecked('dof', false); setChecked('bloom', false); }
    else { const p = QUALITY[quality]; post.effects.ao = p.ao; post.effects.dof = p.dof; post.effects.bloom = p.bloom; setChecked('ssao', post.effects.ao); setChecked('dof', post.effects.dof); setChecked('bloom', post.effects.bloom); }
    const old = terrainMat;
    if (typeTex && world) terrainMat = createTerrainMaterial(typeTex, world.size, world.height, liteTerrain, s !== 'standard', s === 'toonLite');
    game.swapMaterials({ ...matsOf(s), terrainMat: old !== terrainMat ? terrainMat : null });
    if (old && old !== terrainMat) old.dispose();
    scene.backgroundNode = skyNodeOf(s);
    // 影の大きさと間引き（トゥーン・軽は 1024・4 フレームに 1 回）
    shadows.setMapSize(shadowSizeOf(QUALITY[quality].shadow));
    applyShadowEvery();
    updatePost(true);
  };
  styleSelect.value = renderStyle;
  styleSelect.addEventListener('change', () => setRenderStyle(isStyle(styleSelect.value) ? styleSelect.value : 'standard'));
  lineInput.addEventListener('input', () => { uLine.value = parseFloat(lineInput.value); });
  // 初期値（src/defaults.ts）をシェーダーへ
  U.blend.value = parseFloat(blendInput.value); U.bump.value = parseFloat(bumpInput.value); uAO.value = parseFloat(aoInput.value); uLine.value = parseFloat(lineInput.value);
  $('toonLineRow').hidden = renderStyle !== 'toon';

  // ---------- 画質プリセット ----------
  type Quality = 'high' | 'medium' | 'low';
  const QUALITY: Record<Quality, { pixelRatio: number; ao: boolean; dof: boolean; bloom: boolean; shadow: number; lite: boolean }> = {
    high: { pixelRatio: Math.min(devicePixelRatio, 2), ao: true, dof: true, bloom: true, shadow: 4096, lite: false },
    medium: { pixelRatio: Math.min(devicePixelRatio, 1.25), ao: true, dof: true, bloom: true, shadow: 2048, lite: false },
    low: { pixelRatio: Math.min(devicePixelRatio, 1), ao: false, dof: false, bloom: false, shadow: 1024, lite: true },
  };
  const QUALITY_NAMES: Record<Quality, string> = { high: '高', medium: '中', low: '低' };
  const isMobile = navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 820;
  // スマホは閲覧限定：建物の棚と読み込みは出さない（置いた建物は表示する）
  let quality: Quality = 'high';
  // 画質の初期値は「高」（画面の選択に合わせる）。WebGL2・スマホは重くならないよう「自動」にする（起動の所で切り替える）
  let qualityAuto = $<HTMLSelectElement>('quality').value === 'auto';
  const setChecked = (id: string, v: boolean) => { $<HTMLInputElement>(id).checked = v; };
  const applyQuality = (q: Quality, regenerateIfNeeded = true) => {
    quality = q;
    const p = QUALITY[q];
    renderer.setPixelRatio(p.pixelRatio);
    fit();
    post.effects.ao = p.ao; post.effects.dof = p.dof && !isToon(); post.effects.bloom = p.bloom && !isToon();
    setChecked('ssao', post.effects.ao); setChecked('dof', post.effects.dof); setChecked('bloom', post.effects.bloom);
    updatePost();
    shadows.setMapSize(shadowSizeOf(p.shadow));
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
  /** 時間の流れ（画面の選択）。箱庭を作り直すと畑も作り直されるので、そのたびに合わせる */
  const simSpeed = () => parseFloat($<HTMLSelectElement>('simSpeed').value);
  /** WASD の移動の速さ（注視点までの距離に掛ける倍率） */
  const moveSpeed = () => parseFloat($<HTMLInputElement>('moveSpeed').value) || 0.35;
  const syncDebugLabels = () => {
    $('moveSpeedLabel').textContent = `×${moveSpeed().toFixed(2)}`;
    hoverTip.delay = parseFloat($<HTMLInputElement>('tipDelay').value) || 0;
    $('tipDelayLabel').textContent = `${hoverTip.delay.toFixed(2)} 秒`;
  };
  $('moveSpeed').addEventListener('input', syncDebugLabels);
  $('tipDelay').addEventListener('input', syncDebugLabels);
  syncDebugLabels();
  // 地面の小石と草の多さ（この端末に覚える）
  const GROUND_KEY = 'hakoniwa.groundDensity';
  const groundInput = $<HTMLInputElement>('groundDensity');
  const storedGround = parseFloat(localStorage.getItem(GROUND_KEY) ?? '');
  if (storedGround >= 0 && storedGround <= 4) groundInput.value = String(storedGround);
  const applyGround = () => {
    const d = parseFloat(groundInput.value) || 0;
    game.setGroundDensity(d);
    $('groundDensityLabel').textContent = d > 0 ? `×${d.toFixed(1)}` : 'なし';
  };
  groundInput.addEventListener('input', () => {
    applyGround();
    try { localStorage.setItem(GROUND_KEY, groundInput.value); } catch { /* 保存できなくても変える */ }
  });
  applyGround();
  $<HTMLSelectElement>('simSpeed').addEventListener('change', () => { game.farm.speed = simSpeed(); });
  $('skip1').addEventListener('click', () => { game.skip(1, lastEnv); toast('1 時間進めました'); });
  $('skip6').addEventListener('click', () => { game.skip(6, lastEnv); toast('6 時間進めました'); });

  const hud = createHud();
  // 右のパネル（図鑑）の上の、時刻・季節・天気
  const updateStatus = (hh: number, mm: number, season: number, calendarSeason: number) => {
    const now = new Date();
    hud.updateStatus({ hh, mm, season, calendarSeason, weather: weatherOverride ?? weatherAt(now, season), snowDay: weatherOverride === null && isSnowDay(now), points: points(), openPoints: OPEN_PLOT_POINTS });
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
  const PARAM_KEYS: (keyof TerrainParams)[] = [
    'relief', 'mountains', 'water', 'rocks', 'forest', 'flowers', 'lakes', 'river', 'bare', 'shoreSand', 'conifer',
    'rockPlots', 'wetPlots', 'beachPlots', 'cliffs', 'wetland', 'pools', 'beachWidth',
    'islandEdge', 'islandDetail', 'islandDepth', 'biomeSize',
  ];
  /** 区画の数（整数で見せる） */
  const COUNT_KEYS = new Set<keyof TerrainParams>(['rockPlots', 'wetPlots', 'beachPlots']);
  const paramInput = (k: keyof TerrainParams) => $<HTMLInputElement>(`p-${k}`);
  const showParam = (k: keyof TerrainParams) => {
    const el = paramInput(k);
    (el.nextElementSibling as HTMLOutputElement).value = parseFloat(el.value).toFixed(COUNT_KEYS.has(k) ? 0 : 1);
  };
  PARAM_KEYS.forEach((k) => { paramInput(k).addEventListener('input', () => showParam(k)); showParam(k); });
  $('paramsReset').addEventListener('click', () => PARAM_KEYS.forEach((k) => { paramInput(k).value = String(DEFAULT_PARAMS[k]); showParam(k); }));
  // 新しく作る箱庭は、いまの地形の作り方（LAND_VERSION）。保存した箱庭は、保存した時の版のまま（worldSettings）
  const readParams = () => ({ ...Object.fromEntries(PARAM_KEYS.map((k) => [k, parseFloat(paramInput(k).value)])), land: LAND_VERSION }) as unknown as TerrainParams;
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
    // 保存に無いファクター（古い箱庭）は標準の値を見せる（地形も標準で作る）
    PARAM_KEYS.forEach((k) => { paramInput(k).value = String(s.params[k] ?? DEFAULT_PARAMS[k] ?? 1); showParam(k); });
  };
  const buildSave = (): SaveData => ({
    version: SAVE_VERSION, savedAt: Date.now(), world: worldSettings!, plots: world!.plots,
    ...game.exportState(), progress: { ...progress }, dex: structuredClone(eco.dex), residents: eco.residentsSave(),
    ...(goals ? { goals: structuredClone(goals) } : {}),
  });

  // 閉じていた間の季節と天気（オフライン進行で使う）
  const envAt = (ms: number) => {
    const d = new Date(ms);
    const season = seasonAt(d).season;
    return { season, raining: weatherAt(d, season) === 'rain' };
  };
  /** 留守の間に起きたこと（catchUp の結果と、拾った素材） */
  const awayNews = (r: { ripened: number; grown: number; built: number }) => {
    const picked = game.pickedSince;
    game.pickedSince = 0;
    return [r.ripened > 0 ? `${r.ripened} マスの作物が実りました` : '', r.grown > 0 ? `${r.grown} 本の木が育ちました` : '', r.built > 0 ? `${r.built} 棟の建物が完成しました` : '', picked > 0 ? `素材を ${picked} 個拾いました` : ''].filter(Boolean).join('・');
  };
  const fmtHours = (h: number) => (h >= 24 ? `${Math.floor(h / 24)}日${Math.round(h % 24)}時間` : h >= 1 ? `${Math.floor(h)}時間${Math.round((h % 1) * 60)}分` : `${Math.round(h * 60)}分`);

  /** セーブデータから箱庭を作り直す。catchUp なら閉じていた間の時間を進める */
  const loadFrom = (save: SaveData, catchUp: boolean) => whileBusy(() => loadFromInner(save, catchUp));
  const loadFromInner = async (save: SaveData, catchUp: boolean) => {
    settingsToUI(save.world);
    const s = save.world;
    progress = { ...save.progress };
    goals = sanitizeGoals(save.goals); // 無ければ、読み込んだ時の季節でふつうの 3 つを作る
    goalsTutorial = false;
    goalsHtml = '';
    await startWorld(s.seed, s.detail, s.params, s.flowerStyle, save.plots, save.edits);
    worldSettings = { ...s };
    game.restore(save);
    game.farm.speed = simSpeed();
    renderChip();
    // 住人は畑・苗木を戻した後に（苗木の列に住人を戻さないように）
    eco.restore(save.dex ?? {}, save.residents ?? []);
    eco.resetClock(game.farm.simMs);
    if (!catchUp) return;
    const target = save.farm.simMs + Math.max(0, Date.now() - save.savedAt);
    const r = game.catchUp(target, envAt);
    if (r.hours >= 0.05) {
      const news = awayNews(r);
      toast(`おかえりなさい。${fmtHours(r.hours)}たちました${news ? `：${news}` : ''}`, 5000);
    }
    // 閉じていた間は引っ越してこない（判定の基準をいまにそろえる）
    eco.resetClock(game.farm.simMs);
  };

  /** 箱庭を作り直している・読み込んでいる最中（入れ子になるので数で持つ。Google 同期を待たせる） */
  let regenerating = 0;
  const whileBusy = async <T>(f: () => Promise<T>): Promise<T> => {
    regenerating++;
    try { return await f(); } finally { regenerating--; }
  };
  /** keep = true：今の状態（編集・畑）を保ったまま作り直す（小物の細かさ・花・画質の変更） */
  const doRegen = (keep = true) => whileBusy(() => doRegenInner(keep));
  const doRegenInner = async (keep: boolean) => {
    if (openingDone) await openingDone;
    if (keep && world && worldSettings) {
      const s = buildSave();
      const ui = settingsFromUI();
      s.world = { ...worldSettings, detail: ui.detail, flowerStyle: ui.flowerStyle };
      // 来ていた訪問者は、作り直した後も残りの時間だけいる（画質の自動切り替えで消えないように）
      const stays = eco.visitorStays;
      await loadFrom(s, false);
      eco.readdVisitors(stays);
      game.unsaved = true; // 画質の自動切り替えでも通るので、同期の「変更」には数えない
    } else {
      const s = settingsFromUI();
      progress = { points: 0, rightsUsed: 0, unlocks: [], firsts: [], newMarks: [] };
      goals = null; // 始めたばかりの箱庭：最初の 3 つは操作を覚える目標
      goalsTutorial = true;
      goalsHtml = '';
      await startWorld(s.seed, s.detail, s.params, s.flowerStyle, 1 << START_PLOT);
      eco.restore({}, null);
      worldSettings = s;
      game.unsaved = true; playerChanged();
    }
  };
  const hasProgress = () => game.edits.size > 0 || game.farm.crops.size > 0 || game.farm.saplings.length > 0;
  /** 新しい箱庭を作る（今の箱庭は上書きされるので確認する） */
  const newWorld = async () => {
    if (hasProgress() && !confirm('新しい箱庭を作ると、今の箱庭（畑・植林・地形の変更）は上書きされます。よろしいですか？')) {
      if (worldSettings) settingsToUI(worldSettings);
      return;
    }
    // 作り始める前に「この端末で手を加えた」印を立てる。作っている数秒の間に同期が走っても、
    // Drive の古い箱庭で黙って上書きしないように（同期は作り終わるまで待つ。cloud の busy）
    syncState.markChanged();
    await doRegen(false);
    await saveNow();
  };
  $('regen').addEventListener('click', newWorld);
  $('rightPlus').addEventListener('click', () => {
    progress.points += OPEN_PLOT_POINTS;
    game.unsaved = true;
    refreshGhosts();
    toast(`発見ポイント：${points()}`);
  });
  $('bagPlus').addEventListener('click', () => {
    const inv = game.farm.inventory;
    for (const m of MAT_IDS) inv[m] = (inv[m] ?? 0) + 50;
    game.unsaved = true;
    toast('素材を 50 ずつ足しました');
  });
  $('ecoCall').addEventListener('click', () => {
    // 確率を 1 にして 1 回判定する（時刻・季節・天気の条件はそのまま）
    const r = eco.check(lastMoment, performance.now(), () => 0);
    const parts = [r.arrived ? `訪問者が ${r.arrived} 匹来ました` : '', r.movedIn ? '住人が引っ越してきました' : '', r.left ? `${r.left} 匹が帰りました` : ''].filter(Boolean);
    toast(r.arrived || r.movedIn ? parts.join('・') : `いまの環境・時刻では、誰も来ませんでした${r.left ? `（${r.left} 匹が帰りました）` : ''}`);
  });
  $('ecoClear').addEventListener('click', () => { eco.clearVisitors(); toast('訪問者が帰りました'); });
  $<HTMLInputElement>('ecoHighlight').addEventListener('change', (e) => eco.setHighlight((e.target as HTMLInputElement).checked));
  // 影の描き方
  // アンチエイリアスの方法と描く解像度（デバッグ。保存しない）
  const applyAA = () => {
    const m = $<HTMLSelectElement>('aaMode').value;
    setAntialias(isAAMode(m) ? m : 'fxaa', parseFloat($<HTMLSelectElement>('renderScale').value) || 1);
    $('aaBenchLabel').textContent = '';
  };
  $<HTMLSelectElement>('aaMode').addEventListener('change', applyAA);
  $<HTMLSelectElement>('renderScale').addEventListener('change', applyAA);
  $('aaBench').addEventListener('click', async () => {
    $('aaBenchLabel').textContent = '測っています…';
    const r = await bench(60);
    $('aaBenchLabel').textContent = `${AA_NAMES[post.aaMode]}・${Math.round(post.renderScale * 100)}%：${r.msPerFrame} ms（${r.fps} fps）`;
  });
  $<HTMLInputElement>('shadowCascade').addEventListener('change', (e) => { shadows.cascade = (e.target as HTMLInputElement).checked; });
  function applyShadowEvery() {
    const on = $<HTMLInputElement>('shadowThrottle').checked;
    const n = on ? parseInt($<HTMLSelectElement>('shadowEvery').value, 10) : 1;
    shadows.schedule.interval = renderStyle === 'toonLite' ? Math.max(4, n) : n;
  }
  applyShadowEvery();
  $<HTMLInputElement>('shadowThrottle').addEventListener('change', applyShadowEvery);
  $<HTMLSelectElement>('shadowEvery').addEventListener('change', applyShadowEvery);
  // 生き物の多さ（倍率）。上げたらすぐ 1 回判定して、増えた上限まで引っ越してくるようにする
  $<HTMLInputElement>('ecoAbundance').addEventListener('change', (e) => {
    const k = parseInt((e.target as HTMLInputElement).value, 10) || 1;
    const up = k > eco.abundance;
    eco.abundance = k;
    $('ecoAbundanceLabel').textContent = `×${k}`;
    if (up) eco.check(lastMoment, performance.now(), Math.random);
  });
  $('spawnAll').addEventListener('click', () => {
    if (!world || game.locked) return;
    const r = eco.spawnAll();
    toast(`住人 ${r.residents} 匹・訪問者 ${r.visitors} 匹を出しました${r.missed.length ? `（居場所が無くて出ない：${r.missed.join('・')}）` : ''}`, 6000);
    refreshDex();
  });
  $<HTMLInputElement>('ecoAbundance').addEventListener('input', (e) => { $('ecoAbundanceLabel').textContent = `×${(e.target as HTMLInputElement).value}`; });
  $('openAll').addEventListener('click', async () => {
    if (!world || opening) return;
    // 残りの区画を 1 つずつ開く（権利が足りなければ足す）。途中で箱庭が作り直されたら止める
    const startGen = gen;
    for (let next = openable(world.plots); next.length && gen === startGen; next = openable(world.plots)) {
      if (points() < OPEN_PLOT_POINTS) progress.points += OPEN_PLOT_POINTS;
      const r = openPlot(next[0]);
      if (typeof r === 'string') break;
      await r;
    }
  });
  $('detail').addEventListener('change', () => { playerChanged(); doRegen(true); });
  $('flowerStyle').addEventListener('change', () => { playerChanged(); doRegen(true); });

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
  let savingDone: Promise<void> | null = null;
  const writeLocal = async () => {
    const save = buildSave();
    const data = await encodeSave(save);
    await saveLocal({ key: 'main', data, savedAt: save.savedAt, version: save.version });
    lastSavedAt = save.savedAt;
    game.unsaved = false;
    if (!persisted) persisted = await requestPersist();
    showSaveStatus(`${(data.byteLength / 1024).toFixed(1)} KB`);
  };
  const saveNow = async () => {
    if (!world || !worldSettings || saving) return;
    saving = true;
    try {
      await (savingDone = writeLocal());
    } catch (err) {
      console.error(err);
      toast('保存できませんでした');
    } finally {
      saving = false;
      savingDone = null;
    }
  };
  /** 走っている保存を待ってから、今の箱庭を必ず保存する（失敗したら投げる）。Drive から読み込んだ時に使う */
  const saveStrict = async () => {
    while (savingDone) await savingDone.catch(() => {});
    saving = true;
    try { await (savingDone = writeLocal()); } finally { saving = false; savingDone = null; }
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
      playerChanged();
      await saveNow();
      toast('読み込みました');
    } catch (err) {
      toast(err instanceof OldSaveError ? '古い形式（v1）の保存データは読み込めません。今の箱庭はそのままです' : err instanceof Error ? err.message : '読み込めませんでした', 4000);
    }
  });

  // Google アカウントで Drive と同期（アプリ専用フォルダ）。PC は自動で送り、スマホは見るだけ
  const cloudStatusEl = $('cloudStatus');
  const cloudSignInBtn = $<HTMLButtonElement>('cloudSignIn');
  const cloudSyncBtn = $<HTMLButtonElement>('cloudSyncNow');
  const cloudSignOutBtn = $<HTMLButtonElement>('cloudSignOut');
  const hhmm = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const whenText = (t: number) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${hhmm(t)}`; };
  let cloudKind: CloudStatus['kind'] = 'signedOut';
  const renderCloud = (s: CloudStatus) => {
    cloudKind = s.kind;
    const who = s.kind === 'signedOut' ? '' : `☁ ${s.email}　`;
    const line =
      s.kind === 'signedOut' ? 'Google でログインすると、PC とスマホで同じ箱庭を使え、バックアップにもなります'
      : s.kind === 'needsLogin' ? `${who}⚠ 同期が止まっています（ログインの期限切れ）`
      : s.kind === 'busy' ? `${who}同期中…`
      : s.kind === 'error' ? `${who}⚠ ${s.message}`
      : `${who}同期 ${s.lastSyncAt ? hhmm(s.lastSyncAt) : '—'} ✓`;
    cloudStatusEl.textContent = line;
    if (isMobile && s.kind !== 'signedOut') cloudStatusEl.append(Object.assign(document.createElement('small'), { textContent: 'スマホは見るだけです（変えたところは PC には届きません）' }));
    cloudSignInBtn.hidden = !(s.kind === 'signedOut' || s.kind === 'needsLogin');
    cloudSignInBtn.querySelector('b')!.textContent = s.kind === 'needsLogin' ? 'タップして同期を続ける' : 'Google でログイン';
    cloudSyncBtn.hidden = !(s.kind === 'ok' || s.kind === 'error' || s.kind === 'busy');
    cloudSignOutBtn.hidden = s.kind === 'signedOut';
    cloudSyncBtn.disabled = cloudSignInBtn.disabled = s.kind === 'busy';
    setViewOnly(isMobile && s.kind !== 'signedOut');
  };
  if (isMobile) cloudSyncBtn.querySelector('b')!.textContent = 'Drive から読み込む';
  if (!DRIVE_CLIENT_ID) {
    cloudStatusEl.textContent = 'この版では Google 同期は使えません';
    cloudSignInBtn.hidden = cloudSyncBtn.hidden = cloudSignOutBtn.hidden = true;
  } else {
    cloud = new CloudSync({
      drive: { hasToken, signIn, signOut, accountInfo, remoteInfo, upload, download },
      state: syncState,
      viewer: isMobile,
      now: () => Date.now(),
      localHasProgress: hasProgress,
      buildEncoded: async () => { const s = buildSave(); return { data: await encodeSave(s), savedAt: s.savedAt }; },
      applyRemote: async (data) => {
        let save: SaveData;
        try { save = await decodeSave(data); } catch (err) {
          throw new Error(err instanceof OldSaveError ? 'Drive の保存データは古い形式なので読み込めません' : 'Drive の保存データを読めませんでした');
        }
        await loadFrom(save, true);
        try { await saveStrict(); } catch { throw new Error('読み込んだ箱庭をこの端末に保存できませんでした'); }
        toast('Google Drive の箱庭を読み込みました');
      },
      askConflict: async (remoteAt, localAt) => {
        for (;;) {
          if (confirm(`この端末と Google Drive の両方で箱庭が変わっています。\nDrive：${whenText(remoteAt)} ／ この端末：${localAt ? `${whenText(localAt)}（最後に手を加えた時）` : 'ここで手を加えた記録なし'}\n\nOK：Drive の箱庭を読み込む\nキャンセル：この端末の箱庭を残す`)) return 'remote';
          if (confirm('Drive の箱庭を、この端末の箱庭で上書きします。よろしいですか？')) return 'local';
        }
      },
      askReplace: async () => confirm('Drive の箱庭に入れ替えますか？（今の箱庭は書き出しで控えを取れます）'),
      onStatus: renderCloud,
      // 箱庭を作り直している・読み込んでいる間は同期しない（作りかけの箱庭を送ったり、上から読み込んだりしない）
      busy: () => game.locked || regenerating > 0,
    });
    prepareSignIn();
    const c = cloud;
    cloudSignInBtn.addEventListener('click', () => { c.signIn().catch((err) => toast(err instanceof Error ? err.message : 'ログインできませんでした', 4000)); });
    cloudSyncBtn.addEventListener('click', () => { void c.syncNow(); });
    cloudSignOutBtn.addEventListener('click', () => { void c.signOut().then(() => toast('ログアウトしました（この端末の箱庭はそのままです）')); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') c.onHidden(); else c.onVisible(); });
    window.addEventListener('pagehide', () => c.onHidden());
    // 別の PC で進めた箱庭に追いつく：窓に戻った時と、開いている間は 1 分ごとに Drive を見る
    window.addEventListener('focus', () => c.onVisible());
    setInterval(() => { if (document.visibilityState === 'visible' && cloudKind === 'ok') c.onVisible(); }, 60_000);
  }

  // デバッグウィンドウの開閉（スマホでは最初はたたんでおく）
  const uiEl = $('ui');
  // 出すかどうかはメニューの設定で決める（ふだんは隠す。この端末に覚える）
  const DEBUG_KEY = 'hakoniwa.showDebug';
  const debugBtn = $<HTMLButtonElement>('debugToggle');
  const setDebug = (on: boolean) => {
    uiEl.hidden = !on;
    debugBtn.setAttribute('aria-checked', String(on));
    try { localStorage.setItem(DEBUG_KEY, on ? '1' : '0'); } catch { /* 保存できなくても表示は変える */ }
  };
  setDebug(localStorage.getItem(DEBUG_KEY) === '1');
  debugBtn.addEventListener('click', () => setDebug(!!uiEl.hidden));
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

  // 最初の画質：初期値は「高」。WebGL2 やスマホは「自動」にして「中」から始め、重ければ自動で下げる
  const weakDevice = forceWebGL || isMobile || !(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend;
  if (weakDevice) { qualityAuto = true; $<HTMLSelectElement>('quality').value = 'auto'; }
  applyQuality(qualityAuto ? (weakDevice ? 'medium' : 'high') : ($<HTMLSelectElement>('quality').value as Quality), false);
  // 画面の初期値を、描画と時間の流れ・生き物の多さに反映する（つまみを動かす前から効くように）
  U.blend.value = parseFloat(blendInput.value);
  uAO.value = parseFloat(aoInput.value);
  eco.abundance = parseInt($<HTMLInputElement>('ecoAbundance').value, 10) || 1;
  /** この端末に箱庭がなく、新しく作った時：同期は「初めての端末」として扱う（作っただけの箱庭で Drive を上書きしないように） */
  const freshStart = () => { syncState.setMarker(null); syncState.clearChanged(); };
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
      freshStart();
      await saveNow();
    }
  } catch (err) {
    console.error(err);
    toast(err instanceof OldSaveError ? `保存データは${err.message}` : '保存データを読めなかったので、新しい箱庭を作りました', 4000);
    await doRegen(false);
    freshStart();
    if (err instanceof OldSaveError) await saveNow();
  }
  // 端末内の箱庭を出してから、Google 同期を始める（待たない）
  if (cloud) {
    const c = cloud;
    void c.start().then(() => { if (cloudKind === 'needsLogin') toast('Google 同期を続けるには、メニューの「タップして同期を続ける」を押してください', 4000); });
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
  /** 影の範囲の真ん中：カメラの注目点（v0.18.1。前は箱庭の真ん中に固定で、近づくと真ん中から離れた区画の影が消えていた） */
  const focusPoint = new THREE.Vector3(0, 10, 0);

  let cpuLogic = 0, cpuRender = 0;
  const wFwd = new THREE.Vector3(), wRight = new THREE.Vector3(), wMv = new THREE.Vector3(), wT = new THREE.Vector3();
  /** 毎フレーム書く文字：変わった時だけ書き換える（v0.18。ui/hud.ts） */
  const setText = hud.setText;
  /** 冬に花を隠す：雪の具合が変わった時と、花が増えた時（区画を開いた）だけ見直す */
  let flowersShown: boolean | null = null, flowerChildren = -1;
  /** シミュレーション用の壁時計（v0.18）。演出の dt は 0.1 秒で切るが、畑・植林・建設はこちらで切らずに進める */
  let lastWall = Date.now();
  /** これより長く空いたら（背景のタブから戻った・止まっていた）、閉じていた間と同じように catchUp でまとめて進める */
  const CATCHUP_GAP_MS = 5000;
  const loop = (t: number) => {
    const tl0 = performance.now();
    timer.update(t);
    const dt = Math.min(timer.getDelta(), 0.1);
    const wallNow = Date.now();
    const gapMs = Math.max(0, wallNow - lastWall);
    lastWall = wallNow;
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
    // WASD：見ている向きに沿って水平に移動。速さは注視点までの距離に比例（倍率はデバッグウィンドウの「移動の速さ」）
    if (moveKeys.size && !menuOpen()) {
      const fwd = wFwd;
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      const right = wRight.set(-fwd.z, 0, fwd.x);
      const has = (c: string) => moveKeys.has(c);
      const mv = wMv.set(0, 0, 0)
        .addScaledVector(fwd, (has('KeyW') ? 1 : 0) - (has('KeyS') ? 1 : 0))
        .addScaledVector(right, (has('KeyD') ? 1 : 0) - (has('KeyA') ? 1 : 0));
      if (mv.lengthSq() > 0) mv.normalize();
      const speed = Math.max(2, camera.position.distanceTo(controls.target) * moveSpeed());
      mv.multiplyScalar(speed * dt);
      // 注視点が箱庭から離れすぎないように
      const lim = extent / 2 + 24;
      const cx = bounds.cx - FRAME / 2, cz = bounds.cz - FRAME / 2;
      const t = wT.copy(controls.target).add(mv);
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
    setText('timeLabel', `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}${timeOverride === null ? '' : '（手動）'}`);

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
    setText('weatherLabel', `いま：${WEATHER_NAMES[weatherAt(now, st.season)]}`);

    const size = extent;
    // 影の範囲は箱庭全体ではなく、注目点のまわり（カメラとの距離で決める）。広くなっても影が粗くならない
    const shadowR = Math.min(160, Math.max(48, camera.position.distanceTo(controls.target) * 0.9));
    focusPoint.copy(controls.target);
    daylight.apply(hour, focusPoint, shadowR, weatherNow);
    U.windowGlow.value = windowGlowAt(hour);
    shadows.update();
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
    const showFlowers = U.snow.value < 0.5;
    if (showFlowers !== flowersShown || diorama.children.length !== flowerChildren) {
      flowersShown = showFlowers;
      flowerChildren = diorama.children.length;
      diorama.children.forEach((o) => { if (o.userData.kind === 'flower') o.visible = showFlowers; });
    }
    setText('seasonLabel', `いまの暦：${SEASON_NAMES[st.season]}${st.blend > 0 ? `→${SEASON_NAMES[st.next]}` : ''}`);

    lastMoment = { season: s, seasonProgress: seasonOverride === null ? st.progress : 0.3, hour, raining: weatherNow.rain > 0.5 };
    eco.update(dt, hour, lastMoment, game.farm.simMs, performance.now());
    // 雪の間（冬）は、家のそばの住人が家に寄り添って暖まる（v0.17）
    eco.setSnowing(s === 3 && weatherNow.snow > 0.5);
    tickGoals();

    // 畑・植林の時間を進める。道具を持っている時はカーソルを更新
    lastEnv = { season: s, raining: weatherNow.rain > 0.5 };
    if (gapMs > CATCHUP_GAP_MS && world && !game.locked && !regenerating) {
      // 背景のタブから戻った：止まっていた間を、閉じていた間と同じようにまとめて進める（v0.18）
      const r = game.catchUp(game.farm.simMs + gapMs * game.farm.speed, envAt);
      eco.resetClock(game.farm.simMs); // まとめて引っ越してこないように
      const news = awayNews(r);
      if (news) toast(`${fmtHours(r.hours)}のあいだに：${news}`, 5000);
      game.tick(dt, lastEnv, 0);
    } else game.tick(dt, lastEnv, Math.min(gapMs, CATCHUP_GAP_MS) / 1000);
    // ドラッグ中もカーソル（白い枠）をマウスに追従させる。ドラッグ中は使った直後のマスが赤くならないよう白のまま
    if (mode === 'edit' && mouseInside) {
      const { plot: gp, hit } = stroke ? { plot: -1, hit: pickAtMouse() } : ghostAtMouse();
      ghosts.setHover(gp);
      if (gp >= 0) {
        game.cursor.visible = false;
        const land = worldLands ? `${PLOT_LAND_INFO[worldLands[gp]].icon} ${PLOT_LAND_INFO[worldLands[gp]].text}・` : '';
        hintEl.textContent = land + (points() >= OPEN_PLOT_POINTS ? `クリックでこの土地を開く（発見ポイント ${OPEN_PLOT_POINTS}）` : `発見ポイントが足りません（${OPEN_PLOT_POINTS} 要ります）`);
      } else {
        const msg = game.updateCursor(hit, !!stroke);
        if (!stroke) hintEl.textContent = msg;
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
  // Object.assign では今の値しか写らないので、変わる値は getter で
  Object.defineProperty((window as N).__hakoniwa, 'goals', { get: () => goals, configurable: true });
  Object.defineProperty((window as N).__hakoniwa, 'aa', { get: () => ({ mode: post.aaMode, scale: post.renderScale }), configurable: true });
  Object.assign((window as N).__hakoniwa, { tickGoals: () => { goalsAt = -Infinity; tickGoals(); }, spawnAll: () => eco.spawnAll(), camera, controls, shadows, setAntialias, setRenderStyle, uLine, shaderFlags: { FIREFLIES_ON, RIPPLES_ON }, eco, spawnVisitor: (id: VisitorId) => eco.spawnVisitor(id), ecoCheck: (force = true) => eco.check(lastMoment, performance.now(), force ? () => 0 : Math.random), bench, adapterInfo, applyQuality, fireflyData, game, selectTool, saveNow, buildSave, encodeSave, saveLocal, setSize: (w: number, h: number) => { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); } });
}

main().catch((err) => {
  console.error(err);
  const el = document.createElement('div');
  el.id = 'error';
  el.textContent = `起動に失敗しました\n${err instanceof Error ? err.message : String(err)}`;
  document.body.appendChild(el);
});
