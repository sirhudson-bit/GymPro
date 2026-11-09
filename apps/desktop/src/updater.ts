import fs from 'node:fs';
import path from 'node:path';
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { app } from 'electron';
import { settings } from './repo';
import { log } from './logger';
import { db, uuidv7, nowIso } from './db';

const PUBLIC_KEY_DER_B64 = 'MCowBQYDK2VwAyEAunIeRCXHcGrbtguiM7xRbRbudHYnaK835veFZShDIsc=';

export type UpdateManifest = {
  version: string;
  minSupported?: string;
  mandatory?: boolean;
  notes?: string[];
  url: string;
  sha256: string;
  size?: number;
  publishedAt?: string;
};

function key() {
  return createPublicKey({ key: Buffer.from(PUBLIC_KEY_DER_B64, 'base64'), format: 'der', type: 'spki' });
}

export function verifyManifest(manifest: UpdateManifest, signatureB64: string): boolean {
  const payload = JSON.stringify(manifest, Object.keys(manifest).sort());
  try {
    return cryptoVerify(null, Buffer.from(payload), key(), Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

export function currentVersion(): string {
  try {
    return app.getVersion();
  } catch {
    return '1.0.0';
  }
}

async function fetchManifest(baseUrl: string): Promise<{ manifest: UpdateManifest; signature: string }> {
  const url = `${baseUrl.replace(/\/$/, '')}/latest.json`;
  const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`سرور آپدیت پاسخ نداد (${res.status})`);
  const body = (await res.json()) as { manifest: UpdateManifest; signature: string };
  if (!body?.manifest || !body?.signature) throw new Error('مانیفست آپدیت ناقص است');
  return body;
}

export async function checkForUpdate(dataDir: string, opts: { force?: boolean } = {}) {
  const url = settings.get('update.url', '');
  if (!url) throw new Error('آدرس سرور آپدیت در تنظیمات وارد نشده است');
  const status = settings.get('update.entitlement', '');
  if (!opts.force && status === 'expired') throw new Error('اشتراک آپدیت شما به پایان رسیده است؛ برای دریافت نسخهٔ جدید تمدید کنید.');

  const { manifest, signature } = await fetchManifest(url);
  if (!verifyManifest(manifest, signature)) throw new Error('امضای مانیفست آپدیت معتبر نیست — به‌روزرسانی متوقف شد');

  const current = currentVersion();
  const newer = compareVersions(manifest.version, current) > 0;
  return { available: newer, current, manifest, signature };
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n) || 0);
  const pb = b.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export async function downloadUpdate(dataDir: string, manifest: UpdateManifest, signature: string, onProgress?: (pct: number) => void) {
  const dir = path.join(dataDir, 'updates');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, path.basename(new URL(manifest.url).pathname) || `GymPro-${manifest.version}.exe`);
  const res = await fetch(manifest.url);
  if (!res.ok || !res.body) throw new Error(`دانلود آپدیت ناموفق بود (${res.status})`);
  const total = Number(res.headers.get('content-length') ?? manifest.size ?? 0);
  const chunks: Uint8Array[] = [];
  let received = 0;
  // @ts-expect-error Node 24 fetch body is an async iterable
  for await (const chunk of res.body) {
    chunks.push(chunk as Uint8Array);
    received += (chunk as Uint8Array).length;
    if (total > 0 && onProgress) onProgress(Math.min(100, Math.round((received / total) * 100)));
  }
  const buf = Buffer.concat(chunks);
  const hash = createHash('sha256').update(buf).digest('hex');
  if (manifest.sha256 && hash !== manifest.sha256.toLowerCase()) {
    log.error('update.hash_mismatch', { expected: manifest.sha256, got: hash });
    throw new Error('فایل دانلودشده با امضای اعلام‌شده تطابق ندارد؛ نصب انجام نشد');
  }
  fs.writeFileSync(file, buf);
  db().run(
    'INSERT INTO update_history (id, from_version, to_version, manifest_json, signature, status, applied_at) VALUES (?,?,?,?,?,?,?)',
    uuidv7(),
    currentVersion(),
    manifest.version,
    JSON.stringify(manifest),
    signature,
    'downloaded',
    nowIso(),
  );
  return { file, size: buf.length };
}
