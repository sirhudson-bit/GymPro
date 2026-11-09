'use client';

import { useCallback, useEffect, useState } from 'react';
import { Banknote, CircleDollarSign, Lock, Plus, Receipt, Unlock } from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Badge, Button, Confirm, Empty, Field, Modal, MoneyInput, Row, Select, Table, TextInput, tomanToRial } from '@/components/ui';
import { formatJalali, formatMoney, toPersianDigits, todayJalali, parseJalaliInput } from '@/lib/format';

const METHOD: Record<string, string> = { cash: 'نقدی', card_to_card: 'کارت به کارت', cheque: 'چک', installment: 'اقساط', wallet: 'کیف پول', bank: 'بانک' };

export default function Finance() {
  const toast = useStore((s) => s.toast);
  const [tab, setTab] = useState<'cash' | 'payments' | 'expenses'>('cash');
  const [cash, setCash] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [openCash, setOpenCash] = useState(false);
  const [closeCash, setCloseCash] = useState(false);
  const [newPayment, setNewPayment] = useState(false);
  const [newExpense, setNewExpense] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, p, e] = await Promise.all([api.cashCurrent(), api.payments({ limit: 100 }), api.expenses()]);
      setCash(c);
      setPayments(p as any[]);
      setExpenses(e as any[]);
    } catch (err: any) {
      toast(err.message, 'bad');
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const session = cash?.session;
  const summary = cash?.summary;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--edge)' }}>
          {([['cash', 'صندوق روز'], ['payments', 'دریافت‌ها'], ['expenses', 'هزینه‌ها']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className="px-3 py-1.5 text-[12.5px]" aria-pressed={tab === k}
              style={{ background: tab === k ? 'var(--brand)' : 'transparent', color: tab === k ? 'var(--brand-ink)' : 'var(--ink)', fontWeight: tab === k ? 700 : 500 }}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {tab === 'payments' ? <Button onClick={() => setNewPayment(true)} icon={<Plus size={15} />}>دریافت جدید</Button> : null}
        {tab === 'expenses' ? <Button onClick={() => setNewExpense(true)} icon={<Plus size={15} />}>هزینه جدید</Button> : null}
      </div>

      {tab === 'cash' ? (
        session ? (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-bold text-[14px] flex items-center gap-1.5"><Unlock size={15} style={{ color: 'var(--ok)' }} /> صندوق باز</h2>
                <Badge tone="ok">باز</Badge>
              </div>
              <Row label="شروع" value={formatJalali(session.opened_at, { withTime: true })} />
              <Row label="موجودی اولیه" value={`${formatMoney(session.opening_float_irr)} ریال`} />
              <Row label="دریافت نقدی" value={`${formatMoney(summary?.inflow)} ریال`} />
              <Row label="فروش نقدی بوفه" value={`${formatMoney(summary?.salesCash)} ریال`} />
              <Row label="هزینه‌های نقدی" value={`${formatMoney(summary?.outflow)} ریال`} />
              <Row label="موجودی مورد انتظار" value={<span style={{ color: 'var(--brand)' }}>{formatMoney(summary?.expected)} ریال</span>} />
              <div className="mt-3 flex gap-2">
                <Button onClick={() => setCloseCash(true)} icon={<Lock size={14} />}>بستن صندوق (F8)</Button>
              </div>
            </div>
            <div className="card p-4">
              <h2 className="font-bold text-[14px] mb-2">راهنمای بستن صندوق</h2>
              <p className="text-[12.5px] leading-7" style={{ color: 'var(--muted)' }}>
                موجودی کشیده‌شده را بشمارید و وارد کنید. اختلاف (کم یا کسری) به‌صورت خودکار محاسبه و در تاریخچهٔ صندوق ثبت می‌شود.
                بعد از بستن، صندوق جدید تا زمان باز کردن مجدد قفل است.
              </p>
            </div>
          </div>
        ) : (
          <div className="card p-6 text-center">
            <CircleDollarSign size={28} style={{ color: 'var(--muted)', margin: '0 auto 8px' }} />
            <p className="font-semibold">صندوق امروز باز نشده است</p>
            <p className="text-[12.5px] my-2" style={{ color: 'var(--muted)' }}>برای ثبت دریافت نقدی و بستن روز، صندوق را باز کنید.</p>
            <Button onClick={() => setOpenCash(true)} className="mx-auto">باز کردن صندوق</Button>
          </div>
        )
      ) : null}

      {tab === 'payments' ? (
        <Table head={['تاریخ', 'عضو', 'مبلغ (ریال)', 'روش', 'رسید', 'ثبت‌کننده', '']} empty={payments.length === 0}>
          {payments.map((p) => (
            <tr key={p.id}>
              <td className="td">{formatJalali(p.paid_at)}</td>
              <td className="td">{p.memberName}</td>
              <td className="td tabular-nums font-semibold">{formatMoney(p.amount_irr)}</td>
              <td className="td">{METHOD[p.method] ?? p.method}</td>
              <td className="td tabular-nums">{toPersianDigits(p.receipt_no)}</td>
              <td className="td">{p.userName ?? '—'}</td>
              <td className="td">
                {p.status === 'posted' ? (
                  <Button variant="ghost" onClick={async () => {
                    try {
                      await api.voidPayment({ id: p.id, reason: 'ابطال توسط مدیر' });
                      toast('پرداخت باطل شد (سابقه حفظ شد)');
                      load();
                    } catch (e: any) { toast(e.message, 'bad'); }
                  }}>ابطال</Button>
                ) : <Badge tone="bad">باطل</Badge>}
              </td>
            </tr>
          ))}
        </Table>
      ) : null}

      {tab === 'expenses' ? (
        <Table head={['تاریخ', 'دسته', 'مبلغ (ریال)', 'روش', 'دریافت‌کننده']} empty={expenses.length === 0}>
          {expenses.map((e) => (
            <tr key={e.id}>
              <td className="td">{formatJalali(e.paid_at)}</td>
              <td className="td">{e.category}</td>
              <td className="td tabular-nums">{formatMoney(e.amount_irr)}</td>
              <td className="td">{METHOD[e.method] ?? e.method}</td>
              <td className="td">{e.payee ?? '—'}</td>
            </tr>
          ))}
        </Table>
      ) : null}

      <OpenCashModal open={openCash} onClose={() => setOpenCash(false)} onSaved={() => { setOpenCash(false); load(); }} />
      <CloseCashModal open={closeCash} expected={summary?.expected ?? 0} sessionId={session?.id} onClose={() => setCloseCash(false)} onSaved={() => { setCloseCash(false); load(); }} />
      <PaymentModal open={newPayment} onClose={() => setNewPayment(false)} onSaved={() => { setNewPayment(false); load(); }} />
      <ExpenseModal open={newExpense} onClose={() => setNewExpense(false)} onSaved={() => { setNewExpense(false); load(); }} />
    </div>
  );
}

function OpenCashModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useStore((s) => s.toast);
  const [amount, setAmount] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="باز کردن صندوق" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button>
      <Button onClick={async () => {
        try {
          await api.cashOpen(tomanToRial(amount));
          toast('صندوق باز شد');
          onSaved();
        } catch (e: any) { toast(e.message, 'bad'); }
      }}>باز کردن</Button></>}>
      <Field label="موجودی اولیه (تومان)" hint="پول خرد ابتدای روز">
        <MoneyInput value={amount} onChange={setAmount} />
      </Field>
    </Modal>
  );
}

function CloseCashModal({ open, expected, sessionId, onClose, onSaved }: { open: boolean; expected: number; sessionId?: string; onClose: () => void; onSaved: () => void }) {
  const toast = useStore((s) => s.toast);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="بستن صندوق" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button>
      <Button onClick={async () => {
        try {
          if (!sessionId) throw new Error('صندوقی باز نیست');
          const res: any = await api.cashClose(sessionId, tomanToRial(counted), note);
          toast(`صندوق بسته شد — اختلاف: ${formatMoney(res.difference)} ریال`);
          onSaved();
        } catch (e: any) { toast(e.message, 'bad'); }
      }}>بستن صندوق</Button></>}>
      <Row label="موجودی مورد انتظار" value={`${formatMoney(expected)} ریال`} />
      <Field label="موجودی شمارش‌شده (تومان)" required>
        <MoneyInput value={counted} onChange={setCounted} />
      </Field>
      <Field label="توضیح"><TextInput value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}

function PaymentModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useStore((s) => s.toast);
  const [memberQ, setMemberQ] = useState('');
  const [members, setMembers] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [date, setDate] = useState(todayJalali());
  const [reference, setReference] = useState('');

  useEffect(() => {
    if (!open) return;
    api.members({ q: memberQ, limit: 8 }).then((r) => setMembers(r as any[])).catch(() => setMembers([]));
  }, [memberQ, open]);

  return (
    <Modal open={open} onClose={onClose} title="ثبت دریافت" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button>
      <Button onClick={async () => {
        try {
          if (!selected) throw new Error('عضو را انتخاب کنید');
          const iso = parseJalaliInput(date);
          if (!iso) throw new Error('تاریخ معتبر نیست');
          await api.createPayment({ memberId: selected.id, amountIrr: tomanToRial(amount), method, paidAt: iso, reference: reference || null });
          toast('دریافت ثبت شد');
          onSaved();
        } catch (e: any) { toast(e.message, 'bad'); }
      }}>ثبت</Button></>}>
      <Field label="عضو" required>
        <TextInput value={selected ? selected.full_name : memberQ} onChange={(e) => { setSelected(null); setMemberQ(e.target.value); }} placeholder="نام یا موبایل" />
      </Field>
      {!selected && memberQ.length >= 2 ? (
        <div className="card mb-3 max-h-36 overflow-y-auto">
          {members.map((m) => (
            <button key={m.id} className="w-full text-right px-3 py-1.5 text-[12.5px] hover:bg-black/5" onClick={() => setSelected(m)}>{m.full_name}</button>
          ))}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="مبلغ (تومان)" required><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="روش" required>
          <Select value={method} onChange={setMethod} ariaLabel="روش پرداخت" options={Object.entries(METHOD).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="تاریخ (شمسی)" required><TextInput value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" style={{ textAlign: 'right' }} /></Field>
        <Field label="شماره پیگیری"><TextInput value={reference} onChange={(e) => setReference(e.target.value)} dir="ltr" style={{ textAlign: 'right' }} /></Field>
      </div>
    </Modal>
  );
}

function ExpenseModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useStore((s) => s.toast);
  const [category, setCategory] = useState('اجاره');
  const [amount, setAmount] = useState('');
  const [payee, setPayee] = useState('');
  const [method, setMethod] = useState('cash');
  const [date, setDate] = useState(todayJalali());

  return (
    <Modal open={open} onClose={onClose} title="ثبت هزینه" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button>
      <Button onClick={async () => {
        try {
          const iso = parseJalaliInput(date);
          if (!iso) throw new Error('تاریخ معتبر نیست');
          await api.createExpense({ category, amountIrr: tomanToRial(amount), paidAt: iso, method, payee: payee || null });
          toast('هزینه ثبت شد');
          onSaved();
        } catch (e: any) { toast(e.message, 'bad'); }
      }}>ثبت هزینه</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="دسته" required>
          <Select value={category} onChange={setCategory} ariaLabel="دسته هزینه" options={['اجاره', 'حقوق', 'آب و برق', 'تعمیرات', 'خرید تجهیزات', 'تبلیغات', 'سایر'].map((v) => ({ value: v, label: v }))} />
        </Field>
        <Field label="مبلغ (تومان)" required><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="تاریخ (شمسی)" required><TextInput value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" style={{ textAlign: 'right' }} /></Field>
        <Field label="روش"><Select value={method} onChange={setMethod} ariaLabel="روش پرداخت" options={Object.entries(METHOD).map(([value, label]) => ({ value, label }))} /></Field>
      </div>
      <Field label="دریافت‌کننده"><TextInput value={payee} onChange={(e) => setPayee(e.target.value)} /></Field>
    </Modal>
  );
}
