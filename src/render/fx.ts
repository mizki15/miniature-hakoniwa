import * as THREE from 'three/webgpu';
import { float, instancedDynamicBufferAttribute, texture, uv, vec2 } from 'three/tsl';

/**
 * パーティクル（v0.21.0。docs/エフェクト一覧.md の VFX）：全部の粒を 1 つの Sprite（インスタンス描画）で描く。
 * 絵は 1 枚のアトラス（public/fx/atlas.png。8 × 8 マス、1 マス 256 px）。読めるまでは、canvas で描いた仮の絵を使う。
 * 粒の動き（重さ・空気の抵抗・回転・大きさの変化・消え方）は CPU で進め、位置・色・絵・大きさを毎フレーム GPU へ送る
 */

/** アトラスのマスの並び（docs/エフェクト一覧.md 9.2 の番号。ここでの順がマスの番号） */
export const FX_SPRITES = [
  'heart', 'heart2', 'note', 'z', 'sparkle', 'sparkleSmall', 'glow', 'drop',
  'splash', 'clod1', 'clod2', 'clod3', 'chip1', 'chip2', 'chip3', 'splinter1',
  'splinter2', 'leaf1', 'leaf2', 'leaf3', 'petal1', 'petal2', 'blade', 'dust1',
  'dust2', 'dust3', 'steam', 'snowflake', 'question', 'exclaim', 'house', 'gift',
  'confetti1', 'confetti2', 'confetti3', 'seed', 'crumb', 'feather', 'hammer', 'beam',
  'swirl',
] as const;
export type FxSprite = (typeof FX_SPRITES)[number];
const CELL = 256, GRID = 8;

/** 粒の出し方 */
export interface Burst {
  sprite: FxSprite | FxSprite[];
  at: { x: number; y: number; z: number };
  count: number;
  /** 色（白い絵に掛ける。配列なら粒ごとに選ぶ）。無ければ白（絵の色そのまま） */
  color?: number | number[];
  /** 出る位置のばらつき（半径） */
  jitter?: number;
  /** 速さ（最小・最大）と、上向きの強さ（0 なら水平に広がる、1 ならほぼ真上） */
  speed?: [number, number];
  up?: number;
  /** 重さ（下向きの加速度。マス/秒²）。負なら浮かぶ */
  gravity?: number;
  /** 空気の抵抗（1 秒あたり） */
  drag?: number;
  /** 寿命（秒。最小・最大） */
  life?: [number, number];
  /** 大きさ（マス。最小・最大）と、消える時の倍率 */
  size?: [number, number];
  endSize?: number;
  /** 回転の速さ（ラジアン/秒の最大） */
  spin?: number;
  /** 出るまでの遅れ（秒。粒ごとに 0〜delay） */
  delay?: number;
  /** 左右にゆらゆら（花びら・葉・雪） */
  sway?: number;
  /** 一定の速さで昇る（ハート・Z など）。speed より優先 */
  rise?: number;
  /** 不透明度の最大（0〜1） */
  alpha?: number;
}

interface P {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  age: number; life: number; delay: number; size0: number; size1: number; rot: number; spin: number;
  r: number; g: number; b: number; a: number; cell: number; gravity: number; drag: number; sway: number; phase: number;
}

const MAX = 768;

export class Fx {
  readonly object: THREE.Sprite;
  private parts: P[] = [];
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 4);
  private rect = new Float32Array(MAX * 4);
  private sr = new Float32Array(MAX * 2);
  private aPos: THREE.InstancedBufferAttribute;
  private aCol: THREE.InstancedBufferAttribute;
  private aRect: THREE.InstancedBufferAttribute;
  private aSr: THREE.InstancedBufferAttribute;
  private atlas: THREE.Texture;
  /** 箱庭の中心（マスの座標 → 描く座標の差。controller と同じ） */
  half = 0;

  constructor(atlasUrl: string) {
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3);
    this.aCol = new THREE.InstancedBufferAttribute(this.col, 4);
    this.aRect = new THREE.InstancedBufferAttribute(this.rect, 4);
    this.aSr = new THREE.InstancedBufferAttribute(this.sr, 2);
    for (const a of [this.aPos, this.aCol, this.aRect, this.aSr]) a.setUsage(THREE.DynamicDrawUsage);
    this.atlas = fallbackAtlas();
    // 本物のアトラスが読めたら差し替える
    new THREE.TextureLoader().load(atlasUrl, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      this.atlas.image = t.image;
      this.atlas.needsUpdate = true;
    }, undefined, () => { /* まだ無ければ仮の絵のまま */ });

    const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rect: any = instancedDynamicBufferAttribute(this.aRect, 'vec4');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const col: any = instancedDynamicBufferAttribute(this.aCol, 'vec4');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sr: any = instancedDynamicBufferAttribute(this.aSr, 'vec2');
    m.positionNode = instancedDynamicBufferAttribute(this.aPos, 'vec3');
    // アトラスのマスを切り出す（v は下から上）
    const tex = texture(this.atlas, uv().mul(vec2(rect.z, rect.w)).add(vec2(rect.x, rect.y)));
    m.colorNode = tex.mul(col);
    m.scaleNode = vec2(sr.x, sr.x);
    m.rotationNode = float(sr.y);
    m.fog = false;
    const s = new THREE.Sprite(m);
    s.count = MAX;
    s.frustumCulled = false;
    s.renderOrder = 20;
    this.object = s;
  }

  /** 粒を出す（箱庭のマスの座標で。y は高さ） */
  burst(b: Burst) {
    const n = Math.max(0, Math.min(b.count, MAX - this.parts.length));
    const sprites = Array.isArray(b.sprite) ? b.sprite : [b.sprite];
    const colors = b.color === undefined ? [0xffffff] : Array.isArray(b.color) ? b.color : [b.color];
    const [s0, s1] = b.speed ?? [0.6, 1.4];
    const [l0, l1] = b.life ?? [0.6, 1.0];
    const [z0, z1] = b.size ?? [0.12, 0.2];
    const up = b.up ?? 0.6, j = b.jitter ?? 0.15;
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = s0 + Math.random() * (s1 - s0);
      const horiz = Math.sqrt(Math.max(0, 1 - up * up));
      c.setHex(colors[Math.floor(Math.random() * colors.length)]);
      const size0 = z0 + Math.random() * (z1 - z0);
      this.parts.push({
        x: b.at.x + (Math.random() - 0.5) * 2 * j, y: b.at.y + Math.random() * j, z: b.at.z + (Math.random() - 0.5) * 2 * j,
        vx: b.rise !== undefined ? (Math.random() - 0.5) * 0.15 : Math.cos(a) * sp * horiz,
        vy: b.rise ?? sp * up,
        vz: b.rise !== undefined ? (Math.random() - 0.5) * 0.15 : Math.sin(a) * sp * horiz,
        age: 0, life: l0 + Math.random() * (l1 - l0), delay: Math.random() * (b.delay ?? 0),
        size0, size1: size0 * (b.endSize ?? 1), rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 2 * (b.spin ?? 0),
        r: c.r, g: c.g, b: c.b, a: b.alpha ?? 1,
        cell: FX_SPRITES.indexOf(sprites[Math.floor(Math.random() * sprites.length)]),
        gravity: b.gravity ?? 6, drag: b.drag ?? 0.8, sway: b.sway ?? 0, phase: Math.random() * 10,
      });
    }
  }

  /** 毎フレーム呼ぶ */
  update(dt: number) {
    const ps = this.parts;
    let k = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.delay > 0) { p.delay -= dt; ps[k++] = p; continue; }
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vy -= p.gravity * dt;
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d; p.vz *= d; if (p.gravity <= 0) p.vy *= d;
      p.x += p.vx * dt + (p.sway ? Math.sin(p.age * 4 + p.phase) * p.sway * dt : 0);
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rot += p.spin * dt;
      ps[k++] = p;
    }
    ps.length = k;
    // GPU へ（生きている粒だけ。残りは大きさ 0）
    const H = this.half;
    let n = 0;
    for (const p of ps) {
      if (p.delay > 0) continue;
      const t = p.age / p.life;
      const fade = Math.min(1, t / 0.08) * Math.min(1, (1 - t) / 0.35);
      this.pos[n * 3] = p.x - H; this.pos[n * 3 + 1] = p.y; this.pos[n * 3 + 2] = p.z - H;
      this.col[n * 4] = p.r; this.col[n * 4 + 1] = p.g; this.col[n * 4 + 2] = p.b; this.col[n * 4 + 3] = p.a * fade;
      const cx = p.cell % GRID, cy = Math.floor(p.cell / GRID);
      this.rect[n * 4] = cx / GRID; this.rect[n * 4 + 1] = 1 - (cy + 1) / GRID; this.rect[n * 4 + 2] = 1 / GRID; this.rect[n * 4 + 3] = 1 / GRID;
      this.sr[n * 2] = p.size0 + (p.size1 - p.size0) * t; this.sr[n * 2 + 1] = p.rot;
      n++;
    }
    for (let i = n; i < this.lastN; i++) { this.sr[i * 2] = 0; this.col[i * 4 + 3] = 0; }
    if (n || this.lastN) for (const a of [this.aPos, this.aCol, this.aRect, this.aSr]) a.needsUpdate = true;
    this.lastN = n;
    this.object.visible = n > 0;
  }
  private lastN = 0;

  /** いま出ている粒の数（デバッグ・テスト用） */
  get alive() { return this.parts.length; }
}

/** アトラスがまだ無い時の仮の絵（canvas で描く。形だけ分かればよい） */
function fallbackAtlas(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = CELL * GRID;
  const g = cv.getContext('2d')!;
  FX_SPRITES.forEach((id, i) => {
    const x = (i % GRID) * CELL + CELL / 2, y = Math.floor(i / GRID) * CELL + CELL / 2;
    g.save();
    g.translate(x, y);
    g.fillStyle = '#ffffff';
    const emoji: Partial<Record<FxSprite, string>> = { heart: '❤', heart2: '💗', note: '♪', z: 'Z', question: '？', exclaim: '！', house: '🏠', gift: '🎁', hammer: '🔨', snowflake: '❄' };
    if (emoji[id]) {
      g.font = `${CELL * 0.6}px "Segoe UI Emoji", sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = id === 'heart' || id === 'heart2' ? '#ff6b8a' : id === 'z' ? '#9cc8ff' : '#fff6d8';
      g.fillText(emoji[id]!, 0, 0);
    } else if (id.startsWith('sparkle')) {
      const r = id === 'sparkle' ? CELL * 0.42 : CELL * 0.3;
      g.beginPath();
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2, rr = k % 2 ? r * 0.22 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      g.closePath(); g.fill();
    } else if (id === 'glow' || id.startsWith('dust') || id === 'steam') {
      const grd = g.createRadialGradient(0, 0, 0, 0, 0, CELL * 0.45);
      grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(0, 0, CELL * 0.45, 0, Math.PI * 2); g.fill();
    } else if (id === 'beam') {
      const grd = g.createLinearGradient(-CELL * 0.2, 0, CELL * 0.2, 0);
      grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.5, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(-CELL * 0.2, -CELL * 0.48, CELL * 0.4, CELL * 0.96);
    } else if (id === 'drop' || id === 'splash') {
      g.fillStyle = '#9fd4ff'; g.beginPath(); g.arc(0, CELL * 0.1, CELL * 0.22, 0, Math.PI * 2); g.fill();
    } else if (id.startsWith('leaf') || id.startsWith('petal') || id === 'feather' || id === 'blade') {
      g.rotate(0.6); g.beginPath(); g.ellipse(0, 0, CELL * 0.4, id === 'blade' ? CELL * 0.06 : CELL * 0.18, 0, 0, Math.PI * 2); g.fill();
    } else {
      // かけら・木くず・紙吹雪・種・食べかす：角ばった形
      g.rotate(i * 0.7);
      g.fillRect(-CELL * 0.26, -CELL * 0.2, CELL * 0.52, CELL * 0.4);
    }
    g.restore();
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
