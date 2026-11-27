/**
 * 持ち物の窓（🎒。v0.20）：左に素材 5 つ（木材・繊維・石材・鉱物・土）、右に収穫物。加工は無い（v0.19 までの原料と加工はやめた）。
 * アイコンは public/icons の画像（mat5-<id>.png）。読めなければ絵文字を出す。
 */
import { MATS, type Inventory } from '../game/materials';
import { CROPS, CROP_KINDS } from '../game/farm';
import { CROP_ICONS } from '../game/tools';

const ICON_BASE = `${import.meta.env.BASE_URL}icons/`;

/** 画像のアイコン（読めなければ絵文字） */
export function iconEl(file: string, emoji: string, cls = 'bag-ic'): HTMLElement {
  const span = document.createElement('span');
  span.className = cls;
  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  img.src = ICON_BASE + file;
  img.addEventListener('error', () => { span.textContent = emoji; }, { once: true });
  span.append(img);
  return span;
}
/** 素材のアイコン */
export const matIcon = (id: string) => iconEl(`mat5-${id}.png`, MATS.find((m) => m.id === id)?.icon ?? '❔');

const row = (icon: HTMLElement, name: string, n: number) => {
  const r = document.createElement('div');
  r.className = 'bag-raw' + (n > 0 ? '' : ' none');
  r.append(icon, Object.assign(document.createElement('span'), { className: 'bag-name', textContent: name }), Object.assign(document.createElement('b'), { className: 'bag-n', textContent: String(n) }));
  return r;
};

/** 窓の中身を作り直す。tip：ホバーの説明を付ける（main の HoverTip） */
export function renderBag(matsEl: HTMLElement, cropsEl: HTMLElement, inv: Inventory, tip: (el: HTMLElement, html: () => string) => void) {
  matsEl.replaceChildren(...MATS.map((m) => {
    const r = row(matIcon(m.id), m.name, Math.floor(inv[m.id] ?? 0));
    tip(r, () => `<b>${m.name}</b><br>手に入れ方：${m.from}`);
    return r;
  }));
  cropsEl.replaceChildren(...CROP_KINDS.map((k) => {
    const r = row(iconEl(`crop-${k}.png`, CROP_ICONS[k]), CROPS[k].name, Math.floor(inv[k] ?? 0));
    tip(r, () => `<b>${CROPS[k].name}</b><br>住人をクリックすると、おすそ分けできる`);
    return r;
  }));
}
