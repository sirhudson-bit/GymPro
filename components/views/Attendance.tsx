'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DoorOpen, LogOut, ScanLine } from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Badge, Button, Empty, Field, Modal, Table, TextArea, TextInput } from '@/components/ui';
import { formatJalali, toPersianDigits } from '@/lib/format';

export default function Attendance() {
  const toast = useStore((s) => s.toast);
  const [rows, setRows] = useState<any[]>([]);
  const [present, setPresent] = useState(0);
  const [tab, setTab] = useState<'today' | 'history'>('today');
  const [scan, setScan] = useState('');
  const [override, setOverride] = useState<{ memberId: string; message: string } | null>(null);
  const [reason, setReason] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [t, p, h] = await Promise.all([api.attendanceToday(), api.attendancePresent(), api.attendanceHistory({ limit: 200 })]);
      setRows(tab === 'today' ? (t as any[]) : (h as any[]));
      setPresent((p as any).present);
    } catch (e: any) {
      toast(e.message, 'bad');
    }
  }, [tab, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F4') inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    const onScan = () => load();
    window.addEventListener('gp:scan', onScan);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('gp:scan', onScan);
    };
  }, [load]);

  async function submitScan(e?: React.FormEvent) {
    e?.preventDefault();
    const token = scan.trim();
    if (!token) return;
    try {
      const res: any = await api.checkin({ token, method: 'barcode' });
      toast(`ورود ${res.memberName} ثبت شد${res.override ? ' (ارفاقی)' : ''}${res.sessionsLeft != null ? ` — ${toPersianDigits(res.sessionsLeft)} جلسه باقی` : ''}`);
      setScan('');
      load();
    } catch (err: any) {
      const message = err.message as string;
      if (message.includes('ارفاقی') || message.includes('منقضی') || message.includes('قرارداد فعال')) {
        try {
          const member: any = await api.members({ q: token, limit: 1 });
          if (member.length) setOverride({ memberId: member[0].id, message });
          else toast(message, 'bad');
        } catch {
          toast(message, 'bad');
        }
      } else {
        toast(message, 'bad');
      }
    }
  }

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <form onSubmit={submitScan} className="flex items-end gap-2">
          <div className="flex-1">
            <Field label="اسکن بارکد / QR یا شمارهٔ عضویت" hint="بارکدخوان را اسکن کنید و Enter بزنید؛ در هر صفحه‌ای هم کار می‌کند.">
              <TextInput ref={inputRef as any} value={scan} onChange={(e) => setScan(e.target.value)} placeholder="کد را اسکن یا وارد کنید" autoFocus dir="ltr" style={{ textAlign: 'right' }} />
            </Field>
          </div>
          <Button type="submit" icon={<ScanLine size={15} />}>ثبت ورود (F4)</Button>
        </form>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--edge)' }}>
          {([['today', 'حاضرین امروز'], ['history', 'تاریخچه']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className="px-3 py-1.5 text-[12.5px]" aria-pressed={tab === k}
              style={{ background: tab === k ? 'var(--brand)' : 'transparent', color: tab === k ? 'var(--brand-ink)' : 'var(--ink)', fontWeight: tab === k ? 700 : 500 }}>{label}</button>
          ))}
        </div>
        <Badge tone="ok">{toPersianDigits(present)} نفر حاضر</Badge>
        <div className="flex-1" />
        <Button variant="ghost" onClick={load}>بازخوانی</Button>
      </div>

      <Table head={['عضو', 'زمان ورود', 'زمان خروج', 'روش', '']} empty={rows.length === 0}>
        {rows.map((c) => (
          <tr key={c.id}>
            <td className="td font-semibold">{c.memberName}</td>
            <td className="td">{formatJalali(c.checked_in_at, { withTime: true })}</td>
            <td className="td">{c.checked_out_at ? formatJalali(c.checked_out_at, { withTime: true }) : '—'}</td>
            <td className="td">
              <div className="flex items-center gap-1">
                <span>{c.method === 'barcode' ? 'بارکد' : c.method === 'qr_webcam' ? 'QR وبکم' : c.method === 'kiosk' ? 'کیوسک' : 'دستی'}</span>
                {c.is_override ? <Badge tone="warn">ارفاقی</Badge> : null}
              </div>
            </td>
            <td className="td">
              {!c.checked_out_at ? (
                <Button variant="ghost" onClick={async () => { await api.checkout(c.id); toast('خروج ثبت شد'); load(); }} icon={<LogOut size={13} />}>خروج</Button>
              ) : null}
            </td>
          </tr>
        ))}
      </Table>

      <Modal open={Boolean(override)} onClose={() => setOverride(null)} title="ورود ارفاقی" footer={
        <>
          <Button variant="ghost" onClick={() => setOverride(null)}>انصراف</Button>
          <Button onClick={async () => {
            if (!override) return;
            try {
              const res: any = await api.checkin({ memberId: override.memberId, method: 'manual', overrideReason: reason || 'ارفاق مدیر' });
              toast(`ورود ارفاقی ${res.memberName} ثبت شد`);
              setOverride(null);
              setReason('');
              load();
            } catch (e: any) { toast(e.message, 'bad'); }
          }} icon={<DoorOpen size={14} />}>ثبت با دلیل</Button>
        </>
      }>
        <p className="text-[13px] mb-2">{override?.message}</p>
        <Field label="دلیل ورود ارفاقی" required hint="در گزارش تردد و حسابرسی ثبت می‌شود">
          <TextArea value={reason} onChange={setReason} rows={2} placeholder="مثلاً: تسویه نکرده اما مدیر اجازه داد" />
        </Field>
      </Modal>
    </div>
  );
}
