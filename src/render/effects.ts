import * as THREE from 'three/webgpu';
import { Fx, type Burst } from './fx';
import { sfx } from '../audio/sfx';
import { faceColor, DIRT, GRASS, STONE, SAND, LOG, LEAVES, CONIFER, MUD, COBBLE } from '../world/blocks';

/**
 * エフェクトの ID（docs/エフェクト一覧.md）→ 見た目（パーティクル）と音。
 * 位置はマスの座標（x・z はマスの真ん中、y は高さ）。音は sfx の呼び出し口へ（つないでいなければ見た目だけ）
 */
export interface FxEvent {
  id: string;
  x: number; y: number; z: number;
  /** 粒の色（ブロック・作物・花・素材の色）。無ければ ID ごとの色 */
  color?: number;
  /** 掘った・置いたブロックの種類（色と音の選び分けに） */
  block?: number;
  /** 数（まとめて起きた時の大きさの目安） */
  n?: number;
}

const lin = new THREE.Color();
/** ブロックの面の色（リニア）→ 16 進（sRGB） */
export const blockHex = (t: number, kind: 0 | 1 | 2 = 0) => { const [r, g, b] = faceColor(t, kind); return lin.setRGB(r, g, b, THREE.LinearSRGBColorSpace).getHex(); };
/** 季節の葉の色 */
export const LEAF_COLORS = [[0x86c95a, 0x6fb442], [0x3d8a30, 0x4f9a3c], [0xd9772e, 0xe8a23a, 0xc4552a], [0xdfe9ee, 0xbfd4dc]];

/** 掘る・置くの音を、ブロックの種類で選ぶ（B05a〜f・B07a〜e） */
export function blockSoundSuffix(t: number): string {
  if (t === STONE || t === COBBLE) return 'b';
  if (t === SAND) return 'c';
  if (t === LOG) return 'd';
  if (t === LEAVES || t === CONIFER) return 'e';
  if (t === MUD) return 'f';
  return 'a';
}

export class Effects {
  readonly fx: Fx;
  /** いまの季節（葉の色） */
  season = 0;
  constructor(atlasUrl: string) { this.fx = new Fx(atlasUrl); }

  private b(at: FxEvent, o: Omit<Burst, 'at'>, dy = 0) { this.fx.burst({ ...o, at: { x: at.x, y: at.y + dy, z: at.z } }); }

  /** エフェクトを出す（見た目と音） */
  play(e: FxEvent) {
    const leaf = LEAF_COLORS[this.season] ?? LEAF_COLORS[0];
    const soil = blockHex(DIRT);
    switch (e.id) {
      // ---- 見るモードの操作 ----
      case 'A01': // 水やり
        this.b(e, { sprite: 'drop', count: 9, speed: [0.4, 0.9], up: 0.2, gravity: 7, life: [0.45, 0.7], size: [0.09, 0.14], jitter: 0.25, delay: 0.25 }, 1.1);
        this.b(e, { sprite: 'splash', count: 3, speed: [0.3, 0.6], up: 0.5, gravity: 3, life: [0.35, 0.5], size: [0.16, 0.24], endSize: 1.4, jitter: 0.3, delay: 0.5 }, 0.05);
        this.b(e, { sprite: 'glow', count: 1, speed: [0, 0], gravity: 0, life: [0.6, 0.6], size: [0.6, 0.6], endSize: 2.2, alpha: 0.35, color: 0x9fd4ff, delay: 0.55 }, 0.05);
        break;
      case 'A02': // 収穫
        this.b(e, { sprite: ['leaf1', 'leaf2', 'leaf3'], count: 6, color: e.color ? [e.color, 0x5fae3a] : [0x5fae3a, 0x86c95a], speed: [0.8, 1.6], up: 0.7, gravity: 5, life: [0.5, 0.9], size: [0.1, 0.16], spin: 6, jitter: 0.2 }, 0.3);
        this.b(e, { sprite: 'sparkle', count: 3, speed: [0.3, 0.7], up: 0.8, gravity: -0.5, life: [0.4, 0.7], size: [0.1, 0.16], endSize: 0.3, color: 0xfff2b0 }, 0.5);
        break;
      case 'A03': // 撫でる
        this.b(e, { sprite: ['heart', 'heart2'], count: 2, rise: 0.8, gravity: 0, drag: 0, life: [0.8, 1.1], size: [0.16, 0.22], delay: 0.3, jitter: 0.15 }, 0.9);
        break;
      case 'A04': // 餌
        this.b(e, { sprite: 'crumb', count: 4, color: e.color ?? 0xe8a23a, speed: [0.4, 0.8], up: 0.5, gravity: 6, life: [0.4, 0.6], size: [0.05, 0.08], delay: 0.2 }, 0.5);
        this.b(e, { sprite: ['heart', 'heart2'], count: 5, speed: [0.5, 1.0], up: 0.85, gravity: -0.3, drag: 1.5, life: [0.9, 1.3], size: [0.18, 0.26], delay: 0.35, jitter: 0.1 }, 0.9);
        break;
      case 'A05': // 木を切る
        this.b(e, { sprite: ['splinter1', 'splinter2'], count: 10, color: [0xc8a070, 0xa07a4e], speed: [1.2, 2.4], up: 0.6, gravity: 8, life: [0.5, 0.8], size: [0.07, 0.12], spin: 10, jitter: 0.2 }, 0.6);
        this.b(e, { sprite: ['leaf1', 'leaf2', 'leaf3'], count: 14, color: leaf, speed: [0.3, 1.0], up: 0.4, gravity: 1.2, drag: 1.5, sway: 1.2, life: [1.2, 2.0], size: [0.12, 0.2], spin: 4, jitter: 1.0 }, 2.5);
        this.b(e, { sprite: ['dust1', 'dust2', 'dust3'], count: 5, color: 0xcbb89a, speed: [0.4, 0.9], up: 0.15, gravity: -0.3, life: [0.6, 1.0], size: [0.3, 0.45], endSize: 1.8, alpha: 0.6, jitter: 0.4 }, 0.1);
        break;
      case 'A06': // 花を摘む
        this.b(e, { sprite: ['petal1', 'petal2'], count: 7, color: e.color ? [e.color] : [0xf2c94c], speed: [0.6, 1.2], up: 0.8, gravity: 1.0, drag: 1.4, sway: 1.0, life: [0.9, 1.4], size: [0.08, 0.13], spin: 5 }, 0.4);
        break;
      case 'A07': // 葦を刈る
        this.b(e, { sprite: 'blade', count: 7, color: [0xb8c45a, 0x9cb04a], speed: [0.8, 1.5], up: 0.35, gravity: 4, life: [0.5, 0.8], size: [0.12, 0.18], spin: 8 }, 0.6);
        break;
      case 'A09': // 観察し終えた
        this.b(e, { sprite: 'sparkle', count: 4, speed: [0.8, 1.2], up: 0.3, gravity: 0, drag: 2.5, life: [0.5, 0.7], size: [0.12, 0.16], endSize: 0.2, color: 0xfff2b0 }, 0.7);
        break;
      case 'A10': // 初めて観察した
        this.b(e, { sprite: 'beam', count: 1, speed: [0, 0], gravity: 0, life: [0.9, 0.9], size: [2.4, 2.4], endSize: 1.1, alpha: 0.55, color: 0xffe08a }, 1.2);
        this.b(e, { sprite: ['sparkle', 'sparkleSmall'], count: 10, speed: [0.6, 1.4], up: 0.7, gravity: -0.4, drag: 1.5, life: [0.8, 1.3], size: [0.1, 0.18], color: [0xffe08a, 0xffffff], delay: 0.15 }, 0.8);
        break;
      // ---- エディタの道具 ----
      case 'B01': // 耕す
        this.b(e, { sprite: ['clod1', 'clod2', 'clod3'], count: 7, color: [soil, 0x9a7448], speed: [1.0, 1.8], up: 0.75, gravity: 9, life: [0.45, 0.7], size: [0.08, 0.13], spin: 6, jitter: 0.25 }, 0.05);
        this.b(e, { sprite: ['dust1', 'dust2'], count: 3, color: 0xb89a74, speed: [0.3, 0.6], up: 0.2, gravity: -0.2, life: [0.5, 0.8], size: [0.3, 0.4], endSize: 1.6, alpha: 0.5 }, 0.05);
        break;
      case 'B02': // 種をまく
        this.b(e, { sprite: 'seed', count: 6, color: e.color ?? 0xd8c070, speed: [0.3, 0.7], up: 0.3, gravity: 7, life: [0.35, 0.55], size: [0.05, 0.07], jitter: 0.25 }, 0.7);
        this.b(e, { sprite: 'dust1', count: 2, color: 0xb89a74, speed: [0.2, 0.4], up: 0.2, gravity: -0.2, life: [0.4, 0.6], size: [0.2, 0.3], endSize: 1.5, alpha: 0.4, delay: 0.3 }, 0.05);
        break;
      case 'B03': case 'B04': // 苗木・花を植える
        this.b(e, { sprite: ['clod1', 'clod2'], count: 4, color: soil, speed: [0.6, 1.1], up: 0.7, gravity: 8, life: [0.4, 0.6], size: [0.07, 0.1] }, 0.05);
        this.b(e, { sprite: e.id === 'B04' ? 'petal1' : 'leaf1', count: 3, color: e.color ?? 0x86c95a, speed: [0.4, 0.8], up: 0.8, gravity: 0.8, sway: 0.8, life: [0.6, 0.9], size: [0.08, 0.12], spin: 4, delay: 0.15 }, 0.4);
        this.b(e, { sprite: 'sparkleSmall', count: 2, gravity: -0.4, speed: [0.2, 0.4], up: 0.9, life: [0.4, 0.6], size: [0.08, 0.1], color: 0xfff2b0, delay: 0.2 }, 0.5);
        break;
      case 'B05': { // 掘る
        const t = e.block ?? DIRT;
        const col = [blockHex(t, 2), blockHex(t, 0)];
        const sprite = t === STONE || t === COBBLE ? ['chip1', 'chip2', 'chip3'] as const : t === LOG ? ['splinter1', 'splinter2'] as const : t === LEAVES || t === CONIFER ? ['leaf1', 'leaf2'] as const : ['clod1', 'clod2', 'clod3'] as const;
        this.b(e, { sprite: [...sprite], count: 10, color: col, speed: [1.0, 2.0], up: 0.7, gravity: 9, life: [0.45, 0.75], size: [0.08, 0.14], spin: 7, jitter: 0.3 }, -0.4);
        if (t === SAND || t === DIRT || t === GRASS) this.b(e, { sprite: ['dust1', 'dust2', 'dust3'], count: 3, color: col[0], speed: [0.3, 0.6], up: 0.2, gravity: -0.2, life: [0.5, 0.8], size: [0.3, 0.45], endSize: 1.6, alpha: 0.45 }, -0.2);
        this.sound(`B05${blockSoundSuffix(t)}`, e);
        return;
      }
      case 'B05h': // 鉱石が出た
        this.b(e, { sprite: ['sparkle', 'sparkleSmall'], count: 8, color: [0xbfe8ff, 0xffffff], speed: [0.6, 1.2], up: 0.8, gravity: 0.5, life: [0.6, 1.0], size: [0.1, 0.16] }, 0);
        break;
      case 'B06': // ならす
        this.b(e, { sprite: ['dust1', 'dust2', 'dust3'], count: 4, color: e.color ?? 0xb89a74, speed: [0.3, 0.8], up: 0.3, gravity: -0.2, life: [0.5, 0.8], size: [0.3, 0.45], endSize: 1.7, alpha: 0.45, jitter: 0.35 }, 0);
        break;
      case 'B07': { // ブロックを置く
        const t = e.block ?? DIRT;
        this.b(e, { sprite: ['dust1', 'dust2'], count: 4, color: blockHex(t, 2), speed: [0.5, 1.0], up: 0.05, gravity: 0, drag: 3, life: [0.4, 0.6], size: [0.22, 0.32], endSize: 1.6, alpha: 0.45, jitter: 0.1 }, -0.45);
        this.sound(`B07${blockSoundSuffix(t)}`, e);
        return;
      }
      case 'B08a': case 'B08b': case 'B08c': case 'B08d': case 'B08e': // 道を敷く
        this.b(e, { sprite: ['dust1', 'dust2'], count: 4, color: e.color ?? 0xc4a574, speed: [0.5, 0.9], up: 0.05, gravity: 0, drag: 3, life: [0.35, 0.55], size: [0.18, 0.26], endSize: 1.5, alpha: 0.45 }, 0.05);
        break;
      case 'B09': // 道が消える
        this.b(e, { sprite: ['chip1', 'chip2'], count: 6, color: e.color ?? 0xc4a574, speed: [0.8, 1.4], up: 0.6, gravity: 8, life: [0.4, 0.6], size: [0.06, 0.1], spin: 6 }, 0.1);
        break;
      case 'B10': // 建設が始まる
        this.b(e, { sprite: ['dust1', 'dust2', 'dust3'], count: 10, color: 0xcbb89a, speed: [1.0, 1.8], up: 0.05, gravity: 0, drag: 2.5, life: [0.6, 0.9], size: [0.35, 0.5], endSize: 1.8, alpha: 0.5, jitter: 0.3 }, 0.1);
        this.b(e, { sprite: 'hammer', count: 1, rise: 0.6, gravity: 0, drag: 0, life: [0.7, 0.7], size: [0.4, 0.4], spin: 3 }, 1.2);
        break;
      case 'B11': // 部品が組み上がる
        this.b(e, { sprite: ['splinter1', 'splinter2'], count: 2, color: [0xc8a070, 0xa07a4e], speed: [0.5, 0.9], up: 0.6, gravity: 7, life: [0.4, 0.6], size: [0.06, 0.09], spin: 6 }, 0);
        break;
      case 'B12': // 建物が完成
        this.b(e, { sprite: ['confetti1', 'confetti2', 'confetti3'], count: 40, color: [0xff8a8a, 0xffd84a, 0x8fd18a, 0x8ac4ff, 0xd8a6ff], speed: [1.5, 3.2], up: 0.85, gravity: 3.0, drag: 1.2, sway: 1.5, life: [1.3, 2.0], size: [0.1, 0.16], spin: 10, jitter: 0.6 }, 0);
        this.b(e, { sprite: 'sparkle', count: 6, color: 0xfff2b0, speed: [0.3, 0.8], up: 0.9, gravity: -0.3, life: [0.8, 1.2], size: [0.2, 0.3], endSize: 0.3, delay: 0.2, jitter: 0.6 }, 0.4);
        break;
      case 'B13': // 片付ける
        this.b(e, { sprite: ['dust1', 'dust2', 'dust3'], count: 16, color: 0xd6c8b0, speed: [0.6, 1.4], up: 0.3, gravity: -0.3, drag: 2, life: [0.7, 1.1], size: [0.45, 0.7], endSize: 1.8, alpha: 0.6, jitter: 1.0 }, 0.6);
        break;
      case 'B14': { // 区画を開く（e.n：区画の大きさ）
        const r = (e.n ?? 64) / 2;
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2;
          this.fx.burst({ sprite: ['dust1', 'dust2', 'dust3'], count: 1, at: { x: e.x + Math.cos(a) * r, y: e.y, z: e.z + Math.sin(a) * r }, color: 0xcbb89a, speed: [0.3, 0.8], up: 0.4, gravity: -0.3, life: [0.9, 1.4], size: [2, 3.5], endSize: 1.6, alpha: 0.4, jitter: 2 });
          this.fx.burst({ sprite: ['glow', 'sparkleSmall'], count: 2, at: { x: e.x + Math.cos(a) * r, y: e.y + 1, z: e.z + Math.sin(a) * r }, color: [0xfff2b0, 0xffffff], speed: [0.2, 0.5], up: 0.95, gravity: -1.2, drag: 0.5, life: [1.2, 1.8], size: [0.25, 0.45], delay: 0.6, jitter: 3 });
        }
        break;
      }
      // ---- 植物 ----
      case 'C01': // 育った
        this.b(e, { sprite: 'glow', count: 3, color: 0xb8f08a, speed: [0.2, 0.4], up: 0.95, gravity: -0.6, life: [0.6, 0.9], size: [0.08, 0.12], jitter: 0.2 }, 0.3);
        break;
      case 'C02': // 収穫できるようになった
        this.b(e, { sprite: 'sparkle', count: 2, color: 0xffe08a, speed: [0.1, 0.3], up: 0.95, gravity: -0.3, life: [0.6, 0.9], size: [0.18, 0.24], endSize: 0.3 }, 0.6);
        break;
      case 'C02t': // 収穫できる間のまたたき（音なし）
        this.b(e, { sprite: 'sparkleSmall', count: 1, color: 0xffe08a, speed: [0, 0.1], up: 1, gravity: -0.2, life: [0.6, 0.8], size: [0.12, 0.16], endSize: 0.2, jitter: 0.25 }, 0.6);
        return;
      case 'C03': // 畑が乾いた
        this.b(e, { sprite: 'steam', count: 1, color: 0xffffff, speed: [0.05, 0.1], up: 1, gravity: -0.3, life: [0.9, 1.2], size: [0.4, 0.5], endSize: 1.6, alpha: 0.3 }, 0.1);
        return;
      case 'C04': case 'C05': // 木が育つ
        this.b(e, { sprite: ['leaf1', 'leaf2', 'leaf3'], count: 7, color: leaf, speed: [0.4, 1.0], up: 0.5, gravity: 1.0, drag: 1.5, sway: 1.0, life: [0.9, 1.4], size: [0.12, 0.18], spin: 4, jitter: 0.8 }, 1.8);
        break;
      case 'C06': case 'C07': case 'C09': // 草・苗木・葦が生える（音なし）
        this.b(e, { sprite: 'glow', count: 2, color: 0xb8f08a, speed: [0.1, 0.3], up: 0.95, gravity: -0.5, life: [0.5, 0.8], size: [0.07, 0.1], jitter: 0.25 }, 0.2);
        return;
      case 'C08': // 花が枯れる（音なし）
        this.b(e, { sprite: 'petal1', count: 3, color: [0xa08050, 0xc0a070], speed: [0.2, 0.4], up: 0.3, gravity: 0.8, sway: 0.8, life: [0.9, 1.3], size: [0.08, 0.12], spin: 3 }, 0.4);
        return;
      // ---- 生き物 ----
      case 'D01': // 気配
        this.b(e, { sprite: 'question', count: 1, rise: 0.5, gravity: 0, drag: 0, life: [1.2, 1.2], size: [0.4, 0.4] }, 1.0);
        this.b(e, { sprite: 'glow', count: 4, color: 0xfff2b0, speed: [0.2, 0.5], up: 0.9, gravity: -0.5, life: [0.8, 1.2], size: [0.1, 0.16], jitter: 0.4 }, 0.4);
        break;
      case 'D02': // 訪問者が来た（知っている種類。音なし）
        this.b(e, { sprite: 'glow', count: 3, color: 0xfff2b0, speed: [0.2, 0.5], up: 0.9, gravity: -0.5, life: [0.7, 1.0], size: [0.1, 0.14], jitter: 0.3 }, 0.4);
        return;
      case 'D03': // 訪問者が帰る（音なし）
        this.b(e, { sprite: 'feather', count: 2, color: 0xffffff, speed: [0.2, 0.5], up: 0.3, gravity: 0.6, sway: 1.2, life: [1.0, 1.5], size: [0.1, 0.14], spin: 3 }, 0.6);
        return;
      case 'D04': // 引っ越してきた
        this.b(e, { sprite: 'house', count: 1, rise: 0.4, gravity: 0, drag: 0, life: [1.4, 1.4], size: [0.45, 0.45] }, 1.1);
        this.b(e, { sprite: 'exclaim', count: 1, rise: 0.6, gravity: 0, drag: 0, life: [0.9, 0.9], size: [0.3, 0.3], delay: 0.2 }, 1.5);
        this.b(e, { sprite: 'sparkle', count: 4, color: 0xfff2b0, speed: [0.6, 1.0], up: 0.4, gravity: 0, drag: 2, life: [0.6, 0.9], size: [0.12, 0.18] }, 0.6);
        break;
      case 'D05': // 好きな家に満足
        this.b(e, { sprite: ['heart', 'heart2'], count: 3, speed: [0.4, 0.8], up: 0.9, gravity: -0.4, drag: 1.5, life: [1.0, 1.4], size: [0.2, 0.26] }, 1.0);
        break;
      case 'D06': // 眠っている（音なし）
        this.b(e, { sprite: 'z', count: 1, rise: 0.35, gravity: 0, drag: 0, sway: 0.4, life: [1.8, 1.8], size: [0.18, 0.18], endSize: 1.5, jitter: 0.05 }, 0.9);
        return;
      case 'D07': // 目を覚ます（音なし）
        this.b(e, { sprite: 'exclaim', count: 1, rise: 0.6, gravity: 0, drag: 0, life: [0.7, 0.7], size: [0.22, 0.22] }, 1.0);
        return;
      case 'D08': // 家で暖まっている
        this.b(e, { sprite: 'steam', count: 1, color: 0xffffff, speed: [0.05, 0.1], up: 1, gravity: -0.4, life: [1.0, 1.3], size: [0.16, 0.22], endSize: 2, alpha: 0.5 }, 0.8);
        this.b(e, { sprite: 'glow', count: 1, color: 0xffb060, speed: [0, 0], gravity: 0, life: [1.2, 1.2], size: [0.9, 0.9], alpha: 0.25 }, 0.4);
        return;
      case 'D09': // うれしい（音なし）
        this.b(e, { sprite: ['heart', 'note'], count: 1, rise: 0.5, gravity: 0, drag: 0, sway: 0.4, life: [1.2, 1.2], size: [0.16, 0.18] }, 1.0);
        return;
      case 'D10': // 足元のほこり（音は D10a〜d）
        this.b(e, { sprite: 'dust1', count: 1, color: e.color ?? 0xcbb89a, speed: [0.1, 0.2], up: 0.2, gravity: -0.1, life: [0.4, 0.6], size: [0.12, 0.16], endSize: 1.6, alpha: 0.35 }, 0.02);
        return;
      case 'D11': case 'D12': // 拾ってきた・贈り物（アイコンは画面の上で）
        this.b(e, { sprite: e.id === 'D12' ? 'gift' : 'sparkleSmall', count: 1, rise: 0.5, gravity: 0, drag: 0, life: [0.9, 0.9], size: [0.3, 0.3], color: e.id === 'D12' ? 0xffffff : 0xfff2b0 }, 1.0);
        break;
      case 'D13': // 魚がはねる
        this.b(e, { sprite: 'drop', count: 6, speed: [0.6, 1.2], up: 0.85, gravity: 7, life: [0.4, 0.6], size: [0.06, 0.09] }, 0.05);
        break;
      // ---- 天気・季節 ----
      case 'E06': // 流れ星（e が空の位置）
        this.b(e, { sprite: 'sparkleSmall', count: 8, color: [0xffffff, 0xfff2b0], speed: [0.1, 0.4], up: 0, gravity: 0.5, life: [0.6, 1.0], size: [0.6, 1.0], jitter: 4, delay: 0.5 }, 0);
        break;
    }
    this.sound(e.id, e);
  }

  private sound(id: string, e: FxEvent) { sfx.play(id, { x: e.x, y: e.y, z: e.z }); }

  update(dt: number) { this.fx.update(dt); }
}
