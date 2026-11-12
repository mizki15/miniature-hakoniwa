import * as THREE from 'three/webgpu';

/**
 * 鳥の群れ：昼間、箱庭の上空をゆったり旋回する。ローポリ（胴体＋2 枚の翼）で羽ばたく。
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

export class Birds {
  readonly group = new THREE.Group();
  private birds: { root: THREE.Group; left: THREE.Mesh; right: THREE.Mesh; offset: THREE.Vector3; phase: number }[] = [];
  private center = new THREE.Vector3();
  private radius = 40;
  private altitude = 45;
  private cx = 0;
  private cz = 0;

  constructor(count = 9) {
    for (let i = 0; i < count; i++) {
      const b = buildBird();
      const offset = new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 6);
      this.birds.push({ ...b, offset, phase: Math.random() * 10 });
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

  /** amount：0..1（昼で晴れているほど多く飛ぶ） */
  update(t: number, amount: number) {
    this.group.visible = amount > 0.05;
    if (!this.group.visible) return;
    // 群れの中心はゆっくり大きな円を描く
    const a = t * 0.05;
    this.center.set(this.cx + Math.cos(a) * this.radius, this.altitude + Math.sin(t * 0.13) * 3, this.cz + Math.sin(a * 1.3) * this.radius * 0.8);
    const ahead = new THREE.Vector3(this.cx + Math.cos(a + 0.05) * this.radius, this.center.y, this.cz + Math.sin((a + 0.05) * 1.3) * this.radius * 0.8);
    for (const b of this.birds) {
      const wob = new THREE.Vector3(Math.sin(t * 0.7 + b.phase) * 1.5, Math.sin(t * 1.1 + b.phase) * 0.6, Math.cos(t * 0.6 + b.phase) * 1.5);
      b.root.position.copy(this.center).add(b.offset).add(wob);
      b.root.lookAt(ahead.clone().add(b.offset));
      // 羽ばたき（ときどき滑空）
      const glide = Math.sin(t * 0.4 + b.phase) > 0.5 ? 0.15 : 1;
      const flap = Math.sin(t * 9 + b.phase * 3) * 0.7 * glide;
      b.left.rotation.z = flap;
      b.right.rotation.z = -flap;
      b.root.scale.setScalar(amount);
    }
  }
}
