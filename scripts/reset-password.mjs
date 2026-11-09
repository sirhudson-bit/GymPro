// Offline admin reset — LAST RESORT when both the recovery code and the support token are lost.
// Requires filesystem access to the club's data folder, i.e. the same access level that can read
// the whole database. Close the app before running it.
// usage: node scripts/reset-password.mjs <dataDir> <username> <newPassword>
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const [, , dataDir, username, newPassword] = process.argv;
if (!dataDir || !username || !newPassword) {
  console.error('usage: node scripts/reset-password.mjs <dataDir> <username> <newPassword>');
  process.exit(1);
}
if (newPassword.length < 6) {
  console.error('رمز جدید حداقل ۶ کاراکتر باشد');
  process.exit(1);
}

const dir = fs.existsSync(dataDir) && fs.statSync(dataDir).isDirectory() ? dataDir : path.dirname(dataDir);
const dbFile = path.join(dir, 'gympro.db');
if (!fs.existsSync(dbFile)) {
  console.error(`پایگاه داده پیدا نشد: ${dbFile}`);
  process.exit(1);
}
for (const suffix of ['-wal', '-shm']) {
  if (fs.existsSync(dbFile + suffix)) {
    console.error('برنامه در حال اجراست (فایل WAL موجود است). اول برنامه را کامل ببندید.');
    process.exit(1);
  }
}

const hash = (pw) => {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(pw, salt, 64).toString('hex')}`;
};

const db = new DatabaseSync(dbFile);
const user = db.prepare('SELECT id, username FROM users WHERE username = ? AND deleted_at IS NULL').get(username);
if (!user) {
  console.error(`کاربر «${username}» پیدا نشد.`);
  process.exit(1);
}

const now = new Date().toISOString();
db.prepare(
  `UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL,
     password_changed_at = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
).run(hash(newPassword), now, now, user.id);

// any "remember me" marker must die with the password change
try {
  fs.unlinkSync(path.join(dir, '.session'));
} catch {
  /* no session */
}

const branch = db.prepare('SELECT id FROM branches LIMIT 1').get();
db.prepare(
  'INSERT INTO audit_logs (id, branch_id, action, entity, entity_id, reason) VALUES (?,?,?,?,?,?)',
).run(
  randomBytes(16).toString('hex'),
  branch?.id ?? '',
  'auth.offline_reset',
  'user',
  user.id,
  'بازنشانی رمز با ابزار آفلاین (dسترسی به پوشهٔ داده)',
);

db.close();
console.log(`رمز کاربر «${username}» روی همین دستگاه عوض شد. حالا برنامه را باز کنید و با رمز تازه وارد شوید.`);
