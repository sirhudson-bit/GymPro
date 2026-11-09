// نمای واکنش‌گرا: عرض دستگاه را شبیه‌سازی می‌کند و از صفحه اسکرین‌شات می‌گیرد
// usage: node scripts/responsive-shot.mjs <port> <width> <height> <hash> <out.png>
import fs from 'node:fs';

const [port, width, height, hash, out] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4]), process.argv[5], process.argv[6]];

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => String(t.url).includes('app://') && !String(t.url).includes('kiosk=1'));
if (!page) {
  console.log(JSON.stringify({ error: 'no target' }));
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
    if (msg.error) pending.get(msg.id).reject(new Error(msg.error.message));
    else pending.get(msg.id).resolve(msg.result);
    pending.delete(msg.id);
  }
});

ws.addEventListener('open', async () => {
  try {
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await send('Runtime.evaluate', { expression: `location.hash='${hash}'` });
    await new Promise((r) => setTimeout(r, 1200));
    const probe = await send('Runtime.evaluate', {
      expression: `(() => {
        const de = document.documentElement;
        const aside = document.querySelector('aside');
        const scroller = [...document.querySelectorAll('div')].find(d => getComputedStyle(d).overflowY === 'auto' && d.scrollHeight > d.clientHeight + 20);
        const table = document.querySelector('table');
        const wrap = table ? table.parentElement : null;
        return JSON.stringify({
          viewport: innerWidth + 'x' + innerHeight,
          pageScrollX: de.scrollWidth > de.clientWidth + 2 ? de.scrollWidth : 0,
          asideWidth: aside ? Math.round(aside.getBoundingClientRect().width) : 0,
          tableScrollable: wrap ? wrap.scrollWidth > wrap.clientWidth + 2 : null,
          contentScrolls: !!scroller,
        });
      })()`,
      returnByValue: true,
    });
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log(probe.result.value, '→', out);
    await send('Emulation.clearDeviceMetricsOverride');
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: String(e) }));
  } finally {
    ws.close();
    setTimeout(() => process.exit(0), 100);
  }
});
