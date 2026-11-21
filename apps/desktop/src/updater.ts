// به‌روزرسانی نرم‌افزار — دو مسیر مستقل:
// ۱) «گیت»: برای نصب از منبع (git clone). با git fetch وضعیت را می‌سنجد و با pull+rebuild به‌روز می‌کند.
// ۲) «انتشار»: نسخهٔ نصب‌شدنی را از GitHub Releases می‌گیرد و با امضای Ed25519 + sha256 بررسی می‌کند.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { app, shell } from 'electron';
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

export type GitStatus = {
  available: boolean;
  repoPath: string;
  branch: string;
  localSha: string;
  remoteSha: string;
  behind: number;
  files?: string[];
  error?: string;
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

/** اجرای یک دستور و برگرداندن خروجی؛ خطای غیرصفر → throw */
function run(cmd: string, args: string[], cwd: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true, shell: false });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`دستور در ${Math.round(timeoutMs / 1000)} ثانیه تمام نشد: ${cmd}`));
    }, timeoutMs);
    child.stdout?.on('data', (c) => (out += String(c)));
    child.stderr?.on('data', (c) => (err += String(c)));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(`${cmd} ${args.join(' ')} → ${code}\n${(err || out).slice(0, 800)}`));
    });
  });
}

/* ───────────────────────── مسیر گیت ───────────────────────── */

/** پوشهٔ منبع گیت: یا تنظیمات، یا پوشهٔ برنامه (نصب از منبع) */
export function repoPath(): string {
  const configured = settings.get('update.gitPath', '');
  if (configured && fs.existsSync(path.join(configured, '.git'))) return configured;
  if (!app.isPackaged) return process.cwd();
  const beside = path.dirname(app.getPath('exe'));
  for (const candidate of [beside, path.join(beside, '..', 'source')]) {
    if (fs.existsSync(path.join(candidate, '.git'))) return path.resolve(candidate);
  }
  return configured;
}

export async function gitStatus(): Promise<GitStatus> {
  const repo = repoPath();
  const empty: GitStatus = { available: false, repoPath: repo, branch: 'main', localSha: '', remoteSha: '', behind: 0 };
  if (!repo || !fs.existsSync(path.join(repo, '.git'))) {
    return { ...empty, error: 'این نصب از منبع گیت نیست؛ از مسیر انتشار نسخه استفاده کنید.' };
  }
  try {
    const branch = (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], repo)).trim() || 'main';
    await run('git', ['fetch', '--prune', 'origin'], repo, 90_000);
    const localSha = (await run('git', ['rev-parse', 'HEAD'], repo)).trim();
    const remoteSha = (await run('git', ['rev-parse', `origin/${branch}`], repo)).trim();
    const behind = Number((await run('git', ['rev-list', '--count', `HEAD..origin/${branch}`], repo)).trim() || 0);
    const files = behind > 0 ? (await run('git', ['diff', '--name-only', `HEAD..origin/${branch}`], repo)).split('\n').filter(Boolean).slice(0, 40) : [];
    return { available: true, repoPath: repo, branch, localSha, remoteSha, behind, files };
  } catch (e) {
    return { ...empty, available: false, error: String((e as Error).message ?? e).slice(0, 400) };
  }
}

/** pull و بازسازی؛ فقط وقتی git و npm روی سیستم موجود باشند */
export async function gitPullAndBuild(onLine?: (line: string) => void): Promise<{ ok: boolean; message: string; output?: string[] }> {
  const repo = repoPath();
  if (!repo || !fs.existsSync(path.join(repo, '.git'))) throw new Error('پوشهٔ منبع گیت پیدا نشد');
  const status = await gitStatus();
  if (!status.available) throw new Error(status.error ?? 'وضعیت گیت خوانده نشد');
  if (status.behind === 0) return { ok: true, message: 'برنامه به‌روز است؛ نسخهٔ جدیدی نیست.' };

  const output: string[] = [];
  const say = (line: string) => {
    output.push(line);
    onLine?.(line);
  };

  say(`git pull (${status.branch}) …`);
  await run('git', ['pull', '--ff-only', 'origin', status.branch], repo, 180_000);
  say('نصب وابستگی‌ها…');
  await run('npm', ['install', '--no-audit', '--no-fund'], repo, 600_000);
  say('ساخت برنامه…');
  await run('npm', ['run', 'build'], repo, 900_000);
  say('آماده شد.');
  db().run(
    'INSERT INTO update_history (id, from_version, to_version, manifest_json, signature, status, applied_at) VALUES (?,?,?,?,?,?,?)',
    uuidv7(),
    currentVersion(),
    `${currentVersion()}-git`,
    JSON.stringify({ mode: 'git', sha: status.remoteSha }),
    '',
    'pulled',
    nowIso(),
  );
  log.info('update.git.pulled', { from: status.localSha, to: status.remoteSha });
  return { ok: true, message: 'به‌روزرسانی از گیت انجام شد. برنامه را ببندید و دوباره باز کنید.', output };
}

/* ───────────────────────── مسیر انتشار (نصب‌شدنی) ───────────────────────── */

async function fetchManifest(baseUrl: string): Promise<{ manifest: UpdateManifest; signature: string }> {
  const url = `${baseUrl.replace(/\/$/, '')}/latest.json`;
  const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`سرور آپدیت پاسخ نداد (${res.status})`);
  const body = (await res.json()) as { manifest: UpdateManifest; signature: string };
  if (!body?.manifest || !body?.signature) throw new Error('مانیفست آپدیت ناقص است');
  return body;
}

export async function checkForUpdate(opts: { force?: boolean } = {}) {
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
  const file = path.join(dir, path.basename(new URL(manifest.url).pathname) || `GymPro-Setup-${manifest.version}.exe`);
  const res = await fetch(manifest.url);
  if (!res.ok || !res.body) throw new Error(`دانلود آپدیت ناموفق بود (${res.status})`);
  const total = Number(res.headers.get('content-length') ?? manifest.size ?? 0);
  const chunks: Uint8Array[] = [];
  let received = 0;
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

/** اجرای نصب‌کننده و باز شدن برنامهٔ به‌روزشده */
export async function installDownloaded(file: string): Promise<{ ok: boolean; message: string }> {
  if (!fs.existsSync(file)) throw new Error('فایل آپدیت پیدا نشد');
  log.info('update.install.started', { file });
  await shell.openPath(file);
  return { ok: true, message: 'نصب‌کننده باز شد. پس از پایان نصب، برنامه خودکار اجرا می‌شود.' };
}
