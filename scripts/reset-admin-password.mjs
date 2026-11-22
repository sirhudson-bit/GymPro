// ریست رمز پنل مالک (سرور لایسنس). بدون نیاز به دسترسی SSH دستی:
// usage: node scripts/reset-admin-password.mjs <newPassword> [dataDir]
//   node scripts/reset-admin-password.mjs 'Panel!New99'
//   node scripts/reset-admin-password.mjs 'Panel!New99' /var/www/gym-admin/data
//
// چرا اسکریپت و نه «پاک کردن admin.json»: با پاک کردن فایل، اگر ADMIN_PASSWORD
// در محیط نباشد یک رمز تصادفی ساخته می‌شود که باید از لاگ خوانده شود. اینجا
// فقط hash عوض می‌شود و secret دست‌نخورده می‌ماند تا نشست‌های باز معتبر بمانند.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';

const [, , newPassword, dir = process.env.GYMPRO_ADMIN_DATA ?? '/var/www/gym-admin/data'] = process.argv;

if (!newPassword || newPassword.length < 8) {
  console.error('رمز جدید را بدهید (حداقل ۸ کاراکتر):');
  console.error("  node scripts/reset-admin-password.mjs 'Panel!New99' /var/www/gym-admin/data");
  process.exit(1);
}

const file = path.join(dir, 'admin.json');
if (!fs.existsSync(file)) {
  console.error(`فایل رمز پیدا نشد: ${file}`);
  console.error('اگر پنل هنوز راه نیفتاده، فقط ADMIN_PASSWORD را ست کنید و سرویس را اجرا کنید.');
  process.exit(1);
}

const record = JSON.parse(fs.readFileSync(file, 'utf8'));
const salt = randomBytes(16).toString('hex');
const hash = `scrypt$${salt}$${scryptSync(newPassword, salt, 64).toString('hex')}`;

const next = {
  ...record,
  hash,
  bootstrapped: false,
  passwordChangedAt: new Date().toISOString(),
};
// نوشتن اتمیک با مجوز 0600 مثل خود سرور
const tmp = `${file}.${process.pid}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
fs.renameSync(tmp, file);

console.log('✓ رمز پنل عوض شد.');
console.log(`  فایل: ${file} (0600)`);
console.log(`  secret دست‌نخورده ماند: ${record.secret === next.secret ? 'بله (نشست‌های باز معتبرند)' : 'خیر'}`);
console.log('  حالا سرویس را ری‌استارت کنید:  pm2 restart gympro-admin');
