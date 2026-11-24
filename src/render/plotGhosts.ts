import * as THREE from 'three/webgpu';
import { FRAME, PLOT, openable, plotRect } from '../world/plots';
import { PLOT_LAND_INFO, type PlotLand } from '../world/landPlan';

/** 土地の型のアイコン（絵文字を描いたテクスチャ。型ごとに 1 枚を使い回す） */
const iconTextures = new Map<PlotLand, THREE.CanvasTexture>();
function iconTexture(kind: PlotLand) {
  let t = iconTextures.get(kind);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  // 灰色の岩も見えるよう、暗い半透明の丸に白い縁
  g.fillStyle = 'rgba(28,36,44,0.62)';
  g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 5; g.stroke();
  g.font = '72px serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(PLOT_LAND_INFO[kind].icon, 64, 70);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  iconTextures.set(kind, t);
  return t;
}

const GHOST_H = 12;

/**
 * エディタモードで「開ける隣の区画」を半透明の枠で見せる。クリックした区画を pick で調べる。
 * 座標は箱庭の中心（枠の中央）が原点。
 */
export class PlotGhosts {
  readonly group = new THREE.Group();
  private boxes: { plot: number; face: THREE.Mesh; line: THREE.LineSegments; icon: THREE.Sprite | null }[] = [];
  private faceGeo = new THREE.BoxGeometry(PLOT, GHOST_H, PLOT);
  private edgeGeo = new THREE.EdgesGeometry(this.faceGeo);
  private hover = -1;
  private canAfford = false;
  private raycaster = new THREE.Raycaster();

  constructor() {
    this.group.visible = false;
  }

  /**
   * 開ける区画の枠を作り直す。heightAt：その区画の枠を置く地面の高さ。
   * lands：区画ごとの土地の型（地形の作り方の版 2 の箱庭だけ。無ければアイコンを出さない）
   */
  update(mask: number, rights: number, heightAt: (plot: number) => number, lands: readonly PlotLand[] | null = null) {
    for (const b of this.boxes) { (b.face.material as THREE.Material).dispose(); (b.line.material as THREE.Material).dispose(); (b.icon?.material as THREE.Material | undefined)?.dispose(); }
    this.group.clear();
    this.boxes = [];
    this.canAfford = rights > 0;
    const half = FRAME / 2;
    for (const plot of openable(mask)) {
      const r = plotRect(plot);
      const face = new THREE.Mesh(this.faceGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false }));
      const line = new THREE.LineSegments(this.edgeGeo, new THREE.LineBasicMaterial({ color: this.canAfford ? 0xffffff : 0x9a9a9a, transparent: true, opacity: 0.85 }));
      // 枠の高さ 1 つ分、地面より下げて置く（2026-11-22〜。上端が地面の 4 下）
      const y = heightAt(plot) - GHOST_H / 2 - 4;
      for (const o of [face, line]) { o.position.set(r.x0 + PLOT / 2 - half, y, r.z0 + PLOT / 2 - half); o.userData.sharedGeometry = true; }
      face.userData.ghostPlot = plot;
      face.renderOrder = 3;
      this.group.add(face, line);
      // 開く前に、土地の型だけをアイコンで見せる（枠の上、地面より少し上）
      let icon: THREE.Sprite | null = null;
      if (lands) {
        icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture(lands[plot]), transparent: true, depthWrite: false }));
        icon.position.set(r.x0 + PLOT / 2 - half, heightAt(plot) + 6, r.z0 + PLOT / 2 - half);
        icon.scale.setScalar(9);
        icon.renderOrder = 4;
        this.group.add(icon);
      }
      this.boxes.push({ plot, face, line, icon });
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
