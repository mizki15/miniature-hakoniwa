import { ACTIVITY_NAMES, SPECIES, SPECIES_LIST, type Animal, type Species } from './animals';

/**
 * 図鑑（仮）：箱庭にいる動物を登録する。
 * いずれは「見つけた時に登録」「季節限定の生き物」などにする予定。今は箱庭にいる種類＝登録済み。
 */
export function renderDex(grid: HTMLElement, detail: HTMLElement, animals: Animal[]) {
  const counts = new Map<Species, number>();
  for (const a of animals) counts.set(a.species, (counts.get(a.species) ?? 0) + 1);
  grid.innerHTML = '';
  let selected: HTMLElement | null = null;
  const total = SPECIES_LIST.length + 2; // まだ見つかっていない枠も少し見せる
  for (let i = 0; i < total; i++) {
    const sp = SPECIES_LIST[i];
    const n = sp ? counts.get(sp) ?? 0 : 0;
    const card = document.createElement('div');
    card.className = 'dex-card' + (n > 0 ? ' found' : '');
    if (sp && n > 0) {
      const info = SPECIES[sp];
      card.innerHTML = `<div class="dex-icon">${info.icon}</div><div class="dex-name">${info.name}</div><div class="dex-count">${n} 匹</div>`;
      card.addEventListener('click', () => {
        selected?.classList.remove('sel');
        card.classList.add('sel');
        selected = card;
        const members = animals.filter((a) => a.species === sp).map((a) => `${a.name}（${ACTIVITY_NAMES[a.activity]}）`).join('、');
        detail.innerHTML = `<b>${info.icon} ${info.name}</b><br>${info.note}<br>得意なこと：${info.skill}<br>住人：${members}`;
      });
    } else {
      card.innerHTML = '<div class="dex-icon">?</div><div class="dex-name">？？？</div>';
    }
    grid.appendChild(card);
  }
}
