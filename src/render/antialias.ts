/**
 * アンチエイリアス（ギザギザを消す方法）の種類。デバッグで切り替えて、重さと見た目を比べる。
 *
 * - off：なし。いちばん軽い
 * - msaa：MSAA 4x。描く時に 1 画素を 4 か所で調べる（形のふちだけ効く。MRT の法線の分も 4 倍になる）
 * - fxaa：FXAA。描き終わった絵のふちをぼかす（軽い。少しぼやける）
 * - smaa：SMAA。ふちの形を調べてから混ぜる（FXAA より少し重く、くっきり）
 * - traa：TRAA。カメラを毎フレーム少しずらし、前のフレームと混ぜる（動いた物は少し残像が出る）
 * - taau：TAAU。TRAA と同じことを、低い解像度で描いた絵から元の解像度へ広げながら行う（「描く解像度」と組み合わせて軽くする）
 */
export const AA_MODES = ['off', 'msaa', 'fxaa', 'smaa', 'traa', 'taau'] as const;
export type AAMode = (typeof AA_MODES)[number];

export const AA_NAMES: Record<AAMode, string> = {
  off: 'なし',
  msaa: 'MSAA 4x',
  fxaa: 'FXAA',
  smaa: 'SMAA',
  traa: 'TRAA（時間方向）',
  taau: 'TAAU（低い解像度から広げる）',
};

export interface AASpec {
  /** 場面を描く時の MSAA のサンプル数（0 なら使わない） */
  samples: number;
  /** 動きの向き（速度）を一緒に描くか（時間方向の方法で使う） */
  velocity: boolean;
  /** 描き終わった絵にかける処理 */
  post: 'none' | 'fxaa' | 'smaa';
  /** 場面の色にかける時間方向の処理 */
  temporal: 'none' | 'traa' | 'taau';
}

export function aaSpec(mode: AAMode): AASpec {
  switch (mode) {
    case 'off': return { samples: 0, velocity: false, post: 'none', temporal: 'none' };
    case 'msaa': return { samples: 4, velocity: false, post: 'none', temporal: 'none' };
    case 'fxaa': return { samples: 0, velocity: false, post: 'fxaa', temporal: 'none' };
    case 'smaa': return { samples: 0, velocity: false, post: 'smaa', temporal: 'none' };
    // 時間方向の方法は MSAA と一緒に使えない
    case 'traa': return { samples: 0, velocity: true, post: 'none', temporal: 'traa' };
    case 'taau': return { samples: 0, velocity: true, post: 'none', temporal: 'taau' };
  }
}

/** 場面を描く解像度（画面の画素に対する割合） */
export const RENDER_SCALES = [1, 0.75, 0.5] as const;

export function isAAMode(v: string): v is AAMode {
  return (AA_MODES as readonly string[]).includes(v);
}
