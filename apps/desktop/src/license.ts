import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { db, uuidv7, nowIso, todayLocal } from './db';
import { log } from './logger';

/** Ed25519 public key (SPKI DER, base64) — private key lives only on the licence server. */
const PUBLIC_KEY_DER_B64 = 'MCowBQYDK2VwAyEAunIeRCXHcGrbtguiM7xRbRbudHYnaK835veFZShDIsc=';
const TRIAL_DAYS = 14;
const TRIAL_MEMBER_CAP = 20;
const CLOCK_ROLLBACK_TOLERANCE_MS = 6 * 60 * 60 * 1000;

export type LicenseStatus = {
  status: 'trial' | 'active' | 'expired' | 'tampered' | 'deactivated';
  edition: string;
  daysLeft: number | null;
  trialDaysLeft: number | null;
  updateEntitlementUntil: string | null;
  updateDaysLeft: number | null;
  features: string[];
  machineId: string;
  licenseKey: string | null;
  memberCap: number | null;
  membersUsed: number;
  message: string;
};

function firstMac(): string {
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') return net.mac;
    }
  }
  return 'no-mac';
}

/** Stable per machine: cpu model + mac + salt file created once in the data dir. */
export function machineId(dataDir: string): string {
  const saltFile = path.join(dataDir, '.machine-salt');
  let salt = '';
  try {
    salt = fs.readFileSync(saltFile, 'utf8').trim();
  } catch {
    salt = createHash('sha256').update(`${os.hostname()}|${Date.now()}|${Math.random()}`).digest('hex').slice(0, 32);
    fs.writeFileSync(saltFile, salt, { mode: 0o600 });
  }
  const cpus = os.cpus()?.[0]?.model ?? 'cpu';
  return createHash('sha256').update(`${cpus}|${firstMac()}|${salt}`).digest('hex').toUpperCase().slice(0, 32);
}

function canonical(body: Record<string, unknown>): string {
  return JSON.stringify(body, Object.keys(body).sort());
}

export function verifyLicenseFile(licenseJson: string, signatureB64: string): { ok: boolean; body?: Record<string, unknown>; error?: string } {
  try {
    const body = JSON.parse(licenseJson);
    const key = createPublicKey({ key: Buffer.from(PUBLIC_KEY_DER_B64, 'base64'), format: 'der', type: 'spki' });
    const ok = cryptoVerify(null, Buffer.from(canonical(body)), key, Buffer.from(signatureB64, 'base64'));
    return ok ? { ok: true, body } : { ok: false, error: 'امضای لایسنس معتبر نیست' };
  } catch (e) {
    return { ok: false, error: `لایسنس قابل خواندن نیست: ${String(e)}` };
  }
}

export const license = {
  dataDir: '',

  row() {
    return db().get<Record<string, string | number>>('SELECT * FROM license_state ORDER BY created_at LIMIT 1');
  },

  trialRow() {
    return db().get<Record<string, string | number>>('SELECT * FROM trial_state ORDER BY created_at LIMIT 1');
  },

  ensureTrial() {
    const d = db();
    if (!this.trialRow()) {
      const now = nowIso();
      const ends = new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString();
      d.run('INSERT INTO trial_state (id, machine_id, started_at, ends_at, last_seen_at) VALUES (?,?,?,?,?)', uuidv7(), machineId(this.dataDir), now, ends, now);
    }
    if (!this.row()) {
      d.run("INSERT INTO license_state (id, machine_id, edition, status, features_json) VALUES (?,?, 'trial', 'trial', '[]')", uuidv7(), machineId(this.dataDir));
    }
  },

  /** Detect clock rollback: if now is far behind the last seen timestamp, lock cautiously (never delete data). */
  guardClock(): number {
    const d = db();
    const trial = this.trialRow();
    if (!trial) return 0;
    const last = new Date(String(trial.last_seen_at)).getTime();
    const drift = Date.now() - last;
    let rollbacks = Number(trial.clock_rollbacks ?? 0);
    if (drift < -CLOCK_ROLLBACK_TOLERANCE_MS) {
      rollbacks += 1;
      d.run('UPDATE trial_state SET clock_rollbacks = ?, last_seen_at = ?, status = ? WHERE id = ?', rollbacks, nowIso(), 'locked', String(trial.id));
      log.warn('license.clock_rollback', { rollbacks, driftHours: Math.round(drift / 3600000) });
    } else {
      d.run('UPDATE trial_state SET last_seen_at = ? WHERE id = ?', nowIso(), String(trial.id));
    }
    return rollbacks;
  },

  status(): LicenseStatus {
    const d = db();
    this.ensureTrial();
    const rollbacks = this.guardClock();
    const row = this.row()!;
    const trial = this.trialRow()!;
    const mid = machineId(this.dataDir);
    const membersUsed = Number(d.get<{ c: number }>('SELECT COUNT(*) AS c FROM members WHERE deleted_at IS NULL')?.c ?? 0);

    const base = {
      machineId: mid,
      membersUsed,
      licenseKey: (row.license_key as string) ?? null,
      features: JSON.parse(String(row.features_json ?? '[]')) as string[],
    };

    if (rollbacks > 3) {
      return {
        ...base,
        status: 'tampered',
        edition: 'trial',
        daysLeft: 0,
        trialDaysLeft: 0,
        updateEntitlementUntil: null,
        updateDaysLeft: null,
        memberCap: TRIAL_MEMBER_CAP,
        message: 'ساعت سیستم چند بار به عقب برگشته است. لطفاً ساعت ویندوز را درست کنید و از پشتیبانی کمک بگیرید. داده‌های شما دست‌نخورده است.',
      };
    }

    if (row.status === 'active') {
      const ent = (row.update_entitlement_until as string) ?? null;
      const updateDays = ent ? Math.ceil((new Date(ent).getTime() - Date.now()) / 86400000) : 0;
      // re-verify signature on every start — file on disk may have been edited
      const check = verifyLicenseFile(String(row.license_json ?? ''), String(row.signature ?? ''));
      if (!check.ok) {
        return { ...base, status: 'tampered', edition: 'trial', daysLeft: 0, trialDaysLeft: 0, updateEntitlementUntil: ent, updateDaysLeft: updateDays, memberCap: null, message: 'فایل لایسنس دست‌کاری شده است. برنامه غیرفعال شد ولی داده‌ها سالم است.' };
      }
      if (check.body?.machineId !== mid) {
        return { ...base, status: 'tampered', edition: 'trial', daysLeft: 0, trialDaysLeft: 0, updateEntitlementUntil: ent, updateDaysLeft: updateDays, memberCap: null, message: 'این لایسنس برای دستگاه دیگری صادر شده است.' };
      }
      const payload = (() => {
        try {
          return JSON.parse(String(row.license_json ?? '{}')) as Record<string, unknown>;
        } catch {
          return {};
        }
      })();
      return {
        ...base,
        status: 'active',
        edition: String(row.edition ?? 'pro'),
        daysLeft: null,
        trialDaysLeft: null,
        updateEntitlementUntil: ent,
        updateDaysLeft: updateDays,
        memberCap: null,
        // same fields the licence panel shows, so both sides read identically
        maxActivations: Number(payload.maxActivations ?? 1),
        activationsUsed: Number(payload.activationsUsed ?? 1),
        issuedAt: (payload.issuedAt as string) ?? null,
        buyer: (payload.buyer as string) ?? null,
        message: updateDays > 0 ? `لایسنس فعال — ${updateDays} روز اشتراک آپدیت باقی است` : 'لایسنس دائمی فعال است؛ اشتراک آپدیت به پایان رسیده (برنامه کار می‌کند).',
      };
    }

    const endsAt = new Date(String(trial.ends_at)).getTime();
    const trialDays = Math.max(0, Math.ceil((endsAt - Date.now()) / 86400000));
    const locked = String(trial.status) === 'locked' || trialDays <= 0;

    return {
      ...base,
      status: locked ? 'expired' : 'trial',
      edition: 'trial',
      daysLeft: trialDays,
      trialDaysLeft: trialDays,
      updateEntitlementUntil: null,
      updateDaysLeft: null,
      memberCap: TRIAL_MEMBER_CAP,
      message: locked
        ? 'دورهٔ آزمایشی به پایان رسیده است. برای ادامه، لایسنس را فعال کنید.'
        : `دورهٔ آزمایشی — ${trialDays} روز باقی مانده (حداکثر ${TRIAL_MEMBER_CAP} عضو)`,
    };
  },

  /** Offline activation: user pastes the signed licence bundle from the purchase email. */
  activate(bundle: { licenseJson: string; signature: string }) {
    const d = db();
    const check = verifyLicenseFile(bundle.licenseJson, bundle.signature);
    if (!check.ok) throw new Error(check.error ?? 'لایسنس نامعتبر است');
    const mid = machineId(this.dataDir);
    const body = check.body!;
    if (body.machineId !== mid) throw new Error('این لایسنس برای دستگاه دیگری صادر شده است (شناسه دستگاه متفاوت است).');
    const row = this.row()!;
    d.tx(() => {
      d.run(
        `UPDATE license_state SET machine_id = ?, license_key = ?, edition = ?, features_json = ?, issued_at = ?, update_entitlement_until = ?,
          max_activations = ?, activations_used = ?, signature = ?, license_json = ?, status = 'active', activated_at = ?, updated_at = ? WHERE id = ?`,
        mid,
        String(body.licenseKey ?? ''),
        String(body.edition ?? 'pro'),
        JSON.stringify(body.features ?? []),
        String(body.issuedAt ?? nowIso()),
        String(body.updateEntitlementUntil ?? ''),
        Number(body.maxActivations ?? 1),
        Number(body.activationsUsed ?? 1),
        bundle.signature,
        bundle.licenseJson,
        nowIso(),
        nowIso(),
        String(row.id),
      );
      d.run("UPDATE trial_state SET status = 'converted', updated_at = ? WHERE status IN ('running','locked')", nowIso());
    });
    log.info('license.activated', { edition: body.edition });
    return this.status();
  },

  deactivate() {
    const d = db();
    const row = this.row()!;
    d.run("UPDATE license_state SET status = 'deactivated', deactivated_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), String(row.id));
    return this.status();
  },

  /** Trial gate helpers used by the repo layer. */
  assertCanAddMember() {
    const s = this.status();
    if (s.status === 'trial' && s.memberCap !== null && s.membersUsed >= s.memberCap) {
      throw new Error(`دورهٔ آزمایشی حداکثر ${s.memberCap} عضو را پشتیبانی می‌کند. برای ثبت عضو بیشتر لایسنس را فعال کنید.`);
    }
    if (s.status === 'expired' || s.status === 'tampered') {
      throw new Error('برای ثبت دادهٔ جدید ابتدا لایسنس را فعال کنید. اطلاعات موجود قابل مشاهده و بکاپ‌گیری است.');
    }
  },
};

export const TRIAL_INFO = { TRIAL_DAYS, TRIAL_MEMBER_CAP, today: todayLocal };
