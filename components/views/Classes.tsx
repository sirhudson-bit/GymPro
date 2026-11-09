'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarPlus, Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Badge, Button, Confirm, Field, Modal, Table, TextInput } from '@/components/ui';
import { WEEKDAYS, toPersianDigits } from '@/lib/format';

type ClassForm = {
  id?: string;
  name: string;
  trainerId: string;
  weekdays: number[];
  startTime: string;
  endTime: string;
  capacity: string;
};
type TrainerForm = { id?: string; fullName: string; mobile: string; specialty: string; commission: string };

const emptyClass: ClassForm = { name: '', trainerId: '', weekdays: [0], startTime: '18:00', endTime: '19:30', capacity: '10' };

export default function Classes() {
  const toast = useStore((s) => s.toast);
  const [classes, setClasses] = useState<any[]>([]);
  const [trainers, setTrainers] = useState<any[]>([]);
  const [classForm, setClassForm] = useState<ClassForm | null>(null);
  const [trainerForm, setTrainerForm] = useState<TrainerForm | null>(null);
  const [enroll, setEnroll] = useState<any | null>(null);
  const [dropClass, setDropClass] = useState<any | null>(null);
  const [dropTrainer, setDropTrainer] = useState<any | null>(null);

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

  const toggleDay = (day: number) => {
    setClassForm((f) => {
      if (!f) return f;
      const has = f.weekdays.includes(day);
      const next = has ? f.weekdays.filter((d) => d !== day) : [...f.weekdays, day];
      return { ...f, weekdays: next.sort((a, b) => a - b) };
    });
  };

  async function saveClass() {
    if (!classForm) return;
    const name = classForm.name.trim();
    if (name.length < 2) return toast('نام کلاس را وارد کنید', 'bad');
    if (classForm.weekdays.length === 0) return toast('حداقل یک روز هفته را انتخاب کنید', 'bad');
    try {
      const payload = {
        name,
        trainerId: classForm.trainerId || null,
        startTime: classForm.startTime || '18:00',
        endTime: classForm.endTime || '19:30',
        capacity: Number(classForm.capacity || 10),
      };
      if (classForm.id) {
        await api.updateClass({ ...payload, id: classForm.id, weekday: classForm.weekdays[0] });
        toast('کلاس ویرایش شد');
      } else {
        const created: any = await api.createClasses({ ...payload, weekdays: classForm.weekdays });
        toast(`ثبت شد: ${Array.isArray(created) ? created.length : classForm.weekdays.length} کلاس در ${classForm.weekdays.length} روز`);
      }
      setClassForm(null);
      load();
    } catch (e: any) {
      toast(e.message, 'bad');
    }
  }

  async function saveTrainer() {
    if (!trainerForm) return;
    const fullName = trainerForm.fullName.trim();
    if (fullName.length < 3) return toast('نام مربی را وارد کنید', 'bad');
    try {
      const payload = {
        fullName,
        mobile: trainerForm.mobile.trim() || null,
        specialty: trainerForm.specialty.trim() || null,
        commissionRateBp: Math.round(Number(trainerForm.commission || 0) * 100),
      };
      if (trainerForm.id) {
        await api.updateTrainer({ ...payload, id: trainerForm.id });
        toast('اطلاعات مربی ویرایش شد');
      } else {
        await api.createTrainer(payload);
        toast('مربی ثبت شد');
      }
      setTrainerForm(null);
      load();
    } catch (e: any) {
      toast(e.message, 'bad');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="font-bold text-[14px]">کلاس‌های گروهی</h2>
        <div className="flex-1" />
        <Button variant="ghost" onClick={() => setTrainerForm({ fullName: '', mobile: '', specialty: '', commission: '20' })} icon={<UserPlus size={14} />}>مربی جدید</Button>
        <Button onClick={() => setClassForm({ ...emptyClass, weekdays: [0] })} icon={<CalendarPlus size={15} />}>کلاس جدید</Button>
      </div>

      <Table head={['کلاس', 'مربی', 'روز', 'ساعت', 'ظرفیت', 'عملیات']} empty={classes.length === 0}>
        {classes.map((c) => (
          <tr key={c.id}>
            <td className="td font-semibold">{c.name}</td>
            <td className="td">{c.trainerName ?? '—'}</td>
            <td className="td">{WEEKDAYS[c.weekday] ?? '—'}</td>
            <td className="td tabular-nums" dir="ltr" style={{ textAlign: 'right' }}>{toPersianDigits(c.start_time)}–{toPersianDigits(c.end_time)}</td>
            <td className="td"><Badge tone={c.enrolled >= c.capacity ? 'bad' : 'ok'}>{toPersianDigits(c.enrolled)}/{toPersianDigits(c.capacity)}</Badge></td>
            <td className="td">
              <div className="flex flex-wrap gap-1">
                <Button variant="ghost" onClick={() => setEnroll(c)} icon={<Plus size={13} />}>ثبت‌نام</Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    setClassForm({
                      id: c.id,
                      name: c.name,
                      trainerId: c.trainer_id ?? '',
                      weekdays: [Number(c.weekday)],
                      startTime: c.start_time,
                      endTime: c.end_time,
                      capacity: String(c.capacity),
                    })
                  }
                  icon={<Pencil size={13} />}
                  aria-label={`ویرایش کلاس ${c.name}`}
                >
                  ویرایش
                </Button>
                <Button variant="ghost" onClick={() => setDropClass(c)} icon={<Trash2 size={13} />} aria-label={`حذف کلاس ${c.name}`}>حذف</Button>
              </div>
            </td>
          </tr>
        ))}
      </Table>

      <div className="flex items-center gap-2 pt-2">
        <h2 className="font-bold text-[14px]">مربیان</h2>
      </div>
      <Table head={['نام', 'موبایل', 'تخصص', 'پورسانت', 'عملیات']} empty={trainers.length === 0}>
        {trainers.map((t) => (
          <tr key={t.id}>
            <td className="td font-semibold">{t.full_name}</td>
            <td className="td tabular-nums" dir="ltr" style={{ textAlign: 'right' }}>{toPersianDigits(t.mobile ?? '—')}</td>
            <td className="td">{t.specialty ?? '—'}</td>
            <td className="td">{toPersianDigits(Math.round(t.commission_rate_bp / 100))}٪</td>
            <td className="td">
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  onClick={() =>
                    setTrainerForm({
                      id: t.id,
                      fullName: t.full_name,
                      mobile: t.mobile ?? '',
                      specialty: t.specialty ?? '',
                      commission: String(Math.round(t.commission_rate_bp / 100)),
                    })
                  }
                  icon={<Pencil size={13} />}
                  aria-label={`ویرایش مربی ${t.full_name}`}
                >
                  ویرایش
                </Button>
                <Button variant="ghost" onClick={() => setDropTrainer(t)} icon={<Trash2 size={13} />} aria-label={`حذف مربی ${t.full_name}`}>حذف</Button>
              </div>
            </td>
          </tr>
        ))}
      </Table>

      <Modal
        open={Boolean(classForm)}
        onClose={() => setClassForm(null)}
        title={classForm?.id ? 'ویرایش کلاس' : 'کلاس جدید'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setClassForm(null)}>انصراف</Button>
            <Button onClick={saveClass}>{classForm?.id ? 'ذخیره تغییرات' : 'ثبت'}</Button>
          </>
        }
      >
        {classForm ? (
          <>
            <Field label="نام کلاس" required>
              <TextInput value={classForm.name} onChange={(e) => setClassForm({ ...classForm, name: e.target.value })} autoFocus />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="مربی">
                <select className="field" value={classForm.trainerId} onChange={(e) => setClassForm({ ...classForm, trainerId: e.target.value })} aria-label="مربی">
                  <option value="">بدون مربی</option>
                  {trainers.map((t) => (
                    <option key={t.id} value={t.id}>{t.full_name}</option>
                  ))}
                </select>
              </Field>
              <Field label="ظرفیت">
                <TextInput value={classForm.capacity} onChange={(e) => setClassForm({ ...classForm, capacity: e.target.value })} dir="ltr" />
              </Field>
              <Field label="ساعت شروع">
                <TextInput value={classForm.startTime} onChange={(e) => setClassForm({ ...classForm, startTime: e.target.value })} dir="ltr" />
              </Field>
              <Field label="ساعت پایان">
                <TextInput value={classForm.endTime} onChange={(e) => setClassForm({ ...classForm, endTime: e.target.value })} dir="ltr" />
              </Field>
            </div>
            <Field
              label={classForm.id ? 'روز هفته' : 'روزهای هفته'}
              required
              hint={classForm.id ? 'هر روز، یک ردیف جداست' : 'چند روز را می‌توانید انتخاب کنید؛ برای هر روز یک کلاس ساخته می‌شود'}
            >
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((d, i) => {
                  const on = classForm.weekdays.includes(i);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => (classForm.weekdays.length === 1 && on ? toast('حداقل یک روز لازم است', 'bad') : toggleDay(i))}
                      aria-pressed={on}
                      className="btn text-[12px]"
                      style={{
                        minHeight: 32,
                        background: on ? 'var(--brand)' : 'transparent',
                        color: on ? 'var(--brand-ink)' : 'var(--ink)',
                        borderColor: on ? 'var(--brand)' : 'var(--edge-strong)',
                      }}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </Field>
          </>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(trainerForm)}
        onClose={() => setTrainerForm(null)}
        title={trainerForm?.id ? 'ویرایش مربی' : 'مربی جدید'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTrainerForm(null)}>انصراف</Button>
            <Button onClick={saveTrainer}>{trainerForm?.id ? 'ذخیره تغییرات' : 'ثبت'}</Button>
          </>
        }
      >
        {trainerForm ? (
          <>
            <Field label="نام و نام خانوادگی" required>
              <TextInput value={trainerForm.fullName} onChange={(e) => setTrainerForm({ ...trainerForm, fullName: e.target.value })} autoFocus />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="موبایل">
                <TextInput value={trainerForm.mobile} onChange={(e) => setTrainerForm({ ...trainerForm, mobile: e.target.value })} dir="ltr" />
              </Field>
              <Field label="تخصص">
                <TextInput value={trainerForm.specialty} onChange={(e) => setTrainerForm({ ...trainerForm, specialty: e.target.value })} />
              </Field>
              <Field label="درصد پورسانت">
                <TextInput value={trainerForm.commission} onChange={(e) => setTrainerForm({ ...trainerForm, commission: e.target.value })} dir="ltr" />
              </Field>
            </div>
          </>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(enroll)}
        onClose={() => setEnroll(null)}
        title={`ثبت‌نام در ${enroll?.name ?? ''}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEnroll(null)}>انصراف</Button>
            <Button
              onClick={async () => {
                try {
                  const memberId = (document.getElementById('en-member') as HTMLSelectElement).value;
                  await api.enroll({ classId: enroll.id, memberId });
                  toast('عضو در کلاس ثبت شد');
                  setEnroll(null);
                  load();
                } catch (e: any) {
                  toast(e.message, 'bad');
                }
              }}
            >
              ثبت‌نام
            </Button>
          </>
        }
      >
        {enroll ? <EnrollSelect classId={enroll.id} /> : null}
      </Modal>

      <Confirm
        open={Boolean(dropClass)}
        danger
        title="حذف کلاس"
        message={`کلاس «${dropClass?.name ?? ''}» در روز ${WEEKDAYS[dropClass?.weekday] ?? ''} حذف می‌شود و ثبت‌نام‌های فعالش لغو می‌شوند. ادامه می‌دهید؟`}
        confirmLabel="حذف کلاس"
        onClose={() => setDropClass(null)}
        onConfirm={async () => {
          const target = dropClass;
          setDropClass(null);
          if (!target) return;
          try {
            await api.removeClass(target.id);
            toast('کلاس حذف شد');
            load();
          } catch (e: any) {
            toast(e.message, 'bad');
          }
        }}
      />

      <Confirm
        open={Boolean(dropTrainer)}
        danger
        title="حذف مربی"
        message={`«${dropTrainer?.full_name ?? ''}» حذف می‌شود. کلاس‌های او حذف نمی‌شوند، فقط بدون مربی می‌مانند.`}
        confirmLabel="حذف مربی"
        onClose={() => setDropTrainer(null)}
        onConfirm={async () => {
          const target = dropTrainer;
          setDropTrainer(null);
          if (!target) return;
          try {
            await api.removeTrainer(target.id);
            toast('مربی حذف شد');
            load();
          } catch (e: any) {
            toast(e.message, 'bad');
          }
        }}
      />
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
        {rows.map((m) => (
          <option key={m.id} value={m.id}>{m.full_name} — {toPersianDigits(m.mobile)}</option>
        ))}
      </select>
    </Field>
  );
}
