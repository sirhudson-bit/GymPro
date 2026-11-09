// QA harness: seeds a throwaway install, audits every view for UX/a11y defects, saves screenshots.
// usage: node scripts/qa.mjs <seed|audit|shots> [cdpPort]
const cmd = process.argv[2] ?? 'audit';
const port = process.argv[3] ?? '9400';
const VIEWS = ['dashboard', 'members', 'contracts', 'finance', 'attendance', 'kiosk', 'pos', 'classes', 'lockers', 'reports', 'support', 'license', 'settings', 'help'];

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.error('no page target');
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const send = (method, params = {}) => {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => reject(new Error(`timeout ${method}`)), 25000);
  });
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

const AUDIT_FN = String.raw`
(() => {
  const out = { url: location.hash, issues: [], counts: { interactive: 0, textNodes: 0 } };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  const nameOf = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const t = labelledby.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
      if (t) return t;
    }
    const text = (el.innerText || el.textContent || '').trim();
    if (text) return text;
    if (el.tagName === 'INPUT') {
      const id = el.id;
      if (id) {
        const lab = document.querySelector('label[for="' + CSS.escape(id) + '"]');
        if (lab?.textContent?.trim()) return lab.textContent.trim();
      }
      const wrap = el.closest('label');
      if (wrap?.textContent?.trim()) return wrap.textContent.trim();
      const parentLabel = el.parentElement?.querySelector('span.label, .label');
      if (parentLabel?.textContent?.trim()) return parentLabel.textContent.trim();
      const ph = el.getAttribute('placeholder');
      if (ph) return 'ph:' + ph;
    }
    const title = el.getAttribute('title');
    if (title) return title;
    return '';
  };

  // 1. interactive elements need an accessible name
  document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="switch"]').forEach((el) => {
    if (!visible(el)) return;
    out.counts.interactive += 1;
    const name = nameOf(el);
    if (!name) out.issues.push({ type: 'no-accessible-name', tag: el.tagName.toLowerCase(), html: el.outerHTML.slice(0, 120) });
    if (name.startsWith('ph:')) out.issues.push({ type: 'placeholder-only-label', tag: el.tagName.toLowerCase(), name: name.slice(3) });
  });

  // 2. touch/click targets below the WCAG 2.5.8 minimum (24×24 css px)
  document.querySelectorAll('button, a[href], input[type="checkbox"], input[type="color"]').forEach((el) => {
    if (!visible(el)) return;
    const r = el.getBoundingClientRect();
    if ((r.height < 24 || r.width < 24) && !el.closest('kbd')) {
      out.issues.push({ type: 'small-target', tag: el.tagName.toLowerCase(), name: nameOf(el).slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) });
    }
  });

  // 3. horizontal overflow (RTL breakage)
  document.querySelectorAll('main, .card, table, .overflow-x-auto').forEach((el) => {
    if (!visible(el)) return;
    if (el.scrollWidth > el.clientWidth + 4 && getComputedStyle(el).overflowX === 'visible') {
      out.issues.push({ type: 'overflow', tag: el.tagName.toLowerCase(), cls: el.className.toString().slice(0, 60), scrollW: el.scrollWidth, clientW: el.clientWidth });
    }
  });

  // 4. heading structure
  const headings = [...document.querySelectorAll('h1,h2,h3,h4')].filter(visible).map((h) => Number(h.tagName[1]));
  const h1 = headings.filter((n) => n === 1).length;
  if (h1 === 0) out.issues.push({ type: 'no-h1' });
  if (h1 > 1) out.issues.push({ type: 'multiple-h1', count: h1 });
  for (let i = 1; i < headings.length; i += 1) {
    if (headings[i] - headings[i - 1] > 1) {
      out.issues.push({ type: 'heading-skip', from: headings[i - 1], to: headings[i] });
      break;
    }
  }

  // 5. images need alt
  document.querySelectorAll('img').forEach((img) => {
    if (!visible(img)) return;
    if (!img.hasAttribute('alt')) out.issues.push({ type: 'img-no-alt', src: (img.getAttribute('src') || '').slice(0, 50) });
  });

  // 6. duplicate ids
  const ids = {};
  document.querySelectorAll('[id]').forEach((el) => {
    ids[el.id] = (ids[el.id] || 0) + 1;
  });
  Object.entries(ids).filter(([, n]) => n > 1).forEach(([id, n]) => out.issues.push({ type: 'duplicate-id', id, n }));

  // 7. computed text contrast (WCAG 1.4.3) — resolves rgb(), rgba() and color(srgb …)
  const toRgb = (value) => {
    if (!value) return null;
    const m = value.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
    if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255, m[4] === undefined ? 1 : Number(m[4])];
    const r = value.match(/rgba?\(([^)]+)\)/);
    if (!r) return null;
    const p = r[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (p.length < 3) return null;
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const lum = (rgb) => {
    const [r, g, b] = rgb.slice(0, 3).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const composite = (fg, bg) => {
    const a = fg[3] ?? 1;
    return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
  };
  const effectiveBg = (el) => {
    const stack = [];
    let node = el;
    while (node) {
      const c = toRgb(getComputedStyle(node).backgroundColor);
      if (c && (c[3] ?? 1) > 0.01) stack.push(c);
      if (c && (c[3] ?? 1) >= 0.99) break;
      node = node.parentElement;
    }
    let bg = toRgb(getComputedStyle(document.body).backgroundColor) ?? [255, 255, 255, 1];
    if ((bg[3] ?? 1) < 0.99) bg = [255, 255, 255, 1];
    for (const layer of stack.reverse()) bg = composite(layer, bg);
    return bg;
  };
  const seen = new Set();
  document.querySelectorAll('p, span, td, th, label, h1, h2, h3, a, button, div').forEach((el) => {
    if (!visible(el)) return;
    if (el.children.length > 0 && el.childNodes.length !== 1) return;
    const text = (el.innerText || '').trim();
    if (text.length < 2) return;
    const cs = getComputedStyle(el);
    const fgRaw = toRgb(cs.color);
    if (!fgRaw) return;
    const bg = effectiveBg(el);
    const fg = composite(fgRaw, bg);
    const L1 = lum(fg);
    const L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const min = large ? 3 : 4.5;
    out.counts.textNodes += 1;
    const key = cs.color + '|' + bg.slice(0, 3).map(Math.round).join(',') + '|' + Math.round(ratio * 10);
    if (ratio < min && !seen.has(key)) {
      seen.add(key);
      out.issues.push({ type: 'low-contrast', text: text.slice(0, 32), ratio: Number(ratio.toFixed(2)), min, size: Math.round(size) });
    }
  });

  return out;
})()`;

if (cmd === 'seed') {
  const result = await evaluate(`(async () => {
    const api = window.api;
    const inv = (c, p) => api.invoke(c, p);
    const boot = await inv('app:bootstrap');
    const state = { setup: false, seeded: {} };
    if (boot.data.usersCount === 0) {
      const s = await inv('setup:run', { clubName: 'باشگاه نمونه', ownerName: 'مدیر نمونه', username: 'admin', password: 'admin1234', pin: '1234' });
      state.setup = s.ok;
    } else {
      const l = await inv('auth:login', { username: 'admin', password: 'admin1234' });
      state.login = l.ok;
    }
    const plans = await inv('plans:list', { includeInactive: true });
    if (!plans.data?.length) {
      await inv('plans:create', { name: 'ماهانه طلایی', kind: 'time', durationDays: 30, priceIrr: 2500000 });
      await inv('plans:create', { name: '۱۲ جلسه‌ای', kind: 'session', durationDays: 45, sessionCount: 12, priceIrr: 1800000 });
    }
    const pl = (await inv('plans:list', {})).data;
    const names = [['علی رضایی', '09121110001'], ['سارا محمدی', '09121110002'], ['مهدی کریمی', '09121110003'], ['نگار تهرانی', '09121110004']];
    let members = (await inv('members:list', { limit: 20 })).data;
    if (!members?.length) {
      for (const [fullName, mobile] of names) await inv('members:create', { fullName, mobile, consent: true });
      members = (await inv('members:list', { limit: 20 })).data;
    }
    const contracts = (await inv('contracts:list', {})).data;
    if (!contracts?.length && members.length && pl.length) {
      await inv('contracts:create', { memberId: members[0].id, planId: pl[0].id, startDate: new Date().toISOString().slice(0,10), discountIrr: 200000, discountReason: 'تخفیف افتتاحیه', payment: { amountIrr: 2300000, method: 'cash' } });
      await inv('contracts:create', { memberId: members[1].id, planId: pl[pl.length-1].id, startDate: new Date().toISOString().slice(0,10), payment: { amountIrr: 1800000, method: 'card_to_card' } });
    }
    const cash = await inv('cash:current');
    if (!cash.data?.session) await inv('cash:open', { openingFloat: 500000 });
    const products = (await inv('pos:products', {})).data;
    if (!products?.length) {
      await inv('pos:createProduct', { name: 'آب معدنی', priceIrr: 15000, costIrr: 9000, stockQty: 24 });
      await inv('pos:createProduct', { name: 'پروتئین بار', priceIrr: 85000, costIrr: 60000, stockQty: 8 });
    }
    const pr = (await inv('pos:products', {})).data;
    if (pr.length && members.length) await inv('pos:sell', { memberId: members[2].id, items: [{ productId: pr[0].id, qty: 2 }], method: 'wallet' }).catch(() => null);
    const trainers = (await inv('trainers:list', {})).data;
    if (!trainers?.length) await inv('trainers:create', { fullName: 'رضا مربی', commissionRateBp: 2000, specialty: 'بدنسازی' });
    const tr = (await inv('trainers:list', {})).data;
    const classes = (await inv('classes:list', {})).data;
    if (!classes?.length) await inv('classes:create', { name: 'کراسفیت', trainerId: tr[0]?.id ?? null, weekday: 1, startTime: '18:00', endTime: '19:30', capacity: 12 });
    const lockers = (await inv('lockers:list', {})).data;
    if (!lockers?.length) {
      await inv('lockers:create', { code: 'A-1', price: 300000 });
      await inv('lockers:create', { code: 'A-2', price: 300000 });
    }
    if (members.length) {
      await inv('body:create', { memberId: members[0].id, measuredAt: new Date().toISOString().slice(0,10), weightKg: 82.5, heightCm: 178, bodyFatPct: 18.4 });
      await inv('attendance:checkin', { memberId: members[0].id, method: 'manual' }).catch(() => null);
    }
    const tickets = (await inv('support:tickets', {})).data;
    if (!tickets?.length) await inv('support:create', { subject: 'سؤال دربارهٔ چاپ فیش', category: 'howto', priority: 'normal', body: 'سلام، برای چاپ فیش حرارتی چه تنظیماتی لازم است؟' });
    state.seeded = {
      members: (await inv('members:list', { limit: 50 })).data?.length,
      contracts: (await inv('contracts:list', {})).data?.length,
      products: (await inv('pos:products', {})).data?.length,
    };
    return state;
  })()`);
  console.log(JSON.stringify(result, null, 1));
}

if (cmd === 'audit') {
  const report = {};
  for (const view of VIEWS) {
    await evaluate(`location.hash = '#/${view}'`);
    await new Promise((r) => setTimeout(r, 1400));
    const res = await evaluate(AUDIT_FN);
    report[view] = res;
    const counts = {};
    for (const i of res.issues) counts[i.type] = (counts[i.type] || 0) + 1;
    console.log(`${view.padEnd(10)} interactive=${res.counts.interactive} text=${res.counts.textNodes} → ${JSON.stringify(counts)}`);
  }
  const all = [];
  for (const [view, r] of Object.entries(report)) for (const i of r.issues) all.push({ view, ...i });
  console.log('\n--- distinct issues ---');
  const seenTypes = new Map();
  for (const i of all) {
    if (!seenTypes.has(i.type)) seenTypes.set(i.type, []);
    seenTypes.get(i.type).push(i);
  }
  for (const [type, items] of seenTypes) {
    console.log(`\n[${type}] ×${items.length}`);
    for (const it of items.slice(0, 6)) console.log('   ', JSON.stringify(it).slice(0, 220));
  }
  const fs = await import('node:fs');
  fs.writeFileSync('docs/qa-report.json', JSON.stringify(report, null, 2));
  console.log('\nfull report → docs/qa-report.json');
}

if (cmd === 'shots') {
  const fs = await import('node:fs');
  fs.mkdirSync('docs/shots', { recursive: true });
  await send('Page.enable');
  for (const view of VIEWS) {
    await evaluate(`location.hash = '#/${view}'`);
    await new Promise((r) => setTimeout(r, 1200));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`docs/shots/${view}.png`, Buffer.from(shot.data, 'base64'));
    console.log('shot', view);
  }
}

ws.close();
process.exit(0);
