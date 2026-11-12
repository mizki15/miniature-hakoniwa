import * as THREE from 'three/webgpu';
import {
  abs, clamp, cos, dot, float, floor, fract as fractT, hash, instanceIndex, length, max, mix, mx_fractal_noise_float,
  normalize, positionGeometry, positionWorldDirection, pow, sin, smoothstep as smoothstepT, time, uniform, vec2, vec3,
} from 'three/tsl';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;
const fract: N = fractT;
const smoothstep: N = smoothstepT;

/** 空の見た目を決める値（昼夜・天気から毎フレーム更新する） */
export const SKY = {
  zenith: uniform(new THREE.Color(0x4f9be0)),
  horizon: uniform(new THREE.Color(0xd8ecfb)),
  sunDir: uniform(new THREE.Vector3(0, 1, 0)),
  sunColor: uniform(new THREE.Color(0xfff4e0)),
  night: uniform(0), // 0 = 昼, 1 = 夜
  cloudCover: uniform(0.3), // 0..1
  cloudDark: uniform(0), // 0..1（雨雲の暗さ）
  meteorA: uniform(new THREE.Vector3(0, 1, 0)),
  meteorB: uniform(new THREE.Vector3(0, 1, 0)),
  meteorP: uniform(-1), // 0..1 の間だけ流れ星が見える
};

const hash3 = (p: N): N => fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));

/** 星：方向を格子に分け、ところどころのセルに星を置く */
function starLayer(dir: N, scale: number, density: number, size: number): N {
  const p = dir.mul(scale);
  const cell = floor(p);
  const h = hash3(cell);
  const jitter = vec3(hash3(cell.add(1.7)), hash3(cell.add(3.1)), hash3(cell.add(5.3))).mul(0.7).add(0.15);
  const d = length(p.sub(cell.add(jitter)));
  const on = h.greaterThan(1 - density).select(float(1), float(0));
  const twinkle = sin(time.mul(h.mul(3).add(1)).add(h.mul(40))).mul(0.35).add(0.65);
  return float(1).sub(smoothstep(0, size, d)).mul(on).mul(twinkle).mul(h.mul(0.6).add(0.4));
}

/** 背景（空）のノード */
export function createSkyNode(): N {
  const dir: N = normalize(positionWorldDirection);
  const elev = dir.y;

  // 箱庭は空に浮かんでいる設定：水平線の下にも空が続く（上下ほぼ対称、下は少し深い色）
  const ae = abs(elev);
  const below = smoothstep(0, 0.05, elev.negate());
  let col: N = mix(SKY.horizon, SKY.zenith, smoothstep(-0.02, 0.55, ae));
  col = mix(col, col.mul(vec3(0.82, 0.86, 0.95)), below);

  // 太陽の光の広がり（昼のみ）
  const sd = max(dot(dir, SKY.sunDir), 0);
  const day = float(1).sub(SKY.night);
  col = col.add(SKY.sunColor.mul(pow(sd, 24).mul(0.35).add(pow(sd, 400).mul(1.5))).mul(day).mul(float(1).sub(SKY.cloudCover.mul(0.8))));

  // 星（夜・晴れているほどよく見える）。水平線の下にも見える
  const starVis = SKY.night.mul(smoothstep(0.02, 0.25, ae)).mul(float(1).sub(SKY.cloudCover.mul(0.9)));
  const stars = starLayer(dir, 90, 0.04, 0.09).add(starLayer(dir, 220, 0.05, 0.12).mul(0.6));
  col = col.add(vec3(0.95, 0.97, 1).mul(stars).mul(starVis).mul(1.6));

  // 流れ星：A → B を移動する明るい線
  const p = SKY.meteorP;
  const active = p.greaterThan(0).and(p.lessThan(1)).select(float(1), float(0));
  const head = normalize(mix(SKY.meteorA, SKY.meteorB, p.max(0)));
  const tail = normalize(mix(SKY.meteorA, SKY.meteorB, p.sub(0.3).max(0)));
  const seg = head.sub(tail);
  const tt = clamp(dot(dir.sub(tail), seg).div(max(dot(seg, seg), 1e-6)), 0, 1);
  const dist = length(dir.sub(tail.add(seg.mul(tt))));
  const meteor = float(1).sub(smoothstep(0, 0.004, dist)).mul(tt.mul(tt)).mul(sin(p.mul(Math.PI))).mul(active).mul(SKY.night);
  col = col.add(vec3(1, 0.97, 0.9).mul(meteor).mul(2.5));

  // 雲：空を平面に投影したノイズ。風でゆっくり流れる。
  // 水平線の上は見上げる雲、下は見下ろす雲海（別の場所のノイズを使う）
  const cover = SKY.cloudCover;
  const up = elev.greaterThan(0);
  const uv = dir.xz.div(max(ae, 0.04)).mul(up.select(float(0.55), float(0.4)))
    .add(up.select(vec2(0, 0), vec2(37.1, -12.7)))
    .add(vec2(time.mul(0.012), time.mul(0.004)));
  const n = mx_fractal_noise_float(vec3(uv, time.mul(0.01)), 4, 2.0, 0.5, 1).mul(0.5).add(0.5);
  const seaCover = cover.mul(0.6).add(0.35); // 雲海は晴れの日でもある程度広がる
  const cv = up.select(cover, seaCover);
  const cloud = smoothstep(float(0.74).sub(cv.mul(0.5)), float(0.9).sub(cv.mul(0.4)), n).mul(smoothstep(0.0, 0.18, ae));
  // 雲の色：昼は白く日の当たる側が明るい、夜は暗い紺、雨雲は灰色。雲海は上から日が当たって明るい
  const lit = pow(sd, 3).mul(0.25).mul(day);
  const cloudDay = mix(vec3(1, 1, 1), vec3(0.55, 0.58, 0.62), SKY.cloudDark).add(lit).add(below.mul(0.08));
  const cloudNight = mix(vec3(0.16, 0.18, 0.24), vec3(0.1, 0.11, 0.14), SKY.cloudDark);
  const cloudCol = mix(cloudDay.mul(SKY.horizon.mul(0.25).add(0.8)), cloudNight, SKY.night);
  col = mix(col, cloudCol, cloud.mul(0.92));

  return col;
}

/**
 * 雲の影：太陽の方向に沿って上空の雲の層まで投影し、同じようなノイズで影を作る。
 * 0 = 影なし, 1 = 濃い影。地形と小物のマテリアルで使う
 */
export function cloudShadowAt(pw: N): N {
  const sun: N = SKY.sunDir;
  const toCloud = float(60).sub(pw.y).div(max(sun.y, 0.15)); // 雲の層（高さ 60）までの距離
  const p = pw.xz.add(sun.xz.mul(toCloud)).mul(0.022).add(vec2(time.mul(0.012), time.mul(0.004)).mul(1.6));
  const n = mx_fractal_noise_float(vec3(p, time.mul(0.01)), 3, 2.0, 0.5, 1).mul(0.5).add(0.5);
  const cover = SKY.cloudCover;
  const c = smoothstep(float(0.72).sub(cover.mul(0.5)), float(0.9).sub(cover.mul(0.4)), n);
  return c.mul(float(1).sub(SKY.night)).mul(smoothstep(0.0, 0.2, sun.y));
}

/**
 * 雨・雪：箱庭の上の箱の中を落ちていく粒。位置は GPU 上で時刻から計算する（CPU 負荷なし）
 */
export function createPrecipitation(kind: 'rain' | 'snow', size: number, amount: THREE.UniformNode<'float', number>) {
  const area = Math.min(4, (size / 128) ** 2);
  const count = Math.round((kind === 'rain' ? 5000 : 3500) * area);
  const geo = kind === 'rain' ? new THREE.BoxGeometry(0.035, 0.7, 0.035) : new THREE.IcosahedronGeometry(0.09, 0);
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const id = float(instanceIndex);
  const fallH = 70;
  const speed = kind === 'rain' ? 28 : 2.2;
  const y = fract(hash(id.mul(3.7)).sub(time.mul(speed / fallH))).mul(fallH);
  const sway = kind === 'snow' ? sin(time.mul(0.8).add(id)).mul(0.6) : float(0);
  const x = hash(id.mul(1.31)).sub(0.5).mul(size).add(sway);
  const z = hash(id.mul(7.17)).sub(0.5).mul(size).add(kind === 'snow' ? cos(time.mul(0.6).add(id.mul(1.3))).mul(0.6) : float(0));
  // 降る量に応じて表示する粒の割合を変える
  const visible = hash(id.mul(5.9)).lessThan(amount).select(float(1), float(0));
  (mat as N).positionNode = (positionGeometry as N).mul(visible).add(vec3(x, y, z));
  mat.colorNode = kind === 'rain' ? vec3(0.75, 0.82, 0.92) : vec3(1, 1, 1);
  mat.opacityNode = kind === 'rain' ? float(0.45) : float(0.9);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}

