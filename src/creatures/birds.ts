import * as THREE from 'three/webgpu';
import { wrapAngle } from './motion';

/**
 * 鳥の群れ：昼間、箱庭の上空をゆったり旋回する。ローポリ（胴体＋2 枚の翼）で羽ばたく。
 * 曲がる時は体を傾け、上がる時はよく羽ばたき、平らな所では時々滑空する
 */
const mat = new THREE.MeshStandardMaterial({ color: 0x3b3f46, flatShading: true, roughness: 0.9 });

function buildBird(): { root: THREE.Group; left: THREE.Mesh; right: THREE.Mesh } {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.6, 4), mat);
  body.rotation.x = Math.PI / 2;
  root.add(body);
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.15, 0.7, 0, 0, 0, 0, -0.15], 3));
  wingGeo.computeVertexNormals();
  const dmat = mat.clone();
  dmat.side = THREE.DoubleSide;
  const left = new THREE.Mesh(wingGeo, dmat);
  const right = new THREE.Mesh(wingGeo, dmat);
  right.scale.x = -1;
  root.add(left, right);
  root.traverse((o) => { o.castShadow = true; });
  return { root, left, right };
}

interface Bird { root: THREE.Group; left: THREE.Mesh; right: THREE.Mesh; offset: THREE.Vector3; phase: number; lag: number; flap: number; beat: number }

export class Birds {
  readonly group = new THREE.Group();
  private birds: Bird[] = [];
  private radius = 40;
  private altitude = 45;
  private cx = 0;
  private cz = 0;
  private last = 0;
  private p0 = new THREE.Vector3();
  private p1 = new THREE.Vector3();
  private p2 = new THREE.Vector3();

  constructor(count = 9) {
    for (let i = 0; i < count; i++) {
      const b = buildBird();
      b.root.rotation.order = 'YXZ'; // 進む向き → 上下の傾き → 左右の傾き（旋回で体を傾ける）
      // 先頭の鳥から少しずつ遅れて同じ道をたどる（群れが曲がる時に、前から順に曲がる）
      const offset = new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3);
      this.birds.push({ ...b, offset, phase: Math.random() * 10, lag: i === 0 ? 0 : 0.4 + Math.random() * 2.2, flap: 1, beat: Math.random() * 10 });
      this.group.add(b.root);
    }
  }

  /** 開いた範囲（中心と大きさ）のまわりを飛ぶ */
  setWorld(area: { cx: number; cz: number; extent: number }, maxHeight: number) {
    this.radius = area.extent * 0.32;
    this.altitude = maxHeight + 8;
    this.cx = area.cx;
    this.cz = area.cz;
  }

  /** 群れが時刻 t に通る点（ゆっくり大きな輪を描き、高さも少し変わる） */
  private path(t: number, out: THREE.Vector3) {
    const a = t * 0.05;
    const r = this.radius * (1 + Math.sin(t * 0.031) * 0.15);
    return out.set(this.cx + Math.cos(a) * r, this.altitude + Math.sin(t * 0.13) * 3, this.cz + Math.sin(a * 1.3) * r * 0.8);
  }

  /** amount：0..1（昼で晴れているほど多く飛ぶ） */
  update(t: number, amount: number) {
    const dt = Math.min(0.1, Math.max(0, t - this.last));
    this.last = t;
    this.group.visible = amount > 0.05;
    if (!this.group.visible) return;
    for (const b of this.birds) {
      const bt = t - b.lag;
      const wob = (s: number, o: THREE.Vector3) => o.add(b.offset).add(new THREE.Vector3(Math.sin(s * 0.7 + b.phase) * 1.5, Math.sin(s * 1.1 + b.phase) * 0.6, Math.cos(s * 0.6 + b.phase) * 1.5));
      // 少し前・今・少し後の点から、進む向き・上がり下がり・曲がり具合を出す
      wob(bt - 0.4, this.path(bt - 0.4, this.p0));
      wob(bt, this.path(bt, this.p1));
      wob(bt + 0.4, this.path(bt + 0.4, this.p2));
      const vx = this.p2.x - this.p1.x, vy = this.p2.y - this.p1.y, vz = this.p2.z - this.p1.z;
      const ux = this.p1.x - this.p0.x, uz = this.p1.z - this.p0.z;
      const yaw = Math.atan2(vx, vz);
      const turn = wrapAngle(yaw - Math.atan2(ux, uz)); // 正なら左へ曲がっている
      const horiz = Math.hypot(vx, vz) || 1e-6;
      b.root.position.copy(this.p1);
      b.root.rotation.set(-Math.atan2(vy, horiz) * 0.8, yaw, Math.max(-0.6, Math.min(0.6, -turn * 6)));
      // 上がる時はよく羽ばたき、下がる時や平らな時は時々翼を広げたまま滑空する
      const climb = vy / horiz;
      const glide = climb < 0.02 && Math.sin(t * 0.4 + b.phase) > 0.3;
      const want = glide ? 0 : climb > 0.05 ? 1.2 : 0.8;
      b.flap += (want - b.flap) * Math.min(1, dt * 2);
      b.beat += dt * (8 + b.flap * 3);
      // 打ち下ろしは速く、引き上げはゆっくり。滑空中は翼を少し上げて止める
      const s = Math.sin(b.beat);
      const stroke = (s > 0 ? s : s * 0.6) * 0.7;
      const wing = stroke * b.flap + (1 - Math.min(1, b.flap)) * 0.12;
      b.left.rotation.z = wing;
      b.right.rotation.z = -wing;
      b.root.scale.setScalar(amount);
    }
  }
}
