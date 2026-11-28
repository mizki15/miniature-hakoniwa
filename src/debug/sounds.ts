/**
 * 開発用（v0.21.2）：効果音を ID ごとに聴くページ（sounds.html）。本番のビルドには入らない。
 * 「▶」はゲームと同じ処理（audio/bank.ts の voiceFor：長さの上限・大きさ・速さ・こもり・楽器の音・鳴らすたびの揺らぎ）を通した音。
 * 大きさはゲームの段（sfx.ts の TIER_GAIN。環境音・時間で起きる変化・操作・ほうび）を掛ける。「録音」は書き出したファイルそのまま。
 * bank.ts を書き換えると、このページも読み直される（Vite）
 */
import { CUES, audioOut, loadSounds, normGain, soundBuffer, voiceFor } from '../audio/bank';
import { TIER_GAIN, tierOf } from '../audio/sfx';
import { sfxName } from '../audio/names';

const BASE = import.meta.env.BASE_URL;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const LOOPS = ['amb-wind', 'amb-stream', 'amb-rain', 'amb-leaves', 'amb-birds', 'amb-dawn', 'amb-night', 'amb-frogs'];
const LOOP_NAMES: Record<string, string> = { 'amb-wind': '風', 'amb-stream': 'せせらぎ', 'amb-rain': '雨', 'amb-leaves': '葉ずれ', 'amb-birds': '昼の鳥', 'amb-dawn': '朝の鳥', 'amb-night': '夜の虫', 'amb-frogs': 'カエル' };
const TIER_NAME = { bed: '環境音', passive: '時間で起きる変化', action: '操作', reward: 'ほうび' } as const;
const GROUPS: [string, string][] = [['A', '見るモードの操作'], ['B', 'エディタの道具'], ['C', '植物と地面'], ['D', '生き物'], ['E', '天気・時刻・季節'], ['F', '進み具合・画面']];

let ready: Promise<void> | null = null;
/** 最初のクリックで音の出口を開き、録音を全部読み込む */
const start = () => {
  const { ctx } = audioOut();
  void ctx.resume();
  if (!ready) {
    const files = new Set([...Object.values(CUES).flatMap((c) => (c.f ? [c.f] : [])), ...LOOPS]);
    ready = loadSounds(BASE, files).then(() => { $('status').textContent = `読み込み済み（録音 ${files.size} 個）`; });
  }
  return ready;
};

const vol = () => Number($<HTMLInputElement>('vol').value);
const pan = () => Number($<HTMLInputElement>('pan').value);

/** ゲームと同じ処理で鳴らす */
async function playCue(id: string) {
  await start();
  const c = CUES[id];
  voiceFor(c)({ pan: pan(), gain: TIER_GAIN[tierOf(id)] * vol() });
  $('now').textContent = `▶ ${id} ${sfxName(id)}`;
}
/** 録音をそのまま（ピークをそろえる倍率だけ） */
async function playRaw(f: string) {
  await start();
  const { ctx, sfx } = audioOut();
  const buf = soundBuffer(f);
  if (!buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = normGain(f) * 0.6 * vol();
  src.connect(g).connect(sfx);
  src.start();
  $('now').textContent = `▶ 録音 ${f}.ogg（${buf.duration.toFixed(2)} 秒）`;
}

const describe = (id: string) => {
  const c = CUES[id];
  const p: string[] = [];
  if (c.f) p.push(`録音 <code>${c.f}.ogg</code>`);
  if (c.max != null) p.push(`長さ ${c.max} 秒まで`);
  if (c.g != null) p.push(`大きさ ×${c.g}`);
  if (c.rate != null) p.push(`速さ ×${c.rate}`);
  if (c.lp != null) p.push(`こもり ${c.lp} Hz`);
  if (c.tones?.length) p.push(`楽器 ${c.tones.map((t) => `${t.i}${t.n ? ` ${t.n}` : ''}`).join('・')}`);
  if (c.vary === false) p.push('揺らぎなし');
  return p.join(' · ');
};

// 一覧
const list = $('list');
for (const [g, title] of GROUPS) {
  const ids = Object.keys(CUES).filter((id) => id.startsWith(g));
  if (!ids.length) continue;
  const h = document.createElement('h2');
  h.textContent = `${g}：${title}（${ids.length}）`;
  list.appendChild(h);
  const table = document.createElement('table');
  for (const id of ids) {
    const c = CUES[id];
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><button class="play">▶</button></td><td><b>${id}</b></td><td>${sfxName(id)}<br><small>${describe(id)}</small></td><td><small>${TIER_NAME[tierOf(id)]}</small></td><td>${c.f ? '<button class="raw">録音</button>' : ''}</td>`;
    tr.querySelector<HTMLButtonElement>('.play')!.addEventListener('click', () => void playCue(id));
    tr.querySelector<HTMLButtonElement>('.raw')?.addEventListener('click', () => void playRaw(c.f!));
    tr.dataset.id = id;
    table.appendChild(tr);
  }
  list.appendChild(table);
}

// 環境音のループ（1 つずつ鳴らす・止める）
const loopsEl = $('loops');
const playing = new Map<string, { src: AudioBufferSourceNode; g: GainNode }>();
for (const n of LOOPS) {
  const b = document.createElement('button');
  b.textContent = `▶ ${LOOP_NAMES[n]}`;
  b.addEventListener('click', async () => {
    await start();
    const cur = playing.get(n);
    if (cur) { cur.src.stop(); playing.delete(n); b.textContent = `▶ ${LOOP_NAMES[n]}`; b.classList.remove('on'); return; }
    const { ctx, amb } = audioOut();
    const buf = soundBuffer(n);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const g = ctx.createGain();
    g.gain.value = normGain(n) * 0.35 * vol();
    src.connect(g).connect(amb);
    src.start();
    playing.set(n, { src, g });
    b.textContent = `■ ${LOOP_NAMES[n]}（${buf.duration.toFixed(1)} 秒）`;
    b.classList.add('on');
  });
  loopsEl.appendChild(b);
}

// 全部を順に鳴らす
$('all').addEventListener('click', async () => {
  await start();
  const rows = [...document.querySelectorAll<HTMLTableRowElement>('tr[data-id]')];
  for (const tr of rows) {
    if (!$<HTMLInputElement>('allRun').checked) break;
    tr.classList.add('cur');
    tr.scrollIntoView({ block: 'center' });
    await playCue(tr.dataset.id!);
    await new Promise((r) => setTimeout(r, Number($<HTMLInputElement>('gap').value) * 1000));
    tr.classList.remove('cur');
  }
});
$('status').textContent = `${Object.keys(CUES).length} 個の ID。最初の ▶ で読み込みます`;
(window as unknown as { __sounds: unknown }).__sounds = { playCue, playRaw, start, audioOut };
