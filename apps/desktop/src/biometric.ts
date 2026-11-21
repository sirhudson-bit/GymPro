// درایور دستگاه‌های اثر انگشت — ZKTeco / Suprema / Futronic
// اصل: هیچ تمپلیت اثر انگشتی از دستگاه بیرون کشیده نمی‌شود؛ فقط رکورد تردد.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { db, nowIso, uuidv7, todayLocal } from './db';
import { attendance, members } from './repo';
import { log } from './logger';

export type Brand = 'zkteco' | 'suprema' | 'futronic';
export type Punch = { deviceUserNo: string; punchedAt: string; direction?: 'in' | 'out' | null };

type BioDevice = {
  id: string;
  brand: Brand;
  label: string;
  mode: string;
  host: string | null;
  port: number | null;
  serial_no: string | null;
  api_user: string | null;
  api_secret: string | null;
  csv_path: string | null;
  punch_mode: 'in_out' | 'toggle';
};

const rows = <T = Record<string, unknown>>(sql: string, ...p: unknown[]) => db().all<T>(sql, ...p);
const row = <T = Record<string, unknown>>(sql: string, ...p: unknown[]) => db().get<T>(sql, ...p);

/* ───────────────────────── دستگاه‌ها ───────────────────────── */

export const devices = {
  list() {
    return rows(
      `SELECT d.*, (SELECT COUNT(*) FROM bio_punches p WHERE p.device_id = d.id AND p.status = 'new') AS pending
       FROM bio_devices d WHERE d.branch_id = ? AND d.deleted_at IS NULL ORDER BY d.created_at`,
      db().branchId,
    );
  },
  create(input: Partial<BioDevice> & { brand: Brand; label: string }) {
    if (!input.label?.trim()) throw new Error('نام دستگاه را وارد کنید');
    if (!['zkteco', 'suprema', 'futronic'].includes(input.brand)) throw new Error('برند نامعتبر است');
    const id = uuidv7();
    db().write({ entity: 'bio_device', entityId: id, op: 'create', version: 1, payload: input }, () => {
      db().run(
        `INSERT INTO bio_devices (id, branch_id, brand, label, mode, host, port, serial_no, api_user, api_secret, csv_path, punch_mode)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        id,
        db().branchId,
        input.brand,
        input.label.trim(),
        input.mode ?? defaultMode(input.brand),
        input.host ?? null,
        input.port ?? defaultPort(input.brand),
        input.serial_no ?? null,
        input.api_user ?? null,
        input.api_secret ?? null,
        input.csv_path ?? null,
        input.punch_mode ?? 'toggle',
      );
    });
    return row('SELECT * FROM bio_devices WHERE id = ?', id);
  },
  update(id: string, input: Partial<BioDevice>) {
    const current = row<BioDevice>('SELECT * FROM bio_devices WHERE id = ? AND deleted_at IS NULL', id);
    if (!current) throw new Error('دستگاه یافت نشد');
    db().write({ entity: 'bio_device', entityId: id, op: 'update', version: 1, payload: input }, () => {
      db().run(
        `UPDATE bio_devices SET label = ?, mode = ?, host = ?, port = ?, serial_no = ?, api_user = ?, api_secret = ?,
           csv_path = ?, punch_mode = ?, is_active = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
        String(input.label ?? current.label),
        String(input.mode ?? current.mode),
        input.host !== undefined ? input.host : current.host,
        input.port !== undefined ? Number(input.port) : current.port,
        input.serial_no !== undefined ? input.serial_no : current.serial_no,
        input.api_user !== undefined ? input.api_user : current.api_user,
        input.api_secret !== undefined ? input.api_secret : current.api_secret,
        input.csv_path !== undefined ? input.csv_path : current.csv_path,
        String(input.punch_mode ?? current.punch_mode),
        input.mode === undefined && (input as { is_active?: number }).is_active === undefined ? 1 : Number((input as { is_active?: number }).is_active ?? 1),
        nowIso(),
        id,
      );
    });
    return row('SELECT * FROM bio_devices WHERE id = ?', id);
  },
  remove(id: string) {
    db().write({ entity: 'bio_device', entityId: id, op: 'delete', version: 1, payload: { id } }, () => {
      db().run('UPDATE bio_devices SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
    });
    return { ok: true };
  },
  get(id: string) {
    const d = row<BioDevice>('SELECT * FROM bio_devices WHERE id = ? AND deleted_at IS NULL', id);
    if (!d) throw new Error('دستگاه یافت نشد');
    return d;
  },
};

function defaultMode(brand: Brand) {
  return brand === 'zkteco' ? 'tcp' : brand === 'suprema' ? 'biostar' : 'csv';
}
function defaultPort(brand: Brand) {
  return brand === 'zkteco' ? 4370 : brand === 'suprema' ? 443 : null;
}

/* ───────────────────────── آزمون اتصال ───────────────────────── */

export async function testConnection(device: BioDevice): Promise<{ ok: boolean; info?: Record<string, unknown>; error?: string }> {
  try {
    if (device.brand === 'zkteco') return await zktecoTest(device);
    if (device.brand === 'suprema') return await supremaTest(device);
    return futronicTest(device);
  } catch (e) {
    return { ok: false, error: faError(e) };
  }
}

function faError(e: unknown): string {
  // node-zklib sometimes rejects with a plain object ({code, errno, syscall}) instead of an Error
  const anyE = e as { message?: string; code?: string; errno?: number; syscall?: string } | string;
  const code = typeof anyE === 'object' && anyE ? String(anyE.code ?? anyE.errno ?? '') : '';
  const msg = typeof anyE === 'string' ? anyE : String(anyE?.message ?? '');
  const combined = `${code} ${msg}`.trim();
  if (/ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT|ENETUNREACH|timeout|ETIMEOUT|fetch failed/i.test(combined)) {
    return 'دستگاه پاسخ نداد. IP، پورت و اتصال شبکه را بررسی کنید (دستگاه و رایانه در یک شبکه باشند).';
  }
  if (/401|403|Unauthorized|Forbidden/i.test(combined)) return 'نام کاربری یا رمز API رد شد.';
  if (/ENOENT|no such file/i.test(combined)) return 'مسیر فایل/پوشه پیدا نشد.';
  if (/ENOTFOUND|EAI_AGAIN/i.test(combined)) return 'نام میزبان پیدا نشد؛ به‌جای نام، IP را وارد کنید.';
  if (/EADDRINUSE/i.test(combined)) return 'پورت محلی اشغال است؛ برنامهٔ دیگری از آن استفاده می‌کند.';
  const readable = msg || (code ? `کد خطا: ${code}` : '');
  return readable || 'خطای نامشخص در ارتباط با دستگاه';
}

/* ───────────────────────── ZKTeco ───────────────────────── */

type ZkInstance = {
  createSocket: () => Promise<void>;
  getInfo: () => Promise<{ userCounts?: number; logCounts?: number; logCapacity?: number }>;
  getAttendances: (cb?: (pct: number) => void) => Promise<{ data: Array<{ userSn?: number; deviceUserId?: string | number; recordTime?: string | Date }> }>;
  disconnect: () => Promise<void>;
  getUsers: () => Promise<{ data: Array<{ uid?: number; userId?: string | number; name?: string }> }>;
};

async function zkLib(device: BioDevice, timeoutMs = 6000): Promise<ZkInstance> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ZKLib = require('node-zklib') as new (ip: string, port: number, timeout: number, inport: number) => ZkInstance;
  const zk = new ZKLib(String(device.host), Number(device.port ?? 4370), timeoutMs, 4000);
  // node-zklib هرگز reject نمی‌کند وقتی دستگاه خاموش است؛ پس خودمان مهلت می‌گذاریم
  await Promise.race([
    zk.createSocket(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('ETIMEDOUT: دستگاه در زمان مقرر پاسخ نداد')), timeoutMs + 2000)),
  ]);
  return zk;
}

/** هر عملیات شبکه با مهلت، چون کتابخانه گاهی معلق می‌ماند */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`ETIMEDOUT: ${label}`)), ms)),
  ]);
}

async function zktecoTest(device: BioDevice) {
  if (!device.host) throw new Error('IP دستگاه را وارد کنید');
  if (device.mode === 'adms') {
    const { admsStatus, admsSeen } = await import('./adms');
    const st = admsStatus();
    if (!st.running) throw new Error(`شنوندهٔ ADMS روشن نیست. پورت ${st.port || 8090} را فعال کنید.`);
    const seen = admsSeen().find((r) => (device.serial_no ? r.sn === device.serial_no : true));
    if (!seen) {
      return {
        ok: false,
        info: { mode: 'adms', port: st.port },
        error: `شنونده روی پورت ${st.port} روشن است ولی رکوردی از دستگاه نرسیده. در دستگاه Server Address = IP این رایانه و Port = ${st.port}`,
      };
    }
    return { ok: true, info: { mode: 'adms', port: st.port, deviceSN: seen.sn, lastSeen: seen.at, lastCount: seen.count } };
  }
  const zk = await zkLib(device);
  try {
    const info = await withTimeout(zk.getInfo(), 12000, 'خواندن اطلاعات دستگاه');
    return {
      ok: true,
      info: {
        users: info?.userCounts ?? null,
        logs: info?.logCounts ?? null,
        capacity: info?.logCapacity ?? null,
        mode: device.mode,
      },
    };
  } finally {
    await zk.disconnect().catch(() => undefined);
  }
}

async function zktecoPull(device: BioDevice): Promise<Punch[]> {
  if (device.mode === 'adms') return []; // رکوردها لحظه‌ای از شنونده می‌آیند
  if (!device.host) throw new Error('IP دستگاه را وارد کنید');
  const zk = await zkLib(device);
  try {
    const res = await withTimeout(zk.getAttendances(), 90000, 'خواندن رکوردهای دستگاه');
    const out: Punch[] = [];
    for (const r of res?.data ?? []) {
      const userNo = String(r.deviceUserId ?? r.userSn ?? '').trim();
      if (!userNo) continue;
      const when = r.recordTime instanceof Date ? r.recordTime : new Date(String(r.recordTime));
      if (Number.isNaN(when.getTime())) continue;
      out.push({ deviceUserNo: userNo, punchedAt: when.toISOString(), direction: null });
    }
    return out;
  } finally {
    await zk.disconnect().catch(() => undefined);
  }
}

/* ───────────────────────── Suprema BioStar 2 ───────────────────────── */

async function supremaLogin(device: BioDevice): Promise<{ base: string; session: string }> {
  const base = `${device.host?.startsWith('http') ? '' : 'https://'}${device.host}:${device.port ?? 443}`.replace(/\/$/, '');
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ User: { login_id: device.api_user ?? '', password: device.api_secret ?? '' } }),
  });
  if (!res.ok) throw new Error(`ورود به BioStar ناموفق بود (${res.status})`);
  const session = res.headers.get('bs-session-id');
  if (!session) throw new Error('BioStar شناسهٔ نشست برنگرداند');
  return { base, session };
}

async function supremaTest(device: BioDevice) {
  if (!device.host) throw new Error('آدرس سرور BioStar را وارد کنید');
  try {
    const { base, session } = await supremaLogin(device);
    const res = await fetch(`${base}/api/devices`, { headers: { 'bs-session-id': session } });
    const body = (await res.json().catch(() => ({}))) as { DeviceCollection?: { rows?: number }; rows?: number };
    return { ok: true, info: { devices: body?.DeviceCollection?.rows ?? body?.rows ?? null, mode: 'biostar' } };
  } catch (e) {
    throw new Error(faError(e));
  }
}

async function supremaPull(device: BioDevice): Promise<Punch[]> {
  if (!device.host) throw new Error('آدرس سرور BioStar را وارد کنید');
  const { base, session } = await supremaLogin(device);
  const since = lastSyncOr(device.id, 3);
  const res = await fetch(`${base}/api/event_logs/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'bs-session-id': session },
    body: JSON.stringify({
      Query: {
        limit: 2000,
        conditions: [{ column: 'datetime', operator: '>=', value: since }],
        orders: [{ column: 'datetime', operator: 'desc' }],
      },
    }),
  });
  if (!res.ok) throw new Error(`خواندن رکوردهای BioStar ناموفق بود (${res.status})`);
  const body = (await res.json().catch(() => ({}))) as { EventLogCollection?: { rows?: Array<Record<string, unknown>> } };
  const list = body?.EventLogCollection?.rows ?? [];
  const out: Punch[] = [];
  for (const r of list) {
    // BioStar: user_id (رشته) + datetime + direction/tna_key
    const userNo = String(r.user_id ?? r.userId ?? '').trim();
    const when = new Date(String(r.datetime ?? r.server_datetime ?? ''));
    if (!userNo || Number.isNaN(when.getTime())) continue;
    const dir = String(r.direction ?? r.tna_key ?? '').toLowerCase();
    out.push({ deviceUserNo: userNo, punchedAt: when.toISOString(), direction: dir.includes('out') ? 'out' : dir.includes('in') ? 'in' : null });
  }
  return out;
}

/* ───────────────────────── Futronic ───────────────────────── */

// فوترونیک پروتکل شبکه ندارد؛ یا نرم‌افزار سازنده فایل CSV می‌سازد، یا یک پل کوچک HTTP
function futronicTest(device: BioDevice) {
  if (device.mode === 'bridge') {
    if (!device.host) throw new Error('آدرس پل محلی را وارد کنید');
    return fetch(`http://${device.host}:${device.port ?? 9099}/health`, { signal: AbortSignal.timeout(4000) })
      .then(async (r) => ({ ok: r.ok, info: await r.json().catch(() => ({ mode: 'bridge' })) }))
      .catch(() => {
        throw new Error('پل محلی فوترونیک پاسخ نداد (پورت ۹۰۹۹).');
      });
  }
  const dir = device.csv_path ?? '';
  if (!dir) throw new Error('پوشهٔ خروجی CSV را انتخاب کنید');
  if (!fs.existsSync(dir)) throw new Error('پوشهٔ CSV پیدا نشد');
  const files = fs.readdirSync(dir).filter((f) => /\.(csv|txt)$/i.test(f));
  return { ok: true, info: { files: files.length, path: dir, mode: 'csv' } };
}

async function futronicPull(device: BioDevice): Promise<Punch[]> {
  if (device.mode === 'bridge') {
    const res = await fetch(`http://${device.host}:${device.port ?? 9099}/punches?since=${encodeURIComponent(lastSyncOr(device.id, 3))}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`پل فوترونیک خطا داد (${res.status})`);
    const body = (await res.json().catch(() => [])) as Array<{ userNo: string; time: string; direction?: string }>;
    return (Array.isArray(body) ? body : []).map((p) => ({
      deviceUserNo: String(p.userNo),
      punchedAt: new Date(p.time).toISOString(),
      direction: p.direction === 'out' ? 'out' : p.direction === 'in' ? 'in' : null,
    }));
  }
  const dir = device.csv_path ?? '';
  if (!dir || !fs.existsSync(dir)) throw new Error('پوشهٔ CSV پیدا نشد');
  const out: Punch[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => /\.(csv|txt)$/i.test(x))) {
    const full = path.join(dir, f);
    const text = fs.readFileSync(full, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const parts = line.split(/[,;\t]/).map((s) => s.trim());
      if (parts.length < 2) continue;
      // قالب‌های رایج: "شماره کاربر, تاریخ و ساعت" یا "شماره,IN/OUT,تاریخ"
      const userNo = parts[0].replace(/\D/g, '');
      const dirToken = parts.find((p) => /^(in|out|1|0)$/i.test(p));
      const dateToken = parts.find((p) => /\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(p) || /\d{1,2}:\d{2}/.test(p));
      if (!userNo || !dateToken) continue;
      const when = parseAnyDate(dateToken);
      if (!when) continue;
      out.push({
        deviceUserNo: userNo,
        punchedAt: when.toISOString(),
        direction: dirToken ? (dirToken.toLowerCase() === 'out' || dirToken === '0' ? 'out' : 'in') : null,
      });
    }
  }
  return out;
}

function parseAnyDate(token: string): Date | null {
  const iso = token.replace(/\//g, '-');
  const direct = new Date(iso);
  if (!Number.isNaN(direct.getTime())) return direct;
  // 2026-11-09 08:30
  const m = iso.match(/(\d{4})-(\d{1,2})-(\d{1,2})[ T]?(\d{1,2})?:?(\d{2})?/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ───────────────────────── ثبت رکوردها ───────────────────────── */

function lastSyncOr(deviceId: string, hoursBack = 3): string {
  const d = row<{ last: string | null }>('SELECT last_sync_at AS last FROM bio_devices WHERE id = ?', deviceId);
  const base = d?.last ? new Date(d.last) : new Date(Date.now() - hoursBack * 3600_000);
  return base.toISOString();
}

function dedupeKey(deviceId: string, punch: Punch) {
  return createHash('sha256').update(`${deviceId}|${punch.deviceUserNo}|${punch.punchedAt}`).digest('hex');
}

/** شمارهٔ عضویت → عضو؛ اول نگاشت دستی، بعد شمارهٔ عضویت */
function resolveMember(deviceId: string, deviceUserNo: string): { id: string; memberName: string } | null {
  const mapped = row<{ member_id: string }>('SELECT member_id FROM bio_user_map WHERE device_id = ? AND device_user_no = ?', deviceId, deviceUserNo);
  const candidate = mapped?.member_id ?? null;
  if (candidate) {
    const m = row<{ id: string; full_name: string }>('SELECT id, full_name FROM members WHERE id = ? AND deleted_at IS NULL', candidate);
    if (m) return { id: m.id, memberName: m.full_name };
  }
  const numeric = Number(deviceUserNo.replace(/\D/g, ''));
  if (!Number.isFinite(numeric)) return null;
  const m = row<{ id: string; full_name: string }>('SELECT id, full_name FROM members WHERE member_no = ? AND deleted_at IS NULL', numeric);
  return m ? { id: m.id, memberName: m.full_name } : null;
}

/** ثبت یک رکورد: تبدیل به چک‌این یا چک‌اوت با توجه به punch_mode */
function applyPunch(device: BioDevice, punch: Punch, operatorId: string | null) {
  const found = resolveMember(device.id, punch.deviceUserNo);
  const key = dedupeKey(device.id, punch);
  if (row('SELECT id FROM bio_punches WHERE dedupe_key = ?', key)) return { skipped: true as const };

  const punchId = uuidv7();
  db().run(
    `INSERT INTO bio_punches (id, branch_id, device_id, device_user_no, punched_at, direction, dedupe_key, member_id, status)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    punchId,
    db().branchId,
    device.id,
    punch.deviceUserNo,
    punch.punchedAt,
    punch.direction ?? null,
    key,
    found?.id ?? null,
    found ? 'new' : 'unknown_member',
  );

  if (!found) return { unknown: true as const };

  // جهت: از دستگاه اگر دارد، وگرنه آخرین رکورد باز امروز
  let direction = punch.direction ?? null;
  if (!direction) {
    const openToday = row<{ id: string }>(
      `SELECT id FROM checkins WHERE member_id = ? AND checked_out_at IS NULL AND date(checked_in_at,'localtime') = date(?)`,
      found.id,
      todayLocal(),
    );
    direction = openToday ? 'out' : 'in';
  }

  try {
    if (direction === 'out') {
      const openRow = row<{ id: string }>(
        `SELECT id FROM checkins WHERE member_id = ? AND checked_out_at IS NULL ORDER BY checked_in_at DESC LIMIT 1`,
        found.id,
      );
      if (!openRow) return { ignored: 'no open checkin' as const };
      // زمان خروج از دستگاه (نه ساعت رایانه)
      db().run('UPDATE checkins SET checked_out_at = ?, updated_at = ?, source_device_id = ? WHERE id = ?', punch.punchedAt, nowIso(), device.id, openRow.id);
      db().run("UPDATE bio_punches SET checkin_id = ?, status = 'applied' WHERE id = ?", openRow.id, punchId);
      return { checkinId: openRow.id, memberName: found.memberName, direction: 'out' as const, at: punch.punchedAt };
    }

    const res = attendance.checkin({ memberId: found.id, method: 'fingerprint' }, operatorId ?? '');
    db().run("UPDATE checkins SET source_device_id = ?, checked_in_at = ? WHERE id = ?", device.id, punch.punchedAt, res.id);
    db().run("UPDATE bio_punches SET checkin_id = ?, status = 'applied' WHERE id = ?", res.id, punchId);
    return { checkinId: res.id, memberName: found.memberName, direction: 'in' as const, at: punch.punchedAt, sessionsLeft: res.sessionsLeft };
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    db().run("UPDATE bio_punches SET status = 'ignored', note = ? WHERE id = ?", msg, punchId);
    return { error: msg, memberName: found.memberName };
  }
}

/** یک دور خواندن از یک دستگاه */
export async function syncDevice(deviceId: string, operatorId: string | null = null) {
  const device = devices.get(deviceId);
  let punches: Punch[] = [];
  try {
    if (device.brand === 'zkteco') punches = await zktecoPull(device);
    else if (device.brand === 'suprema') punches = await supremaPull(device);
    else punches = await futronicPull(device);
  } catch (e) {
    const msg = faError(e);
    db().run('UPDATE bio_devices SET last_error = ?, updated_at = ? WHERE id = ?', msg, nowIso(), deviceId);
    log.warn('bio.sync.failed', { device: deviceId, error: msg });
    return { ok: false, error: msg, applied: 0, skipped: 0, unknown: 0 };
  }

  let applied = 0;
  let skipped = 0;
  let unknown = 0;
  const errors: string[] = [];
  for (const p of punches.sort((a, b) => a.punchedAt.localeCompare(b.punchedAt))) {
    const out = applyPunch(device, p, operatorId);
    if ('skipped' in out) skipped += 1;
    else if ('unknown' in out) unknown += 1;
    else if ('error' in out) errors.push(`${out.memberName}: ${out.error}`);
    else applied += 1;
  }
  db().run(
    'UPDATE bio_devices SET last_sync_at = ?, last_sync_count = ?, last_error = ?, updated_at = ? WHERE id = ?',
    nowIso(),
    applied,
    errors[0] ?? null,
    nowIso(),
    deviceId,
  );
  log.info('bio.sync', { device: deviceId, brand: device.brand, applied, skipped, unknown });
  return { ok: true, applied, skipped, unknown, errors: errors.slice(0, 5), total: punches.length };
}

/** خواندن از همهٔ دستگاه‌های فعال */
export async function syncAll(operatorId: string | null = null) {
  const list = rows<BioDevice & { is_active: number }>('SELECT * FROM bio_devices WHERE branch_id = ? AND is_active = 1 AND deleted_at IS NULL', db().branchId);
  const results = [] as Array<{ device: string; brand: string; ok: boolean; applied: number; error?: string }>;
  for (const d of list) {
    const r = await syncDevice(d.id, operatorId);
    results.push({ device: d.label, brand: d.brand, ok: r.ok, applied: r.applied ?? 0, error: r.error });
  }
  return results;
}

/** ثبت دستی یک رکورد (برای آزمون بدون سخت‌افزار) */
export function simulatePunch(deviceId: string, deviceUserNo: string, direction: 'in' | 'out' | null = null) {
  const device = devices.get(deviceId);
  return applyPunch(device, { deviceUserNo, punchedAt: new Date().toISOString(), direction }, null);
}

/* ───────────────────────── نگاشت کاربر دستگاه ───────────────────────── */

export const userMap = {
  list(deviceId?: string) {
    const where = deviceId ? 'AND m.device_id = ?' : '';
    const params = deviceId ? [db().branchId, deviceId] : [db().branchId];
    return rows(
      `SELECT m.*, mem.full_name AS memberName, mem.member_no AS memberNo, d.label AS deviceLabel
       FROM bio_user_map m JOIN members mem ON mem.id = m.member_id JOIN bio_devices d ON d.id = m.device_id
       WHERE m.branch_id = ? ${where} ORDER BY d.label, m.device_user_no`,
      ...params,
    );
  },
  add(deviceId: string, deviceUserNo: string, memberId: string, userId: string | null = null) {
    const dup = row('SELECT id FROM bio_user_map WHERE device_id = ? AND device_user_no = ?', deviceId, deviceUserNo);
    if (dup) throw new Error('این شناسه روی همین دستگاه قبلاً به عضوی وصل شده است');
    const already = row('SELECT id FROM bio_user_map WHERE device_id = ? AND member_id = ?', deviceId, memberId);
    if (already) throw new Error('این عضو روی همین دستگاه قبلاً ثبت شده است');
    const id = uuidv7();
    db().run(
      'INSERT INTO bio_user_map (id, branch_id, device_id, device_user_no, member_id, enrolled_at, enrolled_by) VALUES (?,?,?,?,?,?,?)',
      id,
      db().branchId,
      deviceId,
      deviceUserNo,
      memberId,
      nowIso(),
      userId,
    );
    return { ok: true, id };
  },
  remove(id: string) {
    db().run('DELETE FROM bio_user_map WHERE id = ?', id);
    return { ok: true };
  },
};

/** رکوردهای خام برای مرور/عیب‌یابی */
export function punches(opts: { deviceId?: string; limit?: number } = {}) {
  const where = opts.deviceId ? 'AND p.device_id = ?' : '';
  const params = opts.deviceId ? [db().branchId, opts.deviceId] : [db().branchId];
  return rows(
    `SELECT p.*, m.full_name AS memberName, m.member_no AS memberNo, d.label AS deviceLabel
     FROM bio_punches p LEFT JOIN members m ON m.id = p.member_id LEFT JOIN bio_devices d ON d.id = p.device_id
     WHERE p.branch_id = ? ${where} ORDER BY p.punched_at DESC LIMIT ?`,
    ...params,
    Math.min(opts.limit ?? 200, 1000),
  );
}

/** فهرست اعضا برای ثبت روی دستگاه (شمارهٔ عضویت = شناسهٔ کاربر) */
export function devicesForEnrollment() {
  return members.list({ limit: 500 });
}

/** رکورد لحظه‌ای که شنوندهٔ ADMS گرفته را به تردد تبدیل می‌کند */
export function applyAdmsPunch(deviceId: string, punch: Punch) {
  const device = devices.get(deviceId);
  return applyPunch(device, punch, null);
}

/** اعضایی که روی این دستگاه اثر انگشت ندارند (برای ثبت) */
export function unenrolled(deviceId: string) {
  return rows(
    `SELECT m.id, m.full_name AS fullName, m.member_no AS memberNo, m.mobile, m.status
     FROM members m
     WHERE m.branch_id = ? AND m.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM bio_user_map u WHERE u.device_id = ? AND u.member_id = m.id)
     ORDER BY m.member_no LIMIT 500`,
    db().branchId,
    deviceId,
  );
}
