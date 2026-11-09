// چاپ کارت به PDF از طریق CDP و بررسی این‌که فقط کارت روی کاغذ می‌آید
// usage: node scripts/print-card.mjs [port] [out.pdf]
import fs from 'node:fs';

const port = process.argv[2] ?? '9222';
const out = process.argv[3] ?? 'docs/shots/card-print.pdf';

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
    await send('Page.enable');
    const pdf = await send('Page.printToPDF', {
      printBackground: true,
      paperWidth: 5.8,
      paperHeight: 8.3,
      marginTop: 0.15,
      marginBottom: 0.15,
      marginLeft: 0.15,
      marginRight: 0.15,
    });
    const buf = Buffer.from(pdf.data, 'base64');
    fs.writeFileSync(out, buf);
    console.log(JSON.stringify({ ok: true, path: out, bytes: buf.length }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: String(e) }));
  } finally {
    ws.close();
    setTimeout(() => process.exit(0), 100);
  }
});
