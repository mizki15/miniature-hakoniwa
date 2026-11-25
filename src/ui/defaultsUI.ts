import { DEFAULTS } from '../defaults';

/**
 * src/defaults.ts の初期値を、画面のスライダーと選択に入れる（v0.18.1）。
 * 起動の最初に 1 回呼ぶ（その後で、端末に覚えた値や保存した箱庭の値が上書きする）
 */
export function applyDefaultsToUI(fStops: readonly number[], doc: Document = document) {
  const set = (id: string, v: number) => {
    const el = doc.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (!el || !Number.isFinite(v)) return;
    el.value = String(v);
    if (el instanceof HTMLInputElement) el.defaultValue = String(v);
  };
  for (const [k, v] of Object.entries(DEFAULTS.terrain)) set(`p-${k}`, v);
  const L = DEFAULTS.look, P = DEFAULTS.play;
  set('bump', L.bump); set('toonLine', L.toonLine); set('blend', L.blend); set('aoStrength', L.aoStrength);
  // f 値は段の番号で持つ（いちばん近い段）
  set('fstop', fStops.reduce((best, f, i) => (Math.abs(f - L.fStop) < Math.abs(fStops[best] - L.fStop) ? i : best), 0));
  set('focusSpeed', L.focusSpeed); set('nightBright', L.nightBright); set('groundDensity', L.groundDensity);
  set('moveSpeed', P.moveSpeed); set('tipDelay', P.tipDelay); set('simSpeed', P.simSpeed); set('ecoAbundance', P.ecoAbundance);
}
