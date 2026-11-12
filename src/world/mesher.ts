import { WATER, faceColor, isOpaque, vegKind, type FaceKind } from './blocks';

/** ボクセルの格子。index = x + z*sx + y*sx*sz */
export interface Grid {
  sx: number;
  sy: number;
  sz: number;
  data: Uint8Array;
}

export interface MeshData {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  ao: Float32Array; // 0..1（1 = 遮蔽なし）
  veg: Float32Array;
  index: Uint32Array;
}

export interface MeshOptions {
  water?: boolean; // 水面だけを作る
  waterLevel?: number; // 水面の高さ（上面をこの分だけ下げる）
  waterDrop?: number;
  skipBottom?: boolean; // y=0 の下面を省略
  core?: { x0: number; x1: number; z0: number; z1: number }; // この範囲（X・Z）のボクセルの面だけ作る
}

/**
 * Greedy Meshing：同じ種類・同じ AO の隣接面を 1 枚の四角形にまとめる。
 * AO が面内で一様でない面はまとめない（AO の補間が崩れないように）。
 */
export function buildMesh(g: Grid, opt: MeshOptions = {}): MeshData {
  const { sx, sy, sz, data } = g;
  const water = !!opt.water;
  const waterDrop = opt.waterDrop ?? 0.15;
  const dims = [sx, sy, sz];
  const get = (x: number, y: number, z: number) =>
    x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? -1 : data[x + z * sx + y * sx * sz];

  const pos: number[] = [], nor: number[] = [], col: number[] = [], aos: number[] = [], veg: number[] = [], ind: number[] = [];
  const p = [0, 0, 0];
  const q = [0, 0, 0];
  const c = [0, 0, 0];
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3;
    const du = dims[u], dv = dims[v];
    const mask = new Int32Array(du * dv);
    const uniform = new Uint8Array(du * dv);
    const aoMask = new Uint8Array(du * dv * 4);

    for (const s of [1, -1]) {
      const kind: FaceKind = d === 1 ? (s > 0 ? 0 : 1) : 2;
      for (let xd = 0; xd < dims[d]; xd++) {
        if (opt.skipBottom && d === 1 && s < 0 && xd === 0) continue;
        mask.fill(0);
        let n = 0;
        for (let j = 0; j < dv; j++) {
          for (let i = 0; i < du; i++, n++) {
            p[d] = xd; p[u] = i; p[v] = j;
            const core = opt.core;
            if (core && (p[0] < core.x0 || p[0] >= core.x1 || p[2] < core.z0 || p[2] >= core.z1)) continue;
            const a = get(p[0], p[1], p[2]);
            if (water ? a !== WATER : !isOpaque(a)) continue;
            q[0] = p[0]; q[1] = p[1]; q[2] = p[2]; q[d] += s;
            const b = get(q[0], q[1], q[2]);
            if (water ? b === WATER || isOpaque(b) : isOpaque(b)) continue;

            let ao0 = 3, ao1 = 3, ao2 = 3, ao3 = 3;
            if (!water) {
              const aoAt = (su: number, sv: number) => {
                c[0] = q[0]; c[1] = q[1]; c[2] = q[2]; c[u] += su;
                const s1 = isOpaque(get(c[0], c[1], c[2]));
                c[u] -= su; c[v] += sv;
                const s2 = isOpaque(get(c[0], c[1], c[2]));
                c[u] += su;
                const cr = isOpaque(get(c[0], c[1], c[2]));
                return s1 && s2 ? 0 : 3 - ((s1 ? 1 : 0) + (s2 ? 1 : 0) + (cr ? 1 : 0));
              };
              ao0 = aoAt(-1, -1); ao1 = aoAt(1, -1); ao2 = aoAt(1, 1); ao3 = aoAt(-1, 1);
            }
            mask[n] = ((water ? 1 : a) + 1) | (ao0 << 8) | (ao1 << 10) | (ao2 << 12) | (ao3 << 14);
            uniform[n] = ao0 === ao1 && ao1 === ao2 && ao2 === ao3 ? 1 : 0;
            aoMask[n * 4] = ao0; aoMask[n * 4 + 1] = ao1; aoMask[n * 4 + 2] = ao2; aoMask[n * 4 + 3] = ao3;
          }
        }

        n = 0;
        for (let j = 0; j < dv; j++) {
          for (let i = 0; i < du; ) {
            const k = mask[n];
            if (k === 0) { i++; n++; continue; }
            let wd = 1, ht = 1;
            if (uniform[n]) {
              while (i + wd < du && mask[n + wd] === k && uniform[n + wd]) wd++;
              outer: while (j + ht < dv) {
                for (let kk = 0; kk < wd; kk++) {
                  const m = n + kk + ht * du;
                  if (mask[m] !== k || !uniform[m]) break outer;
                }
                ht++;
              }
            }
            const t = (k & 255) - 1;
            const a0 = aoMask[n * 4], a1 = aoMask[n * 4 + 1], a2 = aoMask[n * 4 + 2], a3 = aoMask[n * 4 + 3];
            const a = [a0, a1, a2, a3];
            const base = pos.length / 3;
            const plane = xd + (s > 0 ? 1 : 0);
            const rgb = water ? [0, 0, 0] : faceColor(t, kind);
            const vk = water ? 0 : vegKind(t, kind);
            for (let ci = 0; ci < 4; ci++) {
              const vtx = [0, 0, 0];
              vtx[d] = plane;
              vtx[u] = i + corners[ci][0] * wd;
              vtx[v] = j + corners[ci][1] * ht;
              if (water && vtx[1] === opt.waterLevel) vtx[1] -= waterDrop;
              pos.push(vtx[0], vtx[1], vtx[2]);
              const nn = [0, 0, 0]; nn[d] = s;
              nor.push(nn[0], nn[1], nn[2]);
              col.push(rgb[0], rgb[1], rgb[2]);
              aos.push(a[ci] / 3);
              veg.push(vk);
            }
            // AO の異方性を避けるため、対角線の向きを選ぶ
            const tris = a0 + a2 > a1 + a3 ? [0, 1, 2, 0, 2, 3] : [1, 2, 3, 1, 3, 0];
            if (s < 0) tris.reverse();
            for (const ti of tris) ind.push(base + ti);

            for (let hh = 0; hh < ht; hh++) for (let ww = 0; ww < wd; ww++) mask[n + ww + hh * du] = 0;
            i += wd; n += wd;
          }
        }
      }
    }
  }

  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nor),
    color: new Float32Array(col),
    ao: new Float32Array(aos),
    veg: new Float32Array(veg),
    index: new Uint32Array(ind),
  };
}

/** メッシュの頂点を平行移動・拡大縮小する（小物のボクセルを地面の単位に合わせる） */
export function transformMesh(m: MeshData, scale: number, ox: number, oy: number, oz: number): MeshData {
  const p = m.position;
  for (let i = 0; i < p.length; i += 3) {
    p[i] = (p[i] + ox) * scale;
    p[i + 1] = (p[i + 1] + oy) * scale;
    p[i + 2] = (p[i + 2] + oz) * scale;
  }
  return m;
}

/** チャンク（地形を X・Z 方向に CHUNK 個ずつ区切ったもの）の一辺 */
export const CHUNK = 64; // 区画（64×64）と同じ。メッシュの数を減らして描画命令の負荷を抑える

/**
 * 1 チャンク分のメッシュを作る。
 * 周りに 1 ボクセルの縁を付けて切り出し（AO と面の判定に隣のチャンクを使うため）、
 * 縁のボクセル自身の面は作らない。頂点は世界座標（ボクセル単位）で返す。
 */
export function buildChunk(voxels: Uint8Array, N: number, H: number, cx: number, cz: number, waterLevel: number) {
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const cw = Math.min(CHUNK, N - x0), cd = Math.min(CHUNK, N - z0);
  const sx = cw + 2, sz = cd + 2;
  const data = new Uint8Array(sx * H * sz);
  for (let y = 0; y < H; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const wx = x0 + x - 1, wz = z0 + z - 1;
    // 世界の外は空気（外周の断面が見えるように）
    data[x + z * sx + y * sx * sz] = wx < 0 || wz < 0 || wx >= N || wz >= N ? 0 : voxels[wx + wz * N + y * N * N];
  }
  const grid = { sx, sy: H, sz, data };
  const core = { x0: 1, x1: sx - 1, z0: 1, z1: sz - 1 };
  const terrain = transformMesh(buildMesh(grid, { skipBottom: true, core }), 1, x0 - 1, 0, z0 - 1);
  const water = transformMesh(buildMesh(grid, { water: true, waterLevel, skipBottom: true, core }), 1, x0 - 1, 0, z0 - 1);
  return { cx, cz, terrain, water };
}
