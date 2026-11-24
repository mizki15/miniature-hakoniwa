/**
 * 持ち物と加工の窓（🎒）：左に原料、右に素材と加工のボタン。
 * アイコンは public/icons の画像（raw-<id>.png・mat-<id>.png）。読めなければ絵文字を出す。
 */
import { MATERIALS, RAWS, RAW, RECIPES, craftable, matKey, type Inventory, type Recipe } from '../game/materials';

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
export const rawIcon = (id: string) => iconEl(`raw-${id}.png`, RAW[id as keyof typeof RAW]?.icon ?? '❔');
export const matIcon = (id: string) => iconEl(`mat-${id}.png`, MATERIALS.find((m) => m.id === id)?.icon ?? '❔');

const recipeText = (r: Recipe) => `${r.inputs.map(([k, n]) => `${RAW[k].name} ${n}`).join('・')} → ${r.out}`;

/**
 * 窓の中身を作り直す。onCraft(recipe, all)：加工する（all なら、できるだけ全部）。
 * tip：ホバーの説明を付ける（main の HoverTip）
 */
export function renderBag(raws: HTMLElement, mats: HTMLElement, inv: Inventory, onCraft: (r: Recipe, all: boolean) => void, tip: (el: HTMLElement, html: () => string) => void) {
  raws.replaceChildren(...RAWS.map((r) => {
    const row = document.createElement('div');
    row.className = 'bag-raw' + ((inv[r.id] ?? 0) > 0 ? '' : ' none');
    const name = Object.assign(document.createElement('span'), { className: 'bag-name', textContent: r.name });
    const n = Object.assign(document.createElement('b'), { className: 'bag-n', textContent: String(inv[r.id] ?? 0) });
    row.append(rawIcon(r.id), name, n);
    tip(row, () => `<b>${r.name}</b><br>手に入れ方：${r.from}`);
    return row;
  }));
  mats.replaceChildren(...MATERIALS.map((m) => {
    const row = document.createElement('div');
    row.className = 'bag-mat';
    const head = document.createElement('div');
    head.className = 'bag-mat-head';
    const name = Object.assign(document.createElement('span'), { className: 'bag-name', textContent: m.name });
    const n = Object.assign(document.createElement('b'), { className: 'bag-n', textContent: String(inv[matKey(m.id)] ?? 0) });
    head.append(matIcon(m.id), name, n);
    const btns = document.createElement('div');
    btns.className = 'bag-recipes';
    for (const r of RECIPES.filter((x) => x.mat === m.id)) {
      const b = document.createElement('button');
      b.type = 'button';
      const can = craftable(inv, r);
      b.disabled = can === 0;
      b.append(...r.inputs.map(([k]) => rawIcon(k)), Object.assign(document.createElement('span'), { textContent: recipeText(r) }));
      b.addEventListener('click', (e) => onCraft(r, e.shiftKey));
      tip(b, () => `加工する：${recipeText(r)}<br>Shift を押しながらで、できるだけ全部（いま ${craftable(inv, r)} 回）`);
      btns.append(b);
    }
    row.append(head, btns);
    return row;
  }));
}
