(async () => {
  const c = document.querySelector('canvas'); const tip = document.getElementById('tooltip');
  const raf = () => new Promise(r => requestAnimationFrame(() => r()));
  const want = new RegExp(window.__WANT ?? 'ひと休み|眠って');
  for (let y = 150; y < 950; y += 10) for (let x = 300; x < 1620; x += 10) {
    c.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, pointerType: 'mouse' }));
    await raf();
    const s = tip.textContent.trim();
    if (want.test(s)) { window.__raf = window.requestAnimationFrame; window.requestAnimationFrame = () => 0; return x + ',' + y + ' ' + s; }
  }
  return 'none';
})()
