/**
 * 開発用：全種類の生き物のモデルを並べて見るページ（gallery.html）。本番のビルドには入らない。
 * 上の 2 列が住人、下の 3 列が訪問者。翼のある訪問者は ?flap で羽ばたかせる。ドラッグで回す
 */
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RESIDENT_COLORS, buildResidentModel, buildVisitorParts, type ResidentId, type VisitorModelId } from './creatures/models';
import { mergeModel } from './creatures/animals';

const RESIDENTS: ResidentId[] = ['rabbit', 'tanuki', 'fox', 'deer', 'duck', 'squirrel', 'hedgehog', 'sheep', 'bear', 'otter', 'mole', 'serow', 'stoat', 'beaver', 'capybara', 'cat'];
const VISITORS: VisitorModelId[] = ['butterfly', 'bee', 'sparrow', 'frog', 'fish', 'dragonfly', 'woodpecker', 'snail', 'longtailedTit', 'owl', 'kingfisher', 'mejiro', 'skylark', 'cricket', 'flyingSquirrel', 'eagle', 'heron', 'crane', 'crab', 'gull', 'seaTurtle', 'swallow', 'gecko'];
const NAMES: Record<string, string> = {
  rabbit: 'うさぎ', tanuki: 'たぬき', fox: 'きつね', deer: 'しか', duck: 'あひる', squirrel: 'りす', hedgehog: 'はりねずみ', sheep: 'ひつじ', bear: 'くま', otter: 'カワウソ', mole: 'モグラ', serow: 'カモシカ', stoat: 'オコジョ', beaver: 'ビーバー', capybara: 'カピバラ', cat: 'ねこ',
  butterfly: 'チョウ', bee: 'ミツバチ', sparrow: 'スズメ', frog: 'カエル', fish: '魚', dragonfly: 'トンボ', woodpecker: 'キツツキ', snail: 'カタツムリ', longtailedTit: 'シマエナガ', owl: 'フクロウ', kingfisher: 'カワセミ', mejiro: 'メジロ', skylark: 'ヒバリ', cricket: 'コオロギ', flyingSquirrel: 'ムササビ', eagle: 'ワシ', heron: 'サギ', crane: 'ツル', crab: 'カニ', gull: 'カモメ', seaTurtle: 'ウミガメ', swallow: 'ツバメ', gecko: 'ヤモリ',
};

const params = new URLSearchParams(location.search);
const flap = params.has('flap');
/** ?only=crab,gull：その種類だけ大きく並べる */
const only = params.get('only')?.split(',');

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfe9f2);
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 200);
const controls = new OrbitControls(camera, renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9a6a, 1.6));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
sun.position.set(6, 10, 8);
scene.add(sun);
const ground = new THREE.Mesh(new THREE.BoxGeometry(60, 0.2, 40), new THREE.MeshStandardMaterial({ color: 0x8cbf5a, flatShading: true }));
ground.position.y = -0.1;
scene.add(ground);

interface Item { id: string; root: THREE.Object3D; wings?: { l: THREE.Object3D; r: THREE.Object3D; folded: number } }
const items: Item[] = [];
const place = (o: THREE.Object3D, i: number, row: number, cols: number, gap: number) => {
  o.position.set((i - (cols - 1) / 2) * gap, 0, row * gap * 1.1);
};

const list: { id: string; kind: 'r' | 'v' }[] = [...RESIDENTS.map((id) => ({ id, kind: 'r' as const })), ...VISITORS.map((id) => ({ id, kind: 'v' as const }))]
  .filter((x) => !only || only.includes(x.id));
const cols = only ? Math.min(6, list.length) : 8;
const gap = only ? 2.2 : 1.9;
list.forEach((x, k) => {
  const root = new THREE.Group();
  let wings: Item['wings'];
  if (x.kind === 'r') {
    root.add(mergeModel(buildResidentModel(x.id as ResidentId, RESIDENT_COLORS[x.id as ResidentId][0])));
    root.scale.setScalar(1.7);
  } else {
    const p = buildVisitorParts(x.id as VisitorModelId);
    root.add(mergeModel(p.body));
    if (p.wings) {
      const [px, py, pz] = p.wings.pivot;
      const l = new THREE.Group(), r = new THREE.Group();
      l.add(mergeModel(p.wings.left)); r.add(mergeModel(p.wings.right));
      l.position.set(px, py, pz); r.position.set(-px, py, pz);
      root.add(l, r);
      wings = { l, r, folded: p.wings.folded };
    }
    root.scale.setScalar(1.5);
  }
  // ?fit：小さな生き物も見えるよう、いちばん長い辺を 1.4 にそろえる
  if (params.has('fit')) {
    const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
    root.scale.multiplyScalar(1.4 / Math.max(size.x, size.y, size.z));
  }
  place(root, k % cols, Math.floor(k / cols), cols, gap);
  root.rotation.y = 0.5;
  scene.add(root);
  items.push({ id: x.id, root, wings });
});

const rows = Math.ceil(list.length / cols);
controls.target.set(0, 0.4, (rows - 1) * gap * 0.55);
// 横幅が画面に収まる距離から（縦長の画面ほど遠く）
const span = Math.max(cols * gap, rows * gap * 1.1) / Math.min(1, camera.aspect);
camera.position.set(0, span * 0.5, (rows - 1) * gap * 0.55 + span * 0.85);
controls.update();

const labels = document.getElementById('labels')!;
const tags = items.map((it) => { const s = document.createElement('span'); s.textContent = NAMES[it.id] ?? it.id; labels.appendChild(s); return s; });
const v = new THREE.Vector3();
const timer = new THREE.Timer();
renderer.setAnimationLoop((t) => {
  timer.update(t);
  const time = timer.getElapsed();
  for (const it of items) {
    if (!it.wings) continue;
    const a = flap ? Math.sin(time * 8) * 0.8 : it.wings.folded;
    it.wings.l.rotation.z = a;
    it.wings.r.rotation.z = -a;
  }
  controls.update();
  renderer.render(scene, camera);
  items.forEach((it, i) => {
    v.copy(it.root.position); v.y -= 0.15;
    v.project(camera);
    tags[i].style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
    tags[i].style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
  });
});
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
(window as unknown as { __items: Item[] }).__items = items;
