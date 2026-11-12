import { makeNoise2D, mulberry32 } from './noise';
import { DIRT, GRASS, SAND, STONE, WATER } from './blocks';

/** 小物（木・花）の配置。地面のボクセル座標で持つ */
export interface Placement {
  variant: number;
  x: number; // 列の中心からのずれを含む（ボクセル単位）
  y: number;
  z: number;
  rot: number; // ラジアン
  scale: number;
}

export interface World {
  size: number; // X・Z 方向のボクセル数
  height: number; // Y 方向のボクセル数
  waterLevel: number; // 水面の高さ（この高さ未満が水）
  voxels: Uint8Array; // index = x + z*size + y*size*size
  heights: Int16Array; // 列ごとの地表の高さ（固体ボクセルの個数）
  walkable: Uint8Array; // 住人が歩ける列なら 1
  trees: Placement[];
  flowers: Placement[];
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const TREE_VARIANTS = 6; // 0-3: 広葉樹, 4-5: 針葉樹
export const FLOWER_VARIANTS = 3;

export function generateWorld(size: number, height: number, seed: number): World {
  const N = size;
  const H = height;
  const WL = 10;
  const voxels = new Uint8Array(N * N * H);
  const heights = new Int16Array(N * N);
  const n1 = makeNoise2D(seed);
  const n2 = makeNoise2D(seed + 1013);
  const n3 = makeNoise2D(seed + 2027);
  const n4 = makeNoise2D(seed + 3041);
  const rand = mulberry32(seed + 77);
  const riverPhase = rand() * Math.PI * 2;

  const fbm = (x: number, z: number) => {
    let a = 0, amp = 1, f = 1, sum = 0;
    for (let o = 0; o < 4; o++) { a += n1(x * f, z * f) * amp; sum += amp; amp *= 0.5; f *= 2; }
    return a / sum;
  };

  // 1. 地形の高さ
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      let h = 12.5 + fbm(x / 48, z / 48) * 7 + Math.max(0, n2(x / 30, z / 30)) * 9;
      // 大きな起伏（広いフィールドで山と谷ができる）
      h += Math.max(0, n4(x / 90, z / 90)) * 12;
      // 湖：低周波ノイズの窪地
      const lake = n3(x / 70 + 40, z / 70 - 20);
      if (lake > 0.35) h -= (lake - 0.35) * 30;
      // 川：X 方向に蛇行しながら流れる
      const cz = N * 0.5 + Math.sin(x * 0.07 + riverPhase) * Math.min(N, 96) * 0.15 + n2(x * 0.03, 5.3) * Math.min(N, 128) * 0.08;
      const d = Math.abs(z - cz);
      const rw = 2.2 + 0.8 * Math.sin(x * 0.13 + riverPhase) + (N > 128 ? 1 : 0);
      if (d < rw + 7) h = WL - 2.2 + (h - (WL - 2.2)) * smoothstep(rw, rw + 7, d);
      h = Math.max(3, Math.min(H - 6, Math.round(h)));
      heights[x + z * N] = h;

      // 地表の種類：同じ高さでも場所によって砂・土・岩・草が入り混じるようにする
      const beach = n2(x / 12 + 50, z / 12);
      const rocky = n1(x / 18 + 300, z / 18);
      const bare = n3(x / 14 - 200, z / 14);
      let top: number;
      if (h - 1 <= WL) top = SAND;
      else if (h - 1 <= WL + 2 && beach > -0.1) top = SAND; // 砂浜が内陸に入り込む
      else if (h > 27 || rocky > 0.5) top = STONE; // 岩場
      else if (bare > 0.55) top = DIRT; // 土がむき出しの所
      else top = GRASS;
      for (let y = 0; y < h; y++) {
        let t: number;
        if (y < h - 4) t = STONE;
        else if (y < h - 1) t = top === STONE ? STONE : DIRT;
        else t = top;
        voxels[x + z * N + y * N * N] = t;
      }
      for (let y = h; y < WL; y++) voxels[x + z * N + y * N * N] = WATER;
    }
  }

  const topAt = (x: number, z: number) => voxels[x + z * N + (heights[x + z * N] - 1) * N * N];

  // 2. 歩ける列（上が空気で、地表が草・砂・土）
  const walkable = new Uint8Array(N * N);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const top = topAt(x, z);
    walkable[x + z * N] = top === GRASS || top === SAND || top === DIRT ? 1 : 0;
  }

  // 3. 木（地面のボクセルとは別の小物として配置する）
  const trees: Placement[] = [];
  const occupied = new Uint8Array(N * N);
  for (let z = 2; z < N - 2; z++) {
    for (let x = 2; x < N - 2; x++) {
      const h = heights[x + z * N];
      if (topAt(x, z) !== GRASS || h - 1 <= WL + 1) continue;
      const forest = n3(x / 22, z / 22);
      const p = forest > 0.15 ? 0.07 : 0.008;
      if (rand() > p) continue;
      let blocked = false;
      for (let dz = -2; dz <= 2 && !blocked; dz++) for (let dx = -2; dx <= 2; dx++) if (occupied[x + dx + (z + dz) * N]) { blocked = true; break; }
      if (blocked) continue;
      occupied[x + z * N] = 1;
      walkable[x + z * N] = 0;
      // 高い所ほど針葉樹
      const conifer = h > 19 ? rand() < 0.75 : rand() < 0.15;
      const variant = conifer ? 4 + Math.floor(rand() * 2) : Math.floor(rand() * 4);
      trees.push({ variant, x: x + 0.5, y: h, z: z + 0.5, rot: Math.floor(rand() * 4) * (Math.PI / 2), scale: 0.85 + rand() * 0.35 });
    }
  }

  // 4. 花（草地に散らばせる。木の根元は避ける）
  const flowers: Placement[] = [];
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      if (topAt(x, z) !== GRASS || occupied[x + z * N]) continue;
      const meadow = n1(x / 15 + 100, z / 15);
      if (rand() > (meadow > 0.2 ? 0.12 : 0.015)) continue;
      const variant = Math.floor((n2(x / 9, z / 9) * 0.5 + 0.5) * FLOWER_VARIANTS * 0.999 + rand() * 0.6) % FLOWER_VARIANTS;
      flowers.push({ variant, x: x + 0.2 + rand() * 0.6, y: heights[x + z * N], z: z + 0.2 + rand() * 0.6, rot: rand() * Math.PI * 2, scale: 0.8 + rand() * 0.4 });
    }
  }

  return { size: N, height: H, waterLevel: WL, voxels, heights, walkable, trees, flowers };
}

/** メインスレッドに渡す地形データ（小物の配置は別に送る） */
export type WorldData = Omit<World, 'trees' | 'flowers'>;
