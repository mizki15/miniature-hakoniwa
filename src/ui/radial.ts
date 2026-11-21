/**
 * 道具の輪（ラジアルメニュー）。
 * 内側の輪にグループ（畑・植える・地形…）、指したグループの外側に、その中の道具が並ぶ。
 * Q を押している間だけ出す使い方（離した所の道具を選ぶ）と、クリックで選ぶ使い方の両方に対応する。
 * グループの上で離すと、そのグループで最後に選んだ道具になる
 */

/** noRemember：選んでも「グループで最後に選んだ道具」にしない（窓を開くだけの項目など） */
export interface RadialItem { id: string; icon: string; label: string; children?: RadialItem[]; noRemember?: boolean }

const INNER_R = 84;
const OUTER_R = 168;
/** 外側の道具どうしの角度（度） */
const CHILD_STEP = 25;
/** 真ん中のこの距離より内側で離すと、何も選ばない */
const DEAD_R = 34;
/** 内側の輪と外側の輪の境 */
const SPLIT_R = 126;

const deg = (a: number) => (a * Math.PI) / 180;
/** 角度の差（-180〜180） */
const angleDiff = (a: number, b: number) => ((a - b + 540) % 360) - 180;

export class Radial {
  private items: RadialItem[] = [];
  private cx = 0;
  private cy = 0;
  private group = -1;
  private child = -1;
  private groupEls: HTMLElement[] = [];
  private childEls: HTMLElement[] = [];
  private centerEl: HTMLElement;
  private childLayer: HTMLElement;
  /** グループごとに、最後に選んだ道具 */
  private remembered = new Map<string, string>();
  /** いま使っている道具（印を付ける） */
  private current: string | null = null;
  /** クリックで選ぶ使い方（Q を離して閉じるのではない） */
  private sticky = false;
  /** クリックで 1 度押したグループ（もう一度押すと、そのグループの最後の道具を選ぶ） */
  private armed = -1;
  /** 選んだ時（閉じた後）に呼ぶ */
  onPick: ((id: string) => void) | null = null;

  constructor(private root: HTMLElement) {
    this.centerEl = document.createElement('div');
    this.centerEl.className = 'radial-center';
    this.childLayer = document.createElement('div');
    this.childLayer.className = 'radial-children';
    root.addEventListener('pointerdown', (e) => {
      // クリックで選ぶ：道具の上なら選ぶ、それ以外（輪の外）なら閉じる
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-ri]');
      e.preventDefault();
      e.stopPropagation();
      if (!el) { this.close(false); return; }
      const [kind, i] = el.dataset.ri!.split(':');
      if (kind === 'g') {
        const gi = +i;
        this.highlight(gi, -1);
        // 子のないグループはそのまま選ぶ。子のあるグループは、外側の道具を選ぶのを待つ（もう一度押すと最後の道具）
        if (!this.items[gi].children?.length || this.armed === gi) this.close(true);
        else this.armed = gi;
      } else { this.child = +i; this.close(true); }
    });
    root.addEventListener('pointermove', (e) => this.move(e.clientX, e.clientY));
  }

  get isOpen() { return this.root.classList.contains('open'); }

  /** 道具の番号から、それが入っているグループを覚える（ショートカットで選んだ時など） */
  remember(id: string) {
    for (const g of this.items) if (g.children?.some((c) => c.id === id && !c.noRemember)) this.remembered.set(g.id, id);
  }
  /** グループで最後に選んだ道具（なければ最初の道具、子がなければグループ自身） */
  lastOf(groupId: string): string | null {
    const g = this.items.find((x) => x.id === groupId);
    if (!g) return null;
    if (!g.children?.length) return g.id;
    const r = this.remembered.get(g.id);
    return r && g.children.some((c) => c.id === r) ? r : g.children[0].id;
  }

  setItems(items: RadialItem[]) { this.items = items; }
  setCurrent(id: string | null) { this.current = id; if (id) this.remember(id); }

  /** (x, y)（画面の座標）を中心に開く。sticky：クリックで選ぶ使い方 */
  open(x: number, y: number, sticky = false) {
    const m = OUTER_R + 40;
    this.cx = Math.min(innerWidth - m, Math.max(m, x));
    this.cy = Math.min(innerHeight - m, Math.max(m, y));
    this.sticky = sticky;
    this.group = this.child = this.armed = -1;
    this.root.replaceChildren();
    this.groupEls = this.items.map((g, i) => {
      const el = this.itemEl(g, `g:${i}`, 'radial-group');
      const a = this.groupAngle(i);
      el.style.left = `${this.cx + Math.cos(deg(a)) * INNER_R}px`;
      el.style.top = `${this.cy + Math.sin(deg(a)) * INNER_R}px`;
      if (this.current && (g.id === this.current || g.children?.some((c) => c.id === this.current))) el.classList.add('current');
      return el;
    });
    const ring = document.createElement('div');
    ring.className = 'radial-ring';
    ring.style.left = `${this.cx}px`;
    ring.style.top = `${this.cy}px`;
    this.centerEl.style.left = `${this.cx}px`;
    this.centerEl.style.top = `${this.cy}px`;
    this.centerEl.textContent = '';
    this.root.append(ring, ...this.groupEls, this.childLayer, this.centerEl);
    this.childLayer.replaceChildren();
    this.root.classList.add('open');
    this.root.setAttribute('aria-hidden', 'false');
    // 今の道具のグループを最初から指しておく（外側の道具が見えるように）
    const cur = this.items.findIndex((g) => g.id === this.current || g.children?.some((c) => c.id === this.current));
    if (sticky && cur >= 0) this.highlight(cur, -1);
  }

  /** 閉じる。pick なら、指していた道具を選ぶ */
  close(pick: boolean) {
    if (!this.isOpen) return;
    let id: string | null = null;
    if (pick && this.group >= 0) {
      const g = this.items[this.group];
      id = this.child >= 0 && g.children ? g.children[this.child].id : this.lastOf(g.id);
    }
    this.root.classList.remove('open');
    this.root.setAttribute('aria-hidden', 'true');
    this.root.replaceChildren();
    if (id) { this.remember(id); this.onPick?.(id); }
  }

  /** マウスの位置で、指している物を決める */
  move(x: number, y: number) {
    if (!this.isOpen) return;
    const dx = x - this.cx, dy = y - this.cy;
    const d = Math.hypot(dx, dy);
    if (d < DEAD_R) { if (!this.sticky) this.highlight(-1, -1); return; }
    const a = (Math.atan2(dy, dx) * 180) / Math.PI;
    const nearestGroup = () => {
      let best = -1, bd = Infinity;
      this.items.forEach((_, i) => { const t = Math.abs(angleDiff(a, this.groupAngle(i))); if (t < bd) { bd = t; best = i; } });
      return best;
    };
    if (d < SPLIT_R) { this.highlight(nearestGroup(), -1); return; }
    // 外側：指しているグループの道具のどれかに近ければそれ、離れていればグループを替える
    const g = this.items[this.group];
    if (g?.children?.length) {
      let best = -1, bd = Infinity;
      g.children.forEach((_, i) => { const t = Math.abs(angleDiff(a, this.childAngle(this.group, i))); if (t < bd) { bd = t; best = i; } });
      if (bd < CHILD_STEP * 0.75) { this.highlight(this.group, best); return; }
    }
    if (!this.sticky) this.highlight(nearestGroup(), -1);
  }

  private groupAngle(i: number) { return -90 + (360 / this.items.length) * i; }
  private childAngle(g: number, i: number) {
    const n = this.items[g].children!.length;
    return this.groupAngle(g) + (i - (n - 1) / 2) * CHILD_STEP;
  }

  private itemEl(it: RadialItem, ri: string, cls: string) {
    const el = document.createElement('div');
    el.className = `radial-item ${cls}`;
    el.dataset.ri = ri;
    const ic = document.createElement('span');
    ic.className = 'ri-ic';
    ic.textContent = it.icon;
    const lb = document.createElement('span');
    lb.className = 'ri-lb';
    lb.textContent = it.label; // 建物の名前（読み込んだ物）も入るので textContent で出す
    el.append(ic, lb);
    return el;
  }

  private highlight(g: number, c: number) {
    if (g !== this.group) {
      this.group = g;
      this.groupEls.forEach((el, i) => el.classList.toggle('hl', i === g));
      // 外側の道具を出し直す
      const kids = g >= 0 ? this.items[g].children ?? [] : [];
      const last = g >= 0 ? this.lastOf(this.items[g].id) : null;
      this.childEls = kids.map((it, i) => {
        const el = this.itemEl(it, `c:${i}`, 'radial-child');
        const a = this.childAngle(g, i);
        el.style.left = `${this.cx + Math.cos(deg(a)) * OUTER_R}px`;
        el.style.top = `${this.cy + Math.sin(deg(a)) * OUTER_R}px`;
        if (it.id === this.current) el.classList.add('current');
        if (it.id === last) el.classList.add('last');
        return el;
      });
      this.childLayer.replaceChildren(...this.childEls);
    }
    this.child = c;
    this.childEls.forEach((el, i) => el.classList.toggle('hl', i === c));
    const it = g < 0 ? null : c >= 0 ? this.items[g].children![c] : this.items[g];
    this.centerEl.textContent = it ? it.label : '';
  }
}
