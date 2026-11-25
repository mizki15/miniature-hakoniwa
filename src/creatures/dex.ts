import { ACTIVITY_NAMES, SPECIES, type Animal, type Species } from './animals';
import type { Visitor } from './visitors';
import { DEX_ORDER, RARITY_STARS, RESIDENT_ORDER, RESIDENT_TEXT, VISITOR, isVisitorId, visitorLikes, rarityOf, type DexId } from '../eco/species';
import { dexStage, type Dex } from '../eco/dexState';
import { JOB_TEXT, homeText } from '../eco/residents';
import { SEASON_NAMES } from '../calendar';
import { LAND_NAMES, sharePct, type EnvCounts, type Land } from '../eco/environment';
import { shareStars, starText } from '../eco/species';

/** 図鑑の上に出す「いまの箱庭」：土地の型の割合と野生度を、星で大まかに */
const SUMMARY_LANDS: Land[] = ['forest', 'meadow', 'flowerField', 'farm', 'waterside', 'deepWater', 'rock', 'wetland', 'beach'];
export function envSummaryHtml(e: EnvCounts): string {
  const row = (name: string, stars: number) => `<span class="dex-env-item"><span class="dex-env-name">${name}</span><span class="dex-env-stars">${starText(stars)}</span></span>`;
  return SUMMARY_LANDS.map((l) => row(LAND_NAMES[l], shareStars(sharePct(e, l)))).join('') + row('野生度', e.wild);
}

/**
 * 生き物図鑑：住人 16 種と訪問者 24 種。
 *   ？？？：ヒントだけ／見かけた：シルエット（名前はまだ出さない）／観察した：名前・説明・好きな環境・観察した季節
 */
const nameOf = (id: DexId) => (isVisitorId(id) ? VISITOR[id].name : SPECIES[id as Species].name);
const iconOf = (id: DexId) => (isVisitorId(id) ? VISITOR[id].icon : SPECIES[id as Species].icon);
const hintOf = (id: DexId) => (isVisitorId(id) ? VISITOR[id].hint : RESIDENT_TEXT[id as Species].hint);

/**
 * 図鑑のカードを並べる。説明はカードにしばらくカーソルを合わせた時だけ出す（tip で、カードと説明の HTML を渡す）
 */
export function renderDex(grid: HTMLElement, dex: Dex, animals: Animal[], visitors: Visitor[], env: EnvCounts, tip: (card: HTMLElement, html: () => string) => void) {
  grid.innerHTML = '';
  const summary = document.createElement('div');
  summary.className = 'dex-env';
  summary.innerHTML = `<div class="dex-head">いまの箱庭</div>${envSummaryHtml(env)}`;
  grid.appendChild(summary);
  const observed = DEX_ORDER.filter((id) => dexStage(dex, id) === 'observed').length;
  const head = (text: string) => { const h = document.createElement('div'); h.className = 'dex-head'; h.textContent = text; grid.appendChild(h); };
  head(`観察 ${observed} / ${DEX_ORDER.length}　・　住人`);

  const describe = (id: DexId): string => {
    const stage = dexStage(dex, id);
    if (stage !== 'observed') {
      return `<b>？？？</b><br>${hintOf(id)}` +
        (stage === 'seen' ? '<br><span class="dex-muted">箱庭で、カーソルをしばらく合わせると観察できる</span>' : '');
    }
    const e = dex[id];
    const seasons = SEASON_NAMES.map((n, i) => `<span class="dex-season${e.seasons.includes(i) ? ' on' : ''}">${n}</span>`).join('');
    if (isVisitorId(id)) {
      const v = VISITOR[id];
      const here = visitors.some((x) => x.def.id === id) ? '<br>いま箱庭にいる' : '';
      return `<b>${v.icon} ${v.name}</b>　${RARITY_STARS[v.rarity]}<br>${v.note}<br>好きな環境：${visitorLikes(v)}<br>観察した季節：${seasons}${here}`;
    } else {
      const sp = id as Species, info = SPECIES[sp];
      const members = animals.filter((a) => a.species === sp).map((a) => `${a.name}（${ACTIVITY_NAMES[a.activity]}）`).join('、') || 'いまはいない';
      return `<b>${info.icon} ${info.name}</b>　${RARITY_STARS[rarityOf(id)]}<br>${info.note}<br>好きな環境：${RESIDENT_TEXT[sp].likes}<br>好きな家：${homeText(sp)}<br>仕事：${JOB_TEXT[sp]}<br>観察した季節：${seasons}<br>住人：${members}`;
    }
  };

  DEX_ORDER.forEach((id, i) => {
    if (i === RESIDENT_ORDER.length) head('訪問者');
    const stage = dexStage(dex, id);
    const card = document.createElement('div');
    card.className = `dex-card ${stage}`;
    const count = isVisitorId(id) ? (visitors.some((v) => v.def.id === id) ? 'いる' : '') : (() => { const n = animals.filter((a) => a.species === id).length; return n ? `${n} 匹` : ''; })();
    card.innerHTML = stage === 'unknown'
      ? '<div class="dex-icon">?</div><div class="dex-name">？？？</div>'
      : `<div class="dex-icon"><span class="dex-emoji">${iconOf(id)}</span></div><div class="dex-name">${stage === 'seen' ? '？？？' : nameOf(id)}</div>` +
        (stage === 'observed' && count ? `<div class="dex-count">${count}</div>` : '');
    tip(card, () => describe(id));
    grid.appendChild(card);
  });
}
