/**
 * 放っておくと変わる景色（設計メモ 0 章・1 章 6）。three.js に頼らない。
 *   ・土から草が生える：掘ったり盛ったりして土がむき出しになった列は、1 日ほどで草地になる
 *   ・森への移り変わり：木のまわりの草地に、ときどき苗木が生える（草原 → 小さな木 → 森）
 *   ・花畑 → 草原：花はときどき枯れて、草地に戻る
 * 移り変わりは箱庭の 1 日に 1 回。季節（現実の 1 か月）で目に見えるくらいの速さにする。
 * 岩場・湿地・砂浜は変わらない（苗木は草地にしか生えない）。
 */
export const DAY_MS = 24 * 60 * 60 * 1000;
/** むき出しの土が草地になるまで */
export const GRASS_GROW_MS = DAY_MS;
/** 1 本の木が、1 日に苗木を 1 本出す確率 */
export const SEED_CHANCE = 0.025;
/** 花が 1 日に枯れる確率 */
export const FADE_CHANCE = 0.01;
/** 苗木が生える距離（木の根元から 2〜3 列） */
export const SEED_MIN = 2, SEED_MAX = 3;
/** 閉じていた間に進める日数の上限 */
export const MAX_NATURE_DAYS = 60;

/** 草地になる時が来た列 */
export function grassDue(bareSince: ReadonlyMap<number, number>, now: number): number[] {
  const out: number[] = [];
  for (const [col, t] of bareSince) if (now - t >= GRASS_GROW_MS) out.push(col);
  return out;
}

/** 前に進めた日から、今日までに進める日数（上限つき）と、進めた後の日 */
export function natureDays(lastDay: number | undefined, simMs: number): { days: number; today: number } {
  const today = Math.floor(simMs / DAY_MS);
  if (lastDay === undefined || lastDay >= today) return { days: 0, today };
  return { days: Math.min(MAX_NATURE_DAYS, today - lastDay), today };
}

/**
 * 1 日ぶん：木のまわりに苗木を生やす。canGrow(col)：その列に苗木が生えられるか（草地で、ほかの木や建物がないなど）。
 * 同じ日に生えた苗木どうしも、となり合わないようにする
 */
export function spreadTrees(trees: Iterable<number>, size: number, canGrow: (col: number) => boolean, rand: () => number): number[] {
  const out: number[] = [];
  const near = (col: number) => out.some((c) => Math.abs((c % size) - (col % size)) <= 1 && Math.abs(Math.floor(c / size) - Math.floor(col / size)) <= 1);
  for (const t of trees) {
    if (rand() >= SEED_CHANCE) continue;
    const x = t % size, z = Math.floor(t / size);
    const r = SEED_MIN + Math.floor(rand() * (SEED_MAX - SEED_MIN + 1));
    // 根元から r 列離れた輪の上の 1 点
    const side = Math.floor(rand() * 4), k = Math.floor(rand() * (2 * r + 1)) - r;
    const [dx, dz] = side === 0 ? [k, -r] : side === 1 ? [r, k] : side === 2 ? [-k, r] : [-r, -k];
    const nx = x + dx, nz = z + dz;
    if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
    const col = nx + nz * size;
    if (!canGrow(col) || near(col)) continue;
    out.push(col);
  }
  return out;
}

/** 1 日ぶん：枯れる花の列 */
export function fadeFlowers(cols: Iterable<number>, rand: () => number): number[] {
  const out: number[] = [];
  for (const c of cols) if (rand() < FADE_CHANCE) out.push(c);
  return out;
}
