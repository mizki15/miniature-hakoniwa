import * as THREE from 'three/webgpu';
import { FRAME, PLOT, openable, plotRect } from '../world/plots';

const GHOST_H = 12;

/**
 * エディタモードで「開ける隣の区画」を半透明の枠で見せる。クリックした区画を pick で調べる。
 * 座標は箱庭の中心（枠の中央）が原点。
 */
export class PlotGhosts {
  readonly group = new THREE.Group();
  private boxes: { plot: number; face: THREE.Mesh; line: THREE.LineSegments }[] = [];
  private faceGeo = new THREE.BoxGeometry(PLOT, GHOST_H, PLOT);
  private edgeGeo = new THREE.EdgesGeometry(this.faceGeo);
  private hover = -1;
  private canAfford = false;
  private raycaster = new THREE.Raycaster();

  constructor() {
    this.group.visible = false;
  }

  /** 開ける区画の枠を作り直す。heightAt：その区画の枠を置く地面の高さ */
  update(mask: number, rights: number, heightAt: (plot: number) => number) {
    for (const b of this.boxes) { (b.face.material as THREE.Material).dispose(); (b.line.material as THREE.Material).dispose(); }
    this.group.clear();
    this.boxes = [];
    this.canAfford = rights > 0;
    const half = FRAME / 2;
    for (const plot of openable(mask)) {
      const r = plotRect(plot);
      const face = new THREE.Mesh(this.faceGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false }));
      const line = new THREE.LineSegments(this.edgeGeo, new THREE.LineBasicMaterial({ color: this.canAfford ? 0xffffff : 0x9a9a9a, transparent: true, opacity: 0.85 }));
      const y = heightAt(plot) + GHOST_H / 2 - 4;
      for (const o of [face, line]) { o.position.set(r.x0 + PLOT / 2 - half, y, r.z0 + PLOT / 2 - half); o.userData.sharedGeometry = true; }
      face.userData.ghostPlot = plot;
      face.renderOrder = 3;
      this.group.add(face, line);
      this.boxes.push({ plot, face, line });
    }
    this.setHover(this.hover);
  }

  /** レイが当たった区画の番号（当たらなければ -1） */
  pick(ray: THREE.Ray): number {
    if (!this.group.visible || this.boxes.length === 0) return -1;
    this.raycaster.ray.copy(ray);
    const hits = this.raycaster.intersectObjects(this.boxes.map((b) => b.face), false);
    return hits.length ? (hits[0].object.userData.ghostPlot as number) : -1;
  }

  setHover(plot: number) {
    this.hover = plot;
    for (const b of this.boxes) (b.face.material as THREE.MeshBasicMaterial).opacity = b.plot === plot ? (this.canAfford ? 0.18 : 0.12) : 0.08;
  }
}
