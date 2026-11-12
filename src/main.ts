import * as THREE from 'three/webgpu';
import { mix, pass, screenUV, uniform } from 'three/tsl';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RIPPLES, U, createDetailMaterial, createTerrainMaterial, createWaterMaterial, rippleData } from './render/materials';
import { createDaylight } from './render/daylight';
import { SEASON_COLORS, SEASON_NAMES, seasonAt } from './calendar';
import { spawnAnimals, type Animal } from './creatures/animals';
import { WATER, isOpaque } from './world/blocks';
import type { WorldData } from './world/terrain';
import type { MeshData } from './world/mesher';
import type { DetailSet } from './world/worker';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const WORLD_HEIGHT = 40;
const F_STOPS = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22];

interface WorkerResult {
  world: WorldData;
  terrain: MeshData;
  water: MeshData;
  details: DetailSet[];
  counts: { trees: number; flowers: number };
  timings: { generate: number; mesh: number; details: number };
}

async function main() {
  // ---------- レンダラー ----------
  const renderer = new THREE.WebGPURenderer({ antialias: true });
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
  const bgTop = uniform(new THREE.Color());
  const bgBottom = uniform(new THREE.Color());
  scene.backgroundNode = mix(bgTop, bgBottom, screenUV.y);

  // 低 FOV の透視投影：ミニチュアらしさと奥行きのバランス
  const camera = new THREE.PerspectiveCamera(28, 1, 1, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minPolarAngle = THREE.MathUtils.degToRad(20);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(72);
  controls.screenSpacePanning = false;
  controls.autoRotateSpeed = 0.6;

  const daylight = createDaylight(scene);

  // ---------- ポストプロセス（被写界深度：画面中央にピント） ----------
  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const color = scenePass.getTextureNode('output');
  const viewZ = scenePass.getViewZNode();
  const uFocus = uniform(100);
  const uFocal = uniform(30);
  const uBokeh = uniform(1.8);
  const dofOut = dof(color, viewZ, uFocus, uFocal, uBokeh);
  const setDof = (on: boolean) => {
    pipeline.outputNode = on ? dofOut : color;
    pipeline.needsUpdate = true;
  };
  setDof(true);

  // ---------- 箱庭 ----------
  const waterMat = createWaterMaterial();
  const detailMat = createDetailMaterial();
  let terrainMat: THREE.MeshStandardNodeMaterial | null = null;
  let typeTex: THREE.Data3DTexture | null = null;
  const diorama = new THREE.Group();
  scene.add(diorama);
  let world: WorldData | null = null;
  let animals: Animal[] = [];
  let info = '';

  const toGeometry = (m: MeshData) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
    g.setAttribute('color', new THREE.BufferAttribute(m.color, 3));
    g.setAttribute('ao', new THREE.BufferAttribute(m.ao, 1));
    g.setAttribute('veg', new THREE.BufferAttribute(m.veg, 1));
    g.setIndex(new THREE.BufferAttribute(m.index, 1));
    g.computeBoundingSphere();
    return g;
  };

  const worker = new Worker(new URL('./world/worker.ts', import.meta.url), { type: 'module' });
  const busy = document.createElement('div');
  busy.id = 'busy';
  busy.textContent = '生成中…';
  $('stage').appendChild(busy);

  const clearDiorama = () => {
    diorama.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        if (o.userData.ownMaterial) (o.material as THREE.Material).dispose();
      }
    });
    diorama.clear();
  };

  const regenerate = (size: number, seed: number, detail: number) =>
    new Promise<void>((resolve) => {
      busy.style.display = 'grid';
      worker.onmessage = (e: MessageEvent<WorkerResult>) => {
        const { world: w, terrain, water, details, counts, timings } = e.data;
        world = w;
        clearDiorama();
        const half = w.size / 2;

        // ボクセルの種類を 3D テクスチャに（幅 = X, 高さ = Z, 奥行き = Y）
        typeTex?.dispose();
        typeTex = new THREE.Data3DTexture(w.voxels, w.size, w.size, w.height);
        typeTex.format = THREE.RedFormat;
        typeTex.type = THREE.UnsignedByteType;
        typeTex.minFilter = typeTex.magFilter = THREE.NearestFilter;
        typeTex.unpackAlignment = 1;
        typeTex.needsUpdate = true;
        terrainMat?.dispose();
        terrainMat = createTerrainMaterial(typeTex, w.size, w.height);

        const tMesh = new THREE.Mesh(toGeometry(terrain), terrainMat);
        tMesh.castShadow = tMesh.receiveShadow = true;
        tMesh.position.set(-half, 0, -half);
        const wMesh = new THREE.Mesh(toGeometry(water), waterMat);
        wMesh.position.set(-half, 0, -half);
        wMesh.renderOrder = 1;
        // 台座（ジオラマの木の土台）
        const base = new THREE.Mesh(
          new THREE.BoxGeometry(w.size + 3, 2.4, w.size + 3),
          new THREE.MeshStandardMaterial({ color: 0x5a3e2b, roughness: 0.7 }),
        );
        base.userData.ownMaterial = true;
        base.position.y = -1.2;
        base.receiveShadow = true;
        diorama.add(base, tMesh, wMesh);

        // 小物（木・花）はインスタンス描画
        let detailTris = 0;
        const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
        for (const d of details) {
          const count = d.placements.length / 5;
          if (count === 0) continue;
          const im = new THREE.InstancedMesh(toGeometry(d.mesh), detailMat, count);
          for (let i = 0; i < count; i++) {
            const [x, y, z, rot, s] = d.placements.subarray(i * 5, i * 5 + 5);
            ps.set(x - half, y, z - half);
            q.setFromAxisAngle(up, rot);
            sc.setScalar(s);
            im.setMatrixAt(i, mtx.compose(ps, q, sc));
          }
          im.castShadow = d.kind === 'tree';
          im.receiveShadow = true;
          im.userData.kind = d.kind;
          diorama.add(im);
          detailTris += (d.mesh.index.length / 3) * count;
        }

        for (const a of animals) a.object.removeFromParent();
        animals = spawnAnimals(w, Math.max(4, Math.round(w.size / 10)));
        for (const a of animals) diorama.add(a.object);

        U.waterLevel.value = w.waterLevel;
        U.worldSize.value = w.size;
        U.detail.value = detail;

        // 影の範囲と解像度、カメラの距離をフィールドに合わせる
        daylight.sun.shadow.mapSize.setScalar(w.size > 160 ? 4096 : 2048);
        daylight.sun.shadow.map?.dispose();
        daylight.sun.shadow.map = null;
        camera.far = w.size * 8;
        camera.updateProjectionMatrix();
        controls.minDistance = Math.min(30, w.size * 0.35);
        controls.maxDistance = w.size * 3.2;
        const r = w.size * 2.3;
        controls.target.set(0, 10, 0);
        camera.position.set(r * 0.62, r * 0.55, r * 0.62);

        const tris = (terrain.index.length + water.index.length) / 3 + detailTris;
        info = `三角形 ${Math.round(tris / 1000)}k · 木 ${counts.trees} · 花 ${counts.flowers}<br>` +
          `生成 ${timings.generate.toFixed(0)}ms / 地形メッシュ ${timings.mesh.toFixed(0)}ms / 小物 ${timings.details.toFixed(0)}ms`;
        busy.style.display = 'none';
        resolve();
      };
      worker.postMessage({ size, height: WORLD_HEIGHT, seed, detail });
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
  // クリック（ドラッグではない時）で水面に波紋
  let downAt: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || !world || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(world.waterLevel - 0.15)), new THREE.Vector3());
    if (hit && isWaterAt(hit.x, hit.z)) addRipple(hit.x, hit.z, 1);
  });
  // 魚がはねる・虫が落ちる：ときどき勝手に波紋
  let nextAmbient = 1;
  // デバッグ用（開発者ツールから確認できるように）
  (window as unknown as { __hakoniwa: unknown }).__hakoniwa = { addRipple, rippleData, get world() { return world; }, camera, controls };

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
  $<HTMLInputElement>('dof').addEventListener('change', (e) => setDof((e.target as HTMLInputElement).checked));
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
  );
  $('regen').addEventListener('click', doRegen);
  $('size').addEventListener('change', doRegen);
  $('detail').addEventListener('change', doRegen);

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

  await doRegen();

  // ---------- ループ ----------
  const timer = new THREE.Timer();
  timer.connect(document);
  let fpsFrames = 0, fpsTime = 0, fps = 0;
  const cA = new THREE.Color(), cB = new THREE.Color();
  let focusSmoothed = -1;
  const focusPoint = new THREE.Vector3(0, 10, 0);

  renderer.setAnimationLoop((t) => {
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

    // 時刻（端末の現在時刻と連動。スライダーで上書き可）
    const now = new Date();
    const hour = timeOverride ?? now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    if (timeOverride === null) timeInput.value = String(hour);
    const hh = Math.floor(hour), mm = Math.floor((hour - hh) * 60);
    $('timeLabel').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}${timeOverride === null ? '' : '（手動）'}`;

    const size = world?.size ?? 64;
    daylight.apply(hour, focusPoint, size * 0.78);
    bgTop.value.copy(daylight.bgTop);
    bgBottom.value.copy(daylight.bgBottom);

    // 季節（全世界共通の暦。セレクトで上書き可）
    const st = seasonAt(now);
    const s = seasonOverride ?? st.season;
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

    // ときどき勝手に波紋
    nextAmbient -= dt;
    if (nextAmbient <= 0 && world) {
      nextAmbient = 0.8 + Math.random() * 2.5;
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

    if (appEl.clientWidth > 0 && appEl.clientHeight > 0) pipeline.render();

    fpsFrames++; fpsTime += dt;
    if (fpsTime > 0.5) {
      fps = fpsFrames / fpsTime; fpsFrames = 0; fpsTime = 0;
      $('stats').innerHTML = `${backendName} · ${fps.toFixed(0)} fps · ピント ${focusSmoothed.toFixed(0)}<br>${info}`;
    }
  });
}

main().catch((err) => {
  console.error(err);
  const el = document.createElement('div');
  el.id = 'error';
  el.textContent = `起動に失敗しました\n${err instanceof Error ? err.message : String(err)}`;
  document.body.appendChild(el);
});
