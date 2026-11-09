import { db, todayLocal } from './db';
import { members, plans, contracts, payments, attendance, pos, cash, wallet, reports, users, meta, settings, cards, lockers, classes, trainers, body } from './repo';
import { license } from './license';
import { backupNow } from './backup';
import { addDaysIso } from '../../../lib/jalali';

type Check = { name: string; ok: boolean; detail?: unknown };

export async function runSmokeTest(dataDir: string) {
  const checks: Check[] = [];
  const expect = (name: string, fn: () => void) => {
    try {
      fn();
      checks.push({ name, ok: true });
    } catch (e) {
      checks.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  };
  const eq = (a: unknown, b: unknown, label: string) => {
    if (a !== b) throw new Error(`${label}: expected ${String(b)}, got ${String(a)}`);
  };
  const throws = (fn: () => unknown, label: string) => {
    try {
      fn();
    } catch {
      return;
    }
    throw new Error(`${label}: expected an error, none was thrown`);
  };

  let userId = '';
  if (users.count() === 0) {
    const owner = meta.setup({
      clubName: 'باشگاه تست',
      ownerName: 'مدیر تست',
      username: 'admin',
      password: 'admin1234',
      pin: '1234',
    });
    userId = owner.id;
  } else {
    userId = users.list()[0].id;
  }
  const admin = users.login('admin', 'admin1234');
  eq(admin.role, 'owner', 'owner role');

  const plan = plans.create({ name: 'ماهانه تست', kind: 'time', durationDays: 30, priceIrr: 2_000_000, vatRateBp: 0 }) as { id: string; price_irr: number };
  const sessionPlan = plans.create({ name: '۱۲ جلسه', kind: 'session', durationDays: 45, sessionCount: 12, priceIrr: 1_500_000 }) as { id: string };

  const stamp = Date.now().toString().slice(-9);
  const member = members.create({ fullName: 'علی رضایی', mobile: `0912${stamp}` }) as { id: string; member_no: number };
  eq(member.member_no >= 1, true, 'member number assigned');

  const created = contracts.create({ memberId: member.id, planId: plan.id, startDate: todayLocal(), discountIrr: 200_000, discountReason: 'تخفیف تست', payment: { amountIrr: 1_800_000, method: 'cash' } }, userId) as {
    contract: { id: string; end_date: string; list_price_irr: number; discount_irr: number };
    payment: { receipt_no: number; amount_irr: number };
  };
  eq(created.contract.end_date, addDaysIso(todayLocal(), 29), 'contract end date = start + 29');
  eq(created.payment.amount_irr, 1_800_000, 'payment amount');

  const renewed = contracts.renew(created.contract.id, plan.id, userId, { amountIrr: 2_000_000, method: 'cash' }) as { contract: { id: string; start_date: string; end_date: string } };
  eq(renewed.contract.start_date, addDaysIso(created.contract.end_date, 1), 'renewal starts after current end');

  const checkin = attendance.checkin({ memberId: member.id, method: 'barcode' }, userId);
  eq(Boolean(checkin.id), true, 'checkin created');
  expect('duplicate checkin rejected', () => throws(() => attendance.checkin({ memberId: member.id, method: 'barcode' }, userId), 'duplicate'));

  const frozen = contracts.freeze(created.contract.id, todayLocal(), 7, 'سفر', userId) as { endDate: string };
  eq(frozen.endDate, addDaysIso(created.contract.end_date, 7), 'freeze shifts end date by 7');

  const topup = wallet.topup(member.id, 500_000, 'تست', userId) as { balance: number };
  eq(topup.balance, 500_000, 'wallet balance after topup');
  const after = wallet.spend(member.id, 120_000, 'renewal', 'test', 'x', userId) as { balance: number };
  eq(after.balance, 380_000, 'wallet balance after spend');
  expect('wallet overdraft rejected', () => throws(() => wallet.spend(member.id, 9_999_999, 'renewal', 'test', 'y', userId), 'overdraft'));

  const product = pos.createProduct({ name: 'آب معدنی', priceIrr: 15_000, costIrr: 9_000, stockQty: 10 }) as { id: string; stock_qty: number };
  const sale = pos.sell({ items: [{ productId: product.id, qty: 2 }], method: 'wallet', memberId: member.id }, userId);
  eq(sale.total, 30_000, 'sale total');
  const afterSale = db().get<{ stock_qty: number }>('SELECT stock_qty FROM products WHERE id = ?', product.id);
  eq(afterSale?.stock_qty, 8, 'stock decreased by 2');
  eq(wallet.balance(member.id), 350_000, 'wallet debited by sale');

  const session = cash.open(1_000_000, userId) as { id: string };
  const summary = cash.summary(session.id) as { expected: number; inflow: number };
  eq(summary.expected, 1_000_000 + summary.inflow, 'cash expected = float + inflow');
  const closed = cash.close(session.id, 1_000_000 + summary.inflow - 5_000, userId, 'تست') as { difference: number };
  eq(closed.difference, -5_000, 'cash difference computed');

  const sessionPlanId = sessionPlan.id;
  expect('wallet payment rejected when balance is short', () =>
    throws(
      () => contracts.create({ memberId: member.id, planId: sessionPlanId, startDate: todayLocal(), payment: { amountIrr: 1_500_000, method: 'wallet' } }, userId),
      'wallet guard',
    ),
  );
  const contract2 = contracts.create({ memberId: member.id, planId: sessionPlanId, startDate: todayLocal(), payment: { amountIrr: 1_500_000, method: 'cash' } }, userId) as { contract: { id: string } };
  eq(Boolean(contract2.contract.id), true, 'second contract created with cash');
  eq(wallet.balance(member.id), 350_000, 'wallet untouched by cash payment');

  const card = cards.issue(member.id);
  eq(cards.lookup(card.token), member.id, 'card token resolves to member');
  eq(cards.lookup(card.barcode), member.id, 'barcode resolves to member');

  const trainer = trainers.create({ fullName: 'مربی تست', commissionRateBp: 2000 }) as { id: string };
  const cls = classes.create({ name: 'کلاس تست', trainerId: trainer.id, weekday: 1, startTime: '18:00', endTime: '19:30', capacity: 2 }) as { id: string };
  classes.enroll(cls.id, member.id);
  expect('class capacity enforced', () => {
    const m2 = members.create({ fullName: 'سارا محمدی', mobile: `0935${stamp}` }) as { id: string };
    classes.enroll(cls.id, m2.id);
    const m3 = members.create({ fullName: 'نگار تهرانی', mobile: `0936${stamp}` }) as { id: string };
    throws(() => classes.enroll(cls.id, m3.id), 'capacity 2 exceeded');
  });

  const locker = lockers.create('A-1', 300_000) as { id: string };
  lockers.rent(locker.id, member.id, todayLocal(), 1);
  expect('locker double-rent rejected', () => throws(() => lockers.rent(locker.id, member.id, todayLocal(), 1), 'locker busy'));

  body.create({ memberId: member.id, measuredAt: todayLocal(), weightKg: 82.5, heightCm: 178 }, userId);

  const dash = reports.dashboard(addDaysIso(todayLocal(), -30), todayLocal()) as { revenue: number; profit: number };
  eq(dash.revenue > 0, true, 'dashboard revenue > 0');

  const backup = backupNow(dataDir, 'manual');
  eq(backup.size > 0, true, 'backup file non-empty');

  const status = license.status();
  eq(status.machineId.length, 32, 'machine id length 32');
  eq(status.status === 'trial' || status.status === 'active', true, 'licence status is trial/active');

  const outbox = db().get<{ c: number }>('SELECT COUNT(*) AS c FROM outbox') as { c: number };
  eq(outbox.c > 0, true, 'outbox has records');

  const failed = checks.filter((c) => !c.ok);
  return { ok: failed.length === 0, checks, failed: failed.length, outbox: outbox.c, members: members.count(), revenue: dash.revenue };
}
