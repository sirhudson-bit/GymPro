// بررسی خروجی چاپ: با شبیه‌سازی media=print می‌سنجد که فقط کارت عضویت دیده می‌شود.
// usage: node scripts/print-check.mjs [port] [out.png]
import fs from 'node:fs';

const port = process.argv[2] ?? '9222';
const out = process.argv[3] ?? 'docs/shots/card-print-preview.png';

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => String(t.url).startsWith('app://')) ?? list.find((t) => t.type === 'page');
if (!page) {
  console.log(JSON.stringify({ error: 'no page target' }));
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) => {
  const msgId = ++id;
  ws.send(JSON.stringify({ id: msgId, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(msgId, { resolve, reject });
    setTimeout(() => reject(new Error(`timeout ${method}`)), 20000);
  });
};
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    if (msg.error) pending.get(msg.id).reject(new Error(`${msg.error.message ?? 'cdp error'} (${msg.error.code})`));
    else pending.get(msg.id).resolve(msg.result);
    pending.delete(msg.id);
  }
});

ws.addEventListener('open', async () => {
  try {
    await send('Emulation.setEmulatedMedia', { media: 'print' });
    const probe = `(() => {
      const vis = (el) => { if (!el) return 'missing'; const s = getComputedStyle(el); return s.visibility + '/' + s.display; };
      const card = document.querySelector('.print-card');
      const aside = document.querySelector('aside');
      const table = document.querySelector('table');
      const hint = document.querySelector('.print-card .no-print');
      const rect = card ? card.getBoundingClientRect() : null;
      return JSON.stringify({
        card: vis(card),
        aside: vis(aside),
        table: vis(table),
        hint: vis(hint),
        cardBox: rect ? { w: Math.round(rect.width), h: Math.round(rect.height) } : null,
      });
    })()`;
    const res = await send('Runtime.evaluate', { expression: probe, returnByValue: true });
    await send('Page.enable');
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    await send('Emulation.setEmulatedMedia', { media: 'screen' });
    console.log(res.result.value);
    console.log('screenshot →', out);
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: String(e) }));
  } finally {
    ws.close();
    setTimeout(() => process.exit(0), 100);
  }
});
