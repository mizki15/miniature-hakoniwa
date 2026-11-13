import * as THREE from 'three/webgpu';
import { FIREFLIES, FIREFLIES_ON, FIREFLY_COLOR, fireflyData } from '../render/materials';
import type { WorldData } from '../world/terrain';
import { GRASS } from '../world/blocks';

/**
 * ホタル：夏を中心に、夜の水辺や草むらをふわふわ飛んで明滅する。
 * 粒そのものは明るい色（ブルームで光って見える）、周りの照らし方は materials の fireflyLight で計算する。
 */
interface Fly { home: THREE.Vector3; pos: THREE.Vector3; phase: number; speed: number; blink: number; }

export class Fireflies {
  readonly mesh: THREE.InstancedMesh;
  private flies: Fly[] = [];
  private world: WorldData | null = null;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();

  constructor() {
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.color = FIREFLY_COLOR.clone().multiplyScalar(6); // HDR の明るさ → ブルームで光る
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.07, 0), mat, FIREFLIES);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < FIREFLIES; i++) this.mesh.setColorAt(i, new THREE.Color(0, 0, 0));
  }

  /** 新しい箱庭に合わせて、水辺に近い草地にすみかを決める */
  setWorld(w: WorldData) {
    this.world = w;
    const N = w.size, half = N / 2;
    const candidates: [number, number][] = [];
    for (let z = 2; z < N - 2; z += 2) for (let x = 2; x < N - 2; x += 2) {
      const h = w.heights[x + z * N];
      if (h === 0) continue; // 開いていない区画の列（空気だけ）
      const top = w.voxels[x + z * N + (h - 1) * N * N];
      if (top !== GRASS || h > w.waterLevel + 6) continue;
      // 近くに水があるか
      let wet = false;
      for (let d = -4; d <= 4 && !wet; d += 2) for (let e = -4; e <= 4; e += 2) {
        const xx = x + d, zz = z + e;
        // 高さ 0 の列は開いていない区画（空気だけ）なので水辺に数えない
        if (xx >= 0 && zz >= 0 && xx < N && zz < N && w.heights[xx + zz * N] > 0 && w.heights[xx + zz * N] < w.waterLevel) { wet = true; break; }
      }
      if (wet) candidates.push([x, z]);
    }
    // いくつかの群れに分ける
    const clusters = Array.from({ length: Math.min(5, Math.max(1, candidates.length)) }, () => candidates[Math.floor(Math.random() * candidates.length)]).filter(Boolean);
    this.flies = Array.from({ length: FIREFLIES }, (_, i) => {
      const [cx, cz] = clusters.length ? clusters[i % clusters.length] : [half, half];
      const x = cx + (Math.random() - 0.5) * 8, z = cz + (Math.random() - 0.5) * 8;
      const xi = Math.min(N - 1, Math.max(0, Math.floor(x))), zi = Math.min(N - 1, Math.max(0, Math.floor(z)));
      const ground = Math.max(w.heights[xi + zi * N], w.waterLevel);
      const home = new THREE.Vector3(x - half, ground + 0.8 + Math.random() * 1.2, z - half);
      return { home, pos: home.clone(), phase: Math.random() * 100, speed: 0.3 + Math.random() * 0.4, blink: 0.6 + Math.random() * 0.8 };
    });
  }

  /** ホタルの訪問者が来ている時だけ光る（生態系の判定で来る） */
  private present = false;
  setPresent(on: boolean) { this.present = on; }

  /** 光っている粒の位置（観察の判定に使う） */
  positions(): THREE.Vector3[] {
    if (!this.mesh.visible) return [];
    return this.flies.filter((_, i) => fireflyData[i].w > 0.05).map((f) => f.pos);
  }

  /** amount：0..1（夜・季節・天気から決める出現量） */
  update(t: number, amount: number) {
    if (!this.present) amount = 0;
    const visible = amount > 0.01 && this.world !== null;
    this.mesh.visible = visible;
    FIREFLIES_ON.value = visible ? 1 : 0;
    for (let i = 0; i < FIREFLIES; i++) {
      const f = this.flies[i];
      if (!f || !visible) { fireflyData[i].set(0, -100, 0, 0); continue; }
      // ふわふわ：いくつかの周期を重ねた 8 の字のような動き
      const p = f.phase + t * f.speed;
      f.pos.set(
        f.home.x + Math.sin(p * 1.3) * 1.6 + Math.sin(p * 0.37) * 1.2,
        f.home.y + Math.sin(p * 0.9) * 0.45,
        f.home.z + Math.cos(p * 1.1) * 1.6 + Math.cos(p * 0.29) * 1.2,
      );
      // 明滅：ゆっくり光ってすっと消える
      const b = Math.max(0, Math.sin(t * f.blink + f.phase));
      const glow = Math.pow(b, 3) * amount;
      fireflyData[i].set(f.pos.x, f.pos.y, f.pos.z, glow * 0.9);
      this.dummy.position.copy(f.pos);
      this.dummy.scale.setScalar(0.6 + glow * 0.6);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.color.setScalar(0.05 + glow));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
