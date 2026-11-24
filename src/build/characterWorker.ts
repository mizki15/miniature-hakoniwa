/// <reference lib="webworker" />
/**
 * 建物の性格を計算するワーカー（最悪の形でも画面を止めないため）。
 * 受け取る：{ id, design }、返す：{ id, character }
 */
import { buildingCharacter } from './character';
import type { BuildingDesign } from './geoParse';

self.onmessage = (e: MessageEvent<{ id: string; design: BuildingDesign }>) => {
  const { id, design } = e.data;
  let character = null;
  try { character = buildingCharacter(design); } catch { /* 形が壊れていれば null（性格なし） */ }
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, character });
};
