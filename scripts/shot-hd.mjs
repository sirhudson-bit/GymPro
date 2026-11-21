// اسکرین‌شات با کیفیت ۲x برای لندینگ
// usage: node scripts/shot-hd.mjs out.png <port> [width] [height] [scale]
import fs from 'node:fs';

const out = process.argv[2] ?? 'docs/shot.png';
const port = process.argv[3] ?? '9222';
const width = Number(process.argv[4] ?? 1440);
const height = Number(process.argv[5] ?? 900);
const scale = Number(process.argv[6] ?? 2);

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && !t.url.includes('kiosk=1'));
if (!page) {
  console.error('no page target');
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) => {
  const msgId = ++id;
  ws.send(JSON.stringify({ id: msgId, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(msgId, resolve);
    setTimeout(() => reject(new Error(`timeout ${method}`)), 30_000);
  });
};
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
  }
});

ws.addEventListener('open', async () => {
  try {
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: scale,
      mobile: false,
    });
    await new Promise((r) => setTimeout(r, 1400));
    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      fromSurface: true,
    });
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log(`${out} ${fs.statSync(out).size} bytes (${width * scale}x${height * scale})`);
    ws.close();
    process.exit(0);
  } catch (e) {
    console.error(String(e));
    process.exit(1);
  }
});
