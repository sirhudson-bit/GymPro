// Minimal CDP probe used for smoke-verifying the Electron renderer (no external deps).
// usage: node scripts/cdp-probe.mjs "<js expression>" [port]
const expression = process.argv[2] ?? 'document.title';
const port = process.argv[3] ?? '9222';

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.log(JSON.stringify({ error: 'no page target' }));
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();

function send(method, params = {}) {
  const msgId = ++id;
  ws.send(JSON.stringify({ id: msgId, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(msgId, { resolve, reject });
    setTimeout(() => reject(new Error(`timeout ${method}`)), 15000);
  });
}

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id).resolve(msg.result);
    pending.delete(msg.id);
  }
});

ws.addEventListener('open', async () => {
  try {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    console.log(JSON.stringify({ ok: true, value: res.result?.value, type: res.result?.type, description: res.result?.description }, null, 1));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: String(e) }));
  } finally {
    ws.close();
    process.exit(0);
  }
});
