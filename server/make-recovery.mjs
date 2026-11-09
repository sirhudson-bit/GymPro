// Issues an offline password-recovery token for one machine + one username.
// usage: node server/make-recovery.mjs <machineId> <username> [minutes=60] [note]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateKey, sign } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const [, , machineId, username, minutes = '60', note = ''] = process.argv;

if (!machineId || !username) {
  console.error('usage: node server/make-recovery.mjs <machineId> <username> [minutes] [note]');
  console.error('  machineId از صفحهٔ «لایسنس» در برنامه یا از اسکریپت scripts/show-users.mjs');
  process.exit(1);
}

const payload = {
  v: 1,
  kind: 'password-recovery',
  machineId,
  username,
  exp: new Date(Date.now() + Number(minutes) * 60_000).toISOString(),
  ...(note ? { note } : {}),
};

const key = createPrivateKey(fs.readFileSync(path.join(__dirname, 'keys', 'license-private.pem'), 'utf8'));
const signature = sign(null, Buffer.from(JSON.stringify(payload, Object.keys(payload).sort())), key).toString('base64');

const out = { token: JSON.stringify(payload), signature, username, expiresAt: payload.exp };
fs.writeFileSync(path.join(__dirname, 'data', `recovery-${username}-${Date.now()}.json`), JSON.stringify(out, null, 2));

console.log('این دو مقدار را برای مشتری بفرستید (به‌ترتیب: متن توکن، امضا):\n');
console.log(out.token);
console.log(out.signature);
console.log(`\nاعتبار: ${minutes} دقیقه  |  دستگاه: ${machineId}  |  کاربر: ${username}`);
