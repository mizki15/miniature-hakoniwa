/**
 * 効果音の呼び出し口（v0.21.0）：docs/エフェクト一覧.md の ID（A01・B05a など）で鳴らす。
 * 音そのものは、コマンドラインの Claude Code で lumina-sfx を使って作り、src/audio に入れる（8 章のプロンプト）。
 * 届いた音は register で ID につなぐ。つないでいない ID は何もしない（見た目だけ）。
 *
 * 鳴らし方の決まり（docs 1.2）：箱庭の中の音は位置から（左右・遠いほど小さく。60 マスより遠いと鳴らさない）、
 * 同じ音は同時に 3 つまで・0.06 秒より詰めない、早送り中は時間で起きる変化の音を鳴らさない
 */
export interface SfxPos { x: number; y: number; z: number }
/** 1 つの音を鳴らす関数（lumina の SfxPlayer.play をくるんだもの）。pan：-1 左〜1 右、gain：0〜1 */
export type SfxVoice = (opts: { pan: number; gain: number }) => void;

/** 音の優先度・大きさの段（docs 1.2） */
export type SfxTier = 'bed' | 'passive' | 'action' | 'reward';
const TIER_GAIN: Record<SfxTier, number> = { bed: 0.06, passive: 0.1, action: 0.2, reward: 0.32 };
/** ID の頭の文字から段を決める（C・D は時間で起きる変化、F02・B12・B14・A10 はほうび） */
export function tierOf(id: string): SfxTier {
  if (['F02', 'F03', 'B12', 'B14', 'A10', 'E07a', 'E07b', 'E07c', 'E07d'].includes(id)) return 'reward';
  if (id.startsWith('E08') || id === 'E01' || id === 'E02') return 'bed';
  if (id.startsWith('C') || id.startsWith('D')) return 'passive';
  return 'action';
}

export class Sfx {
  private voices = new Map<string, SfxVoice>();
  private last = new Map<string, number>();
  private playing = new Map<string, number[]>();
  /** 聞き手（カメラの注視点。マスの座標）と、画面の右向き（左右に振るため） */
  listener: SfxPos = { x: 0, y: 0, z: 0 };
  right = { x: 1, z: 0 };
  /** 効果音の大きさ（設定。0〜1） */
  volume = 1;
  /** 早送り中（時間で起きる変化の音を鳴らさない） */
  fastForward = false;
  /** 鳴らした記録（デバッグ・テスト用。最後の 50 件） */
  readonly log: { id: string; t: number }[] = [];

  register(id: string, v: SfxVoice) { this.voices.set(id, v); }
  has(id: string) { return this.voices.has(id); }

  /** 鳴らす。at が無ければ画面の操作の音（左右に振らない） */
  play(id: string, at?: SfxPos, now = performance.now()) {
    const tier = tierOf(id);
    if (this.fastForward && tier === 'passive') return;
    let pan = 0, dist = 1;
    if (at) {
      const dx = at.x - this.listener.x, dz = at.z - this.listener.z;
      const d = Math.hypot(dx, dz);
      if (d > 60) return;
      if (tier === 'passive' && d > 30) return;
      dist = 1 / (1 + (d / 14) ** 2);
      pan = Math.max(-1, Math.min(1, (dx * this.right.x + dz * this.right.z) / 20));
    }
    // 同じ音は 0.06 秒より詰めない・同時に 3 つまで
    if (now - (this.last.get(id) ?? -1e9) < 60) return;
    const live = (this.playing.get(id) ?? []).filter((t) => now - t < 400);
    if (live.length >= 3) return;
    live.push(now);
    this.playing.set(id, live);
    this.last.set(id, now);
    this.log.push({ id, t: now });
    if (this.log.length > 50) this.log.shift();
    this.voices.get(id)?.({ pan, gain: TIER_GAIN[tier] * dist * this.volume });
  }
}

export const sfx = new Sfx();
