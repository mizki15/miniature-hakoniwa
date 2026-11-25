import * as THREE from 'three/webgpu';
import { float, packNormalToRGB, unpackRGBToNormal, mix, mrt, normalView, output, pass, sample, uniform, vec4, velocity } from 'three/tsl';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { taau } from 'three/addons/tsl/display/TAAUNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { aaSpec, type AAMode } from './antialias';
import { toonOutline } from './toon';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/**
 * ポストプロセス（v0.18 で main.ts から切り出した）：
 * （時間方向のアンチエイリアス）→ AO（GTAO）→ 被写界深度（画面中央にピント）→ ブルーム →（FXAA・SMAA）。
 * アンチエイリアスの方法と、場面を描く解像度を変えると、場面の描き方ごと作り直す。
 * トゥーン（style.toon()）は AO の代わりに線画を重ねる。トゥーン・軽は描く解像度に style.sceneScale() をかける
 */
export interface PostStyle { toon(): boolean; sceneScale(): number }

interface ScenePost { scenePass: ReturnType<typeof pass>; aoPass: ReturnType<typeof ao>; color: N; withAO: N; viewZ: N; isSky: N; depthTex: N; normalTex: N; temporal: { dispose(): void } | null }

export function createPost(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, style: PostStyle) {
  const pipeline = new THREE.RenderPipeline(renderer);
  const uniforms = { ao: uniform(1), focus: uniform(100), focal: uniform(30), bokeh: uniform(1.8) };
  /** 効果の入り切り（変えたら update() を呼ぶ） */
  const effects = { dof: true, ao: true, bloom: true };
  let aaMode: AAMode = 'fxaa';
  let renderScale = 1;
  let sp: ScenePost | null = null;

  const buildScenePost = (): ScenePost => {
    const spec = aaSpec(aaMode);
    const scenePass = pass(scene, camera, { samples: spec.samples });
    scenePass.setMRT(mrt(spec.velocity ? { output, normal: packNormalToRGB(normalView), velocity } : { output, normal: packNormalToRGB(normalView) }));
    scenePass.setResolutionScale(renderScale * style.sceneScale());
    const raw = scenePass.getTextureNode('output');
    const normalTex = scenePass.getTextureNode('normal');
    const depthTex = scenePass.getTextureNode('depth');
    const viewZ = scenePass.getViewZNode();
    // 時間方向の方法は、場面の色そのものにかける（AO などはその後）
    let temporal: (N & { dispose(): void }) | null = null;
    if (spec.temporal !== 'none') {
      const vel = scenePass.getTextureNode('velocity');
      temporal = (spec.temporal === 'traa' ? traa : taau)(raw, depthTex, vel, camera) as N;
    }
    const color: N = temporal ?? raw;

    const sceneNormal = sample((uv: N) => unpackRGBToNormal((normalTex as N).sample(uv)));
    const aoPass = ao(depthTex, sceneNormal, camera);
    aoPass.resolutionScale = 0.5;
    aoPass.radius.value = 1.6; // ボクセル 1〜2 個分くらいの範囲の隅を暗く
    aoPass.thickness.value = 2;
    aoPass.scale.value = 1.6;
    aoPass.distanceFallOff.value = 1;
    // GTAO はサンプルのノイズが粒状に見えるので、深度と法線を見ながらぼかして消す
    const aoValue = (denoise(aoPass.getTextureNode(), depthTex, sceneNormal, camera) as N).r;
    const withAO = vec4(color.rgb.mul(mix(float(1), aoValue, uniforms.ao)), 1);
    const isSky = (depthTex as N).r.greaterThanEqual(0.99999);
    return { scenePass, aoPass, color, withAO, viewZ, isSky, depthTex, normalTex, temporal };
  };

  /** 出力をつなぎ直す。rebuildScene：場面の描き方（解像度・アンチエイリアス）ごと作り直す */
  const update = (rebuildScene = false) => {
    if (rebuildScene || !sp) {
      if (sp) { sp.scenePass.dispose(); sp.aoPass.dispose(); sp.temporal?.dispose(); }
      sp = buildScenePost();
    }
    const { color, withAO, viewZ, isSky } = sp;
    // トゥーン：AO は使わず（GTAO の計算ごと飛ぶ）、深さと法線から線画を重ねる
    const src: N = style.toon() ? toonOutline(color, sp.depthTex, sp.normalTex, camera) : effects.ao ? withAO : color;
    // 空（背景）はぼかさない：星や雲がくっきり見えるように
    let out: N = effects.dof ? isSky.select(src, dof(src, viewZ, uniforms.focus, uniforms.focal, uniforms.bokeh)) : src;
    // ブルーム：明るい所（ホタル・太陽の照り返し）がにじんで光る
    if (effects.bloom) out = out.add(bloom(out, 0.45, 0.4, 0.9));
    // 描き終わった絵にかける方法は最後に
    const post = aaSpec(aaMode).post;
    if (post === 'fxaa') out = fxaa(out);
    else if (post === 'smaa') out = smaa(out);
    pipeline.outputNode = out;
    pipeline.needsUpdate = true;
  };

  const setAntialias = (mode: AAMode, scale = renderScale) => {
    if (mode === aaMode && scale === renderScale && sp) return;
    aaMode = mode; renderScale = scale;
    update(true);
  };

  update();
  return {
    pipeline, uniforms, effects, update, setAntialias,
    get aaMode() { return aaMode; },
    get renderScale() { return renderScale; },
  };
}
export type Post = ReturnType<typeof createPost>;
