// Captures the current Electron renderer to a PNG (CDP, no deps).
// usage: node scripts/shot.mjs out.png [port]
import fs from 'node:fs';

const out = process.argv[2] ?? 'docs/shot.png';
const port = process.argv[3] ?? '9222';

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) => {
  const msgId = ++id;
  ws.send(JSON.stringify({ id: msgId, method, params }));
  return new Promise((resolve) => pending.set(msgId, resolve));
};
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
  }
});
ws.addEventListener('open', async () => {
  await send('Page.enable');
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`${out} ${fs.statSync(out).size} bytes`);
  ws.close();
  process.exit(0);
});
