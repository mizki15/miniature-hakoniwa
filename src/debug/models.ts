/**
 * 開発用（v0.21.2）：ゲームの 3D モデルを全部並べて見るページ（models.html）。本番のビルドには入らない。
 * 住人・訪問者・作物（4 段階）・苗木・木・花・草・小石・葦・道・ブロック・記念の飾りを、見出しごとの列に並べる。
 * 左の目次で列へ飛ぶ。ドラッグで回す・ホイールで寄る。?fit で、どれもおおよそ同じ大きさにそろえる
 */
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RESIDENT_COLORS, buildResidentModel, buildVisitorParts, type ResidentId, type VisitorModelId } from '../creatures/models';
import { mergeModel } from '../creatures/animals';
import { buildCropGeometry, buildSaplingGeometry } from '../game/cropModels';
import { CROPS, CROP_KINDS } from '../game/farm';
import { buildLowPolyFlower } from '../creatures/flowers';
import { GRASS_VARIANTS, PEBBLE_VARIANTS, REED_VARIANTS, buildGrassTuft, buildPebble, buildReed } from '../creatures/groundDecor';
import { PATHS, buildPathTile } from '../game/paths';
import { buildTreeModel, buildFlowerModel } from '../world/details';
import { buildMesh, transformMesh } from '../world/mesher';
import { toGeometry } from '../game/controller';
import { FLOWER_VARIANTS, TREE_VARIANTS } from '../world/terrain';
import * as B from '../world/blocks';
import { buildBuildingMesh } from '../build/geoMesh';
import { mementoDesign } from '../build/mementos';

const RESIDENTS: ResidentId[] = ['rabbit', 'tanuki', 'fox', 'deer', 'duck', 'squirrel', 'hedgehog', 'sheep', 'bear', 'otter', 'mole', 'serow', 'stoat', 'beaver', 'capybara', 'cat'];
const VISITORS: VisitorModelId[] = ['butterfly', 'bee', 'sparrow', 'frog', 'fish', 'dragonfly', 'woodpecker', 'snail', 'longtailedTit', 'owl', 'kingfisher', 'mejiro', 'skylark', 'cricket', 'flyingSquirrel', 'eagle', 'heron', 'crane', 'crab', 'gull', 'seaTurtle', 'swallow', 'gecko'];
const NAMES: Record<string, string> = {
  rabbit: 'うさぎ', tanuki: 'たぬき', fox: 'きつね', deer: 'しか', duck: 'あひる', squirrel: 'りす', hedgehog: 'はりねずみ', sheep: 'ひつじ', bear: 'くま', otter: 'カワウソ', mole: 'モグラ', serow: 'カモシカ', stoat: 'オコジョ', beaver: 'ビーバー', capybara: 'カピバラ', cat: 'ねこ',
  butterfly: 'チョウ', bee: 'ミツバチ', sparrow: 'スズメ', frog: 'カエル', fish: '魚', dragonfly: 'トンボ', woodpecker: 'キツツキ', snail: 'カタツムリ', longtailedTit: 'シマエナガ', owl: 'フクロウ', kingfisher: 'カワセミ', mejiro: 'メジロ', skylark: 'ヒバリ', cricket: 'コオロギ', flyingSquirrel: 'ムササビ', eagle: 'ワシ', heron: 'サギ', crane: 'ツル', crab: 'カニ', gull: 'カモメ', seaTurtle: 'ウミガメ', swallow: 'ツバメ', gecko: 'ヤモリ',
};
const BLOCKS: [number, string][] = [[B.GRASS, '草'], [B.DIRT, '土'], [B.STONE, '石'], [B.SAND, '砂'], [B.MUD, '泥'], [B.FARMLAND, '畑（乾）'], [B.WET_FARMLAND, '畑（湿）'], [B.PATH, '土の道（旧）'], [B.COBBLE, '石畳（旧）'], [B.LOG, '丸太'], [B.LEAVES, '葉'], [B.CONIFER, '針葉'], [B.STEM, '茎'], [B.PETAL_R, '花びら赤'], [B.PETAL_Y, '花びら黄'], [B.PETAL_W, '花びら白']];
const STAGES = ['芽', '若葉', '育ち中', '実り'];

const params = new URLSearchParams(location.search);
/** 木や花のボクセルの細かさ（ゲームの「1/3」など。?detail=4） */
const DETAIL = Number(params.get('detail') ?? 3);
const fit = params.has('fit');

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
document.getElementById('view')!.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfe9f2);
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9a6a, 1.6));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
sun.position.set(6, 10, 8);
scene.add(sun);

const vcMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, flatShading: true });
const mesh = (g: THREE.BufferGeometry) => new THREE.Mesh(g, vcMat);
/** ボクセルのモデル（木・花・ブロック・建物）を、色付きのメッシュに */
const voxelMesh = (g: Parameters<typeof buildMesh>[0], scale = 1, ox = 0, oy = 0, oz = 0) => mesh(toGeometry(transformMesh(buildMesh(g), scale, ox, oy, oz)));

interface Item { name: string; make: () => THREE.Object3D }
interface Section { title: string; items: Item[]; scale?: number }

const resident = (id: ResidentId): Item => ({ name: NAMES[id], make: () => mergeModel(buildResidentModel(id, RESIDENT_COLORS[id][0])) });
const visitor = (id: VisitorModelId): Item => ({
  name: NAMES[id],
  make: () => {
    const p = buildVisitorParts(id);
    const root = new THREE.Group();
    root.add(mergeModel(p.body));
    if (p.wings) {
      const [px, py, pz] = p.wings.pivot;
      const l = new THREE.Group(), r = new THREE.Group();
      l.add(mergeModel(p.wings.left)); r.add(mergeModel(p.wings.right));
      l.position.set(px, py, pz); r.position.set(-px, py, pz);
      l.rotation.z = p.wings.folded; r.rotation.z = -p.wings.folded;
      root.add(l, r);
    }
    return root;
  },
});
const mementos = (() => {
  const seen = new Set<string>();
  const out: Item[] = [];
  for (let k = 0; k < 12; k++) {
    const d = mementoDesign(k);
    const shape = d.name.replace(/^.*?(花の鉢|ひまわり|かかし|雪だるま).*$/, '$1');
    if (seen.has(shape)) continue;
    seen.add(shape);
    out.push({ name: d.name, make: () => mesh(toGeometry(buildBuildingMesh(d))) });
  }
  return out;
})();

const SECTIONS: Section[] = [
  { title: '住人', items: RESIDENTS.map(resident), scale: 1.7 },
  { title: '訪問者', items: VISITORS.map(visitor), scale: 1.5 },
  ...[0, 1, 2, 3].map((st): Section => ({ title: `作物：${STAGES[st]}（段階 ${st}）`, items: CROP_KINDS.map((k) => ({ name: CROPS[k].name, make: () => mesh(buildCropGeometry(k, st)) })) })),
  { title: '苗木', items: [{ name: '広葉樹の苗木', make: () => mesh(buildSaplingGeometry('broad')) }, { name: '針葉樹の苗木', make: () => mesh(buildSaplingGeometry('conifer')) }] },
  { title: `木（細かさ 1/${DETAIL}）`, items: Array.from({ length: TREE_VARIANTS }, (_, v) => ({ name: `${v >= 4 ? '針葉樹' : '広葉樹'} ${v}`, make: () => { const m = buildTreeModel(v, DETAIL); return voxelMesh(m.grid, 1 / DETAIL, ...m.offset); } })) },
  { title: '花', scale: 2.5, items: [
    ...Array.from({ length: FLOWER_VARIANTS }, (_, v): Item => ({ name: `ボクセルの花 ${v}`, make: () => { const m = buildFlowerModel(v, Math.max(3, DETAIL)); return m ? voxelMesh(m.grid, 1 / Math.max(3, DETAIL), ...m.offset) : new THREE.Group(); } })),
    ...[0, 1, 2].map((v): Item => ({ name: `ローポリの花 ${v}`, make: () => mesh(buildLowPolyFlower(v)) })),
  ] },
  { title: '草・小石・葦', scale: 2.5, items: [
    ...Array.from({ length: GRASS_VARIANTS }, (_, v): Item => ({ name: `草 ${v}`, make: () => mesh(buildGrassTuft(v)) })),
    ...Array.from({ length: PEBBLE_VARIANTS }, (_, v): Item => ({ name: `小石 ${v}`, make: () => mesh(buildPebble(v)) })),
    ...Array.from({ length: REED_VARIANTS }, (_, v): Item => ({ name: `葦 ${v}`, make: () => mesh(buildReed(v)) })),
  ] },
  { title: '道のタイル', items: PATHS.map((p) => ({ name: p.name, make: () => mesh(buildPathTile(p.id)) })) },
  { title: 'ブロック（地面の 1 マス）', items: BLOCKS.map(([t, name]) => ({ name, make: () => voxelMesh({ sx: 1, sy: 1, sz: 1, data: new Uint8Array([t]) }, 1, -0.5, 0, -0.5) })) },
  { title: '記念の飾り', scale: 0.5, items: mementos },
];

// 並べる：見出しごとに 1 列（奥へ）。列の中は左から、物の幅に合わせて詰める
const labels = document.getElementById('labels')!;
const toc = document.getElementById('toc')!;
const tags: { el: HTMLElement; o: THREE.Object3D; y: number }[] = [];
const sectionAt: { title: string; z: number; width: number }[] = [];
let z = 0;
for (const sec of SECTIONS) {
  const objs = sec.items.map((it) => {
    const root = new THREE.Group();
    root.add(it.make());
    root.scale.setScalar(sec.scale ?? 1);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    if (fit) { const k = 1.2 / Math.max(size.x, size.y, size.z, 0.01); root.scale.multiplyScalar(k); size.multiplyScalar(k); }
    return { it, root, size };
  });
  const gap = 0.5;
  const width = objs.reduce((w, o) => w + Math.max(o.size.x, 0.6) + gap, -gap);
  const depth = Math.max(...objs.map((o) => o.size.z), 1);
  let x = -width / 2;
  for (const o of objs) {
    const w = Math.max(o.size.x, 0.6);
    o.root.position.set(x + w / 2, 0, z);
    o.root.rotation.y = 0.45;
    scene.add(o.root);
    x += w + gap;
    const el = document.createElement('span');
    el.textContent = o.it.name;
    labels.appendChild(el);
    tags.push({ el, o: o.root, y: -0.12 });
  }
  // 列の下の板と、見出し
  const plate = new THREE.Mesh(new THREE.BoxGeometry(width + 1.2, 0.06, depth + 1.0), new THREE.MeshStandardMaterial({ color: 0x9cc66a }));
  plate.position.set(0, -0.03, z);
  scene.add(plate);
  const head = new THREE.Object3D();
  head.position.set(-width / 2 - 0.4, 0, z - depth / 2 - 0.4);
  scene.add(head);
  const h = document.createElement('span');
  h.className = 'head';
  h.textContent = sec.title;
  labels.appendChild(h);
  tags.push({ el: h, o: head, y: 0 });
  sectionAt.push({ title: sec.title, z, width });
  const btn = document.createElement('button');
  btn.textContent = `${sec.title}（${sec.items.length}）`;
  btn.addEventListener('click', () => focus(sectionAt.find((s) => s.title === sec.title)!));
  toc.appendChild(btn);
  z += depth + 2.4;
}

const focus = (s: { z: number; width: number }) => {
  const d = Math.max(4, s.width * 0.75) / Math.min(1, camera.aspect);
  controls.target.set(0, 0.4, s.z);
  camera.position.set(0, d * 0.45, s.z + d);
  controls.update();
};
focus(sectionAt[0]);

const v = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  for (const t of tags) {
    v.setFromMatrixPosition(t.o.matrixWorld);
    v.y += t.y;
    const dist = camera.position.distanceTo(v);
    v.project(camera);
    const on = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && dist < 40;
    t.el.style.display = on ? '' : 'none';
    if (!on) continue;
    t.el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
    t.el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
  }
});
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
(window as unknown as { __models: unknown }).__models = { scene, sections: SECTIONS.map((s) => [s.title, s.items.length]) };
