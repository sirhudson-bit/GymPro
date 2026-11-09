'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeySquare, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Badge, Button, Confirm, Field, Modal, MoneyInput, Table, TextInput, tomanToRial } from '@/components/ui';
import { formatJalali, formatMoney, toPersianDigits, todayJalali, parseJalaliInput } from '@/lib/format';

export default function Lockers() {
  const toast = useStore((s) => s.toast);
  const [rows, setRows] = useState<any[]>([]);
  const [newLocker, setNewLocker] = useState(false);
  const [rent, setRent] = useState<any | null>(null);
  const [edit, setEdit] = useState<{ id: string; code: string; price: string; status: string } | null>(null);
  const [drop, setDrop] = useState<any | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await api.lockers()) as any[]);
    } catch (e: any) {
      toast(e.message, 'bad');
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="font-bold text-[14px]">مدیریت کمدها</h2>
        <div className="flex-1" />
        <Button onClick={() => setNewLocker(true)} icon={<Plus size={15} />}>کمد جدید</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
        {rows.map((l) => (
          <div key={l.id} className="card p-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[14px] flex items-center gap-1"><KeySquare size={14} /> {l.code}</span>
              <Badge tone={l.status === 'free' ? 'ok' : l.status === 'rented' ? 'warn' : 'bad'}>{l.status === 'free' ? 'آزاد' : l.status === 'rented' ? 'اجاره' : 'خراب'}</Badge>
            </div>
            <p className="text-[11px] mt-1" style={{ color: 'var(--muted)' }}>{formatMoney(l.monthly_price_irr)} ماهانه</p>
            {l.holderName ? (
              <>
                <p className="text-[12px] mt-1">{l.holderName}</p>
                <p className="text-[11px]" style={{ color: 'var(--muted)' }}>تا {formatJalali(l.rentalEnd)}</p>
                <Button variant="ghost" className="mt-2 w-full" onClick={async () => {
                  try {
                    await api.endLocker(l.rentalId);
                    toast('اجاره پایان یافت');
                    load();
                  } catch (e: any) { toast(e.message, 'bad'); }
                }}>پایان اجاره</Button>
              </>
            ) : (
              <Button variant="ghost" className="mt-2 w-full" onClick={() => setRent(l)} disabled={l.status !== 'free'}>اجاره</Button>
            )}
            <div className="flex gap-1 mt-2">
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => setEdit({ id: l.id, code: l.code, price: String(Math.round(Number(l.monthly_price_irr ?? 0) / 10)), status: l.status })}
                icon={<Pencil size={12} />}
                aria-label={`ویرایش کمد ${l.code}`}
              >
                ویرایش
              </Button>
              <Button variant="ghost" onClick={() => setDrop(l)} icon={<Trash2 size={12} />} aria-label={`حذف کمد ${l.code}`}>حذف</Button>
            </div>
          </div>
        ))}
      </div>

      {rows.length === 0 ? <p className="text-[13px]" style={{ color: 'var(--muted)' }}>کمدی ثبت نشده است. «کمد جدید» را بزنید.</p> : null}

      <Modal open={newLocker} onClose={() => setNewLocker(false)} title="کمد جدید" footer={<><Button variant="ghost" onClick={() => setNewLocker(false)}>انصراف</Button>
        <Button onClick={async () => {
          try {
            const code = (document.getElementById('lk-code') as HTMLInputElement).value;
            const price = (document.getElementById('lk-price') as HTMLInputElement).value;
            await api.createLocker({ code, price: tomanToRial(price) });
            toast('کمد ثبت شد');
            setNewLocker(false);
            load();
          } catch (e: any) { toast(e.message, 'bad'); }
        }}>ثبت</Button></>}>
        <Field label="شماره/کد کمد" required><TextInput id="lk-code" autoFocus aria-label="کد کمد" /></Field>
        <Field label="اجاره ماهانه (تومان)">
          <TextInput id="lk-price" placeholder="مثلاً 300000" dir="ltr" style={{ textAlign: 'right' }} aria-label="اجاره ماهانه" />
        </Field>
      </Modal>

      <Modal open={Boolean(rent)} onClose={() => setRent(null)} title={`اجاره کمد ${rent?.code ?? ''}`} footer={<><Button variant="ghost" onClick={() => setRent(null)}>انصراف</Button>
        <Button onClick={async () => {
          try {
            const memberId = (document.getElementById('lk-member') as HTMLSelectElement).value;
            const months = Number((document.getElementById('lk-months') as HTMLInputElement).value || 1);
            const start = parseJalaliInput((document.getElementById('lk-start') as HTMLInputElement).value) ?? new Date().toISOString().slice(0, 10);
            await api.rentLocker({ lockerId: rent.id, memberId, startDate: start, months });
            toast('کمد اجاره داده شد');
            setRent(null);
            load();
          } catch (e: any) { toast(e.message, 'bad'); }
        }}>ثبت اجاره</Button></>}>
        <MemberSelect />
        <div className="grid grid-cols-2 gap-3">
          <Field label="مدت (ماه)"><TextInput id="lk-months" defaultValue="1" dir="ltr" style={{ textAlign: 'right' }} aria-label="مدت ماه" /></Field>
          <Field label="شروع (شمسی)"><TextInput id="lk-start" defaultValue={todayJalali()} dir="ltr" style={{ textAlign: 'right' }} aria-label="تاریخ شروع" /></Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(edit)}
        onClose={() => setEdit(null)}
        title="ویرایش کمد"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>انصراف</Button>
            <Button
              onClick={async () => {
                if (!edit) return;
                try {
                  await api.updateLocker({ id: edit.id, code: edit.code, price: tomanToRial(edit.price), status: edit.status });
                  toast('کمد ویرایش شد');
                  setEdit(null);
                  load();
                } catch (e: any) {
                  toast(e.message, 'bad');
                }
              }}
            >
              ذخیره تغییرات
            </Button>
          </>
        }
      >
        {edit ? (
          <>
            <Field label="شماره/کد کمد" required>
              <TextInput value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} autoFocus />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="اجاره ماهانه (تومان)">
                <TextInput value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} dir="ltr" />
              </Field>
              <Field label="وضعیت" hint="کمد اجاره‌ای تا پایان اجاره قابل تغییر نیست">
                <select className="field" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })} aria-label="وضعیت کمد">
                  <option value="free">آزاد</option>
                  <option value="rented">اجاره</option>
                  <option value="broken">خراب</option>
                </select>
              </Field>
            </div>
          </>
        ) : null}
      </Modal>

      <Confirm
        open={Boolean(drop)}
        danger
        title="حذف کمد"
        message={`کمد «${drop?.code ?? ''}» حذف می‌شود. اگر در اجاره باشد، اول باید اجاره پایان یابد.`}
        confirmLabel="حذف کمد"
        onClose={() => setDrop(null)}
        onConfirm={async () => {
          const target = drop;
          setDrop(null);
          if (!target) return;
          try {
            await api.removeLocker(target.id);
            toast('کمد حذف شد');
            load();
          } catch (e: any) {
            toast(e.message, 'bad');
          }
        }}
      />
    </div>
  );
}

function MemberSelect() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    api.members({ limit: 200 }).then((r) => setRows(r as any[])).catch(() => setRows([]));
  }, []);
  return (
    <Field label="عضو" required>
      <select id="lk-member" className="field" aria-label="عضو">
        {rows.map((m) => <option key={m.id} value={m.id}>{m.full_name} — {toPersianDigits(m.mobile)}</option>)}
      </select>
    </Field>
  );
}
