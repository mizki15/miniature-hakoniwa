import { seasonAt } from './calendar';

/**
 * 天気：季節と同じく全世界共通。90 分ごとの時間帯ごとに、時刻から決定論的に決まる。
 * （同じ時刻ならどのプレイヤーも同じ天気）
 */
export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'snow';
export const WEATHER_NAMES: Record<WeatherKind, string> = { clear: '晴れ', cloudy: 'くもり', rain: '雨', snow: '雪' };

export interface WeatherParams {
  cloudCover: number; // 雲の量
  cloudDark: number; // 雲の暗さ
  sun: number; // 日差しの強さ（倍率）
  rain: number; // 雨の量
  snow: number; // 雪の量
  wind: number; // 風の強さ
}

export const WEATHER_PARAMS: Record<WeatherKind, WeatherParams> = {
  clear: { cloudCover: 0.28, cloudDark: 0, sun: 1, rain: 0, snow: 0, wind: 0.8 },
  cloudy: { cloudCover: 0.75, cloudDark: 0.25, sun: 0.55, rain: 0, snow: 0, wind: 1.1 },
  rain: { cloudCover: 0.95, cloudDark: 0.65, sun: 0.32, rain: 1, snow: 0, wind: 1.6 },
  snow: { cloudCover: 0.88, cloudDark: 0.3, sun: 0.45, rain: 0, snow: 1, wind: 0.6 },
};

const SLOT_MS = 90 * 60 * 1000;

const hash = (n: number) => {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

/**
 * 雪の日（v0.17。設計メモ 0 章）：冬（暦の冬）の各週（月の 1〜7 日・8〜14 日…。最後は 29 日〜月末）に 1 日ずつ。
 * どの日かは月と週から決定論的に決まる（全世界共通）。その日は UTC の 0 時から 24 時間ずっと雪なので、
 * どの時差の端末でも、昼（10〜16 時）のどこかに雪の時間帯が来る
 */
export function isSnowDay(date: Date): boolean {
  if (seasonAt(date).season !== 3) return false;
  const y = date.getUTCFullYear(), mo = date.getUTCMonth(), day = date.getUTCDate() - 1;
  const dim = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const week = Math.floor(day / 7), start = week * 7, len = Math.min(7, dim - start);
  const months = y * 12 + mo;
  return day === start + Math.floor(hash(months * 16 + week + 0x51ab) * len);
}

/** その時刻の天気（season: 0 春, 1 夏, 2 秋, 3 冬） */
export function weatherAt(date: Date, season: number): WeatherKind {
  if (season === 3 && isSnowDay(date)) return 'snow';
  const r = hash(Math.floor(date.getTime() / SLOT_MS));
  // 季節ごとの確率：[晴れ, くもり, 降水]
  const table = [[0.5, 0.3, 0.2], [0.6, 0.2, 0.2], [0.55, 0.3, 0.15], [0.4, 0.3, 0.3]][season];
  if (r < table[0]) return 'clear';
  if (r < table[0] + table[1]) return 'cloudy';
  return season === 3 ? 'snow' : 'rain';
}

/** 今の値を目標の天気へ少しずつ近づける（急に切り替わらないように） */
export function approachWeather(cur: WeatherParams, target: WeatherParams, dt: number, rate = 0.35) {
  const k = 1 - Math.exp(-dt * rate);
  for (const key of Object.keys(cur) as (keyof WeatherParams)[]) cur[key] += (target[key] - cur[key]) * k;
}
