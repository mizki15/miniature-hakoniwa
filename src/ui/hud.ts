import { SEASON_NAMES } from '../calendar';
import { WEATHER_NAMES, type WeatherKind } from '../weather';

/**
 * 画面の文字の表示（v0.18 で main.ts から切り出した）：右のパネルの時刻・季節・天気・発見ポイントと、
 * デバッグの時刻・暦・天気の札。毎フレーム呼んでも、文字が変わった時だけ書き換える
 */
export interface StatusInfo {
  hh: number; mm: number;
  /** 表示する季節（手動で上書きしていればその季節）と、暦の季節 */
  season: number; calendarSeason: number;
  weather: WeatherKind; snowDay: boolean;
  /** 発見ポイントと、区画を開くのに要るポイント */
  points: number; openPoints: number;
}

export function createHud(doc: Document = document) {
  const cache = new Map<string, { el: HTMLElement; text: string }>();
  /** 文字が変わった時だけ書き換える */
  const setText = (id: string, text: string) => {
    let c = cache.get(id);
    if (!c) {
      const el = doc.getElementById(id);
      if (!el) return;
      c = { el, text: el.textContent ?? '' };
      cache.set(id, c);
    }
    if (c.text !== text) { c.text = text; c.el.textContent = text; }
  };
  let gauge = -1;
  /** 右のパネル（図鑑）の上の、時刻・季節・天気と発見ポイント（0.5 秒ごと） */
  const updateStatus = (s: StatusInfo) => {
    setText('st-time', `${String(s.hh).padStart(2, '0')}:${String(s.mm).padStart(2, '0')}`);
    setText('st-season', SEASON_NAMES[s.season] + (s.season !== s.calendarSeason ? '（手動）' : ''));
    setText('st-weather', WEATHER_NAMES[s.weather] + (s.snowDay ? '（雪の日）' : ''));
    // 発見ポイント（図鑑の上）：持っている数と、区画を開ける量までのたまり具合
    setText('rightsCount', String(s.points));
    setText('rightsNext', s.points >= s.openPoints ? `区画を開ける（${s.openPoints}）・建物にも使う` : `区画を開くまで あと ${s.openPoints - s.points}`);
    const g = Math.min(1, s.points / s.openPoints);
    if (g !== gauge) { gauge = g; const el = doc.getElementById('rightsGauge'); if (el) el.style.width = `${g * 100}%`; }
  };
  return { setText, updateStatus };
}
export type Hud = ReturnType<typeof createHud>;
