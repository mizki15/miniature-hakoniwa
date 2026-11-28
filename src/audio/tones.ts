/**
 * 楽器の音（v0.21.1）：UI と達成の短いメロディは、カリンバ・木琴（マリンバ）・オルゴール・鈴でそろえる（docs/エフェクト一覧.md 10 章）。
 * 録音のカタログに無い音なので、Web Audio で合成する（素材ファイル不要）。
 * 他に、芽が出る「ぷち」、水に落ちる「ぽちゃ」、地鳴り、拍子木のような「ぱん」もここで作る
 */
export type Inst = 'kalimba' | 'marimba' | 'musicbox' | 'bell' | 'clap' | 'pip' | 'plop' | 'rumble' | 'swish';
/** 1 つの音：i 楽器、n 音の高さ（'E5' など）、t 始まり（秒）、v 大きさ（0〜1） */
export interface Tone { i: Inst; n?: string; t: number; v?: number }

const NOTE: Record<string, number> = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
/** 'E5'・'F#4' などを周波数に */
export function noteHz(n: string): number {
  const m = /^([A-G])(#|b)?(\d)$/.exec(n);
  if (!m) return 440;
  const semi = NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * 2 ** (semi / 12);
}

/** 楽器ごとの倍音（倍率・大きさ・減る速さ（秒））と、全体の減る速さ */
const PARTIALS: Record<'kalimba' | 'marimba' | 'musicbox' | 'bell', { p: [number, number, number][]; tau: number; len: number }> = {
  kalimba: { p: [[1, 1, 0.42], [2, 0.12, 0.12], [5.9, 0.1, 0.04]], tau: 0.42, len: 1.4 },
  marimba: { p: [[1, 1, 0.3], [4, 0.22, 0.06], [9.9, 0.05, 0.02]], tau: 0.3, len: 1.0 },
  musicbox: { p: [[1, 1, 0.7], [3, 0.22, 0.25], [5.2, 0.12, 0.1]], tau: 0.7, len: 2.0 },
  bell: { p: [[1, 1, 1.0], [2.76, 0.45, 0.5], [5.4, 0.2, 0.25], [8.93, 0.08, 0.12]], tau: 1.0, len: 2.4 },
};

let noise: AudioBuffer | null = null;
function noiseBuf(ctx: BaseAudioContext) {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise;
  noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noise.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.04 * w) / 1.04; d[i] = i % 2 ? w : last * 3; }
  return noise;
}

/** 音を鳴らす（out へ。at は ctx.currentTime 基準の始まり） */
export function playTones(ctx: BaseAudioContext, out: AudioNode, tones: readonly Tone[], gain: number, at = ctx.currentTime) {
  for (const tn of tones) {
    const t0 = at + tn.t;
    const v = (tn.v ?? 1) * gain;
    if (tn.i in PARTIALS) {
      const def = PARTIALS[tn.i as keyof typeof PARTIALS];
      const f = noteHz(tn.n ?? 'A5');
      const g = ctx.createGain();
      g.gain.value = v * 0.35;
      g.connect(out);
      for (const [mul, amp, tau] of def.p) {
        if (f * mul > 12000) continue;
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * mul;
        const e = ctx.createGain();
        e.gain.setValueAtTime(0, t0);
        e.gain.linearRampToValueAtTime(amp, t0 + 0.004);
        e.gain.setTargetAtTime(0, t0 + 0.004, tau);
        o.connect(e).connect(g);
        o.start(t0);
        o.stop(t0 + def.len);
      }
      continue;
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf(ctx);
    src.loop = true;
    const e = ctx.createGain();
    e.gain.value = 0;
    const flt = ctx.createBiquadFilter();
    switch (tn.i) {
      case 'clap': { // 拍子木のような軽い「ぱん」（2 回の短い音）
        flt.type = 'bandpass'; flt.frequency.value = 1700; flt.Q.value = 1.4;
        e.gain.setValueAtTime(0, t0);
        for (const dt of [0, 0.012]) { e.gain.setValueAtTime(v * 0.9, t0 + dt); e.gain.setTargetAtTime(0, t0 + dt + 0.002, 0.018); }
        src.connect(flt).connect(e).connect(out);
        src.start(t0, Math.random()); src.stop(t0 + 0.2);
        break;
      }
      case 'rumble': { // 地鳴り：低い音が 0.6 秒ふくらんで、静まる
        flt.type = 'lowpass'; flt.frequency.value = 140; flt.Q.value = 0.7;
        e.gain.setValueAtTime(0, t0);
        e.gain.linearRampToValueAtTime(v * 1.6, t0 + 0.6);
        e.gain.setTargetAtTime(0, t0 + 0.65, 0.18);
        src.connect(flt).connect(e).connect(out);
        src.start(t0, Math.random()); src.stop(t0 + 1.6);
        break;
      }
      case 'swish': { // 流れ星：高い所から下りる、かすかな風の音
        flt.type = 'bandpass'; flt.Q.value = 2.5;
        flt.frequency.setValueAtTime(5200, t0);
        flt.frequency.exponentialRampToValueAtTime(900, t0 + 0.6);
        e.gain.setValueAtTime(0, t0);
        e.gain.linearRampToValueAtTime(v * 0.25, t0 + 0.12);
        e.gain.linearRampToValueAtTime(0, t0 + 0.7);
        src.connect(flt).connect(e).connect(out);
        src.start(t0, Math.random()); src.stop(t0 + 0.75);
        break;
      }
      case 'pip': case 'plop': { // 芽の「ぷち」・水に落ちる「ぽちゃ」（音の高さが上がる短い丸い音）
        const o = ctx.createOscillator();
        o.type = 'sine';
        const [f0, f1, d] = tn.i === 'pip' ? [700, 1400, 0.05] : [320, 1100, 0.09];
        o.frequency.setValueAtTime(f0, t0);
        o.frequency.exponentialRampToValueAtTime(f1, t0 + d);
        e.gain.setValueAtTime(0, t0);
        e.gain.linearRampToValueAtTime(v * (tn.i === 'pip' ? 0.16 : 0.17), t0 + 0.004);
        e.gain.setTargetAtTime(0, t0 + 0.01, d * 0.7);
        o.connect(e).connect(out);
        o.start(t0); o.stop(t0 + d * 5);
        if (tn.i === 'plop') { // 水しぶきの小さなさざめき
          flt.type = 'highpass'; flt.frequency.value = 2500;
          const e2 = ctx.createGain();
          e2.gain.value = 0;
          e2.gain.setValueAtTime(0, t0 + 0.02);
          e2.gain.linearRampToValueAtTime(v * 0.08, t0 + 0.03);
          e2.gain.setTargetAtTime(0, t0 + 0.04, 0.05);
          src.connect(flt).connect(e2).connect(out);
          src.start(t0, Math.random()); src.stop(t0 + 0.4);
        }
        break;
      }
    }
  }
}

/** 楽器の音の並び（docs 8 章の説明どおり） */
const k = (n: string, t: number, v = 1): Tone => ({ i: 'kalimba', n, t, v });
const m = (n: string, t: number, v = 1): Tone => ({ i: 'marimba', n, t, v });
const b = (n: string, t: number, v = 1): Tone => ({ i: 'musicbox', n, t, v });
const bell = (n: string, t: number, v = 1): Tone => ({ i: 'bell', n, t, v });
export const MELODY: Record<string, Tone[]> = {
  /** 発見：C5–E5–G5 と、最後にオルゴールのきらめき */
  A10: [k('C5', 0), k('E5', 0.14), k('G5', 0.28), b('G6', 0.3, 0.45), b('C7', 0.4, 0.3)],
  /** 建物の完成：G4–C5–E5、最後に拍子木 */
  B12: [m('G4', 0), m('C5', 0.16), m('E5', 0.32), k('E5', 0.32, 0.5), b('E6', 0.36, 0.4), b('G6', 0.48, 0.3), { i: 'clap', t: 0.32, v: 0.5 }],
  /** 実ったよ：A5 */
  C02: [k('A5', 0, 0.8), b('A6', 0.03, 0.2)],
  /** 何かいる：低めのオルゴール D5 */
  D01: [b('D5', 0.25, 0.7)],
  /** 住人が引っ越してきた：C5–G5 */
  D04: [k('C5', 0.45), k('G5', 0.68)],
  /** 満ち足りた和音 */
  D05: [k('C5', 0), k('E5', 0.03), k('G5', 0.06), b('C7', 0.12, 0.3)],
  /** 冬の日：澄んだ鈴 2 つ */
  E03: [bell('E6', 0, 0.6), bell('B6', 0.32, 0.5)],
  /** 夕暮れ：遠くの小さな鐘 */
  E05: [bell('G4', 0, 0.4)],
  /** 季節の変わり目（春：カリンバで明るく上がる／夏：マリンバ／秋：オルゴールで少しさびしく／冬：鈴） */
  E07a: [k('C5', 0), k('E5', 0.2), k('G5', 0.4), k('C6', 0.6), b('E7', 0.62, 0.25)],
  E07b: [m('G4', 0), m('B4', 0.2), m('D5', 0.4), m('G5', 0.6), bell('D7', 0.62, 0.15)],
  E07c: [b('A5', 0), b('E5', 0.24), b('G5', 0.48), b('A4', 0.72)],
  E07d: [bell('E5', 0, 0.45), bell('B5', 0.24, 0.45), bell('G5', 0.48, 0.45), bell('E6', 0.72, 0.4)],
  /** 目標の達成：いちばん大きなほうび（カリンバとマリンバ、最後にきらめきと拍子木） */
  F02: [m('C5', 0), k('E5', 0.14), m('G5', 0.28), k('C6', 0.42), m('E5', 0.62, 0.7), k('G5', 0.62, 0.7), k('C6', 0.62, 0.8), b('C7', 0.66, 0.4), b('E7', 0.8, 0.3), { i: 'clap', t: 0.62, v: 0.5 }],
  /** 注意：下がる 2 音 */
  F12: [k('E5', 0), k('B4', 0.16)],
};
