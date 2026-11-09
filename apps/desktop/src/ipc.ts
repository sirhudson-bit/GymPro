import { ipcMain, shell, app, dialog, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { members, plans, contracts, payments, cash, expenses, wallet, attendance, pos, lockers, classes, trainers, body, programs, loyalty, sms, reports, settings, users, cards, meta } from './repo';
import { db, uuidv7, nowIso, todayLocal } from './db';
import { license } from './license';
import { backupNow, listBackups, restoreBackup } from './backup';
import { readSession, saveSession, clearSession, SESSION_DAYS } from './session';
import { MemberCreate, MemberUpdate, PlanCreate, ContractCreate, PaymentCreate, ExpenseCreate, ProductCreate, SaleCreate, UserCreate, LoginInput, CheckinInput, TicketCreate, ChangePasswordInput, ResetWithCodeInput, ResetWithTokenInput } from './schemas';
import { log } from './logger';

type Handler = (payload: any) => unknown;
let currentUser: { id: string; username: string; fullName: string; role: string } | null = null;
/** in-memory guard against recovery-code brute force: 5 tries / 10 minutes per username */
const resetAttempts = new Map<string, { count: number; since: number }>();

// سرور پیش‌فرض لایسنس (همان پنلی که کلیدها را می‌سازد). با settings[license.server] قابل تغییر است.
const DEFAULT_LICENSE_SERVER = process.env.GYMPRO_LICENSE_SERVER ?? 'https://gym.academyr.ir';

// همان مبدأ سفارشی که main.ts برای بارگذاری رابط ثبت می‌کند (پنجرهٔ کیوسک هم از همین استفاده می‌کند)
const APP_ORIGIN = 'app://gympro';


export const getSession = () => currentUser;

const PUBLIC_CHANNELS = new Set([
  'app:info',
  'app:bootstrap',
  'setup:run',
  'auth:login',
  'auth:resetWithCode',
  'auth:resetWithToken',
  'license:status',
  'license:machineId',
]);

function parse<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { issues: { message: string }[] } } }, payload: unknown): T {
  const res = schema.safeParse(payload);
  if (!res.success) throw new Error(res.error?.issues?.[0]?.message ?? 'ورودی نامعتبر است');
  return res.data as T;
}

function auth() {
  if (!currentUser) throw new Error('برای این عملیات باید وارد شوید');
  return currentUser;
}

function role(...allowed: string[]) {
  const u = auth();
  if (!allowed.includes(u.role)) throw new Error('دسترسی کافی ندارید');
  return u;
}

export function registerIpc(deps: { dataDir: string; openDataDir: () => void; nightlyBackup: () => unknown }) {
  const table: Record<string, Handler> = {
    'app:info': () => ({
      version: app.getVersion(),
      dataDir: deps.dataDir,
      portable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR),
      license: license.status(),
      user: currentUser,
      today: todayLocal(),
    }),
    'app:bootstrap': () => {
      const boot = meta.bootstrap();
      let lastUsername: string | null = null;
      if (!currentUser) {
        const remembered = readSession(deps.dataDir);
        if (remembered && remembered.exp > Date.now()) {
          const row = db().get<{ id: string; username: string; full_name: string; role: string; is_active: number; password_changed_at: string | null }>(
            'SELECT id, username, full_name, role, is_active, password_changed_at FROM users WHERE id = ? AND deleted_at IS NULL',
            remembered.userId,
          );
          const stillValid = row && row.is_active === 1 && (row.password_changed_at ?? null) === (remembered.pwdAt ?? null);
          if (stillValid) {
            currentUser = { id: row.id, username: row.username, fullName: row.full_name, role: row.role };
            db().run('INSERT INTO login_sessions (id, user_id, device_id, started_at) VALUES (?,?,?,?)', uuidv7(), row.id, db().deviceId, nowIso());
            log.info('auth.auto_login', { username: row.username });
          } else {
            clearSession(deps.dataDir);
          }
        }
        if (!remembered) lastUsername = settings.get('auth.last_username', '') || null;
      }
      return { ...boot, user: currentUser, lastUsername };
    },

    'setup:run': (p) => {
      const owner = meta.setup({
        clubName: String(p.clubName ?? '').trim(),
        phone: p.phone,
        address: p.address,
        genderType: p.genderType,
        ownerName: String(p.ownerName ?? '').trim(),
        username: String(p.username ?? '').trim(),
        password: String(p.password ?? ''),
        pin: p.pin,
      });
      currentUser = { id: owner.id, username: owner.username, fullName: owner.fullName, role: owner.role };
      // shown exactly once, at setup; only the scrypt hash is stored
      const recoveryCode = users.issueRecoveryCode(owner.id);
      return { user: currentUser, recoveryCode };
    },

    'auth:login': (p) => {
      const input = parse(LoginInput, p);
      const remember = Boolean(p?.remember);
      const user = users.login(input.username, input.password);
      currentUser = { id: user.id, username: user.username, fullName: user.fullName, role: user.role };
      settings.set('auth.last_username', user.username);
      if (remember) {
        const pwdAt = db().get<{ pc: string | null }>('SELECT password_changed_at AS pc FROM users WHERE id = ?', user.id)?.pc ?? null;
        const res = saveSession(deps.dataDir, {
          userId: user.id,
          username: user.username,
          exp: Date.now() + SESSION_DAYS * 86400000,
          pwdAt,
        });
        log.info('auth.remember', { username: user.username, encrypted: res.encrypted });
      } else {
        clearSession(deps.dataDir);
      }
      log.info('auth.login', { username: user.username, role: user.role, remember });
      return { user: currentUser, remember };
    },
    'auth:logout': () => {
      currentUser = null;
      clearSession(deps.dataDir);
      return { ok: true };
    },
    'auth:pin': (p) => {
      const u = auth();
      if (!users.verifyPin(u.id, String(p?.pin ?? ''))) throw new Error('PIN نادرست است');
      return { ok: true };
    },
    'auth:users': () => role('owner', 'manager').valueOf() && users.list(),
    'auth:createUser': (p) => {
      role('owner');
      const input = parse(UserCreate, p);
      return users.create(input);
    },
    'auth:setPin': (p) => {
      const u = auth();
      users.setPin(u.id, String(p?.pin ?? ''));
      return { ok: true };
    },

    'auth:changePassword': (p) => {
      const u = auth();
      const input = parse(ChangePasswordInput, p);
      return users.changePassword(u.id, input.currentPassword, input.newPassword);
    },

    'auth:issueRecoveryCode': (p) => {
      const u = auth();
      const target = p?.userId ? String(p.userId) : u.id;
      if (target !== u.id) role('owner');
      return { code: users.issueRecoveryCode(target) };
    },

    'auth:ownerResetPassword': (p) => {
      const u = role('owner');
      const target = String(p?.userId ?? '');
      const next = String(p?.newPassword ?? '');
      if (!target) throw new Error('کاربر انتخاب نشده است');
      return users.ownerResetPassword(target, next, u.id);
    },

    'auth:resetWithCode': (p) => {
      const input = parse(ResetWithCodeInput, p);
      const key = input.username.toLowerCase();
      const record = resetAttempts.get(key) ?? { count: 0, since: Date.now() };
      if (Date.now() - record.since > 10 * 60_000) {
        record.count = 0;
        record.since = Date.now();
      }
      if (record.count >= 5) throw new Error('تلاش‌های ناموفق زیاد است؛ ۱۰ دقیقه بعد دوباره امتحان کنید');
      try {
        const result = users.resetWithRecoveryCode(input);
        resetAttempts.delete(key);
        log.info('auth.reset_with_code', { username: input.username });
        return result;
      } catch (e) {
        record.count += 1;
        resetAttempts.set(key, record);
        throw e;
      }
    },

    'auth:resetWithToken': (p) => {
      const input = parse(ResetWithTokenInput, p);
      const result = users.resetWithToken(
        { username: input.username, tokenJson: input.token, signature: input.signature, newPassword: input.newPassword },
        license.status().machineId,
      );
      log.info('auth.reset_with_token', { username: input.username });
      return result;
    },

    'members:list': (p) => members.list(p ?? {}),
    'members:get': (p) => members.get(String(p.id)),
    'members:create': (p) => {
      auth();
      license.assertCanAddMember();
      const input = parse(MemberCreate, p);
      return members.create({ ...input, consent: Boolean(input.consent) });
    },
    'members:update': (p) => {
      auth();
      const input = parse(MemberUpdate, p);
      return members.update(input as never);
    },
    'members:archive': (p) => {
      role('owner', 'manager');
      members.archive(String(p.id));
      return { ok: true };
    },
    'members:restore': (p) => {
      role('owner', 'manager');
      members.restore(String(p.id));
      return { ok: true };
    },
    'members:remove': (p) => {
      role('owner', 'manager');
      return members.remove(String(p.id));
    },

    'cards:issue': (p) => {
      auth();
      const card = cards.issue(String(p.memberId));
      const member = db().get<{ full_name: string; member_no: number }>('SELECT full_name, member_no FROM members WHERE id = ?', p.memberId);
      return { ...card, memberName: member?.full_name, memberNo: member?.member_no };
    },
    'cards:revoke': (p) => {
      auth();
      cards.revoke(String(p.cardId));
      return { ok: true };
    },
    'cards:active': (p) => cards.active(String(p.memberId)),
    'cards:lookup': (p) => {
      const memberId = cards.lookup(String(p.token ?? ''));
      if (!memberId) throw new Error('کارت شناسایی نشد');
      return members.get(memberId).member;
    },
    'ui:qr': async (p) => ({ dataUrl: await QRCode.toDataURL(String(p.text ?? ''), { margin: 3, width: 360, errorCorrectionLevel: 'M' }) }),

    // ذخیرهٔ خروجی تصویری (کارت عضویت، رسید) به‌جای چاپ کاغذی
    'ui:saveImage': async (p) => {
      const dataUrl = String(p?.dataUrl ?? '');
      if (!dataUrl.startsWith('data:image/png;base64,')) throw new Error('تصویر نامعتبر است');
      const safeName = String(p?.fileName ?? 'gympro.png').replace(/[\\/:*?"<>|]+/g, '-');
      const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
      // حالت خودکار (بدون دیالوگ): مسیر داده‌شده، یا پوشهٔ data/cards کنار داده‌ها
      const silent = process.env.GYMPRO_SILENT_SAVE === '1';
      let filePath = silent ? String(p?.targetPath ?? path.join(deps.dataDir, 'cards', safeName)) : '';
      if (!filePath) {
        const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
        const res = await dialog.showSaveDialog(win, {
          title: 'ذخیرهٔ تصویر',
          defaultPath: path.join(app.getPath('pictures'), safeName),
          filters: [{ name: 'تصویر PNG', extensions: ['png'] }],
        });
        if (res.canceled || !res.filePath) return { canceled: true };
        filePath = res.filePath;
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, buffer);
      log.info('image.saved', { file: path.basename(filePath), bytes: buffer.length });
      return { canceled: false, path: filePath };
    },

    'plans:list': (p) => plans.list(Boolean(p?.includeInactive)),
    'plans:create': (p) => {
      role('owner', 'manager');
      return plans.create(parse(PlanCreate, p) as never);
    },
    'plans:update': (p) => {
      role('owner', 'manager');
      return plans.update(p);
    },
    'plans:remove': (p) => {
      role('owner', 'manager');
      plans.remove(String(p.id));
      return { ok: true };
    },

    'contracts:list': (p) => contracts.list(p ?? {}),
    'contracts:create': (p) => {
      const u = role('owner', 'manager', 'receptionist');
      const input = parse(ContractCreate, p);
      return contracts.create(input as never, u.id);
    },
    'contracts:renew': (p) => {
      const u = role('owner', 'manager', 'receptionist');
      return contracts.renew(String(p.contractId), String(p.planId), u.id, p.payment);
    },
    'contracts:freeze': (p) => {
      const u = role('owner', 'manager');
      const days = Number(p.days);
      if (!Number.isFinite(days) || days < 1) throw new Error('تعداد روز فریز نامعتبر است');
      return contracts.freeze(String(p.contractId), String(p.startDate ?? todayLocal()), days, String(p.reason ?? ''), u.id);
    },
    'contracts:cancel': (p) => {
      role('owner', 'manager');
      contracts.cancel(String(p.contractId), String(p.reason ?? ''));
      return { ok: true };
    },

    'payments:list': (p) => payments.list(p ?? {}),
    'payments:create': (p) => {
      const u = auth();
      return payments.create(parse(PaymentCreate, p) as never, u.id);
    },
    'payments:void': (p) => {
      const u = role('owner', 'manager');
      payments.void(String(p.id), String(p.reason ?? 'بدون دلیل'), u.id);
      return { ok: true };
    },
    'payments:installments': (p) => payments.installments(String(p.paymentId)),
    'payments:payInstallment': (p) => payments.payInstallment(String(p.id), Number(p.amount)),

    'cash:current': () => ({ session: cash.current(), summary: cash.current() ? cash.summary(String((cash.current() as { id: string }).id)) : null }),
    'cash:open': (p) => {
      const u = role('owner', 'manager', 'receptionist');
      return cash.open(Number(p.openingFloat ?? 0), u.id);
    },
    'cash:summary': (p) => cash.summary(String(p.sessionId)),
    'cash:close': (p) => {
      const u = role('owner', 'manager');
      return cash.close(String(p.sessionId), Number(p.counted ?? 0), u.id, String(p.note ?? ''));
    },
    'cash:list': () => cash.list(),
    'expenses:list': () => expenses.list(),
    'expenses:create': (p) => {
      const u = role('owner', 'manager');
      return expenses.create(parse(ExpenseCreate, p) as never, u.id);
    },

    'wallet:balance': (p) => ({ balance: wallet.balance(String(p.memberId)) }),
    'wallet:history': (p) => wallet.history(String(p.memberId)),
    'wallet:topup': (p) => {
      const u = auth();
      return wallet.topup(String(p.memberId), Number(p.amount), String(p.note ?? ''), u.id);
    },

    'attendance:today': () => attendance.today(),
    'attendance:present': () => ({ present: attendance.present() }),
    'attendance:history': (p) => attendance.history(p ?? {}),
    'attendance:hourly': () => attendance.hourlyToday(),
    'attendance:checkin': (p) => {
      const u = auth();
      const input = parse(CheckinInput, p);
      let memberId = input.memberId;
      if (!memberId && input.token) memberId = cards.lookup(input.token) ?? undefined;
      if (!memberId) throw new Error('کارت شناسایی نشد؛ شمارهٔ عضویت را دستی وارد کنید');
      return attendance.checkin({ memberId, method: input.method, overrideReason: input.overrideReason }, u.id);
    },
    'attendance:checkout': (p) => {
      auth();
      attendance.checkout(String(p.id));
      return { ok: true };
    },

    'pos:products': (p) => pos.products(Boolean(p?.includeInactive)),
    'pos:createProduct': (p) => {
      role('owner', 'manager');
      return pos.createProduct(parse(ProductCreate, p) as never);
    },
    'pos:restock': (p) => {
      const u = role('owner', 'manager');
      return pos.restock(String(p.productId), Number(p.qty), String(p.note ?? ''), u.id);
    },
    'pos:sell': (p) => {
      const u = auth();
      return pos.sell(parse(SaleCreate, p) as never, u.id);
    },
    'pos:sales': () => pos.sales(),
    'pos:lowStock': () => pos.lowStock(),

    // پنجرهٔ دوم برای نمایشگر دوم (کیوسک) — بدون سایدبار و با صفحهٔ تمام
    'kiosk:openWindow': () => {
      role('owner', 'manager', 'receptionist');
      const existing = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'GymPro Kiosk' || (w as unknown as { __kiosk?: boolean }).__kiosk === true);
      if (existing) {
        existing.show();
        existing.focus();
        return { ok: true, reused: true };
      }
      const win = new BrowserWindow({
        width: 1280,
        height: 800,
        title: 'GymPro Kiosk',
        backgroundColor: '#0b1220',
        autoHideMenuBar: true,
        webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
      });
      (win as unknown as { __kiosk?: boolean }).__kiosk = true;
      win.loadURL(`${APP_ORIGIN}/index.html?kiosk=1#/kiosk`);
      win.once('ready-to-show', () => win.show());
      return { ok: true, reused: false };
    },

    'lockers:list': () => lockers.list(),
    'lockers:create': (p) => {
      role('owner', 'manager');
      return lockers.create(String(p.code), Number(p.price ?? 0));
    },
    'lockers:rent': (p) => {
      role('owner', 'manager', 'receptionist');
      return lockers.rent(String(p.lockerId), String(p.memberId), String(p.startDate ?? todayLocal()), Number(p.months ?? 1));
    },
    'lockers:end': (p) => {
      role('owner', 'manager', 'receptionist');
      lockers.endRent(String(p.rentalId));
      return { ok: true };
    },
    'lockers:update': (p) => {
      role('owner', 'manager');
      return lockers.update(String(p.id), { code: p.code, price: p.price === undefined ? undefined : Number(p.price), status: p.status });
    },
    'lockers:remove': (p) => {
      role('owner', 'manager');
      return lockers.remove(String(p.id));
    },

    'classes:list': () => classes.list(),
    'classes:create': (p) => {
      role('owner', 'manager');
      return classes.create({
        name: String(p.name),
        trainerId: p.trainerId ?? null,
        weekday: Number(p.weekday ?? 0),
        startTime: String(p.startTime ?? '18:00'),
        endTime: String(p.endTime ?? '19:30'),
        capacity: Number(p.capacity ?? 10),
      });
    },
    'classes:enroll': (p) => {
      auth();
      return classes.enroll(String(p.classId), String(p.memberId));
    },
    'classes:createMany': (p) => {
      role('owner', 'manager');
      return classes.createMany({
        name: String(p.name),
        trainerId: p.trainerId ?? null,
        weekdays: Array.isArray(p.weekdays) ? p.weekdays.map(Number) : [],
        startTime: String(p.startTime ?? '18:00'),
        endTime: String(p.endTime ?? '19:30'),
        capacity: Number(p.capacity ?? 10),
      });
    },
    'classes:update': (p) => {
      role('owner', 'manager');
      return classes.update(String(p.id), {
        name: p.name,
        trainerId: p.trainerId,
        weekday: p.weekday === undefined ? undefined : Number(p.weekday),
        startTime: p.startTime,
        endTime: p.endTime,
        capacity: p.capacity === undefined ? undefined : Number(p.capacity),
      });
    },
    'classes:remove': (p) => {
      role('owner', 'manager');
      return classes.remove(String(p.id));
    },
    'trainers:list': () => trainers.list(),
    'trainers:create': (p) => {
      role('owner', 'manager');
      return trainers.create({ fullName: String(p.fullName), mobile: p.mobile ?? null, specialty: p.specialty ?? null, commissionRateBp: Number(p.commissionRateBp ?? 0) });
    },
    'trainers:update': (p) => {
      role('owner', 'manager');
      return trainers.update(String(p.id), {
        fullName: p.fullName,
        mobile: p.mobile,
        specialty: p.specialty,
        commissionRateBp: p.commissionRateBp === undefined ? undefined : Number(p.commissionRateBp),
      });
    },
    'trainers:remove': (p) => {
      role('owner', 'manager');
      return trainers.remove(String(p.id));
    },

    'body:list': (p) => body.list(String(p.memberId)),
    'body:create': (p) => {
      const u = auth();
      return body.create({ ...p, memberId: String(p.memberId) } as never, u.id);
    },

    'programs:list': (p) => programs.list(p?.memberId),
    'programs:create': (p) => {
      role('owner', 'manager', 'trainer');
      return programs.create({ memberId: String(p.memberId), title: String(p.title), startDate: String(p.startDate ?? todayLocal()), trainerId: p.trainerId ?? null, notes: p.notes ?? '' });
    },
    'programs:items': (p) => programs.items(String(p.programId)),
    'programs:addItem': (p) => {
      role('owner', 'manager', 'trainer');
      return programs.addItem(String(p.programId), p);
    },
    'programs:exercises': () => {
      programs.seedExercises();
      return programs.exercises();
    },

    'loyalty:member': (p) => loyalty.forMember(String(p.memberId)),
    'loyalty:leaderboard': () => loyalty.leaderboard(),
    'sms:list': () => sms.list(),
    'sms:enqueue': (p) => {
      role('owner', 'manager');
      const text = String(p.body ?? '');
      if (text.length < 5) throw new Error('متن پیامک خیلی کوتاه است');
      return sms.enqueue(String(p.mobile), text, String(p.template ?? 'manual'), p.memberId ?? null);
    },

    'reports:dashboard': (p) => reports.dashboard(String(p?.from ?? todayLocal()), String(p?.to ?? todayLocal())),
    'reports:series': (p) => reports.series(Number(p?.days ?? 30)),
    'reports:monthly': () => reports.monthly(),
    'reports:churn': () => reports.churn(),

    'support:tickets': () => db().all('SELECT * FROM support_tickets WHERE branch_id = ? AND deleted_at IS NULL ORDER BY created_at DESC', db().branchId),
    'support:messages': (p) => db().all('SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY created_at', String(p.ticketId)),
    'support:create': (p) => {
      const u = auth();
      const input = parse(TicketCreate, p);
      const id = uuidv7();
      const online = Boolean(settings.get('support.url', ''));
      db().tx(() => {
        db().run('INSERT INTO support_tickets (id, branch_id, created_by, subject, category, priority, status) VALUES (?,?,?,?,?,?,?)', id, db().branchId, u.id, input.subject, input.category, input.priority, online ? 'queued' : 'draft');
        db().run('INSERT INTO support_messages (id, branch_id, ticket_id, direction, body, sent_at) VALUES (?,?,?,?,?,?)', uuidv7(), db().branchId, id, 'out', input.body, nowIso());
        db().run('UPDATE support_tickets SET last_message_at = ? WHERE id = ?', nowIso(), id);
      });
      return db().get('SELECT * FROM support_tickets WHERE id = ?', id);
    },
    'support:reply': (p) => {
      const u = auth();
      const body = String(p.body ?? '');
      if (body.trim().length < 2) throw new Error('متن پاسخ خیلی کوتاه است');
      const ticket = db().get<{ id: string; status: string }>('SELECT id, status FROM support_tickets WHERE id = ?', String(p.ticketId));
      if (!ticket) throw new Error('تیکت یافت نشد');
      db().run('INSERT INTO support_messages (id, branch_id, ticket_id, direction, body, sent_at) VALUES (?,?,?,?,?,?)', uuidv7(), db().branchId, ticket.id, 'out', body, nowIso());
      db().run("UPDATE support_tickets SET status = ?, unread_count = 0, last_message_at = ? WHERE id = ?", ticket.status === 'draft' ? 'draft' : 'sent', nowIso(), ticket.id);
      return { ok: true };
    },
    'support:close': (p) => {
      auth();
      db().run("UPDATE support_tickets SET status = 'closed', updated_at = ? WHERE id = ?", nowIso(), String(p.ticketId));
      return { ok: true };
    },
    'support:log': () => ({ log: log.tail(120) }),

    'license:status': () => license.status(),
    'license:machineId': () => ({ machineId: license.status().machineId }),
    'license:activate': (p) => license.activate({ licenseJson: String(p.licenseJson ?? ''), signature: String(p.signature ?? '') }),
    // فعال‌سازی با کلید، همان کلیدی که در پنل ساخته می‌شود (یک بار اینترنت لازم است)
    'license:activateOnline': async (p) => {
      const licenseKey = String(p?.licenseKey ?? '').trim().toUpperCase();
      if (!licenseKey) throw new Error('کلید لایسنس را وارد کنید');
      const serverUrl = String(p?.serverUrl ?? settings.get('license.server', DEFAULT_LICENSE_SERVER)).replace(/\/+$/, '');
      const current = license.status();
      let res: Response;
      try {
        res = await fetch(`${serverUrl}/v1/activate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ licenseKey, machineId: current.machineId, appVersion: process.env.npm_package_version ?? '1.0.0' }),
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        throw new Error('به سرور لایسنس وصل نشد. اتصال اینترنت را بررسی کنید یا از فعال‌سازی دستی (بدنه + امضا) استفاده کنید.');
      }
      const data = (await res.json().catch(() => ({}))) as { license?: Record<string, unknown>; signature?: string; error?: string; maxActivations?: number };
      if (!res.ok) {
        const map: Record<string, string> = {
          'unknown licence key': 'این کلید در سرور پیدا نشد. کلید را با پنل بررسی کنید.',
          'licence revoked': 'این لایسنس غیرفعال شده است. با پشتیبانی تماس بگیرید.',
          'activation limit reached': `سقف دستگاه‌های مجاز این کلید پر شده است (${data.maxActivations ?? '?'} دستگاه). در پنل یک اسلات آزاد کنید.`,
          'too many attempts': 'تلاش‌های زیاد از این شبکه. چند دقیقه بعد دوباره امتحان کنید.',
        };
        throw new Error(map[data.error ?? ''] ?? `فعال‌سازی ناموفق بود (${data.error ?? res.status})`);
      }
      if (!data.license || !data.signature) throw new Error('پاسخ سرور ناقص بود؛ دوباره تلاش کنید.');
      settings.set('license.server', serverUrl);
      return license.activate({ licenseJson: JSON.stringify(data.license), signature: data.signature });
    },
    'license:deactivate': () => license.deactivate(),

    'settings:all': () => settings.all(),
    'settings:set': (p) => {
      role('owner', 'manager');
      settings.set(String(p.key), String(p.value ?? ''));
      return settings.all();
    },

    'system:backup': () => backupNow(deps.dataDir, 'manual'),
    'system:backups': () => listBackups(),
    'system:restore': (p) => {
      role('owner');
      return restoreBackup(deps.dataDir, String(p.fileName));
    },
    'system:openDataDir': () => {
      deps.openDataDir();
      return { ok: true };
    },
    'system:openExternal': (p) => {
      const url = String(p.url ?? '');
      if (!/^https:\/\//.test(url)) throw new Error('فقط آدرس https مجاز است');
      shell.openExternal(url);
      return { ok: true };
    },
    'system:exportMembersCsv': () => {
      role('owner', 'manager');
      const rows = members.list({ limit: 200 });
      const header = ['member_no', 'full_name', 'mobile', 'joined_at', 'status'];
      const csv = ['\uFEFF' + header.join(','), ...rows.map((r: any) => header.map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\r\n');
      const dir = path.join(deps.dataDir, 'exports');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `members-${todayLocal()}.csv`);
      fs.writeFileSync(file, csv, 'utf8');
      return { file };
    },
    'system:logTail': () => ({ log: log.tail(200) }),
  };

  for (const [channel, handler] of Object.entries(table)) {
    ipcMain.handle(channel, async (_event, payload) => {
      try {
        if (!PUBLIC_CHANNELS.has(channel)) auth();
        const data = await handler(payload);
        return { ok: true, data };
      } catch (e) {
        const message = e instanceof Error ? e.message : 'خطای نامشخص';
        log.warn('ipc.failed', { channel, message });
        return { ok: false, error: { code: 'E_APP', message } };
      }
    });
  }

  return Object.keys(table);
}
