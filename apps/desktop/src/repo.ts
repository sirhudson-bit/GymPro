import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { db, uuidv7, nowIso, todayLocal, plainRows, plainify } from './db';
import { verifyRecoveryToken } from './recovery';
import { addDaysIso, daysBetween } from '../../../lib/jalali';

/* ────────────────────────────── helpers ────────────────────────────── */

const q = () => db();

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(pw, salt, 64).toString('hex')}`;
}

export function verifyPassword(pw: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [alg, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(pw, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/* ────────────────────────────── settings ────────────────────────────── */

export const settings = {
  all(): Record<string, string> {
    const rows = q().all<{ key: string; value: string }>('SELECT key, value FROM settings WHERE branch_id = ?', q().branchId);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  },
  get(key: string, fallback = ''): string {
    const row = q().get<{ value: string }>('SELECT value FROM settings WHERE branch_id = ? AND key = ?', q().branchId, key);
    return row?.value ?? fallback;
  },
  set(key: string, value: string) {
    q().run(
      `INSERT INTO settings (branch_id, key, value, updated_at, version) VALUES (?,?,?,?,1)
       ON CONFLICT(branch_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, version = version + 1`,
      q().branchId,
      key,
      value,
      nowIso(),
    );
  },
};

/* ────────────────────────────── users & auth ────────────────────────────── */

export type AppUser = { id: string; username: string; fullName: string; role: string; isActive: number; lastLoginAt: string | null };

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — avoids transcription mistakes

/** 20 chars → 5 groups of 4, e.g. "K7QM-3XPD-9RTB-W2HN-5JVC" */
export function makeRecoveryCode(): string {
  const bytes = randomBytes(20);
  const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]);
  return chars.join('').replace(/(.{4})(?=.)/g, '$1-');
}

export function normalizeRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

export const users = {
  count(): number {
    return num(q().get<{ c: number }>('SELECT COUNT(*) AS c FROM users WHERE deleted_at IS NULL')?.c);
  },
  list(): AppUser[] {
    return q().all<AppUser>(
      `SELECT id, username, full_name AS fullName, role, is_active AS isActive, last_login_at AS lastLoginAt,
              CASE WHEN recovery_hash IS NULL THEN 0 ELSE 1 END AS recoverySet
       FROM users WHERE deleted_at IS NULL ORDER BY created_at`,
    );
  },
  create(input: { username: string; fullName: string; role: string; password: string; pin?: string | null }) {
    const id = uuidv7();
    q().write({ entity: 'user', entityId: id, op: 'create', version: 1, payload: { username: input.username, role: input.role } }, () => {
      q().run(
        `INSERT INTO users (id, branch_id, username, full_name, role, password_hash, pin_hash)
         VALUES (?,?,?,?,?,?,?)`,
        id,
        q().branchId,
        input.username,
        input.fullName,
        input.role,
        hashPassword(input.password),
        input.pin ? hashPassword(input.pin) : null,
      );
    });
    return users.byId(id);
  },
  byId(id: string): AppUser | null {
    return (
      (q().get<AppUser>(
        `SELECT id, username, full_name AS fullName, role, is_active AS isActive, last_login_at AS lastLoginAt
         FROM users WHERE id = ? AND deleted_at IS NULL`,
        id,
      ) as AppUser) ?? null
    );
  },
  login(username: string, password: string): AppUser {
    const row = q().get<{ id: string; password_hash: string; locked_until: string | null; failed_attempts: number }>(
      'SELECT id, password_hash, locked_until, failed_attempts FROM users WHERE username = ? AND deleted_at IS NULL AND is_active = 1',
      username,
    );
    if (!row) throw new Error('نام کاربری یا رمز عبور نادرست است');
    if (row.locked_until && new Date(row.locked_until) > new Date()) {
      throw new Error('حساب موقتاً قفل است. چند دقیقه بعد دوباره تلاش کنید.');
    }
    if (!verifyPassword(password, row.password_hash)) {
      const attempts = num(row.failed_attempts) + 1;
      q().run(
        'UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?',
        attempts,
        attempts >= 5 ? new Date(Date.now() + 5 * 60000).toISOString() : null,
        row.id,
      );
      throw new Error('نام کاربری یا رمز عبور نادرست است');
    }
    q().run('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', nowIso(), row.id);
    q().run('INSERT INTO login_sessions (id, user_id, device_id, started_at) VALUES (?,?,?,?)', uuidv7(), row.id, q().deviceId, nowIso());
    return users.byId(row.id)!;
  },
  verifyPin(userId: string, pin: string): boolean {
    const row = q().get<{ pin_hash: string | null }>('SELECT pin_hash FROM users WHERE id = ?', userId);
    return verifyPassword(pin, row?.pin_hash);
  },
  setPin(userId: string, pin: string) {
    q().run('UPDATE users SET pin_hash = ?, updated_at = ? WHERE id = ?', hashPassword(pin), nowIso(), userId);
  },

  /* ── password recovery ───────────────────────────────────────── */

  /** Creates (or rotates) the recovery code for a user and returns the plaintext exactly once. */
  issueRecoveryCode(userId: string): string {
    const code = makeRecoveryCode();
    q().run(
      'UPDATE users SET recovery_hash = ?, recovery_issued_at = ?, recovery_used_at = NULL, updated_at = ?, version = version + 1 WHERE id = ?',
      hashPassword(normalizeRecoveryCode(code)),
      nowIso(),
      nowIso(),
      userId,
    );
    return code;
  },

  findByUsername(username: string) {
    return q().get<{ id: string; username: string; recovery_hash: string | null; is_active: number }>(
      'SELECT id, username, recovery_hash, is_active FROM users WHERE username = ? AND deleted_at IS NULL',
      username,
    );
  },

  /** Recovery code path: username + one-time code → new password. Returns the next recovery code. */
  resetWithRecoveryCode(input: { username: string; code: string; newPassword: string }): { recoveryCode: string; username: string } {
    if (input.newPassword.length < 6) throw new Error('رمز جدید حداقل ۶ کاراکتر باشد');
    const user = users.findByUsername(input.username.trim());
    if (!user) throw new Error('نام کاربری یافت نشد');
    if (!user.recovery_hash) throw new Error('برای این حساب کد بازیابی صادر نشده است؛ از راه «توکن پشتیبانی» یا بازنشانی توسط مالک استفاده کنید');
    if (!verifyPassword(normalizeRecoveryCode(input.code), user.recovery_hash)) {
      throw new Error('کد بازیابی نادرست است');
    }
    q().tx(() => {
      q().run(
        'UPDATE users SET password_hash = ?, recovery_used_at = ?, failed_attempts = 0, locked_until = NULL, password_changed_at = ?, updated_at = ?, version = version + 1 WHERE id = ?',
        hashPassword(input.newPassword),
        nowIso(),
        nowIso(),
        nowIso(),
        user.id,
      );
      q().run(
        'INSERT INTO audit_logs (id, branch_id, action, entity, entity_id, reason) VALUES (?,?,?,?,?,?)',
        uuidv7(),
        q().branchId,
        'auth.reset_with_code',
        'user',
        user.id,
        'بازیابی رمز با کد یک‌بارمصرف',
      );
    });
    return { recoveryCode: users.issueRecoveryCode(user.id), username: user.username };
  },

  /** Support-token path: signed, machine-bound, expiring token. */
  resetWithToken(input: { username: string; tokenJson: string; signature: string; newPassword: string }, machineId: string): { username: string } {
    if (input.newPassword.length < 6) throw new Error('رمز جدید حداقل ۶ کاراکتر باشد');
    const check = verifyRecoveryToken(input.tokenJson, input.signature, machineId);
    if (!check.ok) throw new Error(check.error);
    const user = users.findByUsername(input.username.trim());
    if (!user || user.username !== check.username) throw new Error('این توکن برای نام کاربری دیگری صادر شده است');
    q().tx(() => {
      q().run(
        'UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL, password_changed_at = ?, updated_at = ?, version = version + 1 WHERE id = ?',
        hashPassword(input.newPassword),
        nowIso(),
        nowIso(),
        user.id,
      );
      q().run(
        'INSERT INTO audit_logs (id, branch_id, action, entity, entity_id, reason) VALUES (?,?,?,?,?,?)',
        uuidv7(),
        q().branchId,
        'auth.reset_with_token',
        'user',
        user.id,
        'بازیابی رمز با توکن پشتیبانی',
      );
    });
    return { username: user.username };
  },

  changePassword(userId: string, current: string, next: string): { ok: true } {
    if (next.length < 6) throw new Error('رمز جدید حداقل ۶ کاراکتر باشد');
    const row = q().get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', userId);
    if (!verifyPassword(current, row?.password_hash)) throw new Error('رمز فعلی نادرست است');
    q().run('UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ?, version = version + 1 WHERE id = ?', hashPassword(next), nowIso(), nowIso(), userId);
    return { ok: true };
  },

  /** Owner-side reset for a colleague who forgot the password (no old password needed). */
  ownerResetPassword(targetUserId: string, next: string, actorId: string): { ok: true } {
    if (next.length < 6) throw new Error('رمز جدید حداقل ۶ کاراکتر باشد');
    const target = q().get<{ username: string }>('SELECT username FROM users WHERE id = ? AND deleted_at IS NULL', targetUserId);
    if (!target) throw new Error('کاربر یافت نشد');
    q().tx(() => {
      q().run(
        'UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL, password_changed_at = ?, updated_at = ?, version = version + 1 WHERE id = ?',
        hashPassword(next),
        nowIso(),
        nowIso(),
        targetUserId,
      );
      q().run(
        'INSERT INTO audit_logs (id, branch_id, actor_user_id, action, entity, entity_id, reason) VALUES (?,?,?,?,?,?,?)',
        uuidv7(),
        q().branchId,
        actorId,
        'auth.owner_reset',
        'user',
        targetUserId,
        `بازنشانی رمز ${target.username} توسط مالک`,
      );
    });
    return { ok: true };
  },
};

/* ────────────────────────────── members ────────────────────────────── */

export const members = {
  list(opts: { q?: string; status?: string; limit?: number; offset?: number } = {}) {
    const where = ['deleted_at IS NULL', 'branch_id = ?'];
    const params: unknown[] = [q().branchId];
    if (opts.q) {
      where.push('(full_name LIKE ? OR mobile LIKE ? OR CAST(member_no AS TEXT) LIKE ?)');
      const like = `%${opts.q}%`;
      params.push(like, like, like);
    }
    if (opts.status && opts.status !== 'all') {
      where.push('status = ?');
      params.push(opts.status);
    }
    const limit = Math.min(opts.limit ?? 50, 200);
    const rows = q().all(
      `SELECT m.*, 
        (SELECT c.end_date FROM contracts c WHERE c.member_id = m.id AND c.deleted_at IS NULL AND c.status IN ('active','frozen') ORDER BY c.end_date DESC LIMIT 1) AS activeEndDate,
        (SELECT c.status FROM contracts c WHERE c.member_id = m.id AND c.deleted_at IS NULL AND c.status IN ('active','frozen') ORDER BY c.end_date DESC LIMIT 1) AS activeStatus,
        (SELECT c.sessions_total - c.sessions_used FROM contracts c WHERE c.member_id = m.id AND c.deleted_at IS NULL AND c.status IN ('active','frozen') ORDER BY c.end_date DESC LIMIT 1) AS sessionsLeft,
        (SELECT COALESCE(SUM(p.amount_irr),0) FROM payments p WHERE p.member_id = m.id AND p.status = 'posted') AS totalPaid,
        (SELECT balance_after_irr FROM wallet_transactions w WHERE w.member_id = m.id ORDER BY created_at DESC LIMIT 1) AS wallet
       FROM members m WHERE ${where.join(' AND ')}
       ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      limit,
      opts.offset ?? 0,
    );
    return plainRows(rows);
  },
  count(): number {
    return num(q().get<{ c: number }>('SELECT COUNT(*) AS c FROM members WHERE deleted_at IS NULL')?.c);
  },
  get(id: string) {
    const member = q().get('SELECT * FROM members WHERE id = ?', id);
    if (!member) throw new Error('عضو یافت نشد');
    const contracts = q().all(
      `SELECT c.*, p.name AS planName, p.kind AS planKind FROM contracts c JOIN plans p ON p.id = c.plan_id
       WHERE c.member_id = ? AND c.deleted_at IS NULL ORDER BY c.start_date DESC`,
      id,
    );
    const payments = q().all('SELECT * FROM payments WHERE member_id = ? AND deleted_at IS NULL ORDER BY paid_at DESC LIMIT 50', id);
    const checkins = q().all('SELECT * FROM checkins WHERE member_id = ? AND deleted_at IS NULL ORDER BY checked_in_at DESC LIMIT 30', id);
    const measurements = q().all('SELECT * FROM body_measurements WHERE member_id = ? AND deleted_at IS NULL ORDER BY measured_at DESC LIMIT 30', id);
    const wallet = q().all('SELECT * FROM wallet_transactions WHERE member_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 30', id);
    const programs = q().all('SELECT * FROM workout_programs WHERE member_id = ? AND deleted_at IS NULL ORDER BY start_date DESC', id);
    return { member, contracts: plainRows(contracts), payments: plainRows(payments), checkins: plainRows(checkins), measurements: plainRows(measurements), wallet: plainRows(wallet), programs: plainRows(programs) };
  },
  nextNo(): number {
    const row = q().get<{ n: number }>('SELECT COALESCE(MAX(member_no),0) + 1 AS n FROM members WHERE branch_id = ?', q().branchId);
    return num(row?.n) || 1;
  },
  create(input: Record<string, unknown>) {
    const id = uuidv7();
    const memberNo = members.nextNo();
    q().write({ entity: 'member', entityId: id, op: 'create', version: 1, payload: { fullName: input.fullName, memberNo } }, () => {
      q().run(
        `INSERT INTO members (id, branch_id, member_no, full_name, mobile, gender, birth_date, national_id, address,
          emergency_name, emergency_mobile, photo_path, notes, joined_at, consent_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id,
        q().branchId,
        memberNo,
        String(input.fullName),
        String(input.mobile),
        (input.gender as string) || null,
        (input.birthDate as string) || null,
        (input.nationalId as string) || null,
        (input.address as string) || null,
        (input.emergencyName as string) || null,
        (input.emergencyMobile as string) || null,
        (input.photo as string) || null,
        (input.notes as string) || null,
        todayLocal(),
        input.consent ? nowIso() : null,
      );
    });
    return members.get(id).member;
  },
  update(input: Record<string, unknown> & { id: string; version: number }) {
    const current = q().get<{ version: number }>('SELECT version FROM members WHERE id = ?', input.id);
    if (!current) throw new Error('عضو یافت نشد');
    if (num(current.version) !== input.version) throw new Error('این رکورد تغییر کرده است؛ صفحه را بازخوانی کنید');
    q().write({ entity: 'member', entityId: input.id, op: 'update', version: input.version + 1, payload: input }, () => {
      q().run(
        `UPDATE members SET full_name = COALESCE(?, full_name), mobile = COALESCE(?, mobile), gender = ?,
          birth_date = ?, national_id = ?, address = ?, emergency_name = ?, emergency_mobile = ?, notes = ?,
          updated_at = ?, version = version + 1 WHERE id = ?`,
        input.fullName ?? null,
        input.mobile ?? null,
        input.gender ?? null,
        input.birthDate ?? null,
        input.nationalId ?? null,
        input.address ?? null,
        input.emergencyName ?? null,
        input.emergencyMobile ?? null,
        input.notes ?? null,
        nowIso(),
        input.id,
      );
    });
    return members.get(input.id).member;
  },
  archive(id: string) {
    q().write({ entity: 'member', entityId: id, op: 'delete', version: 1, payload: { id } }, () => {
      q().run("UPDATE members SET deleted_at = ?, status = 'archived', updated_at = ? WHERE id = ?", nowIso(), nowIso(), id);
    });
  },
  restore(id: string) {
    q().write({ entity: 'member', entityId: id, op: 'restore', version: 1, payload: { id } }, () => {
      q().run("UPDATE members SET deleted_at = NULL, status = 'active', updated_at = ? WHERE id = ?", nowIso(), id);
    });
  },
};

/* ────────────────────────────── cards ────────────────────────────── */

export const cards = {
  issue(memberId: string) {
    const raw = randomBytes(18).toString('base64url');
    const tokenHash = createHash('sha256').update(raw).digest('hex');
    const member = q().get<{ member_no: number }>('SELECT member_no FROM members WHERE id = ?', memberId);
    if (!member) throw new Error('عضو یافت نشد');
    const id = uuidv7();
    // Human-readable AND unique: the member number is for the receptionist, the suffix keeps
    // re-issued cards from colliding with a revoked card's barcode.
    const suffix = randomBytes(2).toString('hex').toUpperCase().slice(0, 3);
    const barcode = `GP${String(num(member.member_no)).padStart(6, '0')}-${suffix}`;
    q().write({ entity: 'member_card', entityId: id, op: 'create', version: 1, payload: { memberId } }, () => {
      q().run('UPDATE member_cards SET status = ?, revoked_at = ? WHERE member_id = ? AND status = ?', 'revoked', nowIso(), memberId, 'active');
      q().run('INSERT INTO member_cards (id, branch_id, member_id, token_hash, barcode_value, status) VALUES (?,?,?,?,?,?)', id, q().branchId, memberId, tokenHash, barcode, 'active');
    });
    return { id, token: raw, barcode, memberNo: num(member.member_no) };
  },
  revoke(cardId: string) {
    q().write({ entity: 'member_card', entityId: cardId, op: 'update', version: 1, payload: { status: 'revoked' } }, () => {
      q().run("UPDATE member_cards SET status = 'revoked', revoked_at = ? WHERE id = ?", nowIso(), cardId);
    });
  },
  active(memberId: string) {
    return q().get('SELECT id, barcode_value AS barcode, status, issued_at FROM member_cards WHERE member_id = ? AND status = ? ORDER BY issued_at DESC LIMIT 1', memberId, 'active');
  },
  lookup(token: string) {
    const value = token.trim();
    if (!value) return null;
    const hash = createHash('sha256').update(value).digest('hex');
    const byToken = q().get<{ member_id: string }>("SELECT member_id FROM member_cards WHERE token_hash = ? AND status = 'active'", hash);
    if (byToken) return byToken.member_id;
    const byBarcode = q().get<{ member_id: string }>("SELECT member_id FROM member_cards WHERE barcode_value = ? AND status = 'active'", value);
    if (byBarcode) return byBarcode.member_id;
    // 1D scanners often drop the "GP…-" wrapper; accept the bare member number too.
    const direct = /^\d{1,9}$/.test(value) ? value : value.replace(/^GP0*/i, '').match(/^\d{1,9}/)?.[0];
    if (!direct) return null;
    const byNo = q().get<{ id: string }>('SELECT id FROM members WHERE member_no = ? AND deleted_at IS NULL', Number(direct));
    return byNo?.id ?? null;
  },
};

/* ────────────────────────────── plans ────────────────────────────── */

export const plans = {
  list(includeInactive = false) {
    return q().all(
      `SELECT * FROM plans WHERE branch_id = ? AND deleted_at IS NULL ${includeInactive ? '' : 'AND is_active = 1'} ORDER BY sort_order, price_irr`,
      q().branchId,
    );
  },
  create(input: Record<string, unknown>) {
    const id = uuidv7();
    q().write({ entity: 'plan', entityId: id, op: 'create', version: 1, payload: input }, () => {
      q().run(
        `INSERT INTO plans (id, branch_id, name, kind, duration_days, session_count, price_irr, vat_rate_bp, is_active)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        id,
        q().branchId,
        input.name,
        input.kind,
        input.durationDays ?? null,
        input.sessionCount ?? null,
        input.priceIrr,
        input.vatRateBp ?? 0,
        input.isActive === false ? 0 : 1,
      );
    });
    return q().get('SELECT * FROM plans WHERE id = ?', id);
  },
  update(input: Record<string, unknown> & { id: string }) {
    q().write({ entity: 'plan', entityId: input.id, op: 'update', version: 1, payload: input }, () => {
      q().run(
        `UPDATE plans SET name = ?, kind = ?, duration_days = ?, session_count = ?, price_irr = ?, vat_rate_bp = ?,
          is_active = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
        input.name,
        input.kind,
        input.durationDays ?? null,
        input.sessionCount ?? null,
        input.priceIrr,
        input.vatRateBp ?? 0,
        input.isActive === false ? 0 : 1,
        nowIso(),
        input.id,
      );
    });
    return q().get('SELECT * FROM plans WHERE id = ?', input.id);
  },
  remove(id: string) {
    q().write({ entity: 'plan', entityId: id, op: 'delete', version: 1, payload: { id } }, () => {
      q().run('UPDATE plans SET deleted_at = ?, is_active = 0 WHERE id = ?', nowIso(), id);
    });
  },
};

/* ────────────────────────────── contracts ────────────────────────────── */

export const contracts = {
  list(opts: { status?: string; q?: string; limit?: number } = {}) {
    const where = ['c.deleted_at IS NULL', 'c.branch_id = ?'];
    const params: unknown[] = [q().branchId];
    if (opts.status && opts.status !== 'all') {
      where.push('c.status = ?');
      params.push(opts.status);
    }
    if (opts.q) {
      where.push('(m.full_name LIKE ? OR m.mobile LIKE ?)');
      params.push(`%${opts.q}%`, `%${opts.q}%`);
    }
    return plainRows(
      q().all(
        `SELECT c.*, p.name AS planName, m.full_name AS memberName, m.mobile AS memberMobile, m.id AS memberId,
                (c.sessions_total - c.sessions_used) AS sessionsLeft
         FROM contracts c JOIN plans p ON p.id = c.plan_id JOIN members m ON m.id = c.member_id
         WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC LIMIT ?`,
        ...params,
        Math.min(opts.limit ?? 100, 300),
      ),
    );
  },
  create(input: { memberId: string; planId: string; startDate: string; discountIrr?: number; discountReason?: string | null; payment?: { amountIrr: number; method: string; reference?: string | null; installments?: number } | null }, userId: string) {
    const plan = q().get<{ price_irr: number; duration_days: number | null; session_count: number | null; kind: string; name: string }>(
      'SELECT price_irr, duration_days, session_count, kind, name FROM plans WHERE id = ?',
      input.planId,
    );
    if (!plan) throw new Error('تعرفه یافت نشد');
    const start = input.startDate || todayLocal();
    const duration = num(plan.duration_days) || 30;
    const end = addDaysIso(start, duration - 1);
    const discount = num(input.discountIrr);
    const price = num(plan.price_irr);
    if (discount > price) throw new Error('تخفیف نمی‌تواند از مبلغ تعرفه بیشتر باشد');
    const contractId = uuidv7();
    const contractNo = num(q().get<{ n: number }>('SELECT COALESCE(MAX(contract_no),0) + 1 AS n FROM contracts WHERE branch_id = ?', q().branchId)?.n) || 1;
    const version = 1;

    q().write({ entity: 'contract', entityId: contractId, op: 'create', version, payload: { memberId: input.memberId, planId: input.planId } }, () => {
      q().run(
        `INSERT INTO contracts (id, branch_id, member_id, plan_id, contract_no, start_date, end_date, sessions_total, sessions_used,
          list_price_irr, discount_irr, discount_reason, approved_by, status)
         VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?, 'active')`,
        contractId,
        q().branchId,
        input.memberId,
        input.planId,
        contractNo,
        start,
        end,
        num(plan.session_count) || null,
        price,
        discount,
        input.discountReason ?? null,
        discount > 0 ? userId : null,
      );
      q().run(
        `INSERT INTO loyalty_events (id, branch_id, member_id, points, kind, ref_entity, ref_id, note)
         VALUES (?,?,?,?, 'manual', 'contract', ?, 'ثبت قرارداد جدید')`,
        uuidv7(),
        q().branchId,
        input.memberId,
        10,
        contractId,
      );
    });

    let paymentResult: ReturnType<typeof payments.create> | null = null;
    if (input.payment && num(input.payment.amountIrr) > 0) {
      paymentResult = payments.create(
        {
          memberId: input.memberId,
          contractId,
          amountIrr: num(input.payment.amountIrr),
          method: input.payment.method,
          paidAt: start,
          reference: input.payment.reference ?? null,
          note: `قرارداد ${contractNo} — ${plan.name}`,
          installments: input.payment.installments,
        },
        userId,
      );
    }
    return { contract: q().get('SELECT * FROM contracts WHERE id = ?', contractId), payment: paymentResult };
  },
  renew(contractId: string, planId: string, userId: string, payment?: { amountIrr: number; method: string }) {
    const previous = q().get<{ end_date: string; member_id: string; status: string }>(
      'SELECT end_date, member_id, status FROM contracts WHERE id = ? AND deleted_at IS NULL',
      contractId,
    );
    if (!previous) throw new Error('قرارداد یافت نشد');
    const plan = q().get<{ duration_days: number | null }>('SELECT duration_days FROM plans WHERE id = ?', planId);
    const base = previous.status === 'active' && previous.end_date >= todayLocal() ? addDaysIso(previous.end_date, 1) : todayLocal();
    return contracts.create({ memberId: previous.member_id, planId, startDate: base, payment: payment ?? null }, userId);
  },
  freeze(contractId: string, startDate: string, days: number, reason: string, userId: string) {
    const cap = Number(settings.get('freeze.cap_days', '30'));
    const row = q().get<{ freeze_days_used: number; end_date: string; status: string }>('SELECT freeze_days_used, end_date, status FROM contracts WHERE id = ?', contractId);
    if (!row) throw new Error('قرارداد یافت نشد');
    if (row.status !== 'active') throw new Error('فقط قرارداد فعال قابل فریز است');
    if (num(row.freeze_days_used) + days > cap) throw new Error(`سقف فریز ${cap} روز است و ${cap - num(row.freeze_days_used)} روز باقی مانده`);
    const endDate = addDaysIso(startDate, days - 1);
    const newEnd = addDaysIso(row.end_date, days);
    q().write({ entity: 'contract', entityId: contractId, op: 'update', version: 1, payload: { frozen: days } }, () => {
      q().run(
        'INSERT INTO membership_freezes (id, branch_id, contract_id, start_date, end_date, days, reason, approved_by) VALUES (?,?,?,?,?,?,?,?)',
        uuidv7(),
        q().branchId,
        contractId,
        startDate,
        endDate,
        days,
        reason,
        userId,
      );
      q().run('UPDATE contracts SET end_date = ?, freeze_days_used = freeze_days_used + ?, updated_at = ? WHERE id = ?', newEnd, days, nowIso(), contractId);
    });
    return { endDate: newEnd, daysLeft: cap - (num(row.freeze_days_used) + days) };
  },
  cancel(contractId: string, reason: string) {
    q().write({ entity: 'contract', entityId: contractId, op: 'update', version: 1, payload: { status: 'cancelled', reason } }, () => {
      q().run("UPDATE contracts SET status = 'cancelled', updated_at = ? WHERE id = ?", nowIso(), contractId);
    });
  },
  /** marks contracts whose end_date passed; called on bootstrap */
  expireStale(): number {
    const res = q().run("UPDATE contracts SET status = 'expired', updated_at = ? WHERE status = 'active' AND end_date < ?", nowIso(), todayLocal());
    return res.changes;
  },
  activeFor(memberId: string) {
    return q().get<{ id: string; end_date: string; sessions_total: number | null; sessions_used: number; status: string }>(
      `SELECT id, end_date, sessions_total, sessions_used, status FROM contracts
       WHERE member_id = ? AND deleted_at IS NULL AND status IN ('active','frozen') ORDER BY end_date DESC LIMIT 1`,
      memberId,
    );
  },
};

/* ────────────────────────────── payments ────────────────────────────── */

export const payments = {
  list(opts: { from?: string; to?: string; memberId?: string; limit?: number } = {}) {
    const where = ["p.deleted_at IS NULL", 'p.branch_id = ?'];
    const params: unknown[] = [q().branchId];
    if (opts.from) {
      where.push('p.paid_at >= ?');
      params.push(opts.from);
    }
    if (opts.to) {
      where.push('p.paid_at <= ?');
      params.push(opts.to);
    }
    if (opts.memberId) {
      where.push('p.member_id = ?');
      params.push(opts.memberId);
    }
    return plainRows(
      q().all(
        `SELECT p.*, m.full_name AS memberName, u.full_name AS userName FROM payments p
         JOIN members m ON m.id = p.member_id LEFT JOIN users u ON u.id = p.created_by
         WHERE ${where.join(' AND ')} ORDER BY p.paid_at DESC, p.created_at DESC LIMIT ?`,
        ...params,
        Math.min(opts.limit ?? 100, 500),
      ),
    );
  },
  create(input: { memberId: string; contractId?: string | null; amountIrr: number; method: string; paidAt: string; reference?: string | null; note?: string | null; installments?: number }, userId: string) {
    const cash = q().get<{ id: string }>("SELECT id FROM cash_sessions WHERE branch_id = ? AND status = 'open'", q().branchId);
    const receiptNo = num(q().get<{ n: number }>('SELECT COALESCE(MAX(receipt_no),0) + 1 AS n FROM payments WHERE branch_id = ?', q().branchId)?.n) || 1;
    const id = uuidv7();

    if (input.method === 'wallet') {
      const balance = wallet.balance(input.memberId);
      if (balance < input.amountIrr) throw new Error(`موجودی کیف پول کافی نیست (${balance.toLocaleString('fa-IR')} ریال)`);
      wallet.spend(input.memberId, input.amountIrr, 'renewal', 'payment', id, userId);
    }

    q().write({ entity: 'payment', entityId: id, op: 'create', version: 1, payload: { memberId: input.memberId, amountIrr: input.amountIrr } }, () => {
      q().run(
        `INSERT INTO payments (id, branch_id, member_id, contract_id, cash_session_id, receipt_no, amount_irr, method, paid_at, reference, note, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        id,
        q().branchId,
        input.memberId,
        input.contractId ?? null,
        input.method === 'cash' ? (cash?.id ?? null) : null,
        receiptNo,
        input.amountIrr,
        input.method,
        input.paidAt,
        input.reference ?? null,
        input.note ?? null,
        userId,
      );
      if (input.method === 'installment' && input.installments && input.installments >= 2) {
        const per = Math.floor(input.amountIrr / input.installments);
        const remainder = input.amountIrr - per * input.installments;
        for (let i = 0; i < input.installments; i += 1) {
          q().run(
            'INSERT INTO installments (id, branch_id, payment_id, seq, due_date, amount_irr) VALUES (?,?,?,?,?,?)',
            uuidv7(),
            q().branchId,
            id,
            i + 1,
            addDaysIso(input.paidAt, 30 * i),
            i === 0 ? per + remainder : per,
          );
        }
      }
    });
    return q().get('SELECT * FROM payments WHERE id = ?', id);
  },
  void(id: string, reason: string, userId: string) {
    q().write({ entity: 'payment', entityId: id, op: 'update', version: 1, payload: { void: reason } }, () => {
      q().run("UPDATE payments SET status = 'void', void_reason = ?, updated_at = ? WHERE id = ?", `${reason} — ${userId.slice(0, 8)}`, nowIso(), id);
    });
  },
  installments(paymentId: string) {
    return plainRows(q().all('SELECT * FROM installments WHERE payment_id = ? ORDER BY seq', paymentId));
  },
  payInstallment(installmentId: string, amount: number) {
    const row = q().get<{ amount_irr: number; paid_amount_irr: number }>('SELECT amount_irr, paid_amount_irr FROM installments WHERE id = ?', installmentId);
    if (!row) throw new Error('قسط یافت نشد');
    const paid = num(row.paid_amount_irr) + amount;
    const status = paid >= num(row.amount_irr) ? 'paid' : 'partial';
    q().run('UPDATE installments SET paid_amount_irr = ?, status = ?, updated_at = ? WHERE id = ?', paid, status, nowIso(), installmentId);
    return { paid, status };
  },
};

/* ────────────────────────────── wallet ────────────────────────────── */

export const wallet = {
  balance(memberId: string): number {
    const row = q().get<{ b: number }>('SELECT balance_after_irr AS b FROM wallet_transactions WHERE member_id = ? ORDER BY created_at DESC LIMIT 1', memberId);
    return num(row?.b);
  },
  topup(memberId: string, amount: number, note: string, userId: string) {
    return wallet.record(memberId, amount, 'topup', 'credit', null, null, note || 'شارژ کیف پول', userId);
  },
  spend(memberId: string, amount: number, reason: 'renewal' | 'pos_sale' | 'adjustment', refEntity: string, refId: string, userId: string) {
    return wallet.record(memberId, amount, reason, 'debit', refEntity, refId, 'کسر خودکار', userId);
  },
  record(memberId: string, amount: number, reason: string, direction: 'credit' | 'debit', refEntity: string | null, refId: string | null, note: string, userId: string) {
    const current = wallet.balance(memberId);
    const next = direction === 'credit' ? current + amount : current - amount;
    if (next < 0) throw new Error('موجودی کیف پول کافی نیست');
    const id = uuidv7();
    q().write({ entity: 'wallet_transaction', entityId: id, op: 'create', version: 1, payload: { memberId, amount, direction } }, () => {
      q().run(
        `INSERT INTO wallet_transactions (id, branch_id, member_id, direction, amount_irr, balance_after_irr, reason, ref_entity, ref_id, note, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        id,
        q().branchId,
        memberId,
        direction,
        amount,
        next,
        reason,
        refEntity,
        refId,
        note,
        userId,
      );
    });
    return { balance: next, id };
  },
  history(memberId: string) {
    return plainRows(q().all('SELECT * FROM wallet_transactions WHERE member_id = ? ORDER BY created_at DESC LIMIT 100', memberId));
  },
};

/* ────────────────────────────── cash & expenses ────────────────────────────── */

export const cash = {
  current() {
    return q().get('SELECT * FROM cash_sessions WHERE branch_id = ? AND status = ? ORDER BY opened_at DESC LIMIT 1', q().branchId, 'open');
  },
  open(openingFloat: number, userId: string) {
    const existing = cash.current();
    if (existing) throw new Error('یک صندوق باز وجود دارد؛ ابتدا آن را ببندید');
    const id = uuidv7();
    q().run('INSERT INTO cash_sessions (id, branch_id, opened_by, opened_at, opening_float_irr) VALUES (?,?,?,?,?)', id, q().branchId, userId, nowIso(), openingFloat);
    return q().get('SELECT * FROM cash_sessions WHERE id = ?', id);
  },
  summary(sessionId: string) {
    const row = q().get<{ id: string; opening_float_irr: number; opened_at: string }>('SELECT id, opening_float_irr, opened_at FROM cash_sessions WHERE id = ?', sessionId);
    if (!row) throw new Error('صندوق یافت نشد');
    const inflow = num(
      q().get<{ s: number }>("SELECT COALESCE(SUM(amount_irr),0) AS s FROM payments WHERE cash_session_id = ? AND status = 'posted'", sessionId)?.s,
    );
    const salesCash = num(q().get<{ s: number }>("SELECT COALESCE(SUM(total_irr),0) AS s FROM sales WHERE cash_session_id = ?", sessionId)?.s);
    const outflow = num(q().get<{ s: number }>("SELECT COALESCE(SUM(amount_irr),0) AS s FROM expenses WHERE cash_session_id = ?", sessionId)?.s);
    const expected = num(row.opening_float_irr) + inflow + salesCash - outflow;
    return { sessionId, openingFloat: num(row.opening_float_irr), openedAt: row.opened_at, inflow, salesCash, outflow, expected };
  },
  close(sessionId: string, counted: number, userId: string, note: string) {
    const s = cash.summary(sessionId);
    const diff = counted - s.expected;
    q().run("UPDATE cash_sessions SET status = 'closed', closed_by = ?, closed_at = ?, expected_irr = ?, counted_irr = ?, difference_irr = ?, note = ? WHERE id = ?", userId, nowIso(), s.expected, counted, diff, note, sessionId);
    return { ...s, counted, difference: diff };
  },
  list(limit = 30) {
    return plainRows(q().all('SELECT * FROM cash_sessions WHERE branch_id = ? ORDER BY opened_at DESC LIMIT ?', q().branchId, limit));
  },
};

export const expenses = {
  list(limit = 100) {
    return plainRows(q().all('SELECT * FROM expenses WHERE deleted_at IS NULL AND branch_id = ? ORDER BY paid_at DESC LIMIT ?', q().branchId, limit));
  },
  create(input: { category: string; amountIrr: number; paidAt: string; method: string; payee?: string | null; note?: string | null }, userId: string) {
    const session = cash.current();
    const id = uuidv7();
    q().write({ entity: 'expense', entityId: id, op: 'create', version: 1, payload: input }, () => {
      q().run(
        `INSERT INTO expenses (id, branch_id, cash_session_id, category, amount_irr, paid_at, method, payee, note, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        id,
        q().branchId,
        input.method === 'cash' ? (session?.id ?? null) : null,
        input.category,
        input.amountIrr,
        input.paidAt,
        input.method,
        input.payee ?? null,
        input.note ?? null,
        userId,
      );
    });
    return q().get('SELECT * FROM expenses WHERE id = ?', id);
  },
};

/* ────────────────────────────── attendance ────────────────────────────── */

export const attendance = {
  today() {
    return plainRows(
      q().all(
        `SELECT c.*, m.full_name AS memberName, m.mobile AS memberMobile FROM checkins c JOIN members m ON m.id = c.member_id
         WHERE c.branch_id = ? AND date(c.checked_in_at, 'localtime') = date('now','localtime') AND c.deleted_at IS NULL
         ORDER BY c.checked_in_at DESC`,
        q().branchId,
      ),
    );
  },
  present() {
    return num(
      q().get<{ c: number }>(
        "SELECT COUNT(*) AS c FROM checkins WHERE branch_id = ? AND checked_out_at IS NULL AND date(checked_in_at,'localtime') = date('now','localtime')",
        q().branchId,
      )?.c,
    );
  },
  history(opts: { from?: string; to?: string; limit?: number } = {}) {
    const where = ['c.deleted_at IS NULL', 'c.branch_id = ?'];
    const params: unknown[] = [q().branchId];
    if (opts.from) {
      where.push("date(c.checked_in_at,'localtime') >= ?");
      params.push(opts.from);
    }
    if (opts.to) {
      where.push("date(c.checked_in_at,'localtime') <= ?");
      params.push(opts.to);
    }
    return plainRows(
      q().all(
        `SELECT c.*, m.full_name AS memberName, m.mobile AS memberMobile FROM checkins c JOIN members m ON m.id = c.member_id
         WHERE ${where.join(' AND ')} ORDER BY c.checked_in_at DESC LIMIT ?`,
        ...params,
        Math.min(opts.limit ?? 200, 1000),
      ),
    );
  },
  checkin(input: { memberId: string; method: string; overrideReason?: string }, userId: string) {
    const member = q().get<{ id: string; full_name: string; status: string }>('SELECT id, full_name, status FROM members WHERE id = ? AND deleted_at IS NULL', input.memberId);
    if (!member) throw new Error('عضو یافت نشد');
    if (member.status === 'blocked') throw new Error('عضویت این عضو مسدود است');

    const duplicate = q().get<{ id: string }>(
      `SELECT id FROM checkins WHERE member_id = ? AND checked_out_at IS NULL AND date(checked_in_at,'localtime') = date('now','localtime')`,
      input.memberId,
    );
    if (duplicate) throw new Error('این عضو امروز چک‌این باز دارد');

    const contract = contracts.activeFor(input.memberId);
    const today = todayLocal();
    const expired = !contract || contract.end_date < today || contract.status === 'expired';
    const sessionsFinished = contract?.sessions_total != null && num(contract.sessions_used) >= num(contract.sessions_total);
    const override = input.overrideReason?.trim();

    if ((expired || sessionsFinished) && !override) {
      throw new Error(
        !contract
          ? 'این عضو قرارداد فعال ندارد؛ برای ورود ارفاقی دلیل ثبت کنید'
          : expired
            ? `عضویت در تاریخ ${contract.end_date} منقضی شده است؛ برای ورود ارفاقی دلیل ثبت کنید`
            : 'جلسات این قرارداد تمام شده است؛ برای ورود ارفاقی دلیل ثبت کنید',
      );
    }

    const id = uuidv7();
    q().write({ entity: 'checkin', entityId: id, op: 'create', version: 1, payload: { memberId: input.memberId } }, () => {
      q().run(
        `INSERT INTO checkins (id, branch_id, member_id, contract_id, checked_in_at, method, is_override, override_reason, override_by, device_id)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        id,
        q().branchId,
        input.memberId,
        contract?.id ?? null,
        nowIso(),
        input.method,
        override ? 1 : 0,
        override ?? null,
        override ? userId : null,
        q().deviceId,
      );
      if (contract && !override) {
        q().run('UPDATE contracts SET sessions_used = sessions_used + 1, updated_at = ? WHERE id = ? AND sessions_total IS NOT NULL', nowIso(), contract.id);
      }
      q().run(
        'INSERT INTO loyalty_events (id, branch_id, member_id, points, kind, ref_entity, ref_id) VALUES (?,?,?,?,?,?,?)',
        uuidv7(),
        q().branchId,
        input.memberId,
        1,
        'checkin',
        'checkin',
        id,
      );
    });
    return {
      id,
      memberName: member.full_name,
      override: Boolean(override),
      endDate: contract?.end_date ?? null,
      sessionsLeft: contract?.sessions_total != null ? num(contract.sessions_total) - num(contract.sessions_used) : null,
    };
  },
  checkout(checkinId: string) {
    q().run('UPDATE checkins SET checked_out_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), checkinId);
  },
  hourlyToday() {
    const rows = q().all<{ h: string; c: number }>(
      `SELECT strftime('%H', checked_in_at, 'localtime') AS h, COUNT(*) AS c FROM checkins
       WHERE branch_id = ? AND date(checked_in_at,'localtime') = date('now','localtime') GROUP BY h ORDER BY h`,
      q().branchId,
    );
    return rows.map((r) => ({ hour: Number(r.h), count: num(r.c) }));
  },
};

/* ────────────────────────────── POS ────────────────────────────── */

export const pos = {
  products(includeInactive = false) {
    return plainRows(
      q().all(`SELECT * FROM products WHERE branch_id = ? AND deleted_at IS NULL ${includeInactive ? '' : 'AND is_active = 1'} ORDER BY name`, q().branchId),
    );
  },
  createProduct(input: { name: string; priceIrr: number; costIrr?: number; stockQty?: number; lowStockThreshold?: number }) {
    const id = uuidv7();
    q().write({ entity: 'product', entityId: id, op: 'create', version: 1, payload: input }, () => {
      q().run('INSERT INTO products (id, branch_id, name, price_irr, cost_irr, stock_qty, low_stock_threshold) VALUES (?,?,?,?,?,?,?)', id, q().branchId, input.name, input.priceIrr, input.costIrr ?? 0, input.stockQty ?? 0, input.lowStockThreshold ?? 3);
    });
    return q().get('SELECT * FROM products WHERE id = ?', id);
  },
  restock(productId: string, qty: number, note: string, userId: string) {
    q().write({ entity: 'product', entityId: productId, op: 'update', version: 1, payload: { restock: qty } }, () => {
      q().run('UPDATE products SET stock_qty = stock_qty + ?, updated_at = ? WHERE id = ?', qty, nowIso(), productId);
      q().run('INSERT INTO inventory_movements (id, branch_id, product_id, qty_delta, reason, note, created_by) VALUES (?,?,?,?,?,?,?)', uuidv7(), q().branchId, productId, qty, 'purchase', note, userId);
    });
    return q().get('SELECT * FROM products WHERE id = ?', productId);
  },
  sell(input: { memberId?: string | null; items: { productId: string; qty: number }[]; method: string; discountIrr?: number }, userId: string) {
    const session = cash.current();
    let subtotal = 0;
    const lines = input.items.map((item) => {
      const product = q().get<{ id: string; name: string; price_irr: number; stock_qty: number }>('SELECT id, name, price_irr, stock_qty FROM products WHERE id = ?', item.productId);
      if (!product) throw new Error('محصول یافت نشد');
      if (num(product.stock_qty) < item.qty) throw new Error(`موجودی «${product.name}» کافی نیست`);
      const line = num(product.price_irr) * item.qty;
      subtotal += line;
      return { ...item, line, name: product.name };
    });
    const discount = Math.min(num(input.discountIrr), subtotal);
    const total = subtotal - discount;
    if (input.method === 'wallet' && !input.memberId) throw new Error('برای فروش اعتباری، عضو را انتخاب کنید');
    if (input.method === 'wallet' && input.memberId) {
      if (wallet.balance(input.memberId) < total) throw new Error('موجودی کیف پول عضو کافی نیست');
    }
    if (input.method === 'credit' && !input.memberId) throw new Error('برای فروش نسیه، عضو را انتخاب کنید');

    const saleId = uuidv7();
    const saleNo = num(q().get<{ n: number }>('SELECT COALESCE(MAX(sale_no),0) + 1 AS n FROM sales WHERE branch_id = ?', q().branchId)?.n) || 1;
    q().write({ entity: 'sale', entityId: saleId, op: 'create', version: 1, payload: { total } }, () => {
      q().run(
        `INSERT INTO sales (id, branch_id, member_id, cash_session_id, sale_no, subtotal_irr, discount_irr, total_irr, method, sold_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        saleId,
        q().branchId,
        input.memberId ?? null,
        input.method === 'cash' ? (session?.id ?? null) : null,
        saleNo,
        subtotal,
        discount,
        total,
        input.method,
        nowIso(),
        userId,
      );
      for (const line of lines) {
        q().run('INSERT INTO sale_items (id, branch_id, sale_id, product_id, qty, unit_price_irr, line_total_irr) VALUES (?,?,?,?,?,?,?)', uuidv7(), q().branchId, saleId, line.productId, line.qty, Math.round(line.line / line.qty), line.line);
        q().run('UPDATE products SET stock_qty = stock_qty - ?, updated_at = ? WHERE id = ?', line.qty, nowIso(), line.productId);
        q().run('INSERT INTO inventory_movements (id, branch_id, product_id, qty_delta, reason, ref_entity, ref_id, created_by) VALUES (?,?,?,?,?,?,?,?)', uuidv7(), q().branchId, line.productId, -line.qty, 'sale', 'sale', saleId, userId);
      }
    });
    if (input.method === 'wallet' && input.memberId) {
      wallet.spend(input.memberId, total, 'pos_sale', 'sale', saleId, userId);
    }
    return { id: saleId, saleNo, subtotal, discount, total, lines };
  },
  sales(limit = 50) {
    return plainRows(
      q().all(
        `SELECT s.*, m.full_name AS memberName FROM sales s LEFT JOIN members m ON m.id = s.member_id
         WHERE s.branch_id = ? AND s.deleted_at IS NULL ORDER BY s.sold_at DESC LIMIT ?`,
        q().branchId,
        limit,
      ),
    );
  },
  lowStock() {
    return plainRows(q().all('SELECT * FROM products WHERE branch_id = ? AND deleted_at IS NULL AND stock_qty <= low_stock_threshold ORDER BY stock_qty', q().branchId));
  },
};

/* ────────────────────────────── lockers / classes / trainers / body / programs ────────────────────────────── */

export const lockers = {
  list() {
    return plainRows(
      q().all(
        `SELECT l.*, r.id AS rentalId, r.end_date AS rentalEnd, m.full_name AS holderName
         FROM lockers l LEFT JOIN locker_rentals r ON r.locker_id = l.id AND r.status = 'active' AND r.deleted_at IS NULL
         LEFT JOIN members m ON m.id = r.member_id
         WHERE l.branch_id = ? AND l.deleted_at IS NULL ORDER BY l.code`,
        q().branchId,
      ),
    );
  },
  create(code: string, price: number) {
    const id = uuidv7();
    q().run('INSERT INTO lockers (id, branch_id, code, monthly_price_irr) VALUES (?,?,?,?)', id, q().branchId, code, price);
    return q().get('SELECT * FROM lockers WHERE id = ?', id);
  },
  rent(lockerId: string, memberId: string, startDate: string, months: number) {
    const locker = q().get<{ monthly_price_irr: number; status: string }>('SELECT monthly_price_irr, status FROM lockers WHERE id = ?', lockerId);
    if (!locker) throw new Error('کمد یافت نشد');
    if (locker.status === 'rented') throw new Error('این کمد در اجاره است');
    const id = uuidv7();
    const endDate = addDaysIso(startDate, months * 30);
    q().write({ entity: 'locker_rental', entityId: id, op: 'create', version: 1, payload: { lockerId, memberId } }, () => {
      q().run('INSERT INTO locker_rentals (id, branch_id, locker_id, member_id, start_date, end_date, amount_irr) VALUES (?,?,?,?,?,?,?)', id, q().branchId, lockerId, memberId, startDate, endDate, num(locker.monthly_price_irr) * months);
      q().run("UPDATE lockers SET status = 'rented', updated_at = ? WHERE id = ?", nowIso(), lockerId);
    });
    return q().get('SELECT * FROM locker_rentals WHERE id = ?', id);
  },
  endRent(rentalId: string) {
    const row = q().get<{ locker_id: string }>('SELECT locker_id FROM locker_rentals WHERE id = ?', rentalId);
    if (!row) throw new Error('اجاره یافت نشد');
    q().run("UPDATE locker_rentals SET status = 'ended', updated_at = ? WHERE id = ?", nowIso(), rentalId);
    q().run("UPDATE lockers SET status = 'free', updated_at = ? WHERE id = ?", nowIso(), row.locker_id);
  },
};

export const classes = {
  list() {
    return plainRows(
      q().all(
        `SELECT c.*, t.full_name AS trainerName, (SELECT COUNT(*) FROM class_enrollments e WHERE e.class_id = c.id AND e.status = 'active') AS enrolled
         FROM classes c LEFT JOIN trainers t ON t.id = c.trainer_id WHERE c.branch_id = ? AND c.deleted_at IS NULL ORDER BY c.weekday, c.start_time`,
        q().branchId,
      ),
    );
  },
  create(input: { name: string; trainerId?: string | null; weekday: number; startTime: string; endTime: string; capacity: number }) {
    const id = uuidv7();
    q().run('INSERT INTO classes (id, branch_id, trainer_id, name, weekday, start_time, end_time, capacity) VALUES (?,?,?,?,?,?,?,?)', id, q().branchId, input.trainerId ?? null, input.name, input.weekday, input.startTime, input.endTime, input.capacity);
    return q().get('SELECT * FROM classes WHERE id = ?', id);
  },
  enroll(classId: string, memberId: string) {
    const cls = q().get<{ capacity: number }>('SELECT capacity FROM classes WHERE id = ?', classId);
    const enrolled = num(q().get<{ c: number }>("SELECT COUNT(*) AS c FROM class_enrollments WHERE class_id = ? AND status = 'active'", classId)?.c);
    if (cls && enrolled >= num(cls.capacity)) throw new Error('ظرفیت کلاس پر است');
    const id = uuidv7();
    q().run('INSERT INTO class_enrollments (id, branch_id, class_id, member_id, enrolled_at) VALUES (?,?,?,?,?)', id, q().branchId, classId, memberId, nowIso());
    return { id };
  },
};

export const trainers = {
  list() {
    return plainRows(q().all('SELECT * FROM trainers WHERE branch_id = ? AND deleted_at IS NULL ORDER BY full_name', q().branchId));
  },
  create(input: { fullName: string; mobile?: string | null; specialty?: string | null; commissionRateBp?: number }) {
    const id = uuidv7();
    q().run('INSERT INTO trainers (id, branch_id, full_name, mobile, specialty, commission_rate_bp) VALUES (?,?,?,?,?,?)', id, q().branchId, input.fullName, input.mobile ?? null, input.specialty ?? null, input.commissionRateBp ?? 0);
    return q().get('SELECT * FROM trainers WHERE id = ?', id);
  },
};

export const body = {
  list(memberId: string) {
    return plainRows(q().all('SELECT * FROM body_measurements WHERE member_id = ? AND deleted_at IS NULL ORDER BY measured_at DESC', memberId));
  },
  create(input: { memberId: string; measuredAt: string; weightKg?: number; heightCm?: number; bodyFatPct?: number; muscleMassKg?: number; waistCm?: number; chestCm?: number; armCm?: number; thighCm?: number; note?: string }, userId: string) {
    const id = uuidv7();
    q().run(
      `INSERT INTO body_measurements (id, branch_id, member_id, measured_at, weight_kg, height_cm, body_fat_pct, muscle_mass_kg, waist_cm, chest_cm, arm_cm, thigh_cm, measured_by, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id,
      q().branchId,
      input.memberId,
      input.measuredAt,
      input.weightKg ?? null,
      input.heightCm ?? null,
      input.bodyFatPct ?? null,
      input.muscleMassKg ?? null,
      input.waistCm ?? null,
      input.chestCm ?? null,
      input.armCm ?? null,
      input.thighCm ?? null,
      userId,
      input.note ?? null,
    );
    return q().get('SELECT * FROM body_measurements WHERE id = ?', id);
  },
};

export const programs = {
  list(memberId?: string) {
    const where = ['p.deleted_at IS NULL', 'p.branch_id = ?'];
    const params: unknown[] = [q().branchId];
    if (memberId) {
      where.push('p.member_id = ?');
      params.push(memberId);
    }
    return plainRows(
      q().all(
        `SELECT p.*, m.full_name AS memberName, t.full_name AS trainerName FROM workout_programs p
         JOIN members m ON m.id = p.member_id LEFT JOIN trainers t ON t.id = p.trainer_id
         WHERE ${where.join(' AND ')} ORDER BY p.start_date DESC`,
        ...params,
      ),
    );
  },
  create(input: { memberId: string; trainerId?: string | null; title: string; startDate: string; endDate?: string; notes?: string }) {
    const id = uuidv7();
    q().run('INSERT INTO workout_programs (id, branch_id, member_id, trainer_id, title, start_date, end_date, notes) VALUES (?,?,?,?,?,?,?,?)', id, q().branchId, input.memberId, input.trainerId ?? null, input.title, input.startDate, input.endDate ?? null, input.notes ?? null);
    return q().get('SELECT * FROM workout_programs WHERE id = ?', id);
  },
  items(programId: string) {
    return plainRows(q().all('SELECT * FROM workout_items WHERE program_id = ? AND deleted_at IS NULL ORDER BY day_index, order_index', programId));
  },
  addItem(programId: string, input: { exerciseId?: string | null; dayIndex?: number; sets?: number; reps?: string; weightKg?: number; restSeconds?: number; note?: string }) {
    const id = uuidv7();
    q().run(
      'INSERT INTO workout_items (id, branch_id, program_id, exercise_id, day_index, order_index, sets, reps, weight_kg, rest_seconds, note) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      id,
      q().branchId,
      programId,
      input.exerciseId ?? null,
      input.dayIndex ?? 0,
      num(q().get<{ n: number }>('SELECT COALESCE(MAX(order_index),0)+1 AS n FROM workout_items WHERE program_id = ?', programId)?.n),
      input.sets ?? null,
      input.reps ?? null,
      input.weightKg ?? null,
      input.restSeconds ?? null,
      input.note ?? null,
    );
    return q().get('SELECT * FROM workout_items WHERE id = ?', id);
  },
  exercises() {
    return plainRows(q().all('SELECT * FROM exercises WHERE deleted_at IS NULL ORDER BY muscle_group, name LIMIT 500'));
  },
  seedExercises() {
    const count = num(q().get<{ c: number }>('SELECT COUNT(*) AS c FROM exercises')?.c);
    if (count > 0) return;
    const list: [string, string][] = [
      ['پرس سینه هالتر', 'سینه'],
      ['پرس سینه دمبل', 'سینه'],
      ['قفسه سینه سیم‌کش', 'سینه'],
      ['زیربغل سیم‌کش', 'زیربغل'],
      ['بارفیکس', 'زیربغل'],
      ['ددلیفت', 'زیربغل'],
      ['اسکات', 'پا'],
      ['پرس پا', 'پا'],
      ['جلو پا', 'پا'],
      ['پشت پا', 'پا'],
      ['ساق پا', 'پا'],
      ['پرس سرشانه دمبل', 'سرشانه'],
      ['نشر از جانب', 'سرشانه'],
      ['جلو بازو هالتر', 'بازو'],
      ['جلو بازو دمبل', 'بازو'],
      ['پشت بازو سیم‌کش', 'بازو'],
      ['پشت بازو خوابیده', 'بازو'],
      ['شکم کرانچ', 'شکم'],
      ['پلانک', 'شکم'],
      ['کشش کوهنوردی', 'هوازی'],
    ];
    for (const [name, group] of list) {
      q().run('INSERT INTO exercises (id, name, muscle_group, is_global) VALUES (?,?,?,1)', uuidv7(), name, group);
    }
  },
};

export const loyalty = {
  forMember(memberId: string) {
    const total = num(q().get<{ s: number }>('SELECT COALESCE(SUM(points),0) AS s FROM loyalty_events WHERE member_id = ?', memberId)?.s);
    return { points: total };
  },
  leaderboard(limit = 10) {
    return plainRows(
      q().all(
        `SELECT m.id, m.full_name AS fullName, COALESCE(SUM(l.points),0) AS points FROM loyalty_events l
         JOIN members m ON m.id = l.member_id WHERE l.branch_id = ? GROUP BY m.id ORDER BY points DESC LIMIT ?`,
        q().branchId,
        limit,
      ),
    );
  },
};

export const sms = {
  list(limit = 50) {
    return plainRows(q().all('SELECT * FROM sms_queue WHERE branch_id = ? ORDER BY created_at DESC LIMIT ?', q().branchId, limit));
  },
  enqueue(mobile: string, body: string, template: string, memberId?: string | null) {
    const id = uuidv7();
    q().run('INSERT INTO sms_queue (id, branch_id, member_id, mobile, template, body) VALUES (?,?,?,?,?,?)', id, q().branchId, memberId ?? null, mobile, template, body);
    return { id, status: 'queued' };
  },
};

/* ────────────────────────────── reports ────────────────────────────── */

export const reports = {
  dashboard(from: string, to: string) {
    const revenue = num(q().get<{ s: number }>("SELECT COALESCE(SUM(amount_irr),0) AS s FROM payments WHERE branch_id = ? AND status='posted' AND paid_at BETWEEN ? AND ?", q().branchId, from, to)?.s);
    const salesRevenue = num(q().get<{ s: number }>("SELECT COALESCE(SUM(total_irr),0) AS s FROM sales WHERE branch_id = ? AND sold_at BETWEEN ? AND ?", q().branchId, from, to)?.s);
    const expenseTotal = num(q().get<{ s: number }>('SELECT COALESCE(SUM(amount_irr),0) AS s FROM expenses WHERE branch_id = ? AND paid_at BETWEEN ? AND ?', q().branchId, from, to)?.s);
    const memberCount = members.count();
    const activeContracts = num(q().get<{ c: number }>("SELECT COUNT(*) AS c FROM contracts WHERE branch_id = ? AND status = 'active'", q().branchId)?.c);
    const checkins = num(q().get<{ c: number }>("SELECT COUNT(*) AS c FROM checkins WHERE branch_id = ? AND date(checked_in_at,'localtime') BETWEEN ? AND ?", q().branchId, from, to)?.c);
    const expiring = q().all(
      `SELECT c.id, c.end_date AS endDate, m.full_name AS memberName, m.mobile AS memberMobile, m.id AS memberId
       FROM contracts c JOIN members m ON m.id = c.member_id
       WHERE c.branch_id = ? AND c.status = 'active' AND c.end_date BETWEEN ? AND ?
       ORDER BY c.end_date LIMIT 12`,
      q().branchId,
      todayLocal(),
      addDaysIso(todayLocal(), 7),
    );
    return {
      revenue: revenue + salesRevenue,
      membershipRevenue: revenue,
      posRevenue: salesRevenue,
      expenses: expenseTotal,
      profit: revenue + salesRevenue - expenseTotal,
      memberCount,
      activeContracts,
      checkins,
      present: attendance.present(),
      expiring: plainRows(expiring),
      lowStock: pos.lowStock().length,
    };
  },
  series(days = 30) {
    const rows = q().all<{ d: string; s: number }>(
      `SELECT paid_at AS d, SUM(amount_irr) AS s FROM payments WHERE branch_id = ? AND status='posted' AND paid_at >= ? GROUP BY paid_at ORDER BY paid_at`,
      q().branchId,
      addDaysIso(todayLocal(), -days + 1),
    );
    const byDay = new Map(rows.map((r) => [String(r.d), num(r.s)]));
    // zero-filled range so the chart always shows a real axis instead of a single point
    const out: { date: string; amount: number }[] = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const date = addDaysIso(todayLocal(), -i);
      out.push({ date, amount: byDay.get(date) ?? 0 });
    }
    return out;
  },
  monthly(months = 6) {
    return plainRows(
      q().all(
        `SELECT substr(paid_at,1,7) AS ym, SUM(amount_irr) AS total FROM payments
         WHERE branch_id = ? AND status='posted' GROUP BY ym ORDER BY ym DESC LIMIT ?`,
        q().branchId,
        months,
      ),
    );
  },
  churn() {
    const total = num(q().get<{ c: number }>("SELECT COUNT(*) AS c FROM contracts WHERE branch_id = ?", q().branchId)?.c);
    const expired = num(q().get<{ c: number }>("SELECT COUNT(*) AS c FROM contracts WHERE branch_id = ? AND status = 'expired'", q().branchId)?.c);
    const renewed = num(
      q().get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM contracts c WHERE c.branch_id = ? AND c.status = 'active'
         AND EXISTS (SELECT 1 FROM contracts p WHERE p.member_id = c.member_id AND p.id <> c.id AND p.start_date < c.start_date)`,
        q().branchId,
      )?.c,
    );
    return { total, expired, renewed, churnRate: total ? Math.round((expired / total) * 100) : 0, renewalRate: total ? Math.round((renewed / total) * 100) : 0 };
  },
};

/* ────────────────────────────── meta ────────────────────────────── */

export const meta = {
  bootstrap() {
    contracts.expireStale();
    return {
      branch: q().get('SELECT * FROM branches WHERE id = ?', q().branchId),
      settings: settings.all(),
      usersCount: users.count(),
      user: null,
      counts: {
        members: members.count(),
        plans: plans.list(true).length,
        products: pos.products(true).length,
        tickets: num(q().get<{ c: number }>("SELECT COUNT(*) AS c FROM support_tickets WHERE branch_id = ? AND status <> 'closed'", q().branchId)?.c),
        unreadReplies: num(q().get<{ c: number }>("SELECT COALESCE(SUM(unread_count),0) AS c FROM support_tickets WHERE branch_id = ?", q().branchId)?.c),
      },
    };
  },
  setup(input: { clubName: string; phone?: string; address?: string; genderType?: string; ownerName: string; username: string; password: string; pin?: string }) {
    if (users.count() > 0) throw new Error('این نسخه قبلاً راه‌اندازی شده است');
    q().write({ entity: 'branch', entityId: q().branchId, op: 'update', version: 1, payload: { name: input.clubName } }, () => {
      q().run('UPDATE branches SET name = ?, phone = ?, address = ?, gender_type = ?, updated_at = ? WHERE id = ?', input.clubName, input.phone ?? null, input.address ?? null, input.genderType ?? 'mixed', nowIso(), q().branchId);
    });
    settings.set('club.name', input.clubName);
    settings.set('club.phone', input.phone ?? '');
    settings.set('club.address', input.address ?? '');
    settings.set('currency.unit', 'IRR');
    settings.set('freeze.cap_days', '30');
    settings.set('trial.member_cap', '20');
    const owner = users.create({ username: input.username, fullName: input.ownerName, role: 'owner', password: input.password, pin: input.pin ?? null });
    programs.seedExercises();
    return owner;
  },
};
