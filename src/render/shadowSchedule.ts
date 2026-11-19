/**
 * 影を描き直すフレームを決める（three.js に頼らない）。interval = 1 なら毎フレーム、4 なら 4 フレームに 1 回。
 * 間隔を変えた時と force() の後は、次のフレームですぐ描き直す
 */
export class ShadowSchedule {
  private n = 1;
  private count = 0;
  private forced = true;

  get interval() { return this.n; }
  set interval(v: number) {
    const k = Math.max(1, Math.floor(v) || 1);
    if (k !== this.n) this.forced = true;
    this.n = k;
  }

  /** 次のフレームで必ず描き直す（画質を変えた・影の方式を変えた時など） */
  force() { this.forced = true; }

  /** 1 フレーム進める。このフレームで影を描き直すなら true */
  tick(): boolean {
    if (this.forced || this.count >= this.n - 1) {
      this.forced = false;
      this.count = 0;
      return true;
    }
    this.count++;
    return false;
  }
}
