// Minimal CDP driver for the capture Chrome (port 9333).
// node cdp.mjs nav <url> | eval <js> | shot <file> | drag x1 y1 x2 y2 [button] | wheel x y dy [times] | key <key> [ms] | record <sec> <dir>
import fs from 'node:fs';
import path from 'node:path';

const [cmd, ...a] = process.argv.slice(2);
const targets = await (await fetch('http://localhost:9333/json')).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const listeners = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  else listeners.forEach((l) => l(d));
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, (d) => (d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result)));
  ws.send(JSON.stringify({ id: i, method, params }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (cmd === 'hold') { await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }); setInterval(() => {}, 1e9); await new Promise(() => {}); }
const mouse = (type, x, y, button = 'left', extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button, buttons: type === 'mouseReleased' ? 0 : (button === 'left' ? 1 : button === 'right' ? 2 : 4), ...extra });

if (cmd === 'clear') { await send('Storage.clearDataForOrigin', { origin: a[0], storageTypes: 'all' }); console.log('cleared', a[0]); }
else if (cmd === 'navwith') { await send('Page.enable'); await send('Page.addScriptToEvaluateOnNewDocument', { source: fs.readFileSync(a[0], 'utf8') }); await send('Page.navigate', { url: a[1] }); await sleep(Number(a[2] ?? 6000)); }
else if (cmd === 'nav') { await send('Page.navigate', { url: a[0] }); await sleep(Number(a[1] ?? 6000)); }
else if (cmd === 'eval') {
  const r = await send('Runtime.evaluate', { expression: a[0], awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result.value ?? r.exceptionDetails ?? r.result));
}
else if (cmd === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(a[0], Buffer.from(r.data, 'base64')); console.log('saved', a[0]);
}
else if (cmd === 'drag') {
  const [x1, y1, x2, y2] = a.slice(0, 4).map(Number); const b = a[4] ?? 'left';
  await mouse('mouseMoved', x1, y1, 'none');
  await mouse('mousePressed', x1, y1, b, { clickCount: 1 });
  for (let i = 1; i <= 30; i++) { await mouse('mouseMoved', x1 + (x2 - x1) * i / 30, y1 + (y2 - y1) * i / 30, b); await sleep(16); }
  await mouse('mouseReleased', x2, y2, b, { clickCount: 1 });
}
else if (cmd === 'wheel') {
  const [x, y, dy, n] = [Number(a[0]), Number(a[1]), Number(a[2]), Number(a[3] ?? 1)];
  for (let i = 0; i < n; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy }); await sleep(30); }
}
else if (cmd === 'click') {
  // click x y [x y ...] [--b right] : clicks each point
  const pts = a.filter((v) => !v.startsWith('--')).map(Number); const b = a.includes('--right') ? 'right' : 'left';
  for (let i = 0; i < pts.length; i += 2) { const [x, y] = [pts[i], pts[i + 1]]; await mouse('mouseMoved', x, y, 'none'); await sleep(12); await mouse('mousePressed', x, y, b, { clickCount: 1 }); await sleep(12); await mouse('mouseReleased', x, y, b, { clickCount: 1 }); await sleep(Number(process.env.GAP ?? 25)); }
}
else if (cmd === 'move') { await mouse('mouseMoved', Number(a[0]), Number(a[1]), 'none'); await sleep(300); }
else if (cmd === 'key') {
  // key <key> : e.g. 2, Escape, Tab
  const k = a[0]; const code = /^[0-9]$/.test(k) ? 'Digit' + k : /^[a-z]$/i.test(k) ? 'Key' + k.toUpperCase() : k;
  const kc = { Escape: 27, Tab: 9, Enter: 13 }[k] ?? k.toUpperCase().charCodeAt(0);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: kc, text: k.length === 1 ? k : undefined });
  await sleep(Number(a[1] ?? 50));
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: kc });
}
else if (cmd === 'record') {
  const sec = Number(a[0]); const dir = a[1]; fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  listeners.push(async (d) => {
    if (d.method !== 'Page.screencastFrame') return;
    frames.push({ t: d.params.metadata.timestamp, data: d.params.data });
    send('Page.screencastFrameAck', { sessionId: d.params.sessionId });
  });
  await send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  await sleep(sec * 1000);
  await send('Page.stopScreencast');
  // Resample to constant 30 fps
  const t0 = frames[0].t; let k = 0; let n = 0;
  for (let t = 0; t < sec; t += 1 / 30) {
    while (k + 1 < frames.length && frames[k + 1].t - t0 <= t) k++;
    fs.writeFileSync(path.join(dir, `f${String(n++).padStart(5, '0')}.jpg`), Buffer.from(frames[k].data, 'base64'));
  }
  console.log('frames', frames.length, '->', n);
}
ws.close();
process.exit(0);
