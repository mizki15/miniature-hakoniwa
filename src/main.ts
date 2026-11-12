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
import { RIPPLES, U, createDetailMaterial, createTerrainMaterial, createWaterMaterial, fireflyData, rippleData } from './render/materials';
import { createDaylight } from './render/daylight';
import { SKY, createPrecipitation, createSkyNode } from './render/sky';
import { SEASON_COLORS, SEASON_NAMES, seasonAt } from './calendar';
import { WEATHER_NAMES, WEATHER_PARAMS, approachWeather, weatherAt, type WeatherKind } from './weather';
import { spawnAnimals, type Animal } from './creatures/animals';
import { buildLowPolyFlower } from './creatures/flowers';
import { WATER, isOpaque } from './world/blocks';
import type { TerrainParams, WorldData } from './world/terrain';
import type { ChunkMesh, DetailSet } from './world/worker';
import { GameController, TOOLS, type Tool } from './game/controller';
import { CROPS, CROP_KINDS, type CropKind } from './game/farm';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const WORLD_HEIGHT = 64;
const F_STOPS = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22];

interface WorkerResult {
  type: 'generate';
  world: WorldData;
  chunks: ChunkMesh[];
  details: DetailSet[];
  flowerPlacements: Float32Array[];
  counts: { trees: number; flowers: number };
  timings: { generate: number; mesh: number; details: number };
}

async function main() {
  // ---------- レンダラー ----------
  // ?webgl を付けると WebGL2 で動かす（WebGPU 非対応の端末での動作確認用）
  const forceWebGL = new URLSearchParams(location.search).has('webgl');
  // ?gputime を付けると GPU の処理時間を計測する（計測自体が重くなる環境があるので既定は OFF）
  const trackTimestamp = new URLSearchParams(location.search).has('gputime');
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL, trackTimestamp });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  await renderer.init();
  const appEl = $('app');
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
  let animals: Animal[] = [];
  let info = '';

  const worker = new Worker(new URL('./world/worker.ts', import.meta.url), { type: 'module' });
  const busy = document.createElement('div');
  busy.id = 'busy';
  busy.textContent = '生成中…';
  $('stage').appendChild(busy);

  // 触れる・育つ要素（道具・畑・植林・地形の編集）
  const game = new GameController({ diorama, worker, waterMat, detailMat, flowerMat });
  let onGenerated: ((r: WorkerResult) => void) | null = null;
  worker.onmessage = (e: MessageEvent<WorkerResult | { type: 'remesh'; chunks: ChunkMesh[] }>) => {
    if (e.data.type === 'remesh') game.onRemesh(e.data.chunks);
    else onGenerated?.(e.data);
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

  const regenerate = (size: number, seed: number, detail: number, params: TerrainParams, flowerStyle: string) =>
    new Promise<void>((resolve) => {
      busy.style.display = 'grid';
      onGenerated = (res: WorkerResult) => {
        const { world: w, chunks, details, flowerPlacements, counts, timings } = res;
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

        // 台座（ジオラマの木の土台）
        const base = new THREE.Mesh(
          new THREE.BoxGeometry(w.size + 3, 2.4, w.size + 3),
          new THREE.MeshStandardMaterial({ color: 0x5a3e2b, roughness: 0.7 }),
        );
        base.userData.ownMaterial = true;
        base.position.y = -1.2;
        base.receiveShadow = true;
        diorama.add(base);

        // 地形（チャンクごと）・木・花。ローポリの花はボクセルの花が作れない 1/1 でも使う
        const hasVoxelFlowers = details.some((d) => d.kind === 'flower');
        game.load(w, chunks, details, flowerPlacements, flowerStyle === 'lowpoly' || !hasVoxelFlowers ? lowPolyFlowers : null, typeTex, terrainMat);

        // 雨・雪（フィールドの大きさに合わせて作り直す）
        if (precip) {
          for (const m of [precip.rain, precip.snow]) { scene.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
        }
        precip = { rain: createPrecipitation('rain', w.size, rainAmount), snow: createPrecipitation('snow', w.size, snowAmount) };
        scene.add(precip.rain, precip.snow);

        for (const a of animals) a.object.removeFromParent();
        animals = spawnAnimals(w, Math.max(4, Math.round(w.size / 10)));
        for (const a of animals) diorama.add(a.object);

        U.waterLevel.value = w.waterLevel;
        U.worldSize.value = w.size;
        fireflies.setWorld(w);
        let maxH = 0; for (let i = 0; i < w.heights.length; i++) maxH = Math.max(maxH, w.heights[i]);
        birds.setWorld(w.size, maxH);
        U.detail.value = detail;

        // カメラの距離をフィールドに合わせる（近づいて見上げられるよう最短距離は小さめ）
        camera.far = w.size * 8;
        camera.updateProjectionMatrix();
        controls.minDistance = 3;
        controls.maxDistance = w.size * 3.2;
        // 縦長の画面（スマホ）では横幅に収まるよう遠めから
        const r = w.size * 2.3 * Math.max(1, 1.1 / camera.aspect);
        controls.target.set(0, 10, 0);
        camera.position.set(r * 0.62, r * 0.55, r * 0.62);

        info = `チャンク ${chunks.length} · 木 ${counts.trees} · 花 ${counts.flowers}<br>` +
          `生成 ${timings.generate.toFixed(0)}ms / 地形メッシュ ${timings.mesh.toFixed(0)}ms / 小物 ${timings.details.toFixed(0)}ms`;
        busy.style.display = 'none';
        resolve();
      };
      worker.postMessage({ type: 'generate', size, height: WORLD_HEIGHT, seed, detail, params });
    });

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
  // ---------- 道具 ----------
  const toolsEl = $('tools'), seedsEl = $('seeds'), hintEl = $('toolHint'), toastEl = $('toast');
  let toastTimer = 0;
  const toast = (msg: string) => {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 1600);
  };
  const toolButtons = new Map<Tool, HTMLButtonElement>();
  for (const t of TOOLS) {
    const b = document.createElement('button');
    b.innerHTML = `<span class="ic">${t.icon}</span>${t.name}<span class="k">${t.key}</span>`;
    b.title = t.help;
    b.addEventListener('click', () => selectTool(t.id));
    toolsEl.appendChild(b);
    toolButtons.set(t.id, b);
  }
  const seedButtons = new Map<CropKind, HTMLButtonElement>();
  const CROP_ICONS: Record<CropKind, string> = { turnip: '🥬', wheat: '🌾', pumpkin: '🎃' };
  const renderSeeds = () => {
    seedsEl.innerHTML = '';
    if (game.tool !== 'seed') return;
    for (const k of CROP_KINDS) {
      const b = document.createElement('button');
      b.innerHTML = `${CROP_ICONS[k]} ${CROPS[k].name}<span class="k">${CROPS[k].hours}時間</span>`;
      b.classList.toggle('on', game.seed === k);
      b.addEventListener('click', () => { game.seed = k; renderSeeds(); });
      seedsEl.appendChild(b);
      seedButtons.set(k, b);
    }
  };
  const selectTool = (t: Tool) => {
    game.tool = t;
    for (const [id, b] of toolButtons) b.classList.toggle('on', id === t);
    renderSeeds();
    hintEl.textContent = TOOLS.find((x) => x.id === t)!.help;
    if (t === 'look') game.cursor.visible = false;
  };
  selectTool('look');
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input, select, textarea')) return;
    const t = TOOLS.find((x) => x.key === e.key);
    if (t) selectTool(t.id);
    if (e.key === 'Escape') selectTool('look');
  });

  // マウスの位置から光線を作る
  const mouse = new THREE.Vector2(), raycaster = new THREE.Raycaster();
  let mouseInside = false;
  const setMouse = (e: PointerEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  };
  renderer.domElement.addEventListener('pointermove', (e) => { setMouse(e); mouseInside = true; });
  renderer.domElement.addEventListener('pointerleave', () => { mouseInside = false; game.cursor.visible = false; });
  const pickAtMouse = () => {
    raycaster.setFromCamera(mouse, camera);
    return game.pick(raycaster.ray.origin, raycaster.ray.direction);
  };

  // クリック（ドラッグではない時）：道具を使う。「見る」の時は水面に波紋
  let downAt: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || !world || e.button !== 0 || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
    setMouse(e);
    if (game.tool !== 'look') {
      const msg = game.use(pickAtMouse());
      if (msg) toast(msg);
      return;
    }
    raycaster.setFromCamera(mouse, camera);
    const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(world.waterLevel - 0.15)), new THREE.Vector3());
    if (hit && isWaterAt(hit.x, hit.z)) addRipple(hit.x, hit.z, 1);
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
    if (p.lite !== liteTerrain) { liteTerrain = p.lite; if (regenerateIfNeeded && world) doRegen(); }
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
    $('st-farm').innerHTML = dl([['畑', `${f.fields} マス`], ['育っている', f.growing], ['収穫できる', f.ripe], ['育つ苗木', f.saplings]]);
    $('st-inv').innerHTML = dl(CROP_KINDS.map((k) => [`${CROP_ICONS[k]} ${CROPS[k].name}`, f.inventory[k] ?? 0]));
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
  const autoBtn = $('auto');
  autoBtn.addEventListener('click', () => {
    controls.autoRotate = !controls.autoRotate;
    autoBtn.classList.toggle('on', controls.autoRotate);
  });
  const doRegen = () => regenerate(
    parseInt($<HTMLSelectElement>('size').value, 10),
    parseInt($<HTMLInputElement>('seed').value, 10) || 0,
    parseInt($<HTMLSelectElement>('detail').value, 10),
    readParams(),
    $<HTMLSelectElement>('flowerStyle').value,
  );
  $('regen').addEventListener('click', doRegen);
  $('size').addEventListener('change', doRegen);
  $('detail').addEventListener('change', doRegen);
  $('flowerStyle').addEventListener('change', doRegen);

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

  // 最初の画質：WebGL2 やスマホは「中」から。重ければ自動で下げる
  applyQuality(forceWebGL || isMobile || !(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'medium' : 'high', false);
  await doRegen();

  // ---------- ループ ----------
  const timer = new THREE.Timer();
  timer.connect(document);
  let fpsFrames = 0, fpsTime = 0, fps = 0;
  const cA = new THREE.Color(), cB = new THREE.Color();
  let focusSmoothed = -1;
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

    if (snapT < 1) {
      snapT = Math.min(1, snapT + dt * 2.2);
      const e = 1 - Math.pow(1 - snapT, 3);
      offset.copy(camera.position).sub(controls.target);
      spherical.setFromVector3(offset);
      spherical.theta = snapFrom + (snapTo - snapFrom) * e;
      offset.setFromSpherical(spherical);
      camera.position.copy(controls.target).add(offset);
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

    const size = world?.size ?? 64;
    daylight.apply(hour, focusPoint, size * 0.78, weatherNow);

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

    for (const a of animals) a.update(dt, hour);

    // 畑・植林の時間を進める。道具を持っている時はカーソルを更新
    lastEnv = { season: s, raining: weatherNow.rain > 0.5 };
    game.tick(dt, lastEnv);
    if (game.tool !== 'look' && mouseInside) hintEl.textContent = game.updateCursor(pickAtMouse()) || TOOLS.find((x) => x.id === game.tool)!.help;

    // ときどき勝手に波紋
    nextAmbient -= dt;
    if (nextAmbient <= 0 && world) {
      // 雨の時は雨粒の波紋がたくさん
      nextAmbient = weatherNow.rain > 0.3 ? 0.04 + Math.random() * 0.08 : 0.8 + Math.random() * 2.5;
      const N = world.size;
      for (let tries = 0; tries < 30; tries++) {
        const x = (Math.random() - 0.5) * N, z = (Math.random() - 0.5) * N;
        if (isWaterAt(x, z)) { addRipple(x, z, 0.35 + Math.random() * 0.3); break; }
      }
    }

    // ピント：画面中央の奥行きに、なめらかに追従させる
    const target = centerDepth() ?? camera.position.distanceTo(controls.target);
    focusSmoothed = focusSmoothed < 0 ? target : focusSmoothed + (target - focusSmoothed) * (1 - Math.exp(-dt * 3));
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

    fpsFrames++; fpsTime += dt;
    if (fpsTime > 0.5) {
      fps = fpsFrames / fpsTime; fpsFrames = 0; fpsTime = 0;
      updateStatus(hh, mm, s, st.season);
      // GPU の処理時間（タイムスタンプが使える環境のみ）
      if (trackTimestamp) renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER).then(() => { gpuMs = renderer.info.render.timestamp; }).catch(() => {});
      $('stats').innerHTML = `${backendName} · ${fps.toFixed(0)} fps${gpuMs > 0 ? ` · GPU ${gpuMs.toFixed(1)}ms` : ''} · CPU 処理 ${cpuLogic.toFixed(1)}ms＋描画命令 ${cpuRender.toFixed(1)}ms · 画質 ${QUALITY_NAMES[quality]} · ピント ${focusSmoothed.toFixed(0)}<br>${info}`;
      // 自動画質：重い時は一段ずつ下げる（上げ下げを繰り返さないよう、下げるだけ）
      if (qualityAuto && fps > 0 && performance.now() - lastQualityChange > 4000) {
        fpsWindow.push(fps);
        if (fpsWindow.length >= 6) {
          const avg = fpsWindow.reduce((a, b) => a + b, 0) / fpsWindow.length;
          fpsWindow.length = 0;
          if (avg < 40 && quality !== 'low') {
            applyQuality(quality === 'high' ? 'medium' : 'low');
            lastQualityChange = performance.now();
          }
        }
      }
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
  Object.assign((window as N).__hakoniwa, { bench, adapterInfo, applyQuality, fireflyData, game, selectTool, setSize: (w: number, h: number) => { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); } });
}

main().catch((err) => {
  console.error(err);
  const el = document.createElement('div');
  el.id = 'error';
  el.textContent = `起動に失敗しました\n${err instanceof Error ? err.message : String(err)}`;
  document.body.appendChild(el);
});
