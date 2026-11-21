// ساخت لینک اختصاصی پنل مالک + محدودسازی دسترسی
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });

const file = path.join(DATA, 'admin-path.json');
let record = null;
try {
  record = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch {
  record = null;
}

// مسیر تصادفی ۲۴ کاراکتری که فقط مالک آن را می‌داند
if (!record?.slug) {
  const slug = crypto.randomBytes(12).toString('base64url').replace(/[-_]/g, '').slice(0, 20);
  record = { slug, createdAt: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(record, null, 2), { mode: 0o600 });
}

console.log(`لینک اختصاصی پنل:  /${record.slug}/login`);
console.log(`فایل: ${file}  (0600)`);
