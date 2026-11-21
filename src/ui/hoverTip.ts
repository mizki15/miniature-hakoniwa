/**
 * ホバーの説明：ボタンやカードにしばらくカーソルを合わせた時だけ、その近くに小さな説明を出す。
 * 1 つの説明の板を使い回す（同時に出るのは 1 つだけ）
 */
export class HoverTip {
  /** 説明が出るまでの秒数（デバッグウィンドウで変える） */
  delay = 0.2;
  private timer = 0;
  private target: HTMLElement | null = null;

  constructor(private el: HTMLElement) {
    // スクロールしたら位置がずれるので消す
    window.addEventListener('scroll', () => this.hide(), true);
  }

  /**
   * target にカーソルを合わせ続けたら、content の説明を side の側に出す。
   * html：content を HTML として入れるか（このアプリが作った文だけに使う）。false なら文字として入れる。
   * edge を渡すと、横の位置は target ではなく edge（パネルなど）の端に合わせる（隣のカードを隠さないように）
   */
  attach(target: HTMLElement, content: () => string, side: 'right' | 'left', html = false, edge?: HTMLElement) {
    target.addEventListener('pointerenter', () => {
      clearTimeout(this.timer);
      this.target = target;
      this.timer = window.setTimeout(() => {
        if (this.target !== target || !target.isConnected) return;
        if (html) this.el.innerHTML = content(); else this.el.textContent = content();
        this.show(target, side, edge);
      }, this.delay * 1000);
    });
    target.addEventListener('pointerleave', () => { if (this.target === target) this.hide(); });
    target.addEventListener('pointerdown', () => this.hide());
  }

  hide() {
    clearTimeout(this.timer);
    this.target = null;
    this.el.classList.remove('show');
  }

  private show(target: HTMLElement, side: 'right' | 'left', edge?: HTMLElement) {
    const t = target.getBoundingClientRect();
    const e = edge?.getBoundingClientRect();
    const r = { left: e ? e.left : t.left, right: e ? e.right : t.right, top: t.top };
    this.el.classList.add('show');
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    let x = side === 'right' ? r.right + 8 : r.left - w - 8;
    // はみ出す時は反対側へ
    if (x + w > innerWidth - 4) x = r.left - w - 8;
    if (x < 4) x = Math.min(innerWidth - w - 4, r.right + 8);
    const y = Math.max(4, Math.min(innerHeight - h - 4, r.top));
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }
}
