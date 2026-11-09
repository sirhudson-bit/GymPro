// Displays the accounts stored in a GymPro database — offline, read-only, no app needed.
// usage: node scripts/show-users.mjs [dataDirOrDbPath]
//   portable : <folder of exe>\data
//   installed: %APPDATA%\GymPro\data
//   dev      : .dev-data
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const arg = process.argv[2] ?? path.join(process.env.APPDATA ?? process.env.HOME ?? '.', 'GymPro', 'data');
const candidate = fs.existsSync(arg) && fs.statSync(arg).isDirectory() ? path.join(arg, 'gympro.db') : arg;

if (!fs.existsSync(candidate)) {
  console.log(`پایگاه داده پیدا نشد: ${candidate}`);
  console.log('مسیر درست: پوشهٔ data کنار فایل GymPro.exe (حالت پرتابل) یا %APPDATA%\\GymPro\\data');
  process.exit(1);
}

const db = new DatabaseSync(candidate, { readOnly: true });
// tolerate older schema versions (recovery columns arrive in migration 0002)
const cols = new Set(db.prepare("PRAGMA table_info('users')").all().map((c) => c.name));
const pick = (name, fallback = 'NULL') => (cols.has(name) ? name : `${fallback} AS ${name}`);
const users = db
  .prepare(
    `SELECT username, full_name, role, is_active, last_login_at, password_hash,
            ${pick('recovery_hash')}, ${pick('password_changed_at')}
     FROM users WHERE deleted_at IS NULL ORDER BY created_at`,
  )
  .all();

const branch = db.prepare('SELECT name FROM branches WHERE deleted_at IS NULL LIMIT 1').get();

console.log(`فایل: ${candidate}`);
if (branch) console.log(`باشگاه: ${branch.name}`);
console.log('');

const ROLE = { owner: 'مالک', manager: 'مدیر', receptionist: 'منشی', trainer: 'مربی' };
if (users.length === 0) {
  console.log('هیچ کاربری ثبت نشده است (برنامه هنوز راه‌اندازی اولیه نشده).');
} else {
  for (const u of users) {
    const algo = String(u.password_hash ?? '').split('$')[0] || '—';
    console.log(`• ${u.username}`);
    console.log(`   نام: ${u.full_name}   نقش: ${ROLE[u.role] ?? u.role}   ${u.is_active ? 'فعال' : 'غیرفعال'}`);
    console.log(`   آخرین ورود: ${u.last_login_at ?? 'هرگز'}`);
    console.log(`   رمز: ${algo === 'scrypt' ? 'هش scrypt (قابل خواندن نیست)' : 'ثبت نشده'}`);
    console.log(`   کد بازیابی: ${u.recovery_hash ? 'تنظیم شده' : 'ندارد'}`);
    console.log('');
  }
}

const counts = ['members', 'contracts', 'payments'].map((t) => {
  const r = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get();
  return `${t}=${r.c}`;
});
console.log(`داده‌ها: ${counts.join('  ')}`);
console.log('\nیادآوری: رمز عبور با scrypt هش می‌شود و هیچ ابزاری (نه این اسکریپت، نه خود برنامه) نمی‌تواند آن را بازگرداند.');
db.close();
