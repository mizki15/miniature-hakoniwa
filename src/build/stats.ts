/** 棚のビューワーに出す、建物の大きさと数（three.js に頼らない） */
import type { BuildingDesign } from './geoParse';

const r1 = (v: number) => Math.round(v * 10) / 10;

export function designStats(d: BuildingDesign) {
  const { min, max } = d.bounds;
  const width = r1(max[0] - min[0]), depth = r1(max[2] - min[2]), height = r1(max[1] - min[1]);
  const cubes = d.cubes.length;
  return { width, depth, height, cubes, label: `幅 ${width} × 奥行 ${depth} × 高さ ${height} マス・直方体 ${cubes} 個` };
}

/** 建物全体が画面に収まるカメラの距離（外形を囲む球が、縦の画角 fovDeg に収まる距離に少し余白を足す） */
export function viewerCameraDistance(d: BuildingDesign, fovDeg: number): number {
  const { min, max } = d.bounds;
  const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
  return (radius / Math.sin((fovDeg * Math.PI) / 360)) * 1.15;
}
