/**
 * 環境音（v0.21.1 で、合成した音から lumina-sfx の録音のループに置き換え。public/sfx/amb-*.ogg）。
 * 風・水のせせらぎ・雨・葉ずれ・昼の鳥・朝の鳥・夜の虫・夜のカエルを、時刻・天気・季節に合わせて混ぜる。
 * 音の出口は効果音と同じ（audio/bank.ts の audioOut）。「環境音」のボタンで鳴らす・止める
 */
import { audioOut, loadSounds, normGain, soundBuffer } from './audio/bank';

export interface AmbienceState {
  day: number; // 0..1
  rain: number; // 0..1
  wind: number; // 0..2 程度
  season: number; // 0 春, 1 夏, 2 秋, 3 冬
  volume: number; // 0..1
  /** 時刻（0〜24）。朝の鳥に使う */
  hour?: number;
  /** 雪（0〜1） */
  snow?: number;
}

const LOOPS = ['amb-wind', 'amb-stream', 'amb-rain', 'amb-leaves', 'amb-birds', 'amb-dawn', 'amb-night', 'amb-frogs'] as const;
type LoopName = (typeof LOOPS)[number];

export class Ambience {
  private on = false;
  private master: GainNode | null = null;
  private gains = new Map<LoopName, GainNode>();
  private windFilter: BiquadFilterNode | null = null;

  get running() { return this.on; }

  async start() {
    const { ctx, amb } = audioOut();
    await ctx.resume();
    if (!this.master) {
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(amb);
      await loadSounds(import.meta.env.BASE_URL, LOOPS);
      for (const n of LOOPS) {
        const buf = soundBuffer(n);
        const g = ctx.createGain();
        g.gain.value = 0;
        if (n === 'amb-wind') {
          // 冬・雪の日は風をこもらせる
          this.windFilter = ctx.createBiquadFilter();
          this.windFilter.type = 'lowpass';
          this.windFilter.frequency.value = 12000;
          g.connect(this.windFilter).connect(this.master);
        } else g.connect(this.master);
        this.gains.set(n, g);
        if (!buf) continue;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const pre = ctx.createGain();
        pre.gain.value = normGain(n);
        src.connect(pre).connect(g);
        // ループごとに始まりをずらす（同じ所が重ならないように）
        src.start(ctx.currentTime + 0.05, Math.random() * buf.duration);
      }
    }
    this.on = true;
  }

  async stop() {
    this.on = false;
    const m = this.master;
    if (m) m.gain.setTargetAtTime(0, m.context.currentTime, 0.2);
  }

  update(_dt: number, s: AmbienceState) {
    const m = this.master;
    if (!m) return;
    const t = m.context.currentTime;
    const k = 1.2; // なめらかに変える時間（秒）
    m.gain.setTargetAtTime(this.on ? s.volume : 0, t, 0.3);
    if (!this.on) return;
    const night = 1 - s.day;
    const snow = s.snow ?? 0;
    const hour = s.hour ?? 12;
    const dry = 1 - Math.min(1, s.rain + snow);
    const set = (n: LoopName, v: number) => this.gains.get(n)?.gain.setTargetAtTime(Math.max(0, v), t, k);
    const gust = 0.75 + 0.25 * Math.sin(t * 0.3) * Math.sin(t * 0.11);
    set('amb-wind', 0.22 * Math.min(2, s.wind) * gust + 0.12 * snow);
    this.windFilter?.frequency.setTargetAtTime(s.season === 3 || snow > 0.2 ? 1400 : 9000, t, k);
    set('amb-stream', 0.22 * (1 - snow * 0.6));
    set('amb-rain', 0.5 * s.rain);
    set('amb-leaves', s.season === 3 ? 0 : 0.12 * Math.min(1.5, s.wind) * (1 - s.rain * 0.5));
    // 朝の鳥（5〜8 時）・昼の鳥（冬・雨の日はなし）
    const dawn = hour >= 4.8 && hour < 8.5 ? Math.min(1, (hour - 4.8) / 0.7, (8.5 - hour) / 1.2) : 0;
    const birdOk = s.season === 3 ? 0.2 : 1;
    set('amb-dawn', 0.4 * dawn * dry * birdOk);
    set('amb-birds', 0.35 * Math.max(0, s.day - 0.4) / 0.6 * (1 - dawn) * dry * birdOk);
    // 夜の虫（夏・秋）・カエル（春・夏）
    const nightK = Math.max(0, (night - 0.5) / 0.5);
    set('amb-night', 0.35 * nightK * dry * (s.season === 1 || s.season === 2 ? 1 : 0.15));
    set('amb-frogs', 0.18 * nightK * dry * (s.season === 0 || s.season === 1 ? 1 : 0));
  }
}
