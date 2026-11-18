/**
 * 建物の棚のビューワー：選んだ建物を 1 棟、ゆっくり回して見せる。
 * 箱庭とは別の小さな描画（自分の canvas と renderer）。開いている間だけ動かし、閉じたら片付ける
 */
import * as THREE from 'three/webgpu';
import type { BuildingDesign } from './geoParse';
import { buildBuildingMesh } from './geoMesh';
import { viewerCameraDistance } from './stats';
import { toGeometry } from '../game/controller';

const FOV = 32;
/** 何もしていない時の回る速さ（ラジアン/秒） */
const SPIN = 0.35;
const FRONT_YAW = Math.PI - 0.6;

export class BuildingViewer {
  private renderer: THREE.WebGPURenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 200);
  private pivot = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0 });
  /** 正面（−Z、北）を少し斜めから見る向き */
  private yaw = FRONT_YAW;
  private pitch = 0.45;
  private zoom = 1;
  private dist = 5;
  private target = new THREE.Vector3();
  private dragging: { x: number; y: number } | null = null;
  private idleSince = 0;
  private last = 0;
  private resizeObs: ResizeObserver | null = null;

  constructor(private canvas: HTMLCanvasElement, private forceWebGL: boolean) {
    this.scene.background = new THREE.Color(0xdde7ee);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a60, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(4, 8, -6);
    this.scene.add(sun);
    // 地面の円盤（建物の大きさに合わせて広げる）
    const ground = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({ color: 0x8fbf5a, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.name = 'ground';
    this.pivot.add(ground);
    this.scene.add(this.pivot);

    canvas.addEventListener('pointerdown', (e) => { this.dragging = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw -= (e.clientX - this.dragging.x) * 0.01;
      this.pitch = Math.min(1.35, Math.max(0.05, this.pitch + (e.clientY - this.dragging.y) * 0.01));
      this.dragging = { x: e.clientX, y: e.clientY };
      this.idleSince = performance.now();
    });
    const end = () => { this.dragging = null; this.idleSince = performance.now(); };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = Math.min(2.5, Math.max(0.4, this.zoom * Math.exp(e.deltaY * 0.001)));
    }, { passive: false });
  }

  /** 開く（初回は描画の準備をする） */
  async open() {
    if (!this.renderer) {
      this.renderer = new THREE.WebGPURenderer({ canvas: this.canvas, antialias: true, forceWebGL: this.forceWebGL });
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      await this.renderer.init();
      this.resizeObs = new ResizeObserver(() => this.resize());
      this.resizeObs.observe(this.canvas);
    }
    this.resize();
    this.last = performance.now();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  /** 閉じる（描画を止める。renderer は次に開く時のために残す） */
  close() { this.renderer?.setAnimationLoop(null); }

  /** 見せる建物を替える（null で空にする） */
  show(d: BuildingDesign | null) {
    if (this.mesh) { this.pivot.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    const ground = this.pivot.getObjectByName('ground')!;
    if (!d) { ground.visible = false; return; }
    this.mesh = new THREE.Mesh(toGeometry(buildBuildingMesh(d)), this.material);
    this.pivot.add(this.mesh);
    const { min, max } = d.bounds;
    // 建物の中心をまわす軸にする
    this.mesh.position.set(-(min[0] + max[0]) / 2, 0, -(min[2] + max[2]) / 2);
    ground.visible = true;
    ground.scale.setScalar(Math.hypot(max[0] - min[0], max[2] - min[2]) * 0.75 + 0.5);
    this.target.set(0, (max[1] - min[1]) * 0.45, 0);
    this.dist = viewerCameraDistance(d, FOV);
    this.zoom = 1;
    this.yaw = FRONT_YAW;
    this.pitch = 0.45;
    this.idleSince = performance.now();
  }

  private resize() {
    if (!this.renderer) return;
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame(t: number) {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    // 触ってから 2 秒たったら、また回り始める
    if (!this.dragging && t - this.idleSince > 2000) this.yaw += SPIN * dt;
    const r = this.dist * this.zoom;
    this.camera.position.set(
      this.target.x + r * Math.cos(this.pitch) * Math.sin(this.yaw),
      this.target.y + r * Math.sin(this.pitch),
      this.target.z + r * Math.cos(this.pitch) * Math.cos(this.yaw),
    );
    this.camera.lookAt(this.target);
    this.renderer!.render(this.scene, this.camera);
  }
}
