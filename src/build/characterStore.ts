/**
 * 建物の性格の置き場：建物の形（design.id）ごとに 1 回だけ計算して、メモリに覚えておく。
 * 共有コードや保存データには入れない（書き換えられないよう、毎回こちらで計算し直す。設計メモ 8 章）。
 */
import type { BuildingCharacter } from './character';
import type { BuildingDesign } from './geoParse';

export class CharacterStore {
  private done = new Map<string, BuildingCharacter | null>();
  private asked = new Set<string>();
  /** 新しく計算できた時に呼ぶ */
  onReady: ((id: string) => void) | null = null;

  constructor(private worker: Worker) {
    worker.onmessage = (e: MessageEvent<{ id: string; character: BuildingCharacter | null }>) => {
      this.done.set(e.data.id, e.data.character);
      this.onReady?.(e.data.id);
    };
  }

  /** できていれば返す。まだなら計算を頼んで undefined */
  get(d: BuildingDesign): BuildingCharacter | undefined {
    const c = this.done.get(d.id);
    if (c !== undefined) return c ?? undefined;
    if (!this.asked.has(d.id)) {
      this.asked.add(d.id);
      this.worker.postMessage({ id: d.id, design: d });
    }
    return undefined;
  }
}
