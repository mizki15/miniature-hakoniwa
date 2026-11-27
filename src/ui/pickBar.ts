/**
 * 画面下の選択バー（v0.20.1）：カテゴリ（植栽。v0.20.3 からブロック配置・道作りも）を選ぶと、画面の下に横一列で並ぶ。
 * アイコンは物のプレビュー（ui/thumb.ts）。いま選んでいるものに印。名前はアイコンの下に小さく、説明はヒントの欄に出す
 */
export interface PickItem { id: string; name: string; img: string; help?: string; disabled?: boolean }

export class PickBar {
  private items: PickItem[] = [];
  private current = '';
  constructor(private el: HTMLElement, private onPick: (id: string) => void, private onHover?: (item: PickItem | null) => void) {}

  /** 並べる（items が空ならしまう） */
  show(items: PickItem[], current: string) {
    this.items = items;
    this.current = current;
    this.el.hidden = items.length === 0;
    this.el.replaceChildren(...items.map((it) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick-item' + (it.id === current ? ' on' : '');
      b.disabled = !!it.disabled;
      b.dataset.id = it.id;
      const img = Object.assign(document.createElement('img'), { src: it.img, alt: '', draggable: false });
      const nm = Object.assign(document.createElement('span'), { textContent: it.name });
      b.append(img, nm);
      b.addEventListener('click', () => this.onPick(it.id));
      b.addEventListener('pointerenter', () => this.onHover?.(it));
      b.addEventListener('pointerleave', () => this.onHover?.(null));
      return b;
    }));
  }
  hide() { this.show([], ''); }
  /** 選んでいる印だけを付け直す */
  select(id: string) {
    this.current = id;
    this.el.querySelectorAll<HTMLButtonElement>('.pick-item').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
  }
  get visible() { return !this.el.hidden && this.items.length > 0; }
}
