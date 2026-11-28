/**
 * 画面の上に重ねる小さな動き（v0.21.0）：「＋10」などの数字、持ち物のボタンへ飛ぶアイコン、季節が変わった時に流れる物、
 * 目標の達成の帯。どれも HTML の要素を CSS のアニメーションで動かし、終わったら消す
 */
const layer = () => {
  let el = document.getElementById('fxLayer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fxLayer';
    document.body.append(el);
  }
  return el;
};

/** 数字や短い文字を、その場所から上へふわっと出して消す */
export function floatText(x: number, y: number, text: string, cls = '') {
  const el = document.createElement('div');
  el.className = `fx-float ${cls}`;
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  layer().append(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

/** アイコン（画像の URL か絵文字）を、from から to の要素へ弧を描いて飛ばす。着いたら to を小さくはねさせる */
export function flyIcon(from: { x: number; y: number }, to: HTMLElement | null, icon: string, label = '') {
  if (!to) return;
  const r = to.getBoundingClientRect();
  if (!r.width) return;
  const el = document.createElement('div');
  el.className = 'fx-fly';
  if (/^(data:|\/|https?:)/.test(icon) || icon.endsWith('.png')) el.append(Object.assign(document.createElement('img'), { src: icon, alt: '' }));
  else el.textContent = icon;
  if (label) el.append(Object.assign(document.createElement('span'), { textContent: label }));
  const tx = r.left + r.width / 2, ty = r.top + r.height / 2;
  el.style.left = `${from.x}px`;
  el.style.top = `${from.y}px`;
  el.style.setProperty('--dx', `${tx - from.x}px`);
  el.style.setProperty('--dy', `${ty - from.y}px`);
  layer().append(el);
  el.addEventListener('animationend', () => {
    el.remove();
    to.classList.remove('fx-bump');
    void to.offsetWidth;
    to.classList.add('fx-bump');
  }, { once: true });
}

/** 要素を小さく震わせる（使えない・足りない時） */
export function shake(el: HTMLElement | null) {
  if (!el) return;
  el.classList.remove('fx-shake');
  void el.offsetWidth;
  el.classList.add('fx-shake');
}

/** 季節が変わった時：その季節の物を、画面を斜めに流す（2 秒） */
export function seasonSweep(season: number) {
  const items = [['🌸', '🌸', '🌼'], ['✨', '✨', '🌿'], ['🍁', '🍂', '🍁'], ['❄', '❄', '❅']][season] ?? ['✨'];
  for (let i = 0; i < 26; i++) {
    const el = document.createElement('div');
    el.className = 'fx-sweep';
    el.textContent = items[i % items.length];
    el.style.left = `${-10 + Math.random() * 60}vw`;
    el.style.top = `${-15 + Math.random() * 40}vh`;
    el.style.animationDelay = `${Math.random() * 0.9}s`;
    el.style.fontSize = `${16 + Math.random() * 18}px`;
    layer().append(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }
}

/** 目標の達成などの帯（画面の上に 2.4 秒） */
export function banner(text: string) {
  const el = document.createElement('div');
  el.className = 'fx-banner';
  el.textContent = text;
  layer().append(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

/** 画面の縁をうっすら光らせる（モードの切り替え） */
export function edgeGlow() {
  const el = document.createElement('div');
  el.className = 'fx-edge';
  layer().append(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
}
