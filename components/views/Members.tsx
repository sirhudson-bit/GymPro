'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Printer, CreditCard, UserRound, QrCode, Wallet, Pencil, Archive, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Badge, Button, Confirm, DateInput, Empty, Field, Modal, MoneyInput, SearchBox, Select, Table, TextArea, TextInput, Row, tomanToRial } from '@/components/ui';
import { daysLeftLabel, formatJalali, formatMoney, toPersianDigits, todayJalali, parseJalaliInput } from '@/lib/format';

export default function Members() {
  const toast = useStore((s) => s.toast);
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const [card, setCard] = useState<any>(null);
  const [topup, setTopup] = useState<{ member: any; amount: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.members({ q, status, limit: 100 });
      setRows(res as any[]);
    } catch (e: any) {
      toast(e.message, 'bad');
    } finally {
      setLoading(false);
    }
  }, [q, status, toast]);

  useEffect(() => {
    const t = setTimeout(load, 180);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    const handler = () => setCreating(true);
    window.addEventListener('gp:new-member', handler);
    return () => window.removeEventListener('gp:new-member', handler);
  }, []);

  async function openDetail(id: string) {
    try {
      const data: any = await api.member(id);
      const [wallet, loyalty] = await Promise.all([api.walletBalance(id), api.loyalty(id)]);
      setDetail({ ...data, walletBalance: (wallet as any).balance, points: (loyalty as any).points });
    } catch (e: any) {
      toast(e.message, 'bad');
    }
  }

  async function issueCard(memberId: string) {
    try {
      const res: any = await api.issueCard(memberId);
      const qr = await api.qr(res.token);
      setCard({ ...res, qr: qr.dataUrl });
    } catch (e: any) {
      toast(e.message, 'bad');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="نام، موبایل یا شمارهٔ عضویت" />
        <label className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--muted)' }}>
          وضعیت
          <select className="field" style={{ width: 110 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="فیلتر وضعیت عضویت">
            <option value="all">همه</option>
            <option value="active">فعال</option>
            <option value="archived">بایگانی</option>
            <option value="blocked">مسدود</option>
          </select>
        </label>
        <div className="flex-1" />
        <Button variant="ghost" onClick={load} icon={<RefreshCw size={14} />}>بازخوانی</Button>
        <Button onClick={() => setCreating(true)} icon={<Plus size={15} />}>عضو جدید (F2)</Button>
      </div>

      <div className="flex flex-wrap gap-2 text-[12px]" style={{ color: 'var(--muted)' }}>
        <span className="chip">کل: {toPersianDigits(rows.length)}</span>
        <span className="chip" style={{ color: 'var(--ok)', borderColor: 'color-mix(in srgb, var(--ok) 40%, transparent)' }}>
          فعال: {toPersianDigits(rows.filter((m) => m.status === 'active').length)}
        </span>
        <span className="chip" style={{ color: 'var(--warn)', borderColor: 'color-mix(in srgb, var(--warn) 40%, transparent)' }} title="قراردادهایی که تا ۷ روز آینده تمام می‌شوند">
          انقضای ۷ روز آینده: {toPersianDigits(rows.filter((m) => m.activeEndDate && daysLeftLabel(m.activeEndDate).tone !== 'ok').length)}
        </span>
      </div>

      <Table head={['شماره', 'نام', 'موبایل', 'پایان قرارداد', 'روز باقی‌مانده', 'کیف پول', 'وضعیت', 'عملیات']} empty={!loading && rows.length === 0}>
        {rows.map((m) => {
          const d = daysLeftLabel(m.activeEndDate);
          return (
            <tr key={m.id} className="hover:bg-black/[0.02]">
              <td className="td tabular-nums" style={{ color: 'var(--muted)' }}>{toPersianDigits(m.member_no)}</td>
              <td className="td font-semibold">{m.full_name}</td>
              <td className="td tabular-nums" dir="ltr" style={{ textAlign: 'right' }}>{toPersianDigits(m.mobile)}</td>
              <td className="td">{m.activeEndDate ? formatJalali(m.activeEndDate) : '—'}</td>
              <td className="td"><Badge tone={d.tone === 'ok' ? 'ok' : d.tone === 'warn' ? 'warn' : 'bad'}>{d.text}</Badge></td>
              <td className="td tabular-nums">{formatMoney(m.wallet)}</td>
              <td className="td">{m.status === 'active' ? <Badge tone="ok">فعال</Badge> : m.status === 'archived' ? <Badge>بایگانی</Badge> : <Badge tone="bad">مسدود</Badge>}</td>
              <td className="td">
                <div className="flex gap-1">
                  <button onClick={() => openDetail(m.id)} className="btn btn-ghost" style={{ borderColor: 'transparent', color: 'var(--brand)' }}>
                    <UserRound size={13} /> پروفایل
                  </button>
                  <button onClick={() => issueCard(m.id)} className="btn btn-ghost" style={{ borderColor: 'var(--edge-strong)' }} aria-label={`صدور کارت برای ${m.full_name}`}>
                    <QrCode size={13} /> کارت
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </Table>
      {loading ? <p className="text-[12px]" style={{ color: 'var(--muted)' }}>در حال بارگذاری…</p> : (
        <p className="text-[11.5px]" style={{ color: 'var(--muted)' }} aria-live="polite">
          نمایش {toPersianDigits(rows.length)} عضو{rows.length === 100 ? ' (۱۰۰ مورد آخر)' : ''}
        </p>
      )}

      <MemberForm
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          load();
        }}
      />

      {editing ? <MemberEdit member={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); openDetail(editing.id); }} /> : null}

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.member?.full_name ?? 'پروفایل عضو'} wide>
        {detail ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setEditing(detail.member)} icon={<Pencil size={14} />}>ویرایش</Button>
              <Button variant="ghost" onClick={() => issueCard(detail.member.id)} icon={<CreditCard size={14} />}>صدور کارت QR</Button>
              <Button variant="ghost" onClick={() => setTopup({ member: detail.member, amount: '' })} icon={<Wallet size={14} />}>شارژ کیف پول</Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  try {
                    await api.archiveMember(detail.member.id);
                    toast('عضو بایگانی شد (قابل بازیابی)');
                    setDetail(null);
                    load();
                  } catch (e: any) {
                    toast(e.message, 'bad');
                  }
                }}
                icon={<Archive size={14} />}
              >
                بایگانی
              </Button>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="card p-3">
                <h3 className="font-bold text-[13px] mb-2">مشخصات</h3>
                <Row label="شمارهٔ عضویت" value={toPersianDigits(detail.member.member_no)} />
                <Row label="موبایل" value={<span dir="ltr">{toPersianDigits(detail.member.mobile)}</span>} />
                <Row label="تاریخ عضویت" value={formatJalali(detail.member.joined_at)} />
                <Row label="کیف پول" value={`${formatMoney(detail.walletBalance)} ریال`} />
                <Row label="امتیاز باشگاه" value={toPersianDigits(detail.points)} />
                <Row label="رضایت ثبت داده" value={detail.member.consent_at ? formatJalali(detail.member.consent_at) : 'ثبت نشده'} />
              </div>
              <div className="card p-3">
                <h3 className="font-bold text-[13px] mb-2">آخرین آنالیز بدنی</h3>
                {detail.measurements?.length ? (
                  <>
                    <Row label="وزن" value={`${toPersianDigits(detail.measurements[0].weight_kg ?? '—')} کیلوگرم`} />
                    <Row label="قد" value={`${toPersianDigits(detail.measurements[0].height_cm ?? '—')} سانتی‌متر`} />
                    <Row label="درصد چربی" value={`${toPersianDigits(detail.measurements[0].body_fat_pct ?? '—')}٪`} />
                    <Row label="تاریخ" value={formatJalali(detail.measurements[0].measured_at)} />
                  </>
                ) : (
                  <Empty title="آنالیزی ثبت نشده" hint="از پروفایل عضو، آنالیز جدید اضافه کنید." />
                )}
              </div>
            </div>

            <div>
              <h3 className="font-bold text-[13px] mb-2">قراردادها</h3>
              <Table head={['تعرفه', 'شروع', 'پایان', 'جلسات', 'وضعیت']} empty={!detail.contracts?.length}>
                {detail.contracts?.map((c: any) => (
                  <tr key={c.id}>
                    <td className="td">{c.planName}</td>
                    <td className="td">{formatJalali(c.start_date)}</td>
                    <td className="td">{formatJalali(c.end_date)}</td>
                    <td className="td tabular-nums">{c.sessions_total ? `${toPersianDigits(c.sessions_used)}/${toPersianDigits(c.sessions_total)}` : '—'}</td>
                    <td className="td">
                      <Badge tone={c.status === 'active' ? 'ok' : c.status === 'expired' ? 'bad' : c.status === 'frozen' ? 'warn' : 'neutral'}>
                        {c.status === 'active' ? 'فعال' : c.status === 'expired' ? 'منقضی' : c.status === 'frozen' ? 'فریز' : 'لغو'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </Table>
            </div>

            <div>
              <h3 className="font-bold text-[13px] mb-2">آخرین پرداخت‌ها</h3>
              <Table head={['تاریخ', 'مبلغ (ریال)', 'روش', 'وضعیت']} empty={!detail.payments?.length}>
                {detail.payments?.map((p: any) => (
                  <tr key={p.id}>
                    <td className="td">{formatJalali(p.paid_at)}</td>
                    <td className="td tabular-nums">{formatMoney(p.amount_irr)}</td>
                    <td className="td">{p.method === 'cash' ? 'نقدی' : p.method === 'card_to_card' ? 'کارت به کارت' : p.method === 'cheque' ? 'چک' : p.method === 'installment' ? 'اقساط' : 'کیف پول'}</td>
                    <td className="td">{p.status === 'posted' ? <Badge tone="ok">ثبت شده</Badge> : <Badge tone="bad">باطل</Badge>}</td>
                  </tr>
                ))}
              </Table>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={Boolean(card)} onClose={() => setCard(null)} title="کارت عضویت" footer={
        <>
          <Button variant="ghost" onClick={() => setCard(null)}>بستن</Button>
          <Button onClick={() => window.print()} icon={<Printer size={14} />}>چاپ</Button>
        </>
      }>
        {card ? (
          <div className="text-center print-card">
            <p className="text-[11px]" style={{ color: 'var(--muted)' }}>شمارهٔ عضویت</p>
            <p className="font-extrabold text-[26px] leading-tight mb-2" dir="ltr">{toPersianDigits(card.memberNo ?? '')}</p>
            <img src={card.qr} alt={`کد QR کارت ${card.memberName}`} width={232} height={232} className="mx-auto rounded-xl" style={{ background: '#fff', padding: 12 }} />
            <p className="font-bold mt-3">{card.memberName}</p>
            <p className="text-[10.5px] mt-1" style={{ color: 'var(--muted)' }}>
              شناسهٔ کارت: <span dir="ltr">{card.barcode}</span>
            </p>
            <div className="mt-3 p-3 rounded-xl text-right text-[11.5px] leading-6 no-print" style={{ background: 'var(--brand-wash)', border: '1px solid var(--brand-line)' }}>
              <p className="font-bold mb-1 text-[12px]">چطور این کارت را اسکن کنم؟</p>
              <p>۱) اسکنر دوبعدی (QR) را به USB بزنید؛ ویندوز خودش می‌شناسد.</p>
              <p>۲) در «تردد» (F4) کد را روی کارت بگیرید یا شمارهٔ عضویت بالا را تایپ و Enter بزنید.</p>
              <p style={{ color: 'var(--muted)' }}>اسکنر لیزری یک‌بعدی این کد را نمی‌خواند. راهنمای کامل: منوی «راهنما» → «اسکن بارکد و QR».</p>
            </div>
            <p className="text-[11px] mt-2 no-print" style={{ color: 'var(--muted)' }}>کارت یکتا و قابل ابطال است؛ اگر گم شد، کارت جدید صادر کنید تا این یکی باطل شود.</p>
          </div>
        ) : null}
      </Modal>

      <Modal open={Boolean(topup)} onClose={() => setTopup(null)} title="شارژ کیف پول" footer={
        <>
          <Button variant="ghost" onClick={() => setTopup(null)}>انصراف</Button>
          <Button
            onClick={async () => {
              if (!topup) return;
              try {
                const amount = tomanToRial(topup.amount);
                if (amount <= 0) throw new Error('مبلغ را وارد کنید');
                await api.walletTopup({ memberId: topup.member.id, amount, note: 'شارژ دستی' });
                toast('کیف پول شارژ شد');
                setTopup(null);
                if (detail) openDetail(detail.member.id);
                load();
              } catch (e: any) {
                toast(e.message, 'bad');
              }
            }}
          >
            ثبت شارژ
          </Button>
        </>
      }>
        {topup ? (
          <Field label="مبلغ شارژ" required>
            <MoneyInput value={topup.amount} onChange={(v) => setTopup({ ...topup, amount: v })} />
          </Field>
        ) : null}
      </Modal>
    </div>
  );
}

/* ───────────── create ───────────── */

function MemberForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useStore((s) => s.toast);
  const [form, setForm] = useState({ fullName: '', mobile: '', gender: '', notes: '', consent: true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ fullName: '', mobile: '', gender: '', notes: '', consent: true });
      setErrors({});
    }
  }, [open]);

  async function save() {
    const errs: Record<string, string> = {};
    if (form.fullName.trim().length < 3) errs.fullName = 'نام کامل را وارد کنید';
    if (!/^09\d{9}$/.test(form.mobile.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))))) errs.mobile = 'شمارهٔ موبایل باید ۱۱ رقم و با ۰۹ شروع شود';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await api.createMember({
        fullName: form.fullName.trim(),
        mobile: form.mobile.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))),
        gender: form.gender || null,
        notes: form.notes || null,
        consent: form.consent,
      });
      toast('عضو ثبت شد');
      onSaved();
    } catch (e: any) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="ثبت عضو جدید"
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button onClick={save} loading={busy}>ثبت عضو</Button></>}
    >
      <Field label="نام و نام خانوادگی" required error={errors.fullName}>
        <TextInput value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} autoFocus />
      </Field>
      <Field label="موبایل" required error={errors.mobile} hint="فقط همین دو فیلد برای شروع لازم است.">
        <TextInput value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value.replace(/[^\d۰-۹]/g, '') })} dir="ltr" style={{ textAlign: 'right' }} inputMode="tel" />
      </Field>
      <Field label="جنسیت">
        <Select value={form.gender} onChange={(v) => setForm({ ...form, gender: v })} ariaLabel="جنسیت" options={[{ value: '', label: 'ثبت نشده' }, { value: 'male', label: 'آقا' }, { value: 'female', label: 'خانم' }]} />
      </Field>
      <Field label="یادداشت">
        <TextArea value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} rows={2} />
      </Field>
      <label className="flex items-start gap-2 text-[12.5px]">
        <input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} className="mt-1" />
        <span style={{ color: 'var(--muted)' }}>
          عضو با ثبت اطلاعات تماس، ذخیرهٔ آن‌ها روی رایانهٔ باشگاه را پذیرفته است (مطابق سیاست حریم خصوصی).
        </span>
      </label>
    </Modal>
  );
}

/* ───────────── edit ───────────── */

function MemberEdit({ member, onClose, onSaved }: { member: any; onClose: () => void; onSaved: () => void }) {
  const toast = useStore((s) => s.toast);
  const [form, setForm] = useState({
    fullName: member.full_name ?? '',
    mobile: member.mobile ?? '',
    birthDate: member.birth_date ? formatJalali(member.birth_date) : '',
    nationalId: member.national_id ?? '',
    address: member.address ?? '',
    notes: member.notes ?? '',
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const iso = form.birthDate ? parseJalaliInput(form.birthDate) : null;
      await api.updateMember({
        id: member.id,
        version: member.version,
        fullName: form.fullName,
        mobile: form.mobile,
        birthDate: iso,
        nationalId: form.nationalId || '',
        address: form.address || null,
        notes: form.notes || null,
      });
      toast('تغییرات ذخیره شد');
      onSaved();
    } catch (e: any) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="ویرایش عضو" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button onClick={save} loading={busy}>ذخیره</Button></>}>
      <Field label="نام و نام خانوادگی" required><TextInput value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
      <Field label="موبایل" required><TextInput value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} dir="ltr" style={{ textAlign: 'right' }} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="تاریخ تولد" hint="شمسی"><TextInput value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} dir="ltr" style={{ textAlign: 'right' }} /></Field>
        <Field label="کد ملی" hint="۱۰ رقم"><TextInput value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value.replace(/\D/g, '').slice(0, 10) })} dir="ltr" style={{ textAlign: 'right' }} /></Field>
      </div>
      <Field label="نشانی"><TextInput value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
      <Field label="یادداشت"><TextArea value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} rows={2} /></Field>
    </Modal>
  );
}
