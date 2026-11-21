// پرکردن دادهٔ نمونه برای اسکرین‌شات‌های لندینگ (با کاربر واردشدهٔ فعلی اجرا می‌شود)
const inv = (c, p) => window.api.invoke(c, p);
const out = {};

const plans = (await inv('plans:list', { includeInactive: true })).data ?? [];
if (!plans.length) {
  await inv('plans:create', { name: 'ماهانه طلایی', kind: 'time', durationDays: 30, priceIrr: 2500000 });
  await inv('plans:create', { name: '۱۲ جلسه‌ای', kind: 'session', durationDays: 45, sessionCount: 12, priceIrr: 1800000 });
  await inv('plans:create', { name: 'سه‌ماهه ویژه', kind: 'time', durationDays: 90, priceIrr: 6500000 });
}

const names = [
  ['علی رضایی', '09121110001'],
  ['سارا محمدی', '09121110002'],
  ['مهدی کریمی', '09121110003'],
  ['نگار تهرانی', '09121110004'],
  ['حسین موسوی', '09121110005'],
  ['مریم احمدی', '09121110006'],
  ['امیر صادقی', '09121110007'],
  ['زهرا نوری', '09121110008'],
];

let members = (await inv('members:list', { limit: 60 })).data ?? [];
if (members.length < names.length) {
  for (const [fullName, mobile] of names) {
    await inv('members:create', { fullName, mobile, consent: true }).catch(() => null);
  }
  members = (await inv('members:list', { limit: 60 })).data ?? [];
}

const pl = (await inv('plans:list', {})).data ?? [];
let contracts = (await inv('contracts:list', {})).data ?? [];
if (contracts.length < 5 && members.length && pl.length) {
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < Math.min(members.length, 6); i++) {
    await inv('contracts:create', {
      memberId: members[i].id,
      planId: pl[i % pl.length].id,
      startDate: today,
      discountIrr: i === 0 ? 200000 : 0,
      discountReason: i === 0 ? 'تخفیف افتتاحیه' : '',
      payment: { amountIrr: 2500000, method: i % 2 === 0 ? 'cash' : 'card_to_card' },
    }).catch(() => null);
  }
}

const cash = await inv('cash:current');
if (!cash.data?.session) await inv('cash:open', { openingFloat: 800000 });

const products = (await inv('pos:products', {})).data ?? [];
if (!products.length) {
  await inv('pos:createProduct', { name: 'آب معدنی', priceIrr: 15000, costIrr: 9000, stockQty: 24 });
  await inv('pos:createProduct', { name: 'پروتئین بار', priceIrr: 85000, costIrr: 60000, stockQty: 8 });
  await inv('pos:createProduct', { name: 'دستکش تمرین', priceIrr: 45000, costIrr: 30000, stockQty: 15 });
}
const pr = (await inv('pos:products', {})).data ?? [];
if (pr.length && members.length) {
  await inv('pos:sell', { memberId: members[0].id, items: [{ productId: pr[0].id, qty: 2 }], method: 'wallet' }).catch(() => null);
  await inv('pos:sell', { memberId: members[1].id, items: [{ productId: pr[1].id, qty: 1 }], method: 'cash' }).catch(() => null);
}

const trainers = (await inv('trainers:list', {})).data ?? [];
if (!trainers.length) {
  await inv('trainers:create', { fullName: 'رضا مربی', commissionRateBp: 2000, specialty: 'بدنسازی' });
  await inv('trainers:create', { fullName: 'مهسا کوهی', commissionRateBp: 1800, specialty: 'کراسفیت' });
}
const tr = (await inv('trainers:list', {})).data ?? [];
const classes = (await inv('classes:list', {})).data ?? [];
if (!classes.length && tr.length) {
  await inv('classes:createMany', { name: 'کراسفیت', trainerId: tr[0].id, weekdays: [1, 3, 5], startTime: '18:00', endTime: '19:30', capacity: 12 }).catch(() => null);
  await inv('classes:createMany', { name: 'تمرین قدرتی', trainerId: tr[1]?.id ?? tr[0].id, weekdays: [2, 4], startTime: '20:00', endTime: '21:00', capacity: 10 }).catch(() => null);
}

const lockers = (await inv('lockers:list', {})).data ?? [];
if (!lockers.length) {
  for (const code of ['A-1', 'A-2', 'A-3', 'B-1', 'B-2', 'B-3']) {
    await inv('lockers:create', { code, price: 300000 }).catch(() => null);
  }
}

if (members.length >= 3) {
  await inv('attendance:checkin', { memberId: members[0].id, method: 'barcode' }).catch(() => null);
  await inv('attendance:checkin', { memberId: members[1].id, method: 'fingerprint' }).catch(() => null);
  await inv('attendance:checkin', { memberId: members[2].id, method: 'manual' }).catch(() => null);
  await inv('body:create', { memberId: members[0].id, measuredAt: new Date().toISOString().slice(0, 10), weightKg: 82.5, heightCm: 178, bodyFatPct: 18.4 }).catch(() => null);
}

const tickets = (await inv('support:tickets', {})).data ?? [];
if (!tickets.length) {
  await inv('support:create', { subject: 'سؤال دربارهٔ چاپ فیش', category: 'howto', priority: 'normal', body: 'سلام، برای چاپ فیش حرارتی چه تنظیماتی لازم است؟' }).catch(() => null);
}

out.members = (await inv('members:list', { limit: 60 })).data?.length ?? 0;
out.contracts = (await inv('contracts:list', {})).data?.length ?? 0;
out.products = (await inv('pos:products', {})).data?.length ?? 0;
out.classes = (await inv('classes:list', {})).data?.length ?? 0;
out.lockers = (await inv('lockers:list', {})).data?.length ?? 0;
out.tickets = (await inv('support:tickets', {})).data?.length ?? 0;
JSON.stringify(out);
