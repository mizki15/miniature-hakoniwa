import * as THREE from 'three/webgpu';
import {
  abs, attribute, cameraFar, cameraNear, cameraPosition, clamp, dot, exp, float, floor, fract as fractT, instanceIndex,
  int, ivec3, length, max, mix, mx_noise_float as noiseT, mx_noise_vec3, normalize, normalGeometry, normalLocal, perspectiveDepthToViewZ,
  positionGeometry, positionLocal, positionView, positionWorld, pow, screenUV, sin, cos, smoothstep as smoothstepT, step, texture3DLoad, time,
  transformNormalToView, uniform, uniformArray, vec2, vec3, viewportDepthTexture, viewportSharedTexture,
} from 'three/tsl';
import { paletteFlat, WATER } from '../world/blocks';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any; // TSL のノード型は複雑なので、ここでは緩く扱う
const fract: N = fractT;
const mx_noise_float: N = noiseT;
const smoothstep: N = smoothstepT;

/** シェーダー間で共有する値（UI や昼夜サイクルから更新する） */
export const U = {
  roundEdges: uniform(1),
  blend: uniform(0.8), // 境界のなじみ（0 = くっきり, 1 = なめらか）
  warp: uniform(0.45), // 境界のゆらぎ
  waterLevel: uniform(10),
  worldSize: uniform(64),
  grassColor: uniform(new THREE.Color(0x7cbf4a)),
  leafColor: uniform(new THREE.Color(0x4f9a3c)),
  snow: uniform(0), // 0..1 冬の積雪
  skyColor: uniform(new THREE.Color(0xbfe3ff)),
  sunColor: uniform(new THREE.Color(0xfff4e0)),
  daylight: uniform(1), // 0 = 夜, 1 = 昼
  deepWater: uniform(new THREE.Color(0x1d5f7a)),
  detail: uniform(4), // 小物のボクセルの細かさ
  wind: uniform(1),
  now: uniform(0), // 波紋用の時計（秒）
};

/** 波紋：[x, z, 開始時刻, 強さ] × RIPPLES */
export const RIPPLES = 12;
export const rippleData = Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, -1000, 0));
const ripples = uniformArray(rippleData, 'vec4');

const palette = uniformArray(paletteFlat().map(([r, g, b]) => new THREE.Color(r, g, b)), 'color');

const hash3 = (p: N) => fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
const near = (a: N, b: number) => abs(a.sub(b)).lessThan(0.5);

/** 面の向きから、面内の座標系（u, v）を決める */
function faceFrame(pL: N, nL: N) {
  const absN: N = abs(nL);
  const isX = absN.x.greaterThan(0.5);
  const isY = absN.y.greaterThan(0.5);
  const faceUV = isX.select(vec2(pL.z, pL.y), isY.select(vec2(pL.x, pL.z), vec2(pL.x, pL.y)));
  const tU = isX.select(vec3(0, 0, 1), vec3(1, 0, 0));
  const tV = isX.select(vec3(0, 1, 0), isY.select(vec3(0, 0, 1), vec3(0, 1, 0)));
  return { faceUV, tU, tV };
}

/**
 * 地形。
 * - 同じ平面上のとなりの面の色を、ノイズでゆらした双線形補間で混ぜる（境界をなじませる）
 * - 角丸は「平面が途切れる縁」だけに付ける（同じ平面の継ぎ目に溝を作らない）
 * - 頂点 AO、季節の色、水中のコースティクス
 */
export function createTerrainMaterial(types: THREE.Data3DTexture, size: number, height: number): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  const pL: N = positionLocal;
  const nL: N = normalLocal;

  // ボクセルの種類を 3D テクスチャから読む（範囲外は空気）
  const maxC = vec3(size - 1, height - 1, size - 1);
  const typeAt = (c: N): N => {
    const inb = c.x.greaterThanEqual(0).and(c.y.greaterThanEqual(0)).and(c.z.greaterThanEqual(0))
      .and(c.x.lessThan(size)).and(c.y.lessThan(height)).and(c.z.lessThan(size));
    const cc = clamp(c, vec3(0), maxC);
    const t = texture3DLoad(types, ivec3(int(cc.x), int(cc.z), int(cc.y))).r.mul(255).round();
    return inb.select(t, float(0));
  };
  const isOpaque = (t: N): N => t.greaterThan(0.5).and(near(t, WATER).not());

  const kind = nL.y.greaterThan(0.5).select(float(0), nL.y.lessThan(-0.5).select(float(1), float(2)));
  const surfaceColor = (t: N): N => {
    const base = palette.element(int(t.mul(3).add(kind)));
    const grassTop = near(t, 1).and(kind.lessThan(0.5));
    return grassTop.select(U.grassColor, base);
  };

  const { faceUV, tU, tV } = faceFrame(pL, nL);
  const voxel = floor(pL.sub(nL.mul(0.5)));
  const ownU = dot(voxel as N, tU as N), ownV = dot(voxel as N, tV as N);
  const cellAt = (cu: N, cv: N) => voxel.add(tU.mul(cu.sub(ownU))).add(tV.mul(cv.sub(ownV)));

  // --- 境界のなじませ ---
  const warp = vec2(mx_noise_float(pL.mul(0.45)), mx_noise_float(pL.mul(0.45).add(vec3(17.3, 5.1, 9.7)))).mul(U.warp);
  const g = faceUV.add(warp).sub(0.5);
  const base: N = floor(g);
  const b = max(U.blend, 0.02).mul(0.5);
  const f = smoothstep(float(0.5).sub(b), float(0.5).add(b), fract(g));
  const ownColor = surfaceColor(typeAt(voxel));
  let colSum: N = ownColor.mul(0.001);
  let wSum: N = float(0.001);
  for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const cell = cellAt(base.x.add(i), base.y.add(j));
    const t = typeAt(cell);
    const valid = isOpaque(t).and(isOpaque(typeAt(cell.add(nL))).not());
    const w = (i ? f.x : float(1).sub(f.x)).mul(j ? f.y : float(1).sub(f.y)).mul(valid.select(float(1), float(0)));
    colSum = colSum.add(surfaceColor(t).mul(w));
    wSum = wSum.add(w);
  }
  const blended = colSum.div(wSum);

  // --- 角丸：平面が途切れる側の縁だけ法線を外へ曲げる ---
  const fr = fract(faceUV);
  const open = (dir: N) => isOpaque(typeAt(voxel.add(dir))).not().select(float(1), float(0));
  const w = float(0.18);
  const eu = open(tU).mul(smoothstep(float(1).sub(w), 1, fr.x)).sub(open(tU.negate()).mul(float(1).sub(smoothstep(0, w, fr.x))));
  const ev = open(tV).mul(smoothstep(float(1).sub(w), 1, fr.y)).sub(open(tV.negate()).mul(float(1).sub(smoothstep(0, w, fr.y))));
  const k = U.roundEdges.mul(0.9);
  const bent = normalize(nL.add(tU.mul(eu.mul(k))).add(tV.mul(ev.mul(k))));
  m.normalNode = transformNormalToView(bent);

  // --- 色 ---
  // ボクセルごとのゆらぎは弱め＋なめらかなノイズで、平面のつながりを保つ
  const jitter = hash3(voxel).mul(0.05).add(mx_noise_float(pL.mul(0.18)).mul(0.06)).add(0.97);
  const aoF = mix(float(0.42), float(1), attribute('ao', 'float'));
  const edge = max(abs(eu), abs(ev)).mul(U.roundEdges);
  m.colorNode = blended.mul(jitter).mul(aoF).mul(float(1).sub(edge.mul(0.06)));

  // --- コースティクス（水面より下の地形。箱庭の外周には出さない） ---
  const depthBelow = U.waterLevel.sub(0.15).sub(positionWorld.y);
  const inside = pL.x.greaterThan(0.01).and(pL.z.greaterThan(0.01))
    .and(pL.x.lessThan(U.worldSize.sub(0.01))).and(pL.z.lessThan(U.worldSize.sub(0.01)));
  // 上向きの面だけ（側面に出すと縦じまになる）
  const up = smoothstep(0.3, 0.9, nL.y);
  const under = smoothstep(0, 0.3, depthBelow).mul(float(1).sub(smoothstep(2, 6, depthBelow))).mul(inside.select(float(1), float(0))).mul(up);
  const cp = positionWorld.xz.mul(1.1);
  const c1: N = float(1).sub(abs(mx_noise_float(vec3(cp, time.mul(0.5)))));
  const c2: N = float(1).sub(abs(mx_noise_float(vec3(cp.mul(1.7).add(3.1), time.mul(0.7)))));
  m.emissiveNode = (U.sunColor as N).mul(pow(c1, 8).add(pow(c2, 10)).mul(under)).mul(U.daylight).mul(0.55);

  return m;
}

/** 小物（木・花）：頂点カラー・季節の色・AO・風で揺れる */
export function createDetailMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  const pL: N = positionLocal; // ※インスタンスの行列を適用した後の座標（箱庭全体の中での位置）
  const pG: N = positionGeometry; // モデル自身の座標（根元が y=0）
  const nG: N = normalGeometry;

  // 風：モデルの根元からの高さで揺れ幅を決める（地面の標高には依存させない）。
  // 2 つの周期を重ねてゆっくり不規則に。個体ごとに位相をずらす
  const phase = fract(sin(float(instanceIndex).mul(12.9898)).mul(43758.5453)).mul(6.28);
  const hgt = max(pG.y, 0);
  const sway = hgt.mul(hgt).mul(0.0022).min(0.25).mul(U.wind);
  const gust = sin(time.mul(0.9).add(phase)).mul(0.7).add(sin(time.mul(2.3).add(phase.mul(2.1))).mul(0.3));
  const gust2 = cos(time.mul(0.7).add(phase.mul(1.7))).mul(0.6);
  m.positionNode = pL.add(vec3(gust, 0, gust2).mul(sway));

  const veg = attribute('veg', 'float');
  const base = attribute('color', 'vec3');
  const conifer = mix(base, vec3(0.92, 0.95, 0.97), U.snow);
  const col = near(veg, 2).select(U.leafColor, near(veg, 3).select(conifer, base));
  const micro = floor(pG.mul(U.detail).sub(nG.mul(0.5)));
  const jitter = hash3(micro).mul(0.12).add(0.94);
  const aoF = mix(float(0.5), float(1), attribute('ao', 'float'));
  m.colorNode = col.mul(jitter).mul(aoF);
  return m;
}

/** 水：屈折・水深による色の吸収・フレネル反射・岸辺の泡・波紋 */
export function createWaterMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.06, metalness: 0, transparent: true });
  m.depthWrite = true;

  // 波の法線（スクロールする 2 層のノイズ）
  const wp: N = positionWorld.xz;
  const n1 = mx_noise_vec3(vec3(wp.mul(0.45), time.mul(0.35)));
  const n2 = mx_noise_vec3(vec3(wp.mul(1.6).add(vec2(13.1, 7.7)), time.mul(0.6)));
  let tilt: N = n1.xz.mul(0.16).add(n2.xz.mul(0.07));

  // 波紋：中心から広がる輪。輪の位置で法線を傾け、少し白く光らせる
  let ring: N = float(0);
  for (let i = 0; i < RIPPLES; i++) {
    const r: N = ripples.element(i);
    const dv = wp.sub(r.xy);
    const d = max(length(dv), 0.001);
    const age = U.now.sub(r.z);
    const x = d.sub(age.mul(1.8));
    const env = exp(x.mul(x).mul(-2.2)).mul(exp(age.mul(-0.7))).mul(r.w).mul(step(0, age));
    tilt = tilt.add(dv.div(d).mul(sin(x.mul(7)).mul(env).mul(0.55)));
    ring = ring.add(env.mul(cos(x.mul(7)).mul(0.5).add(0.5)));
  }
  const Nw = normalize(vec3(tilt.x, 1, tilt.y));
  m.normalNode = transformNormalToView(Nw);

  // 水の厚み（水面から背後の地形までの距離）
  const sceneZ = perspectiveDepthToViewZ(viewportDepthTexture(), cameraNear, cameraFar);
  const thick = positionView.z.sub(sceneZ).max(0);
  const refrUV = screenUV.add(tilt.mul(0.05).mul(thick.min(1.5)));
  const sceneZR = perspectiveDepthToViewZ(viewportDepthTexture(refrUV), cameraNear, cameraFar);
  const thickR = positionView.z.sub(sceneZR);
  // 屈折先が水より手前にある場合は屈折させない
  const bad = thickR.lessThan(0);
  const uvF = bad.select(screenUV, refrUV);
  const thickF = bad.select(thick, thickR);

  const behind = viewportSharedTexture(uvF).rgb;
  const absorb = exp(vec3(0.42, 0.11, 0.07).negate().mul(thickF)); // 赤から先に吸収される
  const murk = float(1).sub(exp(thickF.mul(-0.28)));
  let col: N = mix(behind.mul(absorb), U.deepWater.mul(mix(float(0.15), float(1), U.daylight)), murk.mul(0.88));

  // フレネル：斜めから見るほど空が映る
  const V = normalize(cameraPosition.sub(positionWorld));
  const fres = pow(float(1).sub(max(dot(Nw, V), 0)), 4);
  col = mix(col, U.skyColor, fres.mul(0.65).add(0.03));

  // 岸辺の泡と波紋の白いきらめき
  const foamN = mx_noise_float(vec3(wp.mul(2.4), time.mul(0.8))).mul(0.5).add(0.5);
  const shore = float(1).sub(smoothstep(0, 0.22, thickF));
  const foam = shore.mul(smoothstep(0.4, 0.62, foamN.add(shore.mul(0.35)))).add(ring.mul(0.18)).min(1);
  col = mix(col, vec3(0.95, 0.97, 1).mul(mix(float(0.25), float(1), U.daylight)), foam.mul(0.85));

  m.backdropNode = col;
  m.backdropAlphaNode = float(1);
  return m;
}
