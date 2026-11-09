// آزمون انتشار آپدیت: امضا + بررسی امضا با کلید عمومی
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.env.ADMIN_BASE ?? 'http://127.0.0.1:8899';
const PASS = process.env.ADMIN_PASSWORD ?? '';
let cookie = '';
const req = async (p, o = {}) => {
  const r = await fetch(BASE + p, { ...o, redirect: 'manual', headers: { ...(o.headers ?? {}), ...(cookie ? { cookie } : {}) } });
  for (const c of r.headers.getSetCookie?.() ?? []) {
    const pair = c.split(';')[0];
    if (pair.startsWith('gp_admin=')) cookie = pair;
  }
  return { status: r.status, text: await r.text(), location: r.headers.get('location') };
};

const login = await req('/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `password=${encodeURIComponent(PASS)}` });
console.log('login →', login.status, login.location);

const page = await req('/updates');
console.log('/updates →', page.status, page.text.length, 'bytes');
const csrf = page.text.match(/name="csrf" value="([^"]+)"/)?.[1];
console.log('csrf:', csrf ?? 'NOT FOUND');

const pub = await req('/updates/publish', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ csrf, version: '1.0.1', fileName: 'GymPro-Setup-1.0.1.exe', mandatory: '', notes: 'رفع باگ چاپ فاکتور' }).toString(),
});
console.log('publish →', pub.status, decodeURIComponent(pub.location ?? ''));

const signed = JSON.parse(fs.readFileSync('server/data/manifest.signed.json', 'utf8'));
const publicKey = crypto.createPublicKey(fs.readFileSync('server/keys/license-public.pem', 'utf8'));
const valid = crypto.verify(null, Buffer.from(JSON.stringify(signed.manifest, Object.keys(signed.manifest).sort())), publicKey, Buffer.from(signed.signature, 'base64'));
console.log('manifest:', signed.manifest.version, '| sha256:', signed.manifest.sha256.slice(0, 16), '…', '| size:', signed.manifest.size, '| امضا معتبر:', valid);

// tamper test
signed.manifest.version = '9.9.9';
const tampered = crypto.verify(null, Buffer.from(JSON.stringify(signed.manifest, Object.keys(signed.manifest).sort())), publicKey, Buffer.from(signed.signature, 'base64'));
console.log('دست‌کاری نسخه → امضا معتبر؟', tampered, tampered ? 'BUG' : '(درست رد شد)');
