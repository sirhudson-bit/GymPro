// Finds elements that still paint the DEFAULT brand colour while another accent is selected.
// usage: node scripts/accent-scan.mjs [cdpPort] [targetHex]
const port = process.argv[2] ?? '9400';
const target = (process.argv[3] ?? '#7e22ce').toLowerCase();

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const send = (method, params = {}) => {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((r) => pending.set(id, r));
};
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
  }
});
await new Promise((r) => ws.addEventListener('open', r));

const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res?.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? 'eval error');
  return res?.result?.value;
};

// switch accent through the settings UI so the real code path runs
await evaluate(`location.hash = '#/settings'`);
await evaluate(`location.reload()`);
await new Promise((r) => setTimeout(r, 4000));
const before = await evaluate(`(async () => {
  location.hash = '#/settings';
  await new Promise(r => setTimeout(r, 1600));
  return JSON.stringify({
    brand: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),
    swatches: [...document.querySelectorAll('button[aria-label^="رنگ "]')].map(b => b.getAttribute('aria-label')),
  });
})()`);
console.log('before:', before);
const after = await evaluate(`(async () => {
  const btn = [...document.querySelectorAll('button[aria-label]')].find(b => b.getAttribute('aria-label') === 'رنگ بنفش');
  if (btn) btn.click();
  await new Promise(r => setTimeout(r, 500));
  return JSON.stringify({
    clicked: !!btn,
    brand: document.documentElement.style.getPropertyValue('--brand'),
    computed: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),
  });
})()`);
console.log('after :', after);

const VIEWS = ['dashboard', 'members', 'contracts', 'finance', 'attendance', 'pos', 'classes', 'lockers', 'reports', 'support', 'license', 'help'];
for (const view of VIEWS) {
  await evaluate(`location.hash = '#/${view}'`);
  await new Promise((r) => setTimeout(r, 1200));
  const res = await evaluate(String.raw`
  (() => {
    const D1 = 'rgb(13, 110, 87)';
    const D2 = 'rgb(43, 184, 148)';
    const hits = [];
    for (const el of document.querySelectorAll('*')) {
      if (!(el instanceof Element)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      for (const p of ['color','backgroundColor','borderTopColor','borderRightColor','borderBottomColor','borderLeftColor','outlineColor','fill','stroke']) {
        const v = cs[p];
        if (v === D1 || v === D2) {
          hits.push({ tag: el.tagName.toLowerCase(), cls: (el.className?.toString()||'').slice(0,50), prop: p, text: (el.textContent||'').trim().slice(0,24) });
          break;
        }
      }
    }
    return { hits: hits.slice(0, 12), total: hits.length };
  })()`);
  console.log(`${view.padEnd(10)} default-teal hits: ${res.total}`, res.total ? JSON.stringify(res.hits.slice(0, 4)) : '');
}

const scan = { skipped: true };

console.log(JSON.stringify(scan, null, 1));
ws.close();
process.exit(0);
