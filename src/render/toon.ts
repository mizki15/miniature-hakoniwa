/**
 * トゥーン（試作）の線画：場面の深さと法線から輪郭と折れ目を探して、暗い線を重ねる後処理。
 * 1 画素につき、深さ 5 回・法線 5 回の読み出しだけ（AO・被写界深度・ブルームより軽い）。
 * - 輪郭：深さの 2 階差分（平らな面は斜めでも 0 になり、段差だけが残る）
 * - 折れ目：となりの画素との法線の向きの差（ブロックの角）
 */
import * as THREE from 'three/webgpu';
import { abs, float, max, mix, perspectiveDepthToViewZ, reference, screenUV, smoothstep, unpackRGBToNormal, uniform, vec2, vec3, vec4 } from 'three/tsl';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

/** 線の濃さ（0 = 線なし） */
export const uLine = uniform(0.4); // 初期値 40%（v0.16.2）

export function toonOutline(color: N, depthTex: N, normalTex: N, camera: THREE.PerspectiveCamera): N {
  const near = reference('near', 'float', camera), far = reference('far', 'float', camera);
  const texel: N = vec2(1).div(vec2(depthTex.size()));
  const zAt = (uv: N): N => perspectiveDepthToViewZ(depthTex.sample(uv).r, near, far).negate();
  const nAt = (uv: N): N => unpackRGBToNormal(normalTex.sample(uv).rgb);
  const uv: N = screenUV;
  const ox = vec2(texel.x, 0), oy = vec2(0, texel.y);
  const z = zAt(uv);
  const zl = zAt(uv.sub(ox)), zr = zAt(uv.add(ox)), zd = zAt(uv.sub(oy)), zu = zAt(uv.add(oy));
  // 輪郭：深さの 2 階差分を、距離で割って比べる（遠くの段差も同じくらいの太さに）
  const lap = abs(zl.add(zr).sub(z.mul(2))).add(abs(zd.add(zu).sub(z.mul(2)))).div(max(z, 0.5));
  const silhouette = smoothstep(0.006, 0.02, lap);
  // 折れ目：法線の向きの差
  const n = nAt(uv);
  const crease: N = float(4).sub(n.dot(nAt(uv.sub(ox))).add(n.dot(nAt(uv.add(ox)))).add(n.dot(nAt(uv.sub(oy)))).add(n.dot(nAt(uv.add(oy)))));
  const fold = smoothstep(0.35, 0.9, crease);
  // 遠くは線を薄く（細かい線が密集して黒くつぶれないように）。空（いちばん奥）には描かない
  const fade = float(1).sub(smoothstep(140, 420, z));
  const sky = depthTex.sample(uv).r.greaterThanEqual(0.99999);
  const edge = max(silhouette, fold.mul(0.7)).mul(fade).mul(uLine).min(1);
  const line = sky.select(float(0), edge);
  // 線は黒ではなく、その場所の色を暗くした色（やわらかい線画）
  const rgb: N = color.rgb;
  return vec4((mix as N)(rgb, rgb.mul(vec3(0.22, 0.2, 0.24)), line.mul(0.85)), 1);
}
