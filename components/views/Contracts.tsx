'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Snowflake, Search, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Badge, Button, DateInput, Empty, Field, Modal, MoneyInput, Row, SearchBox, Select, Table, TextArea, TextInput, tomanToRial } from '@/components/ui';
import { daysLeftLabel, formatJalali, formatMoney, parseJalaliInput, toPersianDigits, todayJalali } from '@/lib/format';

const KIND: Record<string, string> = { time: 'زمانی', session: 'جلسه‌ای', hybrid: 'ترکیبی', vip: 'خصوصی', guest: 'مهمان' };

export default function Contracts() {
  const toast = useStore((s) => s.toast);
  const [tab, setTab] = useState<'contracts' | 'plans'>('contracts');
  const [rows, setRows] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [planModal, setPlanModal] = useState<any | null>(null);
  const [renew, setRenew] = useState<any | null>(null);
  const [freeze, setFreeze] = useState<any | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([api.contracts({ q, limit: 200 }), api.plans(true)]);
      setRows(c as any[]);
      setPlans(p as any[]);
    } catch (e: any) {
      toast(e.message, 'bad');
    }
  }, [q, toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--edge)' }}>
          {(['contracts', 'plans'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-3 py-1.5 text-[12.5px]"
              style={{ background: tab === t ? 'var(--brand)' : 'transparent', color: tab === t ? 'var(--brand-ink)' : 'var(--ink)', fontWeight: tab === t ? 700 : 500 }}
              aria-pressed={tab === t}
            >
              {t === 'contracts' ? 'قراردادها' : 'تعرفه‌ها'}
            </button>
          ))}
        </div>
        {tab === 'contracts' ? <SearchBox value={q} onChange={setQ} placeholder="نام یا موبایل عضو" /> : null}
        <div className="flex-1" />
        <Button variant="ghost" onClick={load} icon={<RefreshCw size={14} />}>بازخوانی</Button>
        {tab === 'contracts' ? (
          <Button onClick={() => setCreating(true)} icon={<Plus size={15} />}>قرارداد جدید</Button>
        ) : (
          <Button onClick={() => setPlanModal({ name: '', kind: 'time', durationDays: '30', sessionCount: '', price: '', isActive: true })} icon={<Plus size={15} />}>تعرفه جدید</Button>
        )}
      </div>

      {tab === 'contracts' ? (
        <Table head={['عضو', 'تعرفه', 'شروع', 'پایان', 'جلسات', 'وضعیت', '']} empty={rows.length === 0}>
          {rows.map((c) => {
            const d = daysLeftLabel(c.end_date);
            return (
              <tr key={c.id}>
                <td className="td">
                  <p className="font-semibold">{c.memberName}</p>
                  <p className="text-[11px] tabular-nums" dir="ltr" style={{ color: 'var(--muted)', textAlign: 'right' }}>{toPersianDigits(c.memberMobile ?? '')}</p>
                </td>
                <td className="td">{c.planName}</td>
                <td className="td">{formatJalali(c.start_date)}</td>
                <td className="td">{formatJalali(c.end_date)}</td>
                <td className="td tabular-nums">{c.sessions_total ? `${toPersianDigits(c.sessions_used)}/${toPersianDigits(c.sessions_total)}` : '—'}</td>
                <td className="td">
                  <div className="flex items-center gap-1">
                    {c.status === 'active' ? <Badge tone="ok">فعال</Badge> : c.status === 'expired' ? <Badge tone="bad">منقضی</Badge> : c.status === 'frozen' ? <Badge tone="warn">فریز</Badge> : <Badge>لغو</Badge>}
                    {c.status === 'active' ? <span className="text-[11px]" style={{ color: 'var(--muted)' }}>{d.text}</span> : null}
                  </div>
                </td>
                <td className="td">
                  <div className="flex gap-1">
                    <Button variant="ghost" onClick={() => setRenew(c)} icon={<RefreshCw size={13} />}>تمدید</Button>
                    <Button variant="ghost" onClick={() => setFreeze(c)} icon={<Snowflake size={13} />}>فریز</Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      ) : (
        <Table head={['نام تعرفه', 'نوع', 'مدت', 'جلسات', 'قیمت (ریال)', 'وضعیت', '']} empty={plans.length === 0}>
          {plans.map((p) => (
            <tr key={p.id}>
              <td className="td font-semibold">{p.name}</td>
              <td className="td">{KIND[p.kind] ?? p.kind}</td>
              <td className="td">{p.duration_days ? `${toPersianDigits(p.duration_days)} روز` : '—'}</td>
              <td className="td">{p.session_count ? toPersianDigits(p.session_count) : '—'}</td>
              <td className="td tabular-nums">{formatMoney(p.price_irr)}</td>
              <td className="td">{p.is_active ? <Badge tone="ok">فعال</Badge> : <Badge>غیرفعال</Badge>}</td>
              <td className="td">
                <Button variant="ghost" onClick={() => setPlanModal({ ...p, price: String(Math.round(p.price_irr / 10)), durationDays: String(p.duration_days ?? ''), sessionCount: String(p.session_count ?? '') })}>ویرایش</Button>
              </td>
            </tr>
          ))}
        </Table>
      )}

      <NewContract open={creating} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} plans={plans} />

      <PlanModal plan={planModal} onClose={() => setPlanModal(null)} onSaved={() => { setPlanModal(null); load(); }} />

      <Modal open={Boolean(renew)} onClose={() => setRenew(null)} title="تمدید قرارداد" footer={
        <>
          <Button variant="ghost" onClick={() => setRenew(null)}>انصراف</Button>
          <Button
            onClick={async () => {
              if (!renew) return;
              try {
                const planId = (document.getElementById('renew-plan') as HTMLSelectElement)?.value;
                const amount = tomanToRial((document.getElementById('renew-amount') as HTMLInputElement)?.value ?? '0');
                await api.renewContract({ contractId: renew.id, planId, payment: amount > 0 ? { amountIrr: amount, method: 'cash' } : null });
                toast('قرارداد تمدید شد (از انتهای اعتبار فعلی)');
                setRenew(null);
                load();
              } catch (e: any) {
                toast(e.message, 'bad');
              }
            }}
          >
            تمدید
          </Button>
        </>
      }>
        {renew ? (
          <>
            <Row label="عضو" value={renew.memberName} />
            <Row label="پایان فعلی" value={formatJalali(renew.end_date)} />
            <p className="text-[11.5px] my-2" style={{ color: 'var(--muted)' }}>تمدید از روز بعدِ پایان فعلی محاسبه می‌شود، نه از امروز.</p>
            <Field label="تعرفه تمدید" required>
              <select id="renew-plan" className="field" defaultValue={renew.plan_id} aria-label="تعرفه تمدید">
                {plans.filter((p) => p.is_active).map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {formatMoney(p.price_irr)} ریال</option>
                ))}
              </select>
            </Field>
            <Field label="مبلغ دریافتی (تومان)" hint="صفر = بدون ثبت پرداخت">
              <input id="renew-amount" className="field" defaultValue="" placeholder="۰" inputMode="numeric" aria-label="مبلغ دریافتی" />
            </Field>
          </>
        ) : null}
      </Modal>

      <FreezeModal contract={freeze} onClose={() => setFreeze(null)} onSaved={() => { setFreeze(null); load(); }} />
    </div>
  );
}

function NewContract({ open, onClose, onSaved, plans }: { open: boolean; onClose: () => void; onSaved: () => void; plans: any[] }) {
  const toast = useStore((s) => s.toast);
  const [memberQ, setMemberQ] = useState('');
  const [members, setMembers] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [planId, setPlanId] = useState('');
  const [start, setStart] = useState(todayJalali());
  const [discount, setDiscount] = useState('');
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.members({ q: memberQ, limit: 8 }).then((r) => setMembers(r as any[])).catch(() => setMembers([]));
  }, [memberQ, open]);

  useEffect(() => {
    if (open && plans.length && !planId) setPlanId(plans[0].id);
  }, [open, plans, planId]);

  const plan = plans.find((p) => p.id === planId);

  async function save() {
    if (!selected) {
      toast('عضو را انتخاب کنید', 'bad');
      return;
    }
    const iso = parseJalaliInput(start);
    if (!iso) {
      toast('تاریخ شروع معتبر نیست', 'bad');
      return;
    }
    setBusy(true);
    try {
      const payable = amount ? tomanToRial(amount) : 0;
      await api.createContract({
        memberId: selected.id,
        planId,
        startDate: iso,
        discountIrr: discount ? tomanToRial(discount) : 0,
        discountReason: reason || null,
        payment: payable > 0 ? { amountIrr: payable, method } : null,
      });
      toast('قرارداد صادر شد');
      setSelected(null);
      setMemberQ('');
      setDiscount('');
      setAmount('');
      onSaved();
    } catch (e: any) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="قرارداد جدید" wide footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button onClick={save} loading={busy}>صدور قرارداد</Button></>}>
      <Field label="عضو" required>
        <div className="relative">
          <TextInput value={selected ? selected.full_name : memberQ} onChange={(e) => { setSelected(null); setMemberQ(e.target.value); }} placeholder="نام یا موبایل را بنویسید" />
        </div>
      </Field>
      {!selected && memberQ.length >= 2 ? (
        <div className="card mb-3 max-h-40 overflow-y-auto">
          {members.map((m) => (
            <button key={m.id} className="w-full text-right px-3 py-1.5 text-[12.5px] hover:bg-black/5 flex justify-between" onClick={() => { setSelected(m); setMemberQ(''); }}>
              <span>{m.full_name}</span>
              <span dir="ltr" style={{ color: 'var(--muted)' }}>{toPersianDigits(m.mobile)}</span>
            </button>
          ))}
          {members.length === 0 ? <Empty title="عضوی پیدا نشد" hint="ابتدا از بخش اعضا ثبت کنید." /> : null}
        </div>
      ) : null}

      <div className="grid md:grid-cols-2 gap-3">
        <Field label="تعرفه" required>
          <select className="field" value={planId} onChange={(e) => setPlanId(e.target.value)} aria-label="تعرفه">
            {plans.filter((p) => p.is_active).map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {formatMoney(p.price_irr)} ریال</option>
            ))}
          </select>
        </Field>
        <Field label="تاریخ شروع (شمسی)" required>
          <TextInput value={start} onChange={(e) => setStart(e.target.value)} dir="ltr" style={{ textAlign: 'right' }} />
        </Field>
        <Field label="تخفیف (تومان)">
          <MoneyInput value={discount} onChange={setDiscount} />
        </Field>
        <Field label="دلیل تخفیف" hint="برای گزارش تخفیف‌ها ثبت می‌شود">
          <TextInput value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label="مبلغ دریافتی (تومان)">
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <Field label="روش پرداخت">
          <Select value={method} onChange={setMethod} ariaLabel="روش پرداخت" options={[
            { value: 'cash', label: 'نقدی' },
            { value: 'card_to_card', label: 'کارت به کارت' },
            { value: 'cheque', label: 'چک' },
            { value: 'installment', label: 'اقساط' },
            { value: 'wallet', label: 'کیف پول' },
          ]} />
        </Field>
      </div>

      {plan ? (
        <div className="card p-3 mt-2 text-[12.5px]">
          <Row label="مبلغ تعرفه" value={`${formatMoney(plan.price_irr)} ریال`} />
          <Row label="مدت" value={plan.duration_days ? `${toPersianDigits(plan.duration_days)} روز` : '—'} />
          <Row label="جلسات" value={plan.session_count ? toPersianDigits(plan.session_count) : 'نامحدود'} />
        </div>
      ) : null}
    </Modal>
  );
}

function PlanModal({ plan, onClose, onSaved }: { plan: any; onClose: () => void; onSaved: () => void }) {
  const toast = useStore((s) => s.toast);
  const [form, setForm] = useState<any>(plan);
  useEffect(() => setForm(plan), [plan]);
  if (!plan || !form) return null;

  return (
    <Modal open onClose={onClose} title={plan.id ? 'ویرایش تعرفه' : 'تعرفه جدید'} footer={
      <>
        <Button variant="ghost" onClick={onClose}>انصراف</Button>
        <Button
          onClick={async () => {
            try {
              const payload = {
                id: plan.id,
                name: form.name,
                kind: form.kind,
                durationDays: Number(form.durationDays) || null,
                sessionCount: Number(form.sessionCount) || null,
                priceIrr: tomanToRial(form.price),
                vatRateBp: 0,
                isActive: form.isActive !== false,
              };
              if (plan.id) await api.updatePlan(payload);
              else await api.createPlan(payload);
              toast('تعرفه ذخیره شد');
              onSaved();
            } catch (e: any) {
              toast(e.message, 'bad');
            }
          }}
        >
          ذخیره
        </Button>
      </>
    }>
      <Field label="نام تعرفه" required><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="نوع" required>
          <Select value={form.kind} onChange={(v) => setForm({ ...form, kind: v })} ariaLabel="نوع تعرفه" options={Object.entries(KIND).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="قیمت (تومان)" required><MoneyInput value={form.price} onChange={(v) => setForm({ ...form, price: v })} /></Field>
        <Field label="مدت (روز)"><TextInput value={form.durationDays} onChange={(e) => setForm({ ...form, durationDays: e.target.value.replace(/\D/g, '') })} dir="ltr" style={{ textAlign: 'right' }} /></Field>
        <Field label="تعداد جلسات"><TextInput value={form.sessionCount} onChange={(e) => setForm({ ...form, sessionCount: e.target.value.replace(/\D/g, '') })} dir="ltr" style={{ textAlign: 'right' }} /></Field>
      </div>
    </Modal>
  );
}

function FreezeModal({ contract, onClose, onSaved }: { contract: any; onClose: () => void; onSaved: () => void }) {
  const toast = useStore((s) => s.toast);
  const [days, setDays] = useState('7');
  const [reason, setReason] = useState('');
  if (!contract) return null;

  return (
    <Modal open onClose={onClose} title="فریز عضویت" footer={
      <>
        <Button variant="ghost" onClick={onClose}>انصراف</Button>
        <Button
          onClick={async () => {
            try {
              const res: any = await api.freezeContract({ contractId: contract.id, startDate: new Date().toISOString().slice(0, 10), days: Number(days), reason });
              toast(`فریز ثبت شد؛ پایان جدید: ${formatJalali(res.endDate)} — ${toPersianDigits(res.daysLeft)} روز از سقف باقی است`);
              onSaved();
            } catch (e: any) {
              toast(e.message, 'bad');
            }
          }}
        >
          ثبت فریز
        </Button>
      </>
    }>
      <Row label="عضو" value={contract.memberName} />
      <Row label="پایان فعلی" value={formatJalali(contract.end_date)} />
      <Field label="تعداد روز فریز" required hint="سقف پیش‌فرض ۳۰ روز است (در تنظیمات قابل تغییر)">
        <TextInput value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} dir="ltr" style={{ textAlign: 'right' }} />
      </Field>
      <Field label="دلیل فریز" required>
        <TextArea value={reason} onChange={setReason} rows={2} />
      </Field>
    </Modal>
  );
}
