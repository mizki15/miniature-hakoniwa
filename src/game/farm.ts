/**
 * 畑と植林のシミュレーション。
 * 成長は「経過した時間」から計算するので、閉じている間（オフライン）の分もまとめて進められる。
 * 時間は箱庭内の時計（simMs）で数える。ふだんは現実の時間と同じ速さ、デバッグで早送りできる。
 */

export type CropKind = 'turnip' | 'wheat' | 'pumpkin';

export interface CropDef { name: string; hours: number; seasons: number[]; }

/** 作物：育つまでの時間（現実の時間）と、育つ季節（0 春, 1 夏, 2 秋, 3 冬） */
export const CROPS: Record<CropKind, CropDef> = {
  turnip: { name: 'カブ', hours: 1.5, seasons: [0, 2] },
  wheat: { name: '小麦', hours: 6, seasons: [0, 1, 2] },
  pumpkin: { name: 'かぼちゃ', hours: 8, seasons: [1, 2] },
};
export const CROP_KINDS = Object.keys(CROPS) as CropKind[];

/** 苗木が木になるまでの時間 */
export const SAPLING_HOURS = 24;
/** 水やりの効果が続く時間 */
export const WET_HOURS = 6;

export interface Crop { kind: CropKind; col: number; progress: number; }
export interface FarmChange { crops: boolean; saplings: boolean; matured: boolean }
export interface Sapling { col: number; variant: number; rot: number; progress: number; }

export interface FarmEnv {
  season: number;
  raining: boolean;
  isWet: (col: number) => boolean; // 湿っている（水やり・雨・水路のそば）
  /** 住人の仕事（v0.16.1）：育つ速さの倍率（うさぎの近く）と、冬の育つ速さ（オコジョの近く。ふだんは 0） */
  growth?: (col: number) => number;
  winterGrowth?: (col: number) => number;
}

const HOUR = 3600 * 1000;

export class Farm {
  crops = new Map<number, Crop>();
  saplings: Sapling[] = [];
  wetUntil = new Map<number, number>(); // 列 → 湿っている期限（simMs）
  /** 持ち物：収穫物・原料・素材（game/materials.ts）。上限は付けない */
  inventory: Record<string, number> = { turnip: 0, wheat: 0, pumpkin: 0 };
  simMs = Date.now();
  speed = 1; // 早送りの倍率（デバッグ用）
  /** 水やりが続く時間の倍率（住人の仕事：モグラで 1.5。v0.16.1） */
  wetMul = 1;

  /** 生育段階：0 芽, 1 若い, 2 育った, 3 収穫できる */
  static stage(progress: number) {
    return progress >= 1 ? 3 : progress >= 0.6 ? 2 : progress >= 0.25 ? 1 : 0;
  }

  plant(col: number, kind: CropKind) {
    if (this.crops.has(col)) return false;
    this.crops.set(col, { kind, col, progress: 0 });
    return true;
  }

  harvest(col: number) {
    const c = this.crops.get(col);
    if (!c || c.progress < 1) return null;
    this.crops.delete(col);
    this.inventory[c.kind] = (this.inventory[c.kind] ?? 0) + 1;
    return c.kind;
  }

  water(col: number) { this.wetUntil.set(col, this.simMs + WET_HOURS * HOUR * this.wetMul); }

  plantSapling(col: number, variant: number, rot: number) {
    this.saplings.push({ col, variant, rot, progress: 0 });
  }

  /**
   * 時間を進める。dtMs は箱庭内の経過時間（早送り込み）。
   * 段階が変わった作物・苗木があれば true（見た目を作り直す合図）
   */
  /**
   * 時間を進める。戻り値：crops 作物の段階が変わった、saplings 苗木の大きさが変わった（1/20 ごと）、
   * matured 苗木の形が変わった（小さな木になった・育ちきった。とまれる木が変わるので環境を数え直す）
   */
  advance(dtMs: number, env: FarmEnv): FarmChange {
    this.simMs += dtMs;
    const hours = dtMs / HOUR;
    const out: FarmChange = { crops: false, saplings: false, matured: false };
    for (const c of this.crops.values()) {
      if (c.progress >= 1) continue;
      const def = CROPS[c.kind];
      // 季節外れはとてもゆっくり、冬は育たない。乾いた畑は半分の速さ
      const seasonRate = env.season === 3 ? env.winterGrowth?.(c.col) ?? 0 : def.seasons.includes(env.season) ? 1 : 0.35;
      const wetRate = env.isWet(c.col) ? 1 : 0.5;
      const before = Farm.stage(c.progress);
      c.progress = Math.min(1, c.progress + (hours / def.hours) * seasonRate * wetRate * (env.growth?.(c.col) ?? 1));
      if (Farm.stage(c.progress) !== before) out.crops = true;
    }
    for (const s of this.saplings) {
      if (s.progress >= 1) continue;
      const before = Math.floor(s.progress * 20), was = s.progress;
      s.progress = Math.min(1, s.progress + (hours / SAPLING_HOURS) * (env.season === 3 ? 0.2 : 1));
      if (Math.floor(s.progress * 20) !== before) out.saplings = true;
      if ((was < 0.25) !== (s.progress < 0.25) || (was < 1 && s.progress >= 1)) out.matured = true;
    }
    // 雨の間はすべての畑が湿る
    if (env.raining) for (const col of this.crops.keys()) this.wetUntil.set(col, this.simMs + WET_HOURS * HOUR);
    return out;
  }

  isWateredNow(col: number) { return (this.wetUntil.get(col) ?? 0) > this.simMs; }
}
