'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeySquare, Pencil, Plus, Trash2, Unlock } from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Badge, Button, Confirm, Empty, Field, Modal, MoneyInput, Row, TextInput, tomanToRial } from '@/components/ui';
import { formatJalali, formatMoney, toPersianDigits, todayJalali, parseJalaliInput } from '@/lib/format';

const STATE_LABEL: Record<string, string> = { free: 'آزاد', rented: 'اجاره', broken: 'خراب' };
const STATE_TONE: Record<string, string> = { free: 'var(--ok)', rented: 'var(--warn)', broken: 'var(--bad)' };

export default function Lockers() {
  const toast = useStore((s) => s.toast);
  const [rows, setRows] = useState<any[]>([]);
  const [newLocker, setNewLocker] = useState(false);
  const [rent, setRent] = useState<any | null>(null);
  const [sheet, setSheet] = useState<any | null>(null);
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

  const counts = {
    free: rows.filter((l) => l.status === 'free').length,
    rented: rows.filter((l) => l.status === 'rented').length,
    broken: rows.filter((l) => l.status === 'broken').length,
  };

  async function endRent(rentalId: string) {
    try {
      await api.endLocker(rentalId);
      toast('اجاره پایان یافت');
      setSheet(null);
      load();
    } catch (e: any) {
      toast(e.message, 'bad');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold text-[14px]">مدیریت کمدها</h2>
        <div className="flex-1" />
        <Button onClick={() => setNewLocker(true)} icon={<Plus size={15} />}>کمد جدید</Button>
      </div>

      <div className="flex flex-wrap gap-2 text-[12px]">
        <span className="chip" style={{ color: 'var(--ok)', borderColor: 'color-mix(in srgb, var(--ok) 40%, transparent)' }}>آزاد: {toPersianDigits(counts.free)}</span>
        <span className="chip" style={{ color: 'var(--warn)', borderColor: 'color-mix(in srgb, var(--warn) 40%, transparent)' }}>در اجاره: {toPersianDigits(counts.rented)}</span>
        <span className="chip" style={{ color: 'var(--bad)', borderColor: 'color-mix(in srgb, var(--bad) 40%, transparent)' }}>خراب: {toPersianDigits(counts.broken)}</span>
        <span className="chip">کل: {toPersianDigits(rows.length)}</span>
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <Empty title="کمدی ثبت نشده است" hint="«کمد جدید» را بزنید و شمارهٔ کمدها را وارد کنید." />
        </div>
      ) : (
        <div className="card p-3">
          <div className="locker-grid">
            {rows.map((l) => {
              const state = l.status === 'free' ? 'free' : l.status === 'rented' ? 'rented' : 'broken';
              return (
                <button key={l.id} className={`locker-door ${state}`} onClick={() => setSheet(l)} aria-label={`کمد ${l.code} — ${STATE_LABEL[state]}${l.holderName ? ` — ${l.holderName}` : ''}`}>
                  <span className="locker-handle" aria-hidden="true" />
                  <span className="locker-state" style={{ color: STATE_TONE[state] }}>{STATE_LABEL[state]}</span>
                  <span className="locker-code">{l.code}</span>
                  {l.holderName ? <span className="locker-holder">{l.holderName}</span> : <span className="locker-holder">—</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* برگهٔ عملیات کمد انتخاب‌شده */}
      <Modal
        open={Boolean(sheet)}
        onClose={() => setSheet(null)}
        title={sheet ? `کمد ${sheet.code}` : 'کمد'}
        footer={
          sheet ? (
            <>
              <Button variant="ghost" onClick={() => setSheet(null)}>بستن</Button>
              {sheet.rentalId ? (
                <Button variant="ghost" onClick={() => endRent(sheet.rentalId)} icon={<Unlock size={14} />}>پایان اجاره</Button>
              ) : (
                <Button
                  variant="ghost"
                  icon={<KeySquare size={14} />}
                  disabled={sheet.status !== 'free'}
                  onClick={() => {
                    setRent(sheet);
                    setSheet(null);
                  }}
                >
                  اجاره
                </Button>
              )}
              <Button
                variant="ghost"
                icon={<Pencil size={14} />}
                onClick={() => {
                  setEdit({ id: sheet.id, code: sheet.code, price: String(Math.round(Number(sheet.monthly_price_irr ?? 0) / 10)), status: sheet.status });
                  setSheet(null);
                }}
              >
                ویرایش
              </Button>
              <Button variant="ghost" icon={<Trash2 size={14} />} onClick={() => { setDrop(sheet); setSheet(null); }}>
                حذف
              </Button>
            </>
          ) : null
        }
      >
        {sheet ? (
          <div className="space-y-1">
            <Row label="وضعیت" value={<Badge tone={sheet.status === 'free' ? 'ok' : sheet.status === 'rented' ? 'warn' : 'bad'}>{STATE_LABEL[sheet.status] ?? sheet.status}</Badge>} />
            <Row label="اجارهٔ ماهانه" value={formatMoney(sheet.monthly_price_irr)} />
            <Row label="در اختیار" value={sheet.holderName ?? '—'} />
            {sheet.rentalEnd ? <Row label="پایان اجاره" value={formatJalali(sheet.rentalEnd)} /> : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={newLocker}
        onClose={() => setNewLocker(false)}
        title="کمد جدید"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewLocker(false)}>انصراف</Button>
            <Button
              onClick={async () => {
                try {
                  const code = (document.getElementById('lk-code') as HTMLInputElement).value.trim();
                  if (!code) {
                    toast('شمارهٔ کمد را وارد کنید', 'bad');
                    return;
                  }
                  const price = tomanToRial((document.getElementById('lk-price') as HTMLInputElement).value || '0');
                  await api.createLocker({ code, price });
                  toast('کمد ثبت شد');
                  setNewLocker(false);
                  load();
                } catch (e: any) {
                  toast(e.message, 'bad');
                }
              }}
            >
              ثبت
            </Button>
          </>
        }
      >
        <Field label="شماره/کد کمد" required><TextInput id="lk-code" autoFocus aria-label="کد کمد" /></Field>
        <Field label="اجاره ماهانه (تومان)">
          <TextInput id="lk-price" placeholder="مثلاً 300000" dir="ltr" style={{ textAlign: 'right' }} aria-label="اجاره ماهانه" />
        </Field>
      </Modal>

      <Modal
        open={Boolean(rent)}
        onClose={() => setRent(null)}
        title={`اجارهٔ کمد ${rent?.code ?? ''}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRent(null)}>انصراف</Button>
            <Button
              onClick={async () => {
                if (!rent) return;
                try {
                  const memberId = (document.getElementById('lk-member') as HTMLSelectElement).value;
                  const months = Number((document.getElementById('lk-months') as HTMLInputElement).value || 1);
                  const start = parseJalaliInput((document.getElementById('lk-start') as HTMLInputElement).value) ?? new Date().toISOString().slice(0, 10);
                  await api.rentLocker({ lockerId: rent.id, memberId, startDate: start, months });
                  toast('کمد اجاره داده شد');
                  setRent(null);
                  load();
                } catch (e: any) {
                  toast(e.message, 'bad');
                }
              }}
            >
              ثبت اجاره
            </Button>
          </>
        }
      >
        <MemberSelect />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        {rows.map((m) => (
          <option key={m.id} value={m.id}>{m.full_name} — {toPersianDigits(m.mobile)}</option>
        ))}
      </select>
    </Field>
  );
}
