import { ACTIVITY_NAMES, SPECIES, type Animal, type Species } from './animals';
import type { Visitor } from './visitors';
import { DEX_ORDER, RARITY_STARS, RESIDENT_TEXT, VISITOR, isVisitorId, rarityOf, type DexId } from '../eco/species';
import { dexStage, type Dex } from '../eco/dexState';
import { SEASON_NAMES } from '../calendar';

/**
 * 生き物図鑑：住人 7 種と訪問者 12 種。
 *   ？？？：ヒントだけ／見かけた：シルエット（名前はまだ出さない）／観察した：名前・説明・好きな環境・観察した季節
 */
const nameOf = (id: DexId) => (isVisitorId(id) ? VISITOR[id].name : SPECIES[id as Species].name);
const iconOf = (id: DexId) => (isVisitorId(id) ? VISITOR[id].icon : SPECIES[id as Species].icon);
const hintOf = (id: DexId) => (isVisitorId(id) ? VISITOR[id].hint : RESIDENT_TEXT[id as Species].hint);

let selectedId: DexId | null = null;

export function renderDex(grid: HTMLElement, detail: HTMLElement, dex: Dex, animals: Animal[], visitors: Visitor[]) {
  grid.innerHTML = '';
  const observed = DEX_ORDER.filter((id) => dexStage(dex, id) === 'observed').length;
  const head = (text: string) => { const h = document.createElement('div'); h.className = 'dex-head'; h.textContent = text; grid.appendChild(h); };
  head(`観察 ${observed} / ${DEX_ORDER.length}　・　住人`);

  const show = (id: DexId) => {
    const stage = dexStage(dex, id);
    if (stage !== 'observed') {
      detail.innerHTML = `<b>？？？</b><br>${hintOf(id)}` +
        (stage === 'seen' ? '<br><span class="dex-muted">カーソルをしばらく合わせると観察できる</span>' : '');
      return;
    }
    const e = dex[id];
    const seasons = SEASON_NAMES.map((n, i) => `<span class="dex-season${e.seasons.includes(i) ? ' on' : ''}">${n}</span>`).join('');
    if (isVisitorId(id)) {
      const v = VISITOR[id];
      const here = visitors.some((x) => x.def.id === id) ? '<br>いま箱庭にいる' : '';
      detail.innerHTML = `<b>${v.icon} ${v.name}</b>　${RARITY_STARS[v.rarity]}<br>${v.note}<br>好きな環境：${v.likes}<br>観察した季節：${seasons}${here}`;
    } else {
      const sp = id as Species, info = SPECIES[sp];
      const members = animals.filter((a) => a.species === sp).map((a) => `${a.name}（${ACTIVITY_NAMES[a.activity]}）`).join('、') || 'いまはいない';
      detail.innerHTML = `<b>${info.icon} ${info.name}</b>　${RARITY_STARS[rarityOf(id)]}<br>${info.note}<br>好きな環境：${RESIDENT_TEXT[sp].likes}<br>得意なこと：${info.skill}<br>観察した季節：${seasons}<br>住人：${members}`;
    }
  };

  DEX_ORDER.forEach((id, i) => {
    if (i === 7) head('訪問者');
    const stage = dexStage(dex, id);
    const card = document.createElement('div');
    card.className = `dex-card ${stage}` + (selectedId === id ? ' sel' : '');
    const count = isVisitorId(id) ? (visitors.some((v) => v.def.id === id) ? 'いる' : '') : (() => { const n = animals.filter((a) => a.species === id).length; return n ? `${n} 匹` : ''; })();
    card.innerHTML = stage === 'unknown'
      ? '<div class="dex-icon">?</div><div class="dex-name">？？？</div>'
      : `<div class="dex-icon"><span class="dex-emoji">${iconOf(id)}</span></div><div class="dex-name">${stage === 'seen' ? '？？？' : nameOf(id)}</div>` +
        (stage === 'observed' && count ? `<div class="dex-count">${count}</div>` : '');
    card.addEventListener('click', () => {
      grid.querySelectorAll('.dex-card.sel').forEach((c) => c.classList.remove('sel'));
      card.classList.add('sel');
      selectedId = id;
      show(id);
    });
    grid.appendChild(card);
  });
  if (selectedId) show(selectedId);
}
