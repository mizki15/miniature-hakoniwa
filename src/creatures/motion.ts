/**
 * 生き物の動きの共通の計算（向きの回し方・速さの変え方・歩き方の姿勢）。
 * 動物のモデルは 1 つのメッシュにまとめてあり、足は別々に動かせないので、体全体の上下・傾き・つぶれで歩いて見せる
 */

/** 角度を -π..π に直す */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/** 向き from を to へ、近い回り方で最大 step だけ回す */
export function turnToward(from: number, to: number, step: number): number {
  const d = wrapAngle(to - from);
  return Math.abs(d) <= step ? to : from + Math.sign(d) * step;
}

/** 値 cur を target へ、最大 step だけ近づける */
export function approach(cur: number, target: number, step: number): number {
  return Math.abs(target - cur) <= step ? target : cur + Math.sign(target - cur) * step;
}

/** 跳ねる時の高さ（u：0..1 の 1 回の跳ねの進み。最初と最後は地面、真ん中が 1） */
export function hopArc(u: number): number {
  if (u <= 0 || u >= 1) return 0;
  return 4 * u * (1 - u);
}

/**
 * 歩き方。
 * - hop：跳ねる（うさぎ・りす）。跳ぶ時に前へ傾き、着地で少しつぶれる
 * - waddle：よちよち（あひる）。左右に大きく揺れる
 * - walk：ふつうに歩く。一歩ごとに少し上下し、わずかに左右へ揺れる
 */
export const GAITS = ['hop', 'waddle', 'walk'] as const;
export type Gait = (typeof GAITS)[number];

export interface Pose { lift: number; pitch: number; roll: number; squash: number }

/**
 * 歩いている時の姿勢。phase：歩いた距離に合わせて進む位相（ラジアン）。amp：跳ねの高さ。
 * pace：0..1（止まっている〜全速）。止まっている時は動かない
 */
export function gaitPose(gait: Gait, phase: number, amp: number, pace: number): Pose {
  if (pace <= 0) return { lift: 0, pitch: 0, roll: 0, squash: 1 };
  switch (gait) {
    case 'hop': {
      // 1 回の跳ね＝位相 π。跳ねの前半は鼻先が上がり（蹴り出し）、後半は下がる（着地へ向かう）
      const u = (phase % Math.PI) / Math.PI;
      const air = hopArc(u);
      const land = u < 0.12 ? 1 - u / 0.12 : 0; // 着地した直後
      return { lift: air * amp * pace, pitch: (u - 0.5) * 0.5 * pace, roll: 0, squash: 1 - land * 0.18 * pace };
    }
    case 'waddle':
      return { lift: Math.abs(Math.sin(phase)) * amp * pace, pitch: 0, roll: Math.sin(phase) * 0.22 * pace, squash: 1 };
    case 'walk':
      // 一歩ごと（位相 π ごと）に 1 回上下する。左右の揺れはその半分の速さ
      return { lift: Math.abs(Math.sin(phase)) * amp * pace, pitch: Math.sin(phase * 2) * 0.04 * pace, roll: Math.sin(phase) * 0.05 * pace, squash: 1 };
  }
}
