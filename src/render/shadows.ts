/**
 * 影の描き方の切り替え（デバッグ）。
 * - ふつう：太陽 1 つに影の地図 1 枚。注目点のまわりを覆う（daylight.ts が範囲を決める）
 * - カスケード影：カメラに近い所ほど細かい影の地図を使う（3 段）。three.js の CSMShadowNode
 * - 間引き：影の地図を毎フレームではなく、数フレームに 1 回だけ描き直す（動く物の影は少し遅れる）
 *
 * 材質は「どの光があるか」ごとに作られるので、方式の切り替えは光そのものを替えて行う：
 * カスケード影用の太陽を別に用意し、どちらか一方だけを見せる。向き・色・強さは毎フレーム写す
 */
import * as THREE from 'three/webgpu';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { ShadowSchedule } from './shadowSchedule';

/** カスケード影の設定。段の数・届く距離（カメラから）・光の側の余白（高い山の影が切れないように） */
const CSM_CASCADES = 3;
const CSM_MAX_FAR = 320;
const CSM_LIGHT_MARGIN = 120;

export interface ShadowSystem {
  /** いま影を落としている太陽（daylight の太陽か、カスケード影用の太陽） */
  readonly active: THREE.DirectionalLight;
  readonly schedule: ShadowSchedule;
  /** カスケード影の本体（デバッグで設定を見るため） */
  readonly csm: CSMShadowNode;
  cascade: boolean;
  /** 影の地図の大きさ（画質）。カスケード影は 1 段あたりこの半分（3 段あるので） */
  setMapSize(size: number): void;
  /** 毎フレーム、daylight.apply の後に呼ぶ */
  update(): void;
}

export function createShadowSystem(scene: THREE.Scene, sun: THREE.DirectionalLight): ShadowSystem {
  const csmSun = new THREE.DirectionalLight(0xffffff, 0);
  csmSun.castShadow = true;
  csmSun.visible = false;
  csmSun.shadow.mapSize.set(2048, 2048);
  csmSun.shadow.bias = sun.shadow.bias;
  csmSun.shadow.normalBias = sun.shadow.normalBias;
  csmSun.shadow.radius = sun.shadow.radius;
  // 遠い段は 400 以上の幅になる。光の側の余白も足すと、影のカメラの奥行き（初期値 500）では足りないことがある
  csmSun.shadow.camera.far = 1500;
  const csm = new CSMShadowNode(csmSun, { cascades: CSM_CASCADES, maxFar: CSM_MAX_FAR, mode: 'practical', lightMargin: CSM_LIGHT_MARGIN });
  csm.fade = true; // 段の境目をなめらかに
  csmSun.shadow.shadowNode = csm;
  scene.add(csmSun, csmSun.target);

  const schedule = new ShadowSchedule();
  let cascade = false;
  let mapSize = sun.shadow.mapSize.x;
  /** カスケード影の段を計算した時のカメラ（画角・縦横比・近い面・遠い面） */
  let projKey = '';

  /** 影の地図を毎フレーム描き直すか、決めたフレームだけにするか */
  const cascadeShadows = () => csm.lights.flatMap((l) => (l.shadow ? [l.shadow as THREE.LightShadow] : []));
  const shadowsOf = (): THREE.LightShadow[] => (cascade ? cascadeShadows() : [sun.shadow]);

  const sys: ShadowSystem = {
    get active() { return cascade ? csmSun : sun; },
    schedule,
    csm,
    get cascade() { return cascade; },
    set cascade(v: boolean) {
      if (v === cascade) return;
      cascade = v;
      sun.visible = !v;
      csmSun.visible = v;
      // 使わない方の影も、次に使う時のために毎フレーム描く設定へ戻しておく
      sun.shadow.autoUpdate = true;
      for (const s of cascadeShadows()) s.autoUpdate = true;
      schedule.force();
      sys.setMapSize(mapSize);
    },
    setMapSize(size: number) {
      mapSize = size;
      const resize = (s: THREE.LightShadow, n: number) => {
        if (s.mapSize.x === n) return;
        s.mapSize.setScalar(n);
        s.map?.dispose();
        (s as { map: unknown }).map = null;
      };
      resize(sun.shadow, size);
      const per = Math.max(1024, size / 2);
      resize(csmSun.shadow, per); // まだ段を作る前なら、これが写される
      for (const s of cascadeShadows()) resize(s, per);
      schedule.force();
    },
    update() {
      // カスケード影用の太陽に、向き・色・強さを写す（daylight は sun だけを動かしている）
      csmSun.position.copy(sun.position);
      csmSun.target.position.copy(sun.target.position);
      csmSun.color.copy(sun.color);
      csmSun.intensity = sun.intensity;
      // カスケード影の段の切れ目は、カメラの画角・縦横比から最初に 1 度だけ計算される。
      // 画面の大きさを変えた後もそのままだと、どの段にも入らない所が影（暗い三角形）になるので、変わったら計算し直す
      const cam = csm.camera as THREE.PerspectiveCamera | null;
      if (cam) {
        const key = `${cam.fov}|${cam.aspect}|${cam.near}|${cam.far}`;
        if (key !== projKey) { projKey = key; csm.updateFrustums(); schedule.force(); }
      }
      // 間引き：描き直すフレームだけ needsUpdate を立てる（間隔 1 なら毎フレーム）
      const redraw = schedule.tick();
      const every = schedule.interval === 1;
      for (const s of shadowsOf()) {
        s.autoUpdate = every;
        if (!every && redraw) s.needsUpdate = true;
      }
    },
  };
  return sys;
}
