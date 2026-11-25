import * as THREE from 'three/webgpu';
import {
  abs, attribute, cameraFar, modelWorldMatrix, vec4, cameraNear, cameraPosition, clamp, dot, exp, float, floor, fract as fractT, instanceIndex,
  int, ivec3, length, max, mix, mx_noise_float as noiseT, mx_noise_vec3, normalize, normalGeometry, normalLocal, normalWorldGeometry, perspectiveDepthToViewZ,
  positionGeometry, positionLocal, positionView, positionWorld, pow, screenUV, sin, cos, smoothstep as smoothstepT, step, texture3DLoad, time,
  transformNormalToView, uniform, uniformArray, vec2, vec3, viewportDepthTexture, viewportSharedTexture, Fn, If, Loop,
} from 'three/tsl';
import { COBBLE, FARMLAND, LOG, PATH, WATER, WET_FARMLAND, paletteFlat } from '../world/blocks';
import { cloudShadowAt } from './sky';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any; // TSL のノード型は複雑なので、ここでは緩く扱う
const fract: N = fractT;
const mx_noise_float: N = noiseT;
const smoothstep: N = smoothstepT;

/** シェーダー間で共有する値（UI や昼夜サイクルから更新する） */
export const U = {
  roundEdges: uniform(1),
  bump: uniform(0.2), // 地面の質感（法線の凹凸）の強さ。0 = なし（初期値 20%。v0.16.2）
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
  windowGlow: uniform(0), // 0..1 建物の窓の灯り（夜 19〜5 時に 1）
};

/** 窓の灯りの色（ブルームでにじむ明るさ） */
const WINDOW_LIGHT = new THREE.Color(1.0, 0.72, 0.38).multiplyScalar(2.2);

/** 窓の灯りの強さ：19〜5 時は 1、18〜19 時と 5〜6 時は少しずつ */
export function windowGlowAt(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 19 || h < 5) return 1;
  if (h >= 18) return h - 18;
  if (h < 6) return 6 - h;
  return 0;
}

/** 波紋：[x, z, 開始時刻, 強さ] × RIPPLES */
export const RIPPLES = 12;
export const rippleData = Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, -1000, 0));
const ripples = uniformArray(rippleData, 'vec4');
/** 広がっている途中の波紋があれば 1。無い時は水面の波紋の計算（12 個ぶん）を丸ごと飛ばす */
export const RIPPLES_ON = uniform(0);

/** 影の自己遮蔽（シャドウアクネ）を防ぐため、影を参照する位置を面から浮かせる量 */
const SHADOW_OFFSET = 0.06;

/** ホタル：[x, y, z, 明るさ] × FIREFLIES（ワールド座標）。周りの地面や草木をほんのり照らす */
export const FIREFLIES = 32;
export const fireflyData = Array.from({ length: FIREFLIES }, () => new THREE.Vector4(0, -100, 0, 0));
const fireflies = uniformArray(fireflyData, 'vec4');
export const FIREFLY_COLOR = new THREE.Color(0.75, 1.0, 0.32);
const fireflyColor = uniform(FIREFLY_COLOR);
/** 光っているホタルがいれば 1。いない時（昼・ホタルが来ていない時）は、1 画素ごとの 32 匹ぶんの計算を飛ばす */
export const FIREFLIES_ON = uniform(0);

/** その位置がホタルからどれだけ照らされるか（距離の 2 乗で弱まる） */
const fireflyLight = (pw: N): N => Fn(() => {
  const acc = float(0).toVar();
  If(FIREFLIES_ON.greaterThan(0.5), () => {
    Loop(FIREFLIES, ({ i }: { i: N }) => {
      const f: N = fireflies.element(i);
      const d = pw.sub(f.xyz);
      acc.addAssign(f.w.div(dot(d, d).mul(1.6).add(0.25)));
    });
  });
  return acc;
})();

/** 地形・小物のマテリアル（ふつうは PBR、トゥーンは光を段に分ける軽いもの） */
export type SurfaceMaterial = THREE.MeshStandardNodeMaterial | THREE.MeshToonNodeMaterial;

/**
 * トゥーン（試作）の光の段：ハーフランバート（dotNL × 0.5 + 0.5）を 3 段に分ける。
 * 影の側 0.5・横から 0.78・日なた 1
 */
export const toonGradient = (() => {
  const t = new THREE.DataTexture(new Uint8Array([128, 200, 255]), 3, 1, THREE.RedFormat, THREE.UnsignedByteType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
})();

/** 雲の影・ホタルの光・高い山の雪など、地形と小物に共通の仕上げ */
function finishSurface(m: SurfaceMaterial, albedo: N, extraEmissive: N = null, cloudOctaves = 3) {
  const shade = float(1).sub(cloudShadowAt(positionWorld, cloudOctaves).mul(0.38));
  m.colorNode = albedo.mul(shade);
  const glow = (fireflyColor as N).mul(fireflyLight(positionWorld)).mul(albedo.add(0.08));
  m.emissiveNode = extraEmissive ? extraEmissive.add(glow) : glow;
}

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
 * 地面の質感（バンプ）：面の上の座標 p（ブロック単位）での、法線の傾き (u, v) を返す。
 * 高さの模様 h の傾きの逆向き（-∂h/∂u, -∂h/∂v）。ノイズは 1 ピクセルにつき 1 回だけ
 * （種類で細かさを変えて共有）、セル・目地・年輪・畝は式で作る。
 */
function terrainBump(p: N, t: N, kind: N): N {
  const isT = (id: number) => near(t, id);
  const side = kind.greaterThan(1.5);
  // 種類ごとのノイズの細かさ：草 9、土 6、岩 5、砂 14、道・畑 10、丸太 7、葉 5
  const freq = isT(1).select(9, isT(2).select(6, isT(3).select(5, isT(4).select(14, isT(6).select(7, isT(7).or(isT(8)).select(5, float(10)))))));
  const n: N = mx_noise_vec3(vec3(p.mul(freq), t.mul(3.7)));
  const grain = n.xy; // -1..1 くらい

  // 石畳：ブロックの半分の石を段ごとに半分ずらす。目地へ向かって落ち、石ごとに少し傾く
  const row = floor(p.y.mul(2));
  const sp = vec2(p.x.mul(2).add(fract(row.mul(0.5)).mul(2).mul(0.5)), p.y.mul(2));
  const sf: N = fract(sp), sid: N = floor(sp);
  const gg = float(0.14);
  const groove = vec2(
    smoothstep(float(1).sub(gg), 1, sf.x).sub(float(1).sub(smoothstep(0, gg, sf.x))),
    smoothstep(float(1).sub(gg), 1, sf.y).sub(float(1).sub(smoothstep(0, gg, sf.y))),
  ).mul(1.1);
  const cobble = groove.add(vec2(hash3(vec3(sid, 3)), hash3(vec3(sid, 4))).sub(0.5).mul(0.35)).add(grain.mul(0.08));

  // 丸太：上下の面は年輪（中心からの同心円）、側面は縦の樹皮の筋
  const lc = fract(p).sub(0.5);
  const lr = max(length(lc), 0.001);
  const rings = lc.div(lr).mul(sin(lr.mul(Math.PI * 2 * 5)).mul(0.3));
  const bark = vec2(sin(p.x.mul(Math.PI * 2 * 5).add(n.x.mul(1.5))).mul(0.45), grain.y.mul(0.1));
  const log = side.select(bark, rings.add(grain.mul(0.06)));

  // 砂：細かい粒と、ゆるい風紋（筋に直角に傾く）
  const ph = p.x.mul(0.8).add(p.y.mul(0.3)).mul(Math.PI * 2 * 1.6).add(n.z.mul(0.8));
  const sand = grain.mul(0.16).add(vec2(0.8, 0.3).mul(cos(ph).mul(0.22)));

  // 畑：畝の溝（上面だけ。h = |sin(3πx)| の傾き）と、ざらつき
  const fx = p.x.mul(Math.PI * 3);
  const farmTop = vec2(sin(fx).sign().mul(cos(fx)).mul(-0.45), 0);
  const farm = side.select(vec2(0), farmTop).add(grain.mul(0.14));

  return isT(1).select(grain.mul(0.38), // 草：細かい毛羽立ち
    isT(2).select(grain.mul(0.42), // 土：粒とくぼみ
    isT(3).select(grain.mul(0.48), // 岩：土のようなザラザラ（少し粗く強め）
    isT(4).select(sand,
    isT(16).select(cobble,
    isT(6).select(log,
    isT(15).select(grain.mul(0.2), // 土の道：踏み固めた細かいざらつき
    isT(13).or(isT(14)).select(farm,
    isT(7).or(isT(8)).select(grain.mul(0.4), vec2(0))))))))));
}

/**
 * 地形。
 * - 同じ平面上のとなりの面の色を、ノイズでゆらした双線形補間で混ぜる（境界をなじませる）
 * - 角丸は「平面が途切れる縁」だけに付ける（同じ平面の継ぎ目に溝を作らない）
 * - 頂点 AO、季節の色、水中のコースティクス
 */
export function createTerrainMaterial(types: THREE.Data3DTexture, size: number, height: number, lite = false, toon = false, toonLite = false): SurfaceMaterial {
  // lite（低画質）：境界のなじませと角丸を省き、テクスチャ参照を 13 回 → 1 回に減らす
  // toon（試作）：lite と同じ軽さに加え、光を段に分け、質感の凹凸と水中のコースティクスも省く（線は後処理で描く）
  if (toon) lite = true;
  const m: SurfaceMaterial = toon
    ? new THREE.MeshToonNodeMaterial({ gradientMap: toonGradient })
    : new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
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
  // 人工物（石畳・丸太・道・畑）：となりと色を混ぜない（境目をくっきり）
  const isArtificial = (t: N): N => near(t, COBBLE).or(near(t, LOG)).or(near(t, PATH)).or(near(t, FARMLAND)).or(near(t, WET_FARMLAND));

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
  const ownT0 = typeAt(voxel);
  const ownColor = surfaceColor(ownT0);
  const ownArt = isArtificial(ownT0);
  let colSum: N = ownColor.mul(0.001);
  let wSum: N = float(0.001);
  for (const [i, j] of lite ? [] : [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const cell = cellAt(base.x.add(i), base.y.add(j));
    const t = typeAt(cell);
    // 人工物は混ぜない：自分が人工物ならとなりの色を取らず、となりの人工物の色も取らない
    const valid = isOpaque(t).and(isOpaque(typeAt(cell.add(nL))).not()).and(ownArt.not()).and(isArtificial(t).not());
    const w = (i ? f.x : float(1).sub(f.x)).mul(j ? f.y : float(1).sub(f.y)).mul(valid.select(float(1), float(0)));
    colSum = colSum.add(surfaceColor(t).mul(w));
    wSum = wSum.add(w);
  }
  const blended = colSum.div(wSum);

  // --- 角丸（ベベル） ---
  // 縁の種類ごとに法線を曲げる：
  //   凸の縁（となりが空気＝段差の下り）→ 外側へ曲げる（+1）
  //   凹の縁（となりの手前に壁が立ち上がる）→ 壁から離れる向きへ曲げる（-0.75）。入り隅もまるく見える
  //   同じ平面が続く → 曲げない（継ぎ目に溝を作らない）
  const fr = fract(faceUV);
  const edgeKind = (dir: N): N => {
    const nbSolid = isOpaque(typeAt(voxel.add(dir)));
    const wall = isOpaque(typeAt(voxel.add(dir).add(nL)));
    return nbSolid.not().select(float(1), wall.select(float(-0.75), float(0)));
  };
  const w = float(0.2);
  const eu: N = lite ? float(0) : edgeKind(tU).mul(smoothstep(float(1).sub(w), 1, fr.x)).sub(edgeKind(tU.negate()).mul(float(1).sub(smoothstep(0, w, fr.x))));
  const ev: N = lite ? float(0) : edgeKind(tV).mul(smoothstep(float(1).sub(w), 1, fr.y)).sub(edgeKind(tV.negate()).mul(float(1).sub(smoothstep(0, w, fr.y))));
  const k = U.roundEdges.mul(0.9);
  // 地面の質感：ブロックの種類ごとの模様で法線を傾ける（形は平らな箱のまま）
  const bump: N = lite ? vec2(0) : terrainBump(faceUV, typeAt(voxel), kind).mul(U.bump)
    // 遠くでは弱める（細かい模様のちらつきを防ぐ）
    .mul(float(1).sub(smoothstep(18, 70, length(positionWorld.sub(cameraPosition)))));
  if (!lite) m.normalNode = transformNormalToView(normalize(nL.add(tU.mul(eu.mul(k).add(bump.x))).add(tV.mul(ev.mul(k).add(bump.y)))));
  // 影の参照位置は「曲げる前」の法線方向に少し浮かせる（縁のギザギザ防止）
  m.receivedShadowPositionNode = positionWorld.add(normalWorldGeometry.mul(SHADOW_OFFSET));

  // --- 色 ---
  // ボクセルごとのゆらぎは弱め＋なめらかなノイズで、平面のつながりを保つ
  // トゥーンはノイズを使わず、ボクセルごとの小さな明るさの差だけ（平らな塗り）
  const jitter = toon ? hash3(voxel).mul(0.06).add(0.97) : hash3(voxel).mul(0.05).add(mx_noise_float(pL.mul(0.18)).mul(0.06)).add(0.97);
  const aoF = toon ? mix(float(0.55), float(1), attribute('ao', 'float')) : mix(float(0.42), float(1), attribute('ao', 'float'));
  const edge = max(abs(eu), abs(ev)).mul(U.roundEdges);
  let albedo: N = blended.mul(jitter).mul(aoF).mul(float(1).sub(edge.mul(0.06)));
  // 畑の畝（うね）：耕した土の上面に筋を入れる
  const ownT = typeAt(voxel);
  const farmTop = near(ownT, 13).or(near(ownT, 14)).and(kind.lessThan(0.5));
  const furrow = abs(sin(faceUV.x.mul(Math.PI * 3)));
  albedo = albedo.mul(farmTop.select(furrow.mul(0.28).add(0.72), float(1)));
  // 雪：冬は上向きの面すべて、高い山の頂上は一年中
  const upFace = smoothstep(0.5, 0.9, nL.y);
  const peakSnow = smoothstep(41, 47, positionWorld.y);
  const snowAmt = max(U.snow.mul(0.85), peakSnow).mul(upFace).add(peakSnow.mul(0.6).mul(float(1).sub(upFace))).min(1);
  albedo = mix(albedo, vec3(0.93, 0.95, 0.98).mul(aoF), snowAmt);

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
  const caustics = (U.sunColor as N).mul(pow(c1, 8).add(pow(c2, 10)).mul(under)).mul(U.daylight).mul(0.55);

  // トゥーン・軽：雲の影のノイズを 3 段 → 1 段に
  finishSurface(m, albedo, toon ? null : caustics, toonLite ? 1 : 3);
  return m;
}

/**
 * 小物（木・花）：頂点カラー・季節の色・AO・風で揺れる。
 * swayLinear：背の低いもの（花）向けの揺れ。高さに比例して揺らす
 */
/**
 * far（トゥーン・軽）：カメラからこの距離より遠い小物を、根元へ縮めて地面の下にしまう（遠くの形を描かない）。
 * 0.75×far から縮み始める。根元の高さは、モデルの高さ（positionGeometry.y）から見積もる
 */
export function createDetailMaterial(swayLinear = 0, opts: { sway?: boolean; windows?: boolean; toon?: boolean; far?: number; cloudOctaves?: number } = {}): SurfaceMaterial {
  const m: SurfaceMaterial = opts.toon
    ? new THREE.MeshToonNodeMaterial({ gradientMap: toonGradient })
    : new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  const pL: N = positionLocal; // ※インスタンスの行列を適用した後の座標（箱庭全体の中での位置）
  const pG: N = positionGeometry; // モデル自身の座標（根元が y=0）
  const nG: N = normalGeometry;

  // 風：モデルの根元からの高さで揺れ幅を決める（地面の標高には依存させない）。
  // 2 つの周期を重ねてゆっくり不規則に。個体ごとに位相をずらす
  const phase = fract(sin(float(instanceIndex).mul(12.9898)).mul(43758.5453)).mul(6.28);
  const hgt = max(pG.y, 0);
  const sway = hgt.mul(hgt).mul(0.0022).add(hgt.mul(swayLinear)).min(0.25).mul(U.wind);
  const gust = sin(time.mul(0.9).add(phase)).mul(0.7).add(sin(time.mul(2.3).add(phase.mul(2.1))).mul(0.3));
  const gust2 = cos(time.mul(0.7).add(phase.mul(1.7))).mul(0.6);
  // 建物など、風で揺らさないもの（sway: false）には付けない
  let pos: N = opts.sway !== false ? pL.add(vec3(gust, 0, gust2).mul(sway)) : pL;
  if (opts.far) {
    const rootY = pL.y.sub(max(pG.y, 0));
    const rootW = (modelWorldMatrix as N).mul(vec4(pL.x, rootY, pL.z, 1)).xyz;
    const keep = float(1).sub(smoothstep(opts.far * 0.75, opts.far, length(rootW.sub(cameraPosition))));
    pos = vec3(pos.x, mix(rootY.sub(1.5), pos.y, keep), pos.z);
    if (opts.sway === false) pos = vec3(pL.x, mix(rootY.sub(1.5), pL.y, keep), pL.z);
  }
  if (opts.sway !== false || opts.far) m.positionNode = pos;
  m.receivedShadowPositionNode = positionWorld.add(normalWorldGeometry.mul(SHADOW_OFFSET));
  // カメラのすぐ近くの木は点描のように透かす（近づいた時に視界をふさがないように）
  m.alphaHash = true;
  m.opacityNode = smoothstep(2.5, 9, length(positionWorld.sub(cameraPosition)));

  const veg = attribute('veg', 'float');
  const base = attribute('color', 'vec3');
  const conifer = mix(base, vec3(0.92, 0.95, 0.97), U.snow);
  // veg 1：地面の草の房（頂点カラーは明るさだけ。季節の草の色を掛ける）
  const col = near(veg, 2).select(U.leafColor, near(veg, 3).select(conifer, near(veg, 1).select((U.grassColor as N).mul(base).mul(1.25), base)));
  const micro = floor(pG.mul(U.detail).sub(nG.mul(0.5)));
  const jitter = hash3(micro).mul(0.12).add(0.94);
  const aoF = mix(float(0.5), float(1), attribute('ao', 'float'));
  // 建物の窓（veg 4）：夜に灯りがともる
  const windows = opts.windows ? near(veg, 4).select(vec3(WINDOW_LIGHT.r, WINDOW_LIGHT.g, WINDOW_LIGHT.b).mul(U.windowGlow), vec3(0)) : null;
  finishSurface(m, col.mul(jitter).mul(aoF), windows, opts.cloudOctaves ?? 3);
  return m;
}

/**
 * トゥーン（試作）の水：画面の読み返し（屈折・水の厚み）をしない、半透明の平らな塗り。
 * 斜めから見るほど空の色、ゆっくり流れる白い波の線、昼夜で明るさを変える（光の計算はしない）
 */
export function createToonWaterMaterial(): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true });
  m.depthWrite = true;
  const wp: N = positionWorld.xz;
  const V = normalize(cameraPosition.sub(positionWorld));
  // フレネルを 2 段に（遠く・斜めは空の色）
  const fres = step(0.55, pow(float(1).sub(max(V.y, 0)), 2));
  let col: N = mix((U.deepWater as N).mul(1.35), (U.skyColor as N).mul(0.9), fres.mul(0.55).add(0.1));
  // 波の線：ノイズの 0 の付近を細い線に
  const n: N = mx_noise_float(vec3(wp.mul(0.35), time.mul(0.25)));
  const wave = float(1).sub(smoothstep(0.03, 0.07, abs(n)));
  col = mix(col, vec3(0.92, 0.97, 1), wave.mul(0.55));
  m.colorNode = col.mul(mix(float(0.18), float(1), U.daylight));
  m.opacityNode = float(0.82);
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
  // 波紋：中心から広がる輪。輪の位置で法線を傾け、少し白く光らせる。広がっている波紋が無い時は計算しない
  // 戻り値：xy＝法線の傾きに足す量、z＝輪の明るさ
  const rippleFx: N = Fn(() => {
    const acc = vec3(0).toVar();
    If(RIPPLES_ON.greaterThan(0.5), () => {
      for (let i = 0; i < RIPPLES; i++) {
        const r: N = ripples.element(i);
        const dv: N = wp.sub(r.xy);
        const d: N = max(length(dv), 0.001);
        const age: N = U.now.sub(r.z);
        const x: N = d.sub(age.mul(1.8));
        const env: N = exp(x.mul(x).mul(-2.2)).mul(exp(age.mul(-0.7))).mul(r.w).mul(step(0, age));
        const push: N = dv.div(d).mul(sin(x.mul(7)).mul(env).mul(0.55));
        acc.addAssign(vec3(push.x, push.y, env.mul(cos(x.mul(7)).mul(0.5).add(0.5))));
      }
    });
    return acc;
  })();
  const tilt: N = n1.xz.mul(0.16).add(n2.xz.mul(0.07)).add(rippleFx.xy);
  const ring: N = rippleFx.z;

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
