/**
 * 効果音のつなぎこみ（v0.21.1）：public/sfx の録音（lumina-sfx のカタログから書き出した物）と、
 * tones.ts の楽器の音を、docs/エフェクト一覧.md の ID ごとに sfx（sfx.ts）へ登録する。
 *
 * - 音の出口（AudioContext）は 1 つを環境音と分け合う（audioOut()）。ブラウザの決まりで、最初にクリックなどがあるまで鳴らない
 * - ファイルは最初の操作の時にまとめて読み込む。読み込む前に鳴らそうとした音は、鳴らさない（遅れて鳴ると変なので）
 * - 鳴らすたびに、音の高さを ±1 半音ほど・明るさを少し変える（同じ音の繰り返しに聞こえないように）
 */
import { sfx, type SfxVoice } from './sfx';
import { MELODY, playTones, type Tone } from './tones';

let ctx: AudioContext | null = null;
let sfxBus: GainNode | null = null;
let ambBus: GainNode | null = null;
/** 音の出口（効果音・環境音で分け合う）。まだなら作る */
export function audioOut() {
  if (!ctx) {
    ctx = new AudioContext();
    // 全体が大きくなりすぎた時に割れないよう、最後にやわらかく抑える
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    comp.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.connect(comp);
    ambBus = ctx.createGain(); ambBus.connect(comp);
  }
  return { ctx, sfx: sfxBus!, amb: ambBus! };
}

/** 録音のピーク（dB。書き出した時に測った物）。ピークが -10 dB になるよう大きさをそろえる */
const PEAK: Record<string, number> = {
  'a01': -6.7, 'a02': -2.9, 'a03': -20.7, 'a04': -6.7, 'a05': -2.1, 'a06': -6.7, 'a07': -8.8, 'a09': -13.3, 'amb-birds': -22.7, 'amb-dawn': -17.1, 'amb-frogs': -13.0, 'amb-leaves': -15.3, 'amb-night': -20.2, 'amb-rain': -6.2, 'amb-stream': -17.0, 'amb-wind': -15.3, 'b01': -7.4, 'b02': -8.5, 'b03': -12.1, 'b04': -12.8, 'b05a': -7.1, 'b05b': -6.6, 'b05c': -6.7, 'b05d': -11.7, 'b05e': -7.1, 'b05f': -5.7, 'b05h': -12.9, 'b06': -15.1, 'b07a': -12.9, 'b07b': -12.1, 'b07c': -22.1, 'b07d': -12.1, 'b07e': -10.3, 'b08a': -6.5, 'b08b': -6.7, 'b08c': -11.0, 'b08d': -8.6, 'b08e': -9.7, 'b10': -11.3, 'b11': -10.6, 'b13': -9.8, 'b14': -12.0, 'b15': -14.7, 'b16': -18.8, 'b17': -14.3, 'b18': -11.2, 'c04': -17.6, 'd01': -9.4, 'd04': -10.5, 'd08': -7.8, 'd10': -19.0, 'd11': -22.6, 'd12': -11.6, 'd13': -11.8, 'e06': -13.4, 'f01': -11.1, 'f03': -17.4, 'f04': -16.3, 'f05': -7.1, 'f06': -8.1, 'f07': -11.5, 'f08': -9.8, 'f09': -17.1, 'f11': -15.5, 'f13': -7.6,
};
/** ピークをそろえる倍率（大きくするのは 4 倍まで） */
export const normGain = (f: string) => Math.min(4, 10 ** ((-10 - (PEAK[f] ?? -10)) / 20));

/** 
 * 1 つの ID の音：f 録音（public/sfx/<f>.ogg）、max 長さの上限（秒。そこで消えていく）、g 大きさ、
 * rate 速さ（音の高さも変わる）、lp こもらせる（Hz）、tones 楽器の音（録音と重ねる）、vary 鳴らすたびに変える
 */
export interface Cue { f?: string; max?: number; g?: number; rate?: number; lp?: number; tones?: Tone[]; vary?: boolean }
const k1 = (n: string, t: number, v = 0.6): Tone[] => [{ i: 'kalimba', n, t, v }];
export const CUES: Record<string, Cue> = {
  // 見るモードの操作（A）
  A01: { f: 'a01', max: 0.3, rate: 4 },
  A02: { f: 'a02',g: 3},
  A03: { f: 'a03', max: 0.8, g: 0.6,rate:0.7 },
  A04: { f: 'a04', max: 0.3, rate: 1,g:1.5,},
  A05: { f: 'a05', max: 1.0, g:3,rate:0.8 },
  A06: { f: 'a06', max:0.4,g: 2, rate:1.5 },
  A07: { f: 'a06', max:0.4,g: 2, rate:1.0 },
  A08: { f: 'a08', max: 0.4, g: 1.5, rate: 0.9},
  A09: { f: 'a09', max: 0.1, g: 0.0},
  A10: { tones: MELODY.A10 },
  // エディタの道具（B）
  B01: { f: 'b01', max: 0.4, g: 1.4, rate: 0.8, lp:10000},
  B02: { f: 'b01', max: 0.2, g: 1.4, rate: 1.4    , lp:10000},
  B03: { f: 'b03', max: 0.3, rate: 1 ,g :1.4 },
  B04: { f: 'b01', max: 0.2, g: 1.0, rate: 1.2    , lp:10000},
  B05a: { f: 'b05c', max: 0.3, g: 6, rate:0.8 ,vary:true },
  B05b: { f: 'b05b', max: 0.3,rate:0.9,vary:true },
  B05c: { f: 'b05c', max: 0.3, g: 5 ,vary:true},
  B05d: { f: 'b05d', max: 0.3, g: 1.2, rate: 0.8, vary:true, lp: 6000 },
  B05e: { f: 'b05e', max: 0.3 },
  B05f: { f: 'b05f', max: 0.3, g: 1.2, rate: 0.8, vary:true, },
  B05h: { f: 'b05h', max:0.3, g:0.8},
  B06: { f: 'b06', max: 0.55 },
  // ここまで終わった。2026-11-28
  B07a: { f: 'b07a', max: 0.35 },
  B07b: { f: 'b07b', max: 0.35 },
  B07c: { f: 'b07c', max: 0.35 },
  B07d: { f: 'b07d', max: 0.4 },
  B07e: { f: 'b07e', max: 0.35 },
  // ここから始める。2026-11-28
  B08a: { f: 'b08d', max: 0.4 },
  B08b: { f: 'b08d', max: 0.4 },
  B08c: { f: 'b08d', max: 0.4 },
  B08d: { f: 'b08d', max: 0.4 },
  B08e: { f: 'b08d', max: 0.4 },
  /** 道が消える：道の音をこもらせて短く */
  B09: { f: 'b08a', max: 0.25, lp: 1200, g: 0.7 },
  B10: { f: 'b10', max: 1.0,rate:0.8, g: 0.7 },
  B11: { f: 'b11', max: 0.28, g: 0.0},
  B12: { tones: MELODY.B12 },
  B13: { f: 'b13', max: 0.3 },
  B14: { f: 'b14', g: 10,max:1.0},
  B15: { f: 'b15', g: 0.8 },
  B16: { f: 'b16', g: 0.8 },
  B17: { f: 'b17', max: 0.35, g: 0.7 },
  B18: { f: 'b18', g: 0.7 },
  // 植物と地面（C）
  C01: { tones: [{ i: 'pip', t: 0 }], vary: true, g: 2 },
  C02: { tones: MELODY.C02 },
  C04: { f: 'c04', max: 0.9 },
  C05: { f: 'c04', max: 0.7, g: 0.6 },
  // 生き物（D）
  D01: { f: 'd01', max: 0.5, g: 0.8, tones: MELODY.D01 },
  D04: { f: 'd04', tones: MELODY.D04 },
  D05: { tones: MELODY.D05 },
  D08: { f: 'd08', max: 2.2, g: 0.5 },
  D10: { f: 'd10', max: 0.15, g: 0.5 },
  D11: { f: 'd11' },
  D12: { f: 'd12', tones: [{ i: 'bell', n: 'A6', t: 0.3, v: 0.3 }] },
  D13: { f: 'd13', max: 0.6, g: 2 },
  // 天気・時刻・季節（E）
  E03: { tones: MELODY.E03 },
  E05: { tones: MELODY.E05 },
  E06: { f: 'e06', g: 0.5, tones: [{ i: 'swish', t: 0 }, { i: 'musicbox', n: 'E7', t: 0.05, v: 0.2 }, { i: 'musicbox', n: 'B6', t: 0.17, v: 0.16 }, { i: 'musicbox', n: 'G6', t: 0.29, v: 0.12 }] },
  E07a: { tones: MELODY.E07a }, E07b: { tones: MELODY.E07b }, E07c: { tones: MELODY.E07c }, E07d: { tones: MELODY.E07d },
  // 進み具合・画面（F）
  F01: { f: 'f01', g: 0.4 },
  F02: { tones: MELODY.F02 },
  F03: { f: 'f03', tones: [{ i: 'musicbox', n: 'G6', t: 0.4, v: 0.4 }, { i: 'musicbox', n: 'C7', t: 0.5, v: 0.35 }, { i: 'musicbox', n: 'E7', t: 0.6, v: 0.3 }] },
  F04: { f: 'f04', max: 0.15, g: 0.6 },
  F05: { f: 'f05', g: 0.8 },
  F06: { f: 'f06', g: 0.8 },
  F07: { f: 'f07', g: 0.6 },
  F08: { f: 'f08', g: 0.8 },
  F09: { f: 'f09', g: 0.7, tones: k1('A5', 0.02, 0.3) },
  F11: { f: 'f11', g: 0.8 },
  F12: { tones: MELODY.F12 },
  F13: { f: 'f13', g: 0.8 },
};
/** 一覧で「なし」の ID（たくさん同時に起きる・生き物の声）：C02t C03 C06〜C09 D02 D03 D06 D07 D09 E04（環境音の切り替え） */

const buffers = new Map<string, AudioBuffer>();
let loading: Promise<void> | null = null;
/** 録音をまとめて読み込む（最初の操作の時） */
export function loadSounds(base: string, names: Iterable<string>) {
  const { ctx } = audioOut();
  const jobs = [...new Set(names)].filter((n) => !buffers.has(n)).map(async (n) => {
    try {
      const r = await fetch(`${base}sfx/${n}.ogg`);
      if (!r.ok) return;
      buffers.set(n, await ctx.decodeAudioData(await r.arrayBuffer()));
    } catch { /* 読めない音は鳴らさない */ }
  });
  return Promise.all(jobs).then(() => undefined);
}
export const soundBuffer = (n: string) => buffers.get(n);

/** 1 つの ID を鳴らす関数を作る */
export function voiceFor(c: Cue): SfxVoice {
  return ({ pan, gain }) => {
    if (!ctx || ctx.state !== 'running') return;
    const out = audioOut();
    const t = ctx.currentTime + 0.005;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(out.sfx);
    const vary = c.vary ?? !!c.f;
    if (c.f) {
      const buf = buffers.get(c.f);
      if (buf) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = (c.rate ?? 1) * (vary ? 2 ** ((Math.random() * 2 - 1) / 12) : 1);
        const flt = ctx.createBiquadFilter();
        flt.type = 'lowpass';
        flt.frequency.value = c.lp ?? (vary ? 7000 + Math.random() * 5000 : 16000);
        const g = ctx.createGain();
        const v = gain * (c.g ?? 1) * normGain(c.f);
        g.gain.setValueAtTime(v, t);
        src.connect(flt).connect(g).connect(p);
        src.start(t);
        if (c.max) {
          const end = Math.min(c.max, buf.duration / src.playbackRate.value);
          g.gain.setValueAtTime(v, t + end * 0.7);
          g.gain.linearRampToValueAtTime(0, t + end);
          src.stop(t + end + 0.02);
        }
      }
    }
    if (c.tones) {
      const tones = vary ? c.tones.map((x) => ({ ...x, v: (x.v ?? 1) * (0.85 + Math.random() * 0.3) })) : c.tones;
      playTones(ctx, p, tones, gain * (c.g ?? 1) * (c.f ? 1 : 0.55), t);
    }
  };
}

/** すべての ID を sfx に登録する。最初の操作で音の出口を開き、録音を読み込む */
export function installSounds(base = import.meta.env.BASE_URL) {
  for (const [id, c] of Object.entries(CUES)) sfx.register(id, voiceFor(c));
  const files = Object.values(CUES).flatMap((c) => (c.f ? [c.f] : []));
  const unlock = () => {
    const { ctx: c } = audioOut();
    void c.resume();
    if (!loading) loading = loadSounds(base, files);
  };
  for (const ev of ['pointerdown', 'keydown'] as const) addEventListener(ev, unlock, { capture: true });
}
