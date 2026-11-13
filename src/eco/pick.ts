/**
 * 画面上でマウスにいちばん近い点を選ぶ（小さく速い訪問者でもカーソルを合わせやすいように）。
 * radius（px）より遠ければ null
 */
export function pickNearestOnScreen(points: { x: number; y: number; id: number }[], mx: number, my: number, radius = 28): number | null {
  let best: number | null = null, bestD = radius * radius;
  for (const p of points) {
    const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
    if (d <= bestD) { bestD = d; best = p.id; }
  }
  return best;
}
