// End-to-end licence test against the packaged app (CDP) + local backend.
// usage: node scripts/license-e2e.mjs [cdpPort] [apiBase]
const cdpPort = process.argv[2] ?? '9333';
const apiBase = process.argv[3] ?? 'http://127.0.0.1:8787';
const licenseKey = 'GP-DEMO-0001';

const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) => {
  const msgId = ++id;
  ws.send(JSON.stringify({ id: msgId, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(msgId, resolve);
    setTimeout(() => reject(new Error(`timeout ${method}`)), 20000);
  });
};
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
  }
});
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text ?? 'evaluate failed');
  return res.result?.value;
};

await new Promise((resolve) => ws.addEventListener('open', resolve));

const machineId = await evaluate("window.api.invoke('license:status').then(r => r.data.machineId)");
console.log('machineId:', machineId);

const actRes = await fetch(`${apiBase}/v1/activate`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ licenseKey, machineId, appVersion: '1.0.0' }),
});
const bundle = await actRes.json();
console.log('server:', actRes.status, bundle.license ? `edition=${bundle.license.edition} updatesUntil=${bundle.license.updateEntitlementUntil}` : bundle);

const activated = await evaluate(
  `window.api.invoke('license:activate', ${JSON.stringify({ licenseJson: JSON.stringify(bundle.license), signature: bundle.signature })})`,
);
console.log('activate:', JSON.stringify(activated).slice(0, 300));

const after = await evaluate("window.api.invoke('license:status').then(r => r.data)");
console.log('status after:', JSON.stringify({ status: after.status, edition: after.edition, updateDaysLeft: after.updateDaysLeft, message: after.message }));

// tamper check: signature of another payload must be rejected
const tampered = { ...bundle.license, edition: 'enterprise' };
const tamperRes = await evaluate(
  `window.api.invoke('license:activate', ${JSON.stringify({ licenseJson: JSON.stringify(tampered), signature: bundle.signature })})`,
);
console.log('tampered:', tampered.ok === false ? tamperRes : JSON.stringify(tamperRes).slice(0, 200));

// wrong machine
const otherMachine = { ...bundle.license, machineId: 'F'.repeat(32) };
const otherRes = await evaluate(
  `window.api.invoke('license:activate', ${JSON.stringify({ licenseJson: JSON.stringify(otherMachine), signature: bundle.signature })})`,
);
console.log('other machine:', JSON.stringify(otherRes).slice(0, 200));

ws.close();
process.exit(0);
