// ارزیابی یک تبِ مشخص (بر اساس زیررشتهٔ URL) — برای تست پنجرهٔ کیوسک
// usage: node scripts/cdp-eval-target.mjs <port> <urlSubstring> "<js expression>"
const [port, needle, expression] = [process.argv[2], process.argv[3], process.argv[4]];

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => String(t.url).includes(needle));
if (!page) {
  console.log(JSON.stringify({ error: 'no target', urls: list.map((t) => t.url) }));
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
    setTimeout(() => reject(new Error(`timeout ${method}`)), 15000);
  });
};
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    if (msg.error) pending.get(msg.id).reject(new Error(msg.error.message));
    else pending.get(msg.id).resolve(msg.result);
    pending.delete(msg.id);
  }
});
ws.addEventListener('open', async () => {
  try {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    console.log(JSON.stringify({ ok: true, value: res.result?.value }, null, 1));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: String(e) }));
  } finally {
    ws.close();
    setTimeout(() => process.exit(0), 100);
  }
});
