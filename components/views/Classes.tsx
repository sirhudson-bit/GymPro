'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarPlus, Plus, UserPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Badge, Button, Empty, Field, Modal, Select, Table, TextInput } from '@/components/ui';
import { WEEKDAYS, toPersianDigits } from '@/lib/format';

export default function Classes() {
  const toast = useStore((s) => s.toast);
  const [classes, setClasses] = useState<any[]>([]);
  const [trainers, setTrainers] = useState<any[]>([]);
  const [newClass, setNewClass] = useState(false);
  const [newTrainer, setNewTrainer] = useState(false);
  const [enroll, setEnroll] = useState<any | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, t] = await Promise.all([api.classes(), api.trainers()]);
      setClasses(c as any[]);
      setTrainers(t as any[]);
    } catch (e: any) {
      toast(e.message, 'bad');
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="font-bold text-[14px]">کلاس‌های گروهی</h2>
        <div className="flex-1" />
        <Button variant="ghost" onClick={() => setNewTrainer(true)} icon={<UserPlus size={14} />}>مربی جدید</Button>
        <Button onClick={() => setNewClass(true)} icon={<CalendarPlus size={15} />}>کلاس جدید</Button>
      </div>

      <Table head={['کلاس', 'مربی', 'روز', 'ساعت', 'ظرفیت', '']} empty={classes.length === 0}>
        {classes.map((c) => (
          <tr key={c.id}>
            <td className="td font-semibold">{c.name}</td>
            <td className="td">{c.trainerName ?? '—'}</td>
            <td className="td">{WEEKDAYS[c.weekday] ?? '—'}</td>
            <td className="td tabular-nums" dir="ltr" style={{ textAlign: 'right' }}>{toPersianDigits(c.start_time)}–{toPersianDigits(c.end_time)}</td>
            <td className="td"><Badge tone={c.enrolled >= c.capacity ? 'bad' : 'ok'}>{toPersianDigits(c.enrolled)}/{toPersianDigits(c.capacity)}</Badge></td>
            <td className="td"><Button variant="ghost" onClick={() => setEnroll(c)} icon={<Plus size={13} />}>ثبت‌نام عضو</Button></td>
          </tr>
        ))}
      </Table>

      <div className="flex items-center gap-2 pt-2">
        <h2 className="font-bold text-[14px]">مربیان</h2>
      </div>
      <Table head={['نام', 'موبایل', 'تخصص', 'پورسانت']} empty={trainers.length === 0}>
        {trainers.map((t) => (
          <tr key={t.id}>
            <td className="td font-semibold">{t.full_name}</td>
            <td className="td tabular-nums" dir="ltr" style={{ textAlign: 'right' }}>{toPersianDigits(t.mobile ?? '—')}</td>
            <td className="td">{t.specialty ?? '—'}</td>
            <td className="td">{toPersianDigits(Math.round(t.commission_rate_bp / 100))}٪</td>
          </tr>
        ))}
      </Table>

      <Modal open={newClass} onClose={() => setNewClass(false)} title="کلاس جدید" footer={<><Button variant="ghost" onClick={() => setNewClass(false)}>انصراف</Button>
        <Button onClick={async () => {
          try {
            const name = (document.getElementById('cls-name') as HTMLInputElement).value;
            const trainerId = (document.getElementById('cls-trainer') as HTMLSelectElement).value;
            const weekday = Number((document.getElementById('cls-day') as HTMLSelectElement).value);
            const startTime = (document.getElementById('cls-start') as HTMLInputElement).value || '18:00';
            const endTime = (document.getElementById('cls-end') as HTMLInputElement).value || '19:30';
            const capacity = Number((document.getElementById('cls-cap') as HTMLInputElement).value || 10);
            await api.createClass({ name, trainerId: trainerId || null, weekday, startTime, endTime, capacity });
            toast('کلاس ثبت شد');
            setNewClass(false);
            load();
          } catch (e: any) { toast(e.message, 'bad'); }
        }}>ثبت</Button></>}>
        <Field label="نام کلاس" required><input id="cls-name" className="field" autoFocus aria-label="نام کلاس" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="مربی">
            <select id="cls-trainer" className="field" aria-label="مربی">
              <option value="">بدون مربی</option>
              {trainers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
            </select>
          </Field>
          <Field label="روز هفته">
            <select id="cls-day" className="field" aria-label="روز هفته">
              {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </Field>
          <Field label="ساعت شروع"><input id="cls-start" className="field" defaultValue="18:00" dir="ltr" style={{ textAlign: 'right' }} aria-label="ساعت شروع" /></Field>
          <Field label="ساعت پایان"><input id="cls-end" className="field" defaultValue="19:30" dir="ltr" style={{ textAlign: 'right' }} aria-label="ساعت پایان" /></Field>
        </div>
        <Field label="ظرفیت"><input id="cls-cap" className="field" defaultValue="10" dir="ltr" style={{ textAlign: 'right' }} aria-label="ظرفیت" /></Field>
      </Modal>

      <Modal open={newTrainer} onClose={() => setNewTrainer(false)} title="مربی جدید" footer={<><Button variant="ghost" onClick={() => setNewTrainer(false)}>انصراف</Button>
        <Button onClick={async () => {
          try {
            const fullName = (document.getElementById('tr-name') as HTMLInputElement).value;
            const mobile = (document.getElementById('tr-mobile') as HTMLInputElement).value;
            const specialty = (document.getElementById('tr-spec') as HTMLInputElement).value;
            const commission = Number((document.getElementById('tr-comm') as HTMLInputElement).value || 0);
            await api.createTrainer({ fullName, mobile: mobile || null, specialty: specialty || null, commissionRateBp: Math.round(commission * 100) });
            toast('مربی ثبت شد');
            setNewTrainer(false);
            load();
          } catch (e: any) { toast(e.message, 'bad'); }
        }}>ثبت</Button></>}>
        <Field label="نام و نام خانوادگی" required><input id="tr-name" className="field" autoFocus aria-label="نام مربی" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="موبایل"><input id="tr-mobile" className="field" dir="ltr" style={{ textAlign: 'right' }} aria-label="موبایل مربی" /></Field>
          <Field label="تخصص"><input id="tr-spec" className="field" aria-label="تخصص" /></Field>
          <Field label="درصد پورسانت"><input id="tr-comm" className="field" defaultValue="20" dir="ltr" style={{ textAlign: 'right' }} aria-label="درصد پورسانت" /></Field>
        </div>
      </Modal>

      <Modal open={Boolean(enroll)} onClose={() => setEnroll(null)} title={`ثبت‌نام در ${enroll?.name ?? ''}`} footer={<><Button variant="ghost" onClick={() => setEnroll(null)}>انصراف</Button>
        <Button onClick={async () => {
          try {
            const memberId = (document.getElementById('en-member') as HTMLSelectElement).value;
            await api.enroll({ classId: enroll.id, memberId });
            toast('عضو در کلاس ثبت شد');
            setEnroll(null);
            load();
          } catch (e: any) { toast(e.message, 'bad'); }
        }}>ثبت‌نام</Button></>}>
        {enroll ? <EnrollSelect classId={enroll.id} /> : null}
      </Modal>
    </div>
  );
}

function EnrollSelect({ classId }: { classId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    api.members({ limit: 200 }).then((r) => setRows(r as any[])).catch(() => setRows([]));
  }, [classId]);
  return (
    <Field label="عضو" required>
      <select id="en-member" className="field" aria-label="عضو">
        {rows.map((m) => <option key={m.id} value={m.id}>{m.full_name} — {toPersianDigits(m.mobile)}</option>)}
      </select>
    </Field>
  );
}
