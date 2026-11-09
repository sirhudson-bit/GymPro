// آزمون end-to-end پنل مدیریت: ورود، ساخت کلید، جزئیات، تیکت، انتشار آپدیت
const BASE = process.env.ADMIN_BASE ?? 'http://127.0.0.1:8899';
const PASS = process.env.ADMIN_PASSWORD;
let cookie = '';
const log = (...a) => console.log(...a);

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    redirect: 'manual',
    headers: { ...(opts.headers ?? {}), ...(cookie ? { cookie } : {}) },
  });
  const set = res.headers.getSetCookie?.() ?? [];
  for (const c of set) {
    const pair = c.split(';')[0];
    if (pair.startsWith('gp_admin=')) cookie = pair;
  }
  const text = await res.text();
  return { status: res.status, location: res.headers.get('location'), text };
}

const csrfOf = (html) => html.match(/name="csrf" value="([^"]+)"/)?.[1];

// 1) صفحهٔ ورود
let r = await req('/login');
log('1) GET /login →', r.status, r.text.includes('رمز مدیر') ? 'صفحهٔ ورود سالم' : 'صفحهٔ ورود مشکل دارد');

// 2) رمز غلط
r = await req('/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=wrong-pass' });
log('2) رمز غلط →', r.status, r.status === 401 ? 'رد شد (درست)' : 'باید ۴۰۱ می‌داد');

// 3) رمز درست
r = await req('/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `password=${encodeURIComponent(PASS)}` });
log('3) رمز درست →', r.status, r.location, cookie ? 'کوکی نشست ست شد' : 'کوکی ندارد!');

// 4) داشبورد
r = await req('/dashboard');
log('4) داشبورد →', r.status, r.text.includes('کلیدهای فعال') ? 'KPI سالم' : 'KPI نیست');

// 5) لیست لایسنس
r = await req('/licenses');
const csrf = csrfOf(r.text);
log('5) لیست لایسنس →', r.status, 'csrf:', csrf ? 'دارد' : 'ندارد', 'ردیف‌ها:', (r.text.match(/<code>GP-/g) ?? []).length);

// 6) ساخت کلید جدید
const buyer = `باشگاه تست ${Date.now() % 100000}`;
r = await req('/licenses/create', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ csrf, edition: 'pro', updateMonths: '12', maxActivations: '2', buyer }).toString(),
});
log('6) ساخت کلید →', r.status, decodeURIComponent(r.location ?? ''));

// 7) جزئیات همان کلید از ریدایرکت
const key = decodeURIComponent((r.location ?? '').split('/licenses/')[1] ?? '');
r = await req('/licenses/' + encodeURIComponent(key));
log('7) جزئیات کلید →', r.status, r.text.includes(buyer) ? 'خریدار دیده می‌شود' : 'خریدار نیست', r.text.includes('توکن بازیابی') ? 'فرم بازیابی هست' : 'فرم بازیابی نیست');

// 8) توکن بازیابی
const csrf2 = csrfOf(r.text);
r = await req(`/licenses/${encodeURIComponent(key)}/recovery`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ csrf: csrf2, machineId: 'ABCDEF0123456789ABCDEF0123456789', username: 'admin', minutes: '30' }).toString(),
});
log('8) توکن بازیابی →', r.status, /همه|توکن بازیابی صادر شد/.test(r.text) && r.text.includes('password-recovery') ? 'توکن امضا شد' : 'خروجی ناقص');

// 9) تیکت‌ها
r = await req('/tickets');
const ticketId = r.text.match(/\/tickets\/([0-9a-zA-Z-]{6,})/)?.[1];
log('9) لیست تیکت →', r.status, ticketId ? `تیکت ${ticketId}` : 'تیکتی موجود نیست');

// 10) پاسخ به تیکت
if (ticketId) {
  const before = (await req(`/tickets/${ticketId}`)).text;
  const c = csrfOf(before);
  r = await req(`/tickets/${ticketId}/reply`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf: c, body: 'پاسخ آزمایشی پشتیبانی — سلام، مشکل بررسی شد.' }).toString(),
  });
  const after = (await req(`/tickets/${ticketId}`)).text;
  log('10) پاسخ تیکت →', r.status, after.includes('پاسخ آزمایشی پشتیبانی') ? 'پاسخ ثبت و نمایش داده شد' : 'پاسخ ثبت نشد');
}

// 11) CSRF نامعتبر
r = await req('/licenses/create', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ csrf: 'bogus', edition: 'pro', updateMonths: '12', maxActivations: '1' }).toString(),
});
log('11) CSRF جعلی →', r.status, r.status === 400 ? 'رد شد (درست)' : 'باید ۴۰۰ می‌داد');

// 12) دسترسی بدون کوکی
cookie = '';
r = await req('/licenses');
log('12) بدون نشست →', r.status, r.location, r.location === '/login' ? 'هدایت به ورود (درست)' : 'باید هدایت می‌شد');

// 13) انتشار آپدیت بدون فایل
cookie = '';
await req('/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `password=${encodeURIComponent(PASS)}` });
const up = await req('/updates');
const cu = csrfOf(up.text);
r = await req('/updates/publish', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ csrf: cu, version: '9.9.9', fileName: 'does-not-exist.exe', notes: 't' }).toString(),
});
log('13) انتشار بدون فایل →', r.status, decodeURIComponent(r.location ?? ''), 'باید خطا بدهد');
