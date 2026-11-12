/**
 * 環境音：音声ファイルを使わず Web Audio で合成する（サーバー・素材不要）。
 * 風・水のせせらぎ・雨・昼の鳥のさえずり・夜の虫の声を、時刻と天気に合わせて混ぜる。
 * ブラウザの自動再生の制限があるので、ユーザーの操作（ボタン）で開始する。
 */
export interface AmbienceState {
  day: number; // 0..1
  rain: number; // 0..1
  wind: number; // 0..2 程度
  season: number; // 0 春, 1 夏, 2 秋, 3 冬
  volume: number; // 0..1
}

export class Ambience {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private wind!: GainNode;
  private water!: GainNode;
  private rain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private nextChirp = 0;
  private nextCricket = 0;
  private state: AmbienceState = { day: 1, rain: 0, wind: 1, season: 0, volume: 0.6 };

  get running() { return this.ctx !== null && this.ctx.state === 'running'; }

  async start() {
    if (!this.ctx) this.build();
    await this.ctx!.resume();
  }

  async stop() { await this.ctx?.suspend(); }

  private noiseBuffer(ctx: AudioContext, seconds = 3) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // ブラウンノイズ寄り（低音が多く耳に優しい）
    let last = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    return buf;
  }

  private loopNoise(filterType: BiquadFilterType, freq: number, q = 0.7) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx);
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return { gain: g, filter: f };
  }

  private build() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.state.volume;
    this.master.connect(ctx.destination);
    const w = this.loopNoise('bandpass', 380, 0.6);
    this.wind = w.gain; this.windFilter = w.filter;
    this.water = this.loopNoise('lowpass', 900).gain;
    // 雨は高い音のノイズ（白色に近いもの）
    const rainSrc = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    rainSrc.buffer = buf; rainSrc.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
    this.rain = ctx.createGain(); this.rain.gain.value = 0;
    rainSrc.connect(hp).connect(this.rain).connect(this.master);
    rainSrc.start();
  }

  /** 鳥のさえずり：短い上昇音を数回 */
  private chirp() {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const base = 2600 + Math.random() * 1600;
    const notes = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      const t = t0 + i * (0.09 + Math.random() * 0.05);
      o.type = 'sine';
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.3), t + 0.07);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      const pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 2 - 1;
      o.connect(g).connect(pan).connect(this.master);
      o.start(t); o.stop(t + 0.1);
    }
  }

  /** 虫の声：高い音を細かく区切って鳴らす */
  private cricket() {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 4200 + Math.random() * 600;
    g.gain.value = 0;
    const pulses = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < pulses; i++) {
      const t = t0 + i * 0.06;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.018, t + 0.012);
      g.gain.linearRampToValueAtTime(0.0001, t + 0.04);
    }
    const pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 2 - 1;
    o.connect(g).connect(pan).connect(this.master);
    o.start(t0); o.stop(t0 + pulses * 0.06 + 0.05);
  }

  update(dt: number, s: AmbienceState) {
    this.state = s;
    if (!this.running) return;
    const ctx = this.ctx!;
    const k = 0.5; // なめらかに変える時間（秒）
    const t = ctx.currentTime;
    this.master.gain.setTargetAtTime(s.volume, t, k);
    const gust = 0.6 + 0.4 * Math.sin(t * 0.3) * Math.sin(t * 0.11);
    this.wind.gain.setTargetAtTime(0.05 * s.wind * gust, t, k);
    this.windFilter.frequency.setTargetAtTime(300 + 250 * gust * s.wind, t, k);
    this.water.gain.setTargetAtTime(0.035, t, k);
    this.rain.gain.setTargetAtTime(0.06 * s.rain, t, k);

    // 鳥：昼・雨でない時
    this.nextChirp -= dt;
    if (this.nextChirp <= 0) {
      this.nextChirp = 1.2 + Math.random() * 3.5;
      if (s.day > 0.5 && s.rain < 0.3 && s.season !== 3 && Math.random() < s.day) this.chirp();
    }
    // 虫：夜・夏〜秋
    this.nextCricket -= dt;
    if (this.nextCricket <= 0) {
      this.nextCricket = 0.15 + Math.random() * 0.5;
      const night = 1 - s.day;
      if (night > 0.6 && s.rain < 0.3 && (s.season === 1 || s.season === 2)) this.cricket();
    }
  }
}
