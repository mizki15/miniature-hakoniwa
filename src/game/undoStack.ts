/** 取り消し（Ctrl+Z）の記録。新しいものから取り出す。上限を超えたら一番古いものを捨てる */
export class UndoStack<T> {
  private items: T[] = [];
  constructor(private limit: number) {}
  get size() { return this.items.length; }
  push(v: T) {
    this.items.push(v);
    if (this.items.length > this.limit) this.items.shift();
  }
  pop(): T | undefined { return this.items.pop(); }
  clear() { this.items = []; }
}
