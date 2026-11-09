// GymPro — پنل مدیریت لایسنس، آپدیت و تیکت‌ها (بدون هیچ وابستگی npm)
// اجرا:  ADMIN_PASSWORD=... node server/admin.mjs        (پیش‌فرض پورت 8899)
// روی VPS: pm2 start server/admin.mjs --name gympro-admin
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, 'data');
const KEYS_FILE = path.join(DATA, 'keys.json');
const ACT_FILE = path.join(DATA, 'activations.json');
const TICKETS_FILE = path.join(DATA, 'tickets.json');
const ADMIN_FILE = path.join(DATA, 'admin.json');
const MANIFEST_FILE = path.join(DATA, 'manifest.signed.json');
const PORT = Number(process.env.PORT ?? 8899);
// پیش‌فرض فقط loopback: پنل باید پشت nginx با TLS بیاید، نه روی IP خام.
const HOST = process.env.HOST ?? '127.0.0.1';

const BASE_URL = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}`;

fs.mkdirSync(DATA, { recursive: true });

/* ─────────── storage helpers (atomic writes, shared with the API process) ─────────── */

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

/* ─────────── admin credentials & sessions ─────────── */

function adminStore() {
  const existing = readJson(ADMIN_FILE, null);
  if (existing?.hash) return existing;
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString('hex')}`;
  const secret = crypto.randomBytes(32).toString('hex');
  const record = { hash, secret, createdAt: new Date().toISOString(), bootstrapped: !process.env.ADMIN_PASSWORD };
  writeJson(ADMIN_FILE, record);
  if (!process.env.ADMIN_PASSWORD) {
    console.log(`\n  رمز اولیهٔ پنل: ${password}\n  (در ${ADMIN_FILE} ذخیره شد — با ADMIN_PASSWORD عوضش کنید)\n`);
  }
  return record;
}
const admin = adminStore();

function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', admin.secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function readSession(cookieHeader) {
  const raw = (cookieHeader ?? '').split(';').map((c) => c.trim()).find((c) => c.startsWith('gp_admin='));
  if (!raw) return null;
  const token = decodeURIComponent(raw.slice('gp_admin='.length));
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', admin.secret).update(body).digest('base64url');
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ─────────── rate limit ─────────── */

const attempts = new Map();
const LIMIT = Number(process.env.LOGIN_MAX_ATTEMPTS ?? 10);
function attemptsFor(ip) {
  const rec = attempts.get(ip) ?? { count: 0, since: Date.now() };
  if (Date.now() - rec.since > 10 * 60_000) {
    rec.count = 0;
    rec.since = Date.now();
  }
  attempts.set(ip, rec);
  return rec;
}
const throttled = (ip) => attemptsFor(ip).count >= LIMIT;
const noteFailure = (ip) => {
  const rec = attemptsFor(ip);
  rec.count += 1;
};
const clearFailures = (ip) => attempts.delete(ip);

/* ─────────── domain helpers ─────────── */

const keys = () => readJson(KEYS_FILE, {});
const activations = () => readJson(ACT_FILE, {});
const tickets = () => readJson(TICKETS_FILE, {});

const EDITIONS = ['basic', 'pro', 'enterprise'];
const EDITION_LABEL = { basic: 'پایه', pro: 'حرفه‌ای', enterprise: 'سازمانی' };
const FEATURE_LABEL = { core: 'هستهٔ باشگاه', pos: 'بوفه', kiosk: 'کیوسک', reports: 'گزارش‌ها', support: 'پشتیبانی', sms: 'پیامک', multi_branch: 'چندشعبه' };
const STATUS_LABEL = { open: 'باز', answered: 'پاسخ داده‌شده', closed: 'بسته' };

function newKey(prefix = 'GP') {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = (n) => Array.from(crypto.randomBytes(n), (b) => alphabet[b % alphabet.length]).join('');
  return `${prefix}-${part(4)}-${part(4)}-${part(4)}`;
}

function issueLicensePayload(licenseKey, machineId, record) {
  const privateKey = crypto.createPrivateKey(fs.readFileSync(path.join(__dirname, 'keys', 'license-private.pem'), 'utf8'));
  const issued = new Date();
  const entitlement = new Date(issued.getTime());
  entitlement.setMonth(entitlement.getMonth() + Number(record.updateMonths ?? 12));
  const payload = {
    licenseKey,
    machineId,
    edition: record.edition ?? 'pro',
    issuedAt: issued.toISOString(),
    updateEntitlementUntil: entitlement.toISOString(),
    features: record.features ?? ['core', 'pos', 'kiosk', 'reports', 'support'],
    maxActivations: Number(record.maxActivations ?? 1),
    activationsUsed: Object.values(activations()).filter((a) => a.licenseKey === licenseKey).length,
    buyer: record.buyer ?? null,
  };
  const signature = crypto.sign(null, Buffer.from(JSON.stringify(payload, Object.keys(payload).sort())), privateKey).toString('base64');
  return { payload, signature };
}

/* ─────────── HTML shell ─────────── */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fa = (n) => String(n ?? 0).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

function layout({ title, body, session, active, flash }) {
  const nav = [
    ['/dashboard', 'داشبورد'],
    ['/licenses', 'لایسنس‌ها'],
    ['/tickets', 'تیکت‌ها'],
    ['/updates', 'آپدیت‌ها'],
    ['/help', 'راهنما'],
  ];
  return `<!doctype html>
<html lang="fa" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — پنل جیم‌پرو</title>
<style>
:root{--canvas:#f5f6f8;--panel:#fff;--edge:#d8dee6;--ink:#0f1620;--muted:#55606d;--brand:#0d6e57;--ok:#0d6b3d;--warn:#8a4b00;--bad:#a11d18}
*{box-sizing:border-box}
body{margin:0;font-family:Vazirmatn,Tahoma,"Segoe UI",sans-serif;background:var(--canvas);color:var(--ink);font-size:14px;line-height:1.8}
a{color:var(--brand);text-decoration:none}
header{background:var(--panel);border-bottom:1px solid var(--edge);padding:.75rem 1.25rem;display:flex;gap:1rem;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:5}
nav a{padding:.35rem .7rem;border-radius:8px;color:var(--ink)}
nav a.on{background:color-mix(in srgb,var(--brand) 14%,transparent);color:var(--brand);font-weight:700}
main{max-width:1180px;margin:0 auto;padding:1.25rem}
.card{background:var(--panel);border:1px solid var(--edge);border-radius:14px;padding:1rem;margin-bottom:1rem;box-shadow:0 1px 2px rgba(15,22,32,.05)}
h1{font-size:1.15rem;margin:0 0 1rem}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:right;color:var(--muted);font-weight:700;padding:.55rem .6rem;border-bottom:1px solid var(--edge);background:color-mix(in srgb,var(--edge) 30%,transparent)}
td{padding:.55rem .6rem;border-bottom:1px solid color-mix(in srgb,var(--edge) 80%,transparent);text-align:right}
.num{font-variant-numeric:tabular-nums;direction:ltr;text-align:right}
label{display:block;font-size:12.5px;color:var(--muted);font-weight:600;margin:.6rem 0 .25rem}
input,select,textarea{width:100%;padding:.5rem .65rem;border:1px solid #7b8794;border-radius:9px;font:inherit;background:var(--panel);color:var(--ink)}
input:focus,select:focus,textarea:focus{outline:2px solid var(--brand);outline-offset:1px}
button{display:inline-flex;align-items:center;gap:.4rem;min-height:32px;padding:.45rem .9rem;border-radius:9px;border:1px solid transparent;background:var(--brand);color:#fff;font:inherit;font-weight:700;cursor:pointer}
button.ghost{background:transparent;color:var(--ink);border-color:#7b8794}
button.danger{background:var(--bad)}
.chip{display:inline-block;padding:.05rem .5rem;border-radius:999px;font-size:12px;font-weight:700;border:1px solid currentColor}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}
.grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.kpi{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums}
.muted{color:var(--muted);font-size:12.5px}
code{background:color-mix(in srgb,var(--edge) 45%,transparent);padding:.1rem .35rem;border-radius:6px;font-size:12px}
.flash{border-radius:10px;padding:.6rem .9rem;margin-bottom:1rem;font-size:13px}
.flash.ok{background:color-mix(in srgb,var(--ok) 12%,transparent);color:var(--ok)}
.flash.bad{background:color-mix(in srgb,var(--bad) 12%,transparent);color:var(--bad)}
pre{background:#0f1620;color:#eef3f9;padding:.8rem;border-radius:10px;overflow:auto;direction:ltr;font-size:12px}
</style></head><body>
${session ? `<header><div style="display:flex;gap:.5rem;align-items:center"><strong>جیم‌پرو</strong><nav>${nav.map(([href, label]) => `<a href="${href}" class="${active === href ? 'on' : ''}">${label}</a>`).join('')}</nav></div><form method="post" action="/logout" style="margin:0"><button class="ghost">خروج</button></form></header>` : ''}
<main>
${flash ? `<div class="flash ${flash.tone}">${esc(flash.text)}</div>` : ''}
${body}
</main></body></html>`;
}

/* ─────────── pages ─────────── */

function loginPage(error) {
  return layout({
    title: 'ورود',
    session: null,
    active: '',
    flash: error ? { tone: 'bad', text: error } : null,
    body: `<div class="card" style="max-width:380px;margin:8vh auto">
      <h1>پنل مدیریت جیم‌پرو</h1>
      <form method="post" action="/login">
        <label>رمز مدیر</label>
        <input type="password" name="password" autofocus required aria-label="رمز مدیر">
        <div style="margin-top:1rem"><button type="submit">ورود</button></div>
      </form>
      <p class="muted" style="margin-top:1rem">رمز در <code>server/data/admin.json</code> ذخیره شده و با متغیر محیطی <code>ADMIN_PASSWORD</code> قابل تغییر است.</p>
    </div>`,
  });
}

function csrfToken(session) {
  return crypto.createHmac('sha256', admin.secret).update(`csrf:${session.sid}`).digest('base64url').slice(0, 24);
}

function dashboardPage(session) {
  const k = keys();
  const a = activations();
  const t = tickets();
  const list = Object.entries(k);
  const active = list.filter(([, v]) => !v.disabled);
  const openTickets = Object.values(t).filter((x) => x.status === 'open').length;
  const soon = active.filter(([, v]) => {
    const d = new Date(v.createdAt ?? Date.now());
    d.setMonth(d.getMonth() + Number(v.updateMonths ?? 12));
    return d.getTime() - Date.now() < 45 * 86400000;
  }).length;
  const recent = Object.values(t).sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt))).slice(0, 5);
  return layout({
    title: 'داشبورد',
    session,
    active: '/dashboard',
    body: `<h1>داشبورد</h1>
      <div class="grid">
        <div class="card"><div class="muted">کلیدهای فعال</div><div class="kpi">${fa(active.length)}</div><div class="muted">از ${fa(list.length)} کلید</div></div>
        <div class="card"><div class="muted">فعال‌سازی‌ها</div><div class="kpi">${fa(Object.keys(a).length)}</div><div class="muted">دستگاه‌های ثبت‌شده</div></div>
        <div class="card"><div class="muted">تیکت باز</div><div class="kpi">${fa(openTickets)}</div><div class="muted">نیازمند پاسخ</div></div>
        <div class="card"><div class="muted">اشتراک آپدیت نزدیک پایان</div><div class="kpi warn">${fa(soon)}</div><div class="muted">کمتر از ۴۵ روز</div></div>
      </div>
      <div class="card">
        <h1 style="font-size:1rem">آخرین تیکت‌ها</h1>
        <table><thead><tr><th>موضوع</th><th>دسته</th><th>وضعیت</th><th>تاریخ</th><th></th></tr></thead><tbody>
        ${recent.length ? recent.map((x) => `<tr><td>${esc(x.subject)}</td><td>${esc(x.category)}</td><td><span class="chip ${x.status === 'open' ? 'warn' : 'ok'}">${STATUS_LABEL[x.status] ?? esc(x.status)}</span></td><td class="num">${esc(String(x.createdAt).slice(0, 10))}</td><td><a href="/tickets/${esc(x.remoteId)}">باز کردن</a></td></tr>`).join('') : '<tr><td colspan="5" class="muted">تیکتی ثبت نشده</td></tr>'}
        </tbody></table>
      </div>
      <div class="card"><h1 style="font-size:1rem">اتصال نرم‌افزار به این سرور</h1>
      <p class="muted">در برنامه: تنظیمات → «اتصال به سرورها»:</p>
      <pre>support.url = ${esc(BASE_URL)}
update.url  = ${esc(BASE_URL)}</pre></div>`,
  });
}

function licensesPage(session, flash) {
  const k = keys();
  const a = activations();
  const rows = Object.entries(k).sort((x, y) => String(y[1].createdAt).localeCompare(String(x[1].createdAt)));
  return layout({
    title: 'لایسنس‌ها',
    session,
    active: '/licenses',
    flash,
    body: `<h1>لایسنس‌ها</h1>
    <div class="card">
      <form method="post" action="/licenses/create" class="grid" style="align-items:end">
        <input type="hidden" name="csrf" value="${csrfToken(session)}">
        <div><label>کلید (خالی = تولید خودکار)</label><input name="licenseKey" placeholder="GP-XXXX-XXXX-XXXX"></div>
        <div><label>نسخه</label><select name="edition">${EDITIONS.map((e) => `<option value="${e}" ${e === 'pro' ? 'selected' : ''}>${EDITION_LABEL[e]}</option>`).join('')}</select></div>
        <div><label>اشتراک آپدیت (ماه)</label><input name="updateMonths" type="number" min="0" max="120" value="12"></div>
        <div><label>حداکثر دستگاه</label><input name="maxActivations" type="number" min="1" max="20" value="1"></div>
        <div><label>خریدار</label><input name="buyer" placeholder="نام باشگاه"></div>
        <div><button type="submit">ساخت کلید</button></div>
      </form>
    </div>
    <div class="card">
      <table><thead><tr><th>کلید</th><th>نسخه</th><th>خریدار</th><th>آپدیت</th><th>فعال‌سازی</th><th>وضعیت</th><th></th></tr></thead><tbody>
      ${rows.length ? rows.map(([key, v]) => {
        const used = Object.values(a).filter((x) => x.licenseKey === key).length;
        return `<tr>
          <td class="num"><code>${esc(key)}</code></td>
          <td>${EDITION_LABEL[v.edition] ?? esc(v.edition)}</td>
          <td>${esc(v.buyer ?? '—')}</td>
          <td class="num">${fa(v.updateMonths ?? 12)} ماه</td>
          <td class="num">${fa(used)}/${fa(v.maxActivations ?? 1)}</td>
          <td>${v.disabled ? '<span class="chip bad">غیرفعال</span>' : '<span class="chip ok">فعال</span>'}</td>
          <td style="display:flex;gap:.35rem"><a href="/licenses/${encodeURIComponent(key)}">جزئیات</a>
            <form method="post" action="/licenses/${encodeURIComponent(key)}/toggle" style="margin:0"><input type="hidden" name="csrf" value="${csrfToken(session)}"><button class="ghost" style="min-height:26px;padding:.15rem .5rem;font-size:12px">${v.disabled ? 'فعال‌سازی' : 'غیرفعال'}</button></form>
          </td></tr>`;
      }).join('') : '<tr><td colspan="7" class="muted">هنوز کلیدی ساخته نشده</td></tr>'}
      </tbody></table>
    </div>`,
  });
}

function licenseDetailPage(session, key, flash) {
  const record = keys()[key];
  if (!record) return licensesPage(session, { tone: 'bad', text: 'کلید پیدا نشد' });
  const a = activations();
  const devices = Object.entries(a).filter(([, v]) => v.licenseKey === key);
  return layout({
    title: `لایسنس ${key}`,
    session,
    active: '/licenses',
    flash,
    body: `<h1>لایسنس <code>${esc(key)}</code></h1>
    <div class="card grid">
      <div><div class="muted">نسخه</div><div>${EDITION_LABEL[record.edition] ?? esc(record.edition)}</div></div>
      <div><div class="muted">خریدار</div><div>${esc(record.buyer ?? '—')}</div></div>
      <div><div class="muted">اشتراک آپدیت</div><div class="num">${fa(record.updateMonths ?? 12)} ماه</div></div>
      <div><div class="muted">دستگاه‌های فعال</div><div class="num">${fa(devices.length)} از ${fa(record.maxActivations ?? 1)}</div></div>
      <div><div class="muted">وضعیت</div><div>${record.disabled ? '<span class="chip bad">غیرفعال</span>' : '<span class="chip ok">فعال</span>'}</div></div>
    </div>
    <div class="card">
      <div class="muted">ویژگی‌های این نسخه (همان‌ها که برنامه показывает)</div>
      <div style="margin-top:.35rem">${(record.features ?? ['core']).map((f) => `<span class="chip ok" style="margin-left:.35rem">${esc(FEATURE_LABEL[f] ?? f)}</span>`).join('')}</div>
    </div>
    <div class="card">
      <h1 style="font-size:1rem">دستگاه‌های فعال</h1>
      <table><thead><tr><th>Machine ID</th><th>تاریخ</th><th>نسخهٔ برنامه</th><th></th></tr></thead><tbody>
      ${devices.length ? devices.map(([mid, v]) => `<tr><td class="num"><code>${esc(mid)}</code></td><td class="num">${esc(String(v.at).slice(0, 10))}</td><td class="num">${esc(v.appVersion ?? '—')}</td>
        <td><form method="post" action="/licenses/${encodeURIComponent(key)}/deactivate" style="margin:0"><input type="hidden" name="csrf" value="${csrfToken(session)}"><input type="hidden" name="machineId" value="${esc(mid)}"><button class="ghost" style="min-height:26px;padding:.15rem .5rem;font-size:12px">آزاد کردن اسلات</button></form></td></tr>`).join('') : '<tr><td colspan="4" class="muted">هنوز روی دستگاهی فعال نشده</td></tr>'}
      </tbody></table>
    </div>
    <div class="card">
      <h1 style="font-size:1rem">توکن بازیابی رمز (برای فراموشی رمز کاربر)</h1>
      <p class="muted">Machine ID را از صفحهٔ «لایسنس» در برنامهٔ مشتری بگیرید؛ توکن فقط روی همان دستگاه و برای همان نام کاربری معتبر است.</p>
      <form method="post" action="/licenses/${encodeURIComponent(key)}/recovery" class="grid">
        <input type="hidden" name="csrf" value="${csrfToken(session)}">
        <div><label>Machine ID</label><input name="machineId" required placeholder="32 کاراکتر"></div>
        <div><label>نام کاربری</label><input name="username" required placeholder="admin"></div>
        <div><label>اعتبار (دقیقه)</label><input name="minutes" type="number" value="60" min="5" max="10080"></div>
        <div><button type="submit">ساخت توکن</button></div>
      </form>
    </div>`,
  });
}

function updatesPage(session, flash, published) {
  const current = readJson(MANIFEST_FILE, null);
  return layout({
    title: 'آپدیت‌ها',
    session,
    active: '/updates',
    flash,
    body: `<h1>انتشار آپدیت</h1>
    <div class="card">
      <p class="muted">فایل نصب را در <code>server/releases/</code> بگذارید (همراه سرویس API سرو می‌شود) و اینجا نسخه را ثبت کنید. مانیفست با کلید خصوصی امضا می‌شود؛ برنامه قبل از نصب، امضا و sha256 را بررسی می‌کند.</p>
      <form method="post" action="/updates/publish">
        <input type="hidden" name="csrf" value="${csrfToken(session)}">
        <div class="grid">
          <div><label>نسخه</label><input name="version" placeholder="1.0.1" required></div>
          <div><label>نام فایل در releases</label><input name="fileName" placeholder="GymPro-Setup-1.0.1.exe" required></div>
          <div><label>اجباری؟</label><select name="mandatory"><option value="">خیر</option><option value="1">بله</option></select></div>
          <div><label>یادداشت نسخه</label><input name="notes" placeholder="چه چیزی تغییر کرده"></div>
        </div>
        <div style="margin-top:.8rem"><button type="submit">امضا و انتشار</button></div>
      </form>
    </div>
    ${published ? `<div class="card"><h1 style="font-size:1rem">مانیفست فعلی</h1><pre>${esc(JSON.stringify(published, null, 2))}</pre></div>` : current ? `<div class="card"><h1 style="font-size:1rem">مانیفست فعلی</h1><pre>${esc(JSON.stringify(current, null, 2))}</pre></div>` : '<div class="card muted">هنوز آپدیتی منتشر نشده</div>'}`,
  });
}

function ticketsPage(session) {
  const t = Object.values(tickets()).sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)));
  return layout({
    title: 'تیکت‌ها',
    session,
    active: '/tickets',
    body: `<h1>تیکت‌های پشتیبانی</h1>
    <div class="card"><table><thead><tr><th>موضوع</th><th>دسته</th><th>کلید</th><th>وضعیت</th><th>تاریخ</th><th></th></tr></thead><tbody>
    ${t.length ? t.map((x) => `<tr><td>${esc(x.subject)}</td><td>${esc(x.category)}</td><td class="num"><code>${esc(x.licenseKey ?? '—')}</code></td>
      <td><span class="chip ${x.status === 'closed' ? 'ok' : 'warn'}">${STATUS_LABEL[x.status] ?? esc(x.status)}</span></td>
      <td class="num">${esc(String(x.createdAt).slice(0, 16).replace('T', ' '))}</td>
      <td><a href="/tickets/${esc(x.remoteId)}">پاسخ دادن</a></td></tr>`).join('') : '<tr><td colspan="6" class="muted">تیکتی نیست</td></tr>'}
    </tbody></table></div>`,
  });
}

function ticketPage(session, id, flash) {
  const t = tickets()[id];
  if (!t) return ticketsPage(session);
  return layout({
    title: t.subject,
    session,
    active: '/tickets',
    flash,
    body: `<h1>${esc(t.subject)}</h1>
    <p class="muted">دسته: ${esc(t.category)} · کلید: <code>${esc(t.licenseKey ?? '—')}</code> · نسخهٔ برنامه: ${esc(t.appVersion ?? '—')} · وضعیت: ${STATUS_LABEL[t.status] ?? esc(t.status)}</p>
    <div class="card">
      ${t.messages.map((m) => `<div style="border:1px solid var(--edge);border-radius:10px;padding:.6rem .8rem;margin-bottom:.6rem"><div class="muted" style="font-size:11.5px">${m.direction === 'in' ? 'مشتری' : 'پشتیبانی'} · ${esc(String(m.createdAt).slice(0, 16).replace('T', ' '))}</div><div style="white-space:pre-wrap">${esc(m.body)}</div></div>`).join('')}
    </div>
    <div class="card">
      <form method="post" action="/tickets/${esc(id)}/reply">
        <input type="hidden" name="csrf" value="${csrfToken(session)}">
        <label>پاسخ شما</label>
        <textarea name="body" rows="4" required></textarea>
        <div style="margin-top:.8rem;display:flex;gap:.5rem">
          <button type="submit">ارسال پاسخ</button>
        </div>
      </form>
      <form method="post" action="/tickets/${esc(id)}/close" style="margin-top:.6rem"><input type="hidden" name="csrf" value="${csrfToken(session)}"><button class="ghost">بستن تیکت</button></form>
    </div>`,
  });
}

function helpPage(session) {
  return layout({
    title: 'راهنما',
    session,
    active: '/help',
    body: `<h1>راهنمای راه‌اندازی روی سرور</h1>
    <div class="card"><ol>
      <li>کلیدها را در <code>server/keys/</code> نگه دارید؛ کلید خصوصی <code>license-private.pem</code> را هرگز جایی آپلود نکنید.</li>
      <li>سرویس API: <code>node server/index.mjs</code> (پورت ۸۷۸۷) — برای فعال‌سازی، دی‌اکتیو، آپدیت و تیکت.</li>
      <li>پنل مدیریت: <code>ADMIN_PASSWORD='رمز-قوی' node server/admin.mjs</code> (پورت ۸۸۹۹).</li>
      <li>nginx: دو server block یا یک دامنه با <code>/admin</code> پروکسی به ۸۸۹۹.</li>
      <li>pm2: <code>pm2 start server/index.mjs --name gympro-api</code> و <code>pm2 start server/admin.mjs --name gympro-admin</code></li>
      <li>پشتیبان: پوشهٔ <code>server/data</code> (کلیدها، فعال‌سازی‌ها، تیکت‌ها) و <code>server/keys</code>.</li>
    </ol></div>`,
  });
}

/* ─────────── request handling ─────────── */

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1_000_000) reject(new Error('too large'));
    });
    req.on('end', () => {
      const params = new URLSearchParams(raw);
      resolve(Object.fromEntries(params));
    });
    req.on('error', reject);
  });
}

const redirect = (res, to, flash) => {
  const url = new URL(to, BASE_URL);
  if (flash) {
    url.searchParams.set('ok', flash.tone === 'ok' ? flash.text : '');
    if (flash.tone !== 'ok') url.searchParams.set('err', flash.text);
  }
  res.writeHead(303, { location: url.pathname + url.search });
  res.end();
};

function flashFrom(url) {
  const ok = url.searchParams.get('ok');
  const err = url.searchParams.get('err');
  if (ok) return { tone: 'ok', text: ok };
  if (err) return { tone: 'bad', text: err };
  return null;
}

function requireSession(req, res) {
  const session = readSession(req.headers.cookie);
  if (!session) {
    res.writeHead(303, { location: '/login' });
    res.end();
    return null;
  }
  return session;
}

function sameOriginPost(req) {
  const origin = req.headers.origin;
  if (origin === undefined) return true; // some clients omit Origin entirely
  const fetchSite = req.headers['sec-fetch-site'];
  // Opaque origin: sandboxed iframe, privacy extension, or an in-app browser/webview.
  // No cross-site form can claim `Sec-Fetch-Site: same-origin`, so that header is the
  // decision here; every authenticated POST still needs its session-bound CSRF token.
  if (origin === 'null') {
    const ok = fetchSite === undefined || fetchSite === 'same-origin' || fetchSite === 'none';
    if (!ok) console.warn('[admin] POST rejected: Origin null with Sec-Fetch-Site', fetchSite);
    return ok;
  }
  const bare = (value) => {
    if (!value) return '';
    try {
      // host:port -> host, lowercase; tolerate proxies that add a port
      return new URL(value.includes('://') ? value : `http://${value}`).hostname.toLowerCase();
    } catch {
      return '';
    }
  };
  const originHost = bare(origin);
  const candidates = new Set(
    [req.headers.host, req.headers['x-forwarded-host'], BASE_URL]
      .map(bare)
      .filter(Boolean),
  );
  if (!originHost) {
    console.warn('[admin] POST rejected: unparseable Origin', JSON.stringify(origin));
    return false;
  }
  if (candidates.has(originHost)) return true;
  console.warn('[admin] POST rejected: Origin', originHost, 'not in', [...candidates].join('|'), 'host=', req.headers.host);
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE_URL);
  const ip = req.socket.remoteAddress ?? 'x';
  try {
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, service: 'gympro-admin', time: new Date().toISOString() }));
    }

    if (url.pathname === '/login' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(loginPage(null));
    }

    if (url.pathname === '/login' && req.method === 'POST') {
      if (!sameOriginPost(req)) {
        res.writeHead(403);
        return res.end('forbidden');
      }
      if (throttled(ip)) {
        res.writeHead(429, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(loginPage('تلاش‌های زیاد؛ ۱۰ دقیقه بعد دوباره امتحان کنید'));
      }
      const body = await parseBody(req);
      if (!verifyPassword(body.password ?? '', admin.hash)) {
        noteFailure(ip);
        res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(loginPage('رمز نادرست است'));
      }
      clearFailures(ip);
      const payload = { sid: crypto.randomBytes(12).toString('hex'), exp: Date.now() + 12 * 3600_000 };
      res.writeHead(303, {
        'set-cookie': `gp_admin=${encodeURIComponent(signSession(payload))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`,
        location: '/dashboard',
      });
      return res.end();
    }

    if (url.pathname === '/logout') {
      res.writeHead(303, { 'set-cookie': 'gp_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0', location: '/login' });
      return res.end();
    }

    if (url.pathname.startsWith('/releases/')) {
      const file = path.join(__dirname, 'releases', path.basename(url.pathname));
      if (!fs.existsSync(file)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end('not found');
      }
      const data = fs.readFileSync(file);
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': data.length,
        'content-disposition': `attachment; filename="${path.basename(file)}"`,
      });
      return res.end(data);
    }

    const session = requireSession(req, res);
    if (!session) return;

    const flash = flashFrom(url);

    if (req.method === 'POST') {
      if (!sameOriginPost(req)) {
        res.writeHead(403);
        return res.end('forbidden');
      }
      const body = await parseBody(req);
      if (body.csrf !== csrfToken(session)) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(layout({ title: 'خطا', session, active: '', flash: { tone: 'bad', text: 'توکن فرم نامعتبر است؛ صفحه را دوباره باز کنید' }, body: '' }));
      }

      if (url.pathname === '/licenses/create') {
        const k = keys();
        const key = (body.licenseKey || '').trim().toUpperCase() || newKey();
        if (k[key]) return redirect(res, '/licenses', { tone: 'bad', text: 'این کلید از قبل وجود دارد' });
        k[key] = {
          edition: EDITIONS.includes(body.edition) ? body.edition : 'pro',
          updateMonths: Math.max(0, Math.min(120, Number(body.updateMonths ?? 12))),
          maxActivations: Math.max(1, Math.min(20, Number(body.maxActivations ?? 1))),
          features: body.edition === 'basic' ? ['core'] : ['core', 'pos', 'kiosk', 'reports', 'support'],
          buyer: (body.buyer || '').trim() || null,
          createdAt: new Date().toISOString(),
          disabled: false,
        };
        writeJson(KEYS_FILE, k);
        return redirect(res, `/licenses/${encodeURIComponent(key)}`, { tone: 'ok', text: `کلید ساخته شد: ${key}` });
      }

      const toggle = url.pathname.match(/^\/licenses\/([^/]+)\/toggle$/);
      if (toggle) {
        const key = decodeURIComponent(toggle[1]);
        const k = keys();
        if (k[key]) {
          k[key].disabled = !k[key].disabled;
          writeJson(KEYS_FILE, k);
        }
        return redirect(res, '/licenses', { tone: 'ok', text: 'وضعیت کلید تغییر کرد' });
      }

      const deactivate = url.pathname.match(/^\/licenses\/([^/]+)\/deactivate$/);
      if (deactivate) {
        const a = activations();
        delete a[body.machineId];
        writeJson(ACT_FILE, a);
        return redirect(res, `/licenses/${deactivate[1]}`, { tone: 'ok', text: 'اسلات دستگاه آزاد شد' });
      }

      if (url.pathname === '/updates/publish') {
        const privateKey = crypto.createPrivateKey(fs.readFileSync(path.join(__dirname, 'keys', 'license-private.pem'), 'utf8'));
        const file = path.join(__dirname, 'releases', path.basename(body.fileName ?? ''));
        if (!fs.existsSync(file)) return redirect(res, '/updates', { tone: 'bad', text: 'فایل در server/releases پیدا نشد' });
        const buf = fs.readFileSync(file);
        const manifest = {
          version: String(body.version ?? '').trim(),
          mandatory: body.mandatory === '1',
          notes: [String(body.notes ?? '').trim()].filter(Boolean),
          url: `${BASE_URL}/releases/${path.basename(file)}`,
          sha256: crypto.createHash('sha256').update(buf).digest('hex'),
          size: buf.length,
          publishedAt: new Date().toISOString(),
        };
        const signature = crypto.sign(null, Buffer.from(JSON.stringify(manifest, Object.keys(manifest).sort())), privateKey).toString('base64');
        writeJson(MANIFEST_FILE, { manifest, signature });
        return redirect(res, '/updates', { tone: 'ok', text: `نسخهٔ ${manifest.version} امضا و منتشر شد` });
      }

      const reply = url.pathname.match(/^\/tickets\/([^/]+)\/reply$/);
      if (reply) {
        const t = tickets();
        const ticket = t[reply[1]];
        if (ticket) {
          ticket.messages.push({ id: crypto.randomUUID(), direction: 'out', body: String(body.body ?? '').slice(0, 5000), createdAt: new Date().toISOString() });
          ticket.status = 'answered';
          writeJson(TICKETS_FILE, t);
        }
        return redirect(res, `/tickets/${reply[1]}`, { tone: 'ok', text: 'پاسخ ثبت شد' });
      }

      const close = url.pathname.match(/^\/tickets\/([^/]+)\/close$/);
      if (close) {
        const t = tickets();
        if (t[close[1]]) {
          t[close[1]].status = 'closed';
          writeJson(TICKETS_FILE, t);
        }
        return redirect(res, '/tickets', { tone: 'ok', text: 'تیکت بسته شد' });
      }

      const recovery = url.pathname.match(/^\/licenses\/([^/]+)\/recovery$/);
      if (recovery) {
        const privateKey = crypto.createPrivateKey(fs.readFileSync(path.join(__dirname, 'keys', 'license-private.pem'), 'utf8'));
        const payload = {
          v: 1,
          kind: 'password-recovery',
          machineId: String(body.machineId ?? '').trim().toUpperCase(),
          username: String(body.username ?? '').trim(),
          exp: new Date(Date.now() + Math.max(5, Math.min(10080, Number(body.minutes ?? 60))) * 60_000).toISOString(),
        };
        const signature = crypto.sign(null, Buffer.from(JSON.stringify(payload, Object.keys(payload).sort())), privateKey).toString('base64');
        const text = `متن توکن:\n${JSON.stringify(payload)}\n\nامضا:\n${signature}`;
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(
          layout({
            title: 'توکن بازیابی',
            session,
            active: '/licenses',
            body: `<h1>توکن بازیابی صادر شد</h1>
              <div class="card"><p class="muted">این دو مقدار را برای مشتری بفرستید؛ او در صفحهٔ ورود → «رمز عبور را فراموش کرده‌ام» → تب «توکن پشتیبانی» جای‌گذاری می‌کند. اعتبار: ${fa(Math.max(5, Math.min(10080, Number(body.minutes ?? 60))))} دقیقه.</p>
              <pre>${esc(text)}</pre></div>`,
          }),
        );
      }
    }

    if (url.pathname === '/' || url.pathname === '/dashboard') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(dashboardPage(session));
    }
    if (url.pathname === '/licenses') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(licensesPage(session, flash));
    }
    const detail = url.pathname.match(/^\/licenses\/([^/]+)$/);
    if (detail) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(licenseDetailPage(session, decodeURIComponent(detail[1]), flash));
    }
    if (url.pathname === '/updates') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(updatesPage(session, flash));
    }
    if (url.pathname === '/tickets') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(ticketsPage(session));
    }
    const ticket = url.pathname.match(/^\/tickets\/([^/]+)$/);
    if (ticket) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(ticketPage(session, ticket[1], flash));
    }
    if (url.pathname === '/help') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(helpPage(session));
    }

    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(layout({ title: 'نبود صفحه', session, active: '', body: '<div class="card">صفحه پیدا نشد</div>' }));
  } catch (e) {
    console.error('[admin]', e);
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('خطای سرور');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`GymPro admin on http://${HOST}:${PORT} — data: ${DATA}`);
  if (admin.bootstrapped) console.log('  (رمز اولیه در خروجی بالا چاپ شد و فقط یک‌بار ساخته می‌شود)');
});
