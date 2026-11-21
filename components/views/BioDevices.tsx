'use client';

import { useCallback, useEffect, useState } from 'react';
import { Fingerprint, Plus, RefreshCw, Save, Trash2, Upload, Wifi, XCircle, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Badge, Button, Confirm, Empty, Field, Modal, Row, Section, Table, TextInput } from '@/components/ui';
import { formatJalali, toPersianDigits } from '@/lib/format';

const BRANDS: { key: string; label: string; hint: string; modes: { key: string; label: string }[]; fields: string[] }[] = [
  {
    key: 'zkteco',
    label: 'ZKTeco',
    hint: 'مدل‌های F18/F22/K40/MB360/IN01 — ADMS یا پورت ۴۳۷۰',
    modes: [
      { key: 'tcp', label: 'اتصال شبکه (TCP 4370)' },
      { key: 'adms', label: 'ADMS / Push' },
    ],
    fields: ['host', 'port'],
  },
  {
    key: 'suprema',
    label: 'Suprema',
    hint: 'BioStation / FaceStation با BioStar 2 — از API نسخهٔ ۲ استفاده می‌شود',
    modes: [{ key: 'biostar', label: 'BioStar 2 (REST)' }],
    fields: ['host', 'port', 'apiUser', 'apiSecret'],
  },
  {
    key: 'futronic',
    label: 'Futronic',
    hint: 'اسکنر FS80/FS88 — پوشهٔ CSV نرم‌افزار سازنده، یا پل محلی HTTP',
    modes: [
      { key: 'csv', label: 'پوشهٔ فایل CSV' },
      { key: 'bridge', label: 'پل محلی (HTTP)' },
    ],
    fields: ['csvPath', 'host', 'port'],
  },
];

type Form = {
  id?: string;
  brand: string;
  label: string;
  mode: string;
  host: string;
  port: string;
  serialNo: string;
  apiUser: string;
  apiSecret: string;
  csvPath: string;
  punchMode: 'toggle' | 'in_out';
};

const blank: Form = { brand: 'zkteco', label: '', mode: 'tcp', host: '192.168.1.', port: '4370', serialNo: '', apiUser: '', apiSecret: '', csvPath: '', punchMode: 'toggle' };

export default function BioDevices() {
  const toast = useStore((s) => s.toast);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Form | null>(null);
  const [test, setTest] = useState<{ device: any; result: any } | null>(null);
  const [busy, setBusy] = useState('');
  const [punches, setPunches] = useState<any[]>([]);
  const [drop, setDrop] = useState<any | null>(null);
  const [map, setMap] = useState<{ device: any; userNo: string; memberId: string } | null>(null);
  const [enroll, setEnroll] = useState<any | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, p] = await Promise.all([api.bioDevices(), api.bioPunches({ limit: 40 })]);
      setRows(d as any[]);
      setPunches(p as any[]);
    } catch (e: any) {
      toast(e.message, 'bad');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const brandDef = (key: string) => BRANDS.find((b) => b.key === key) ?? BRANDS[0];

  async function save() {
    if (!form) return;
    if (!form.label.trim()) return toast('نام دستگاه را وارد کنید', 'bad');
    setBusy('save');
    try {
      const payload = {
        brand: form.brand,
        label: form.label.trim(),
        mode: form.mode,
        host: form.host.trim() || null,
        port: form.port ? Number(form.port) : null,
        serialNo: form.serialNo.trim() || null,
        apiUser: form.apiUser.trim() || null,
        apiSecret: form.apiSecret || null,
        csvPath: form.csvPath.trim() || null,
        punchMode: form.punchMode,
      };
      if (form.id) await api.bioUpdateDevice({ ...payload, id: form.id });
      else await api.bioCreateDevice(payload);
      toast(form.id ? 'دستگاه ویرایش شد' : 'دستگاه ثبت شد');
      setForm(null);
      load();
    } catch (e: any) {
      toast(e.message, 'bad');
    } finally {
      setBusy('');
    }
  }

  async function runTest(device: any) {
    setBusy(`test:${device.id}`);
    try {
      const result: any = await api.bioTestDevice(device.id);
      setTest({ device, result });
      if (result?.ok) toast('اتصال برقرار شد');
      else toast(result?.error ?? 'اتصال ناموفق بود', 'bad');
    } catch (e: any) {
      toast(e.message, 'bad');
    } finally {
      setBusy('');
    }
  }

  async function runSync(device: any) {
    setBusy(`sync:${device.id}`);
    try {
      const res: any = await api.bioSync(device.id);
      if (res.ok) toast(`همگام‌سازی: ${toPersianDigits(res.applied)} ورود/خروج ثبت شد، ${toPersianDigits(res.skipped)} تکراری`);
      else toast(res.error ?? 'همگام‌سازی ناموفق بود', 'bad');
      load();
    } catch (e: any) {
      toast(e.message, 'bad');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold text-[14px] flex items-center gap-1.5"><Fingerprint size={16} /> دستگاه‌های اثر انگشت</h2>
        <div className="flex-1" />
        <Button variant="ghost" onClick={load} icon={<RefreshCw size={14} />}>{loading ? 'بازخوانی…' : 'بازخوانی'}</Button>
        <Button onClick={() => setForm({ ...blank })} icon={<Plus size={15} />}>دستگاه جدید</Button>
      </div>

      <AdmsBanner />

      <div className="rounded-xl p-3 text-[12px] leading-6" style={{ background: 'var(--brand-wash)', border: '1px solid var(--brand-line)' }}>
        <p className="font-bold mb-1">چطور وصل می‌شود؟</p>
        <p>شناسهٔ کاربر روی دستگاه را برابر <b>شمارهٔ عضویت</b> بگذارید (یا از «نگاشت شناسه» استفاده کنید). هر بار انگشت زدن، یک رکورد می‌آید: اگر آخرین رکورد امروز آن عضو بدون خروج باشد، این رکورد <b>خروج</b> ثبت می‌شود؛ وگرنه <b>ورود</b>.</p>
        <p style={{ color: 'var(--muted)' }}>تمپلیت اثر انگشت هرگز از دستگاه بیرون کشیده نمی‌شود؛ فقط ساعت و شمارهٔ عضویت می‌آید.</p>
      </div>

      {rows.length === 0 && !loading ? (
        <div className="card"><Empty title="دستگاهی ثبت نشده" hint="«دستگاه جدید» را بزنید و برند و آدرس را وارد کنید." /></div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((d) => {
            const def = brandDef(d.brand);
            return (
              <div key={d.id} className="card p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-[13.5px] flex items-center gap-1.5">
                      <Fingerprint size={14} /> {d.label}
                    </p>
                    <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>{def.label} · {def.modes.find((m) => m.key === d.mode)?.label ?? d.mode}</p>
                  </div>
                  <Badge tone={d.last_error ? 'bad' : d.is_active ? 'ok' : 'warn'}>{d.last_error ? 'خطا' : d.is_active ? 'فعال' : 'غیرفعال'}</Badge>
                </div>
                <div className="text-[11.5px] space-y-0.5" style={{ color: 'var(--muted)' }}>
                  {d.host ? <p dir="ltr" style={{ textAlign: 'right' }}>{d.host}{d.port ? `:${d.port}` : ''}</p> : null}
                  {d.csv_path ? <p>پوشه: {d.csv_path}</p> : null}
                  <p>آخرین همگام‌سازی: {d.last_sync_at ? formatJalali(d.last_sync_at, { withTime: true }) : '—'} {d.last_sync_count ? `(${toPersianDigits(d.last_sync_count)} رکورد)` : ''}</p>
                  {d.pending ? <p>رکورد ثبت‌نشده: {toPersianDigits(d.pending)}</p> : null}
                  {d.last_error ? <p style={{ color: 'var(--bad)' }}>{d.last_error}</p> : null}
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  <Button variant="ghost" onClick={() => runTest(d)} disabled={busy === `test:${d.id}`} icon={<Wifi size={13} />}>
                    {busy === `test:${d.id}` ? 'در حال تست…' : 'تست اتصال'}
                  </Button>
                  <Button variant="ghost" onClick={() => runSync(d)} disabled={busy === `sync:${d.id}`} icon={<Upload size={13} />}>
                    {busy === `sync:${d.id}` ? 'همگام‌سازی…' : 'خواندن رکوردها'}
                  </Button>
                  <Button
                    variant="ghost"
                    icon={<Save size={13} />}
                    onClick={() =>
                      setForm({
                        id: d.id,
                        brand: d.brand,
                        label: d.label,
                        mode: d.mode,
                        host: d.host ?? '',
                        port: d.port ? String(d.port) : '',
                        serialNo: d.serial_no ?? '',
                        apiUser: d.api_user ?? '',
                        apiSecret: '',
                        csvPath: d.csv_path ?? '',
                        punchMode: d.punch_mode ?? 'toggle',
                      })
                    }
                  >
                    ویرایش
                  </Button>
                  <Button onClick={() => setEnroll(d)} icon={<Fingerprint size={13} />}>ثبت اثر انگشت</Button>
                  <Button variant="ghost" onClick={() => setMap({ device: d, userNo: '', memberId: '' })}>نگاشت شناسه</Button>
                  <Button variant="ghost" onClick={() => setDrop(d)} icon={<Trash2 size={13} />} aria-label={`حذف ${d.label}`}>حذف</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Section title="آخرین رکوردهای رسیده از دستگاه" defaultOpen={false}>
        <Table head={['دستگاه', 'شماره روی دستگاه', 'عضو', 'زمان', 'جهت', 'وضعیت']} empty={punches.length === 0} minWidth={640}>
          {punches.map((p) => (
            <tr key={p.id}>
              <td className="td">{p.deviceLabel ?? '—'}</td>
              <td className="td tabular-nums" dir="ltr" style={{ textAlign: 'right' }}>{p.device_user_no}</td>
              <td className="td">{p.memberName ?? <span style={{ color: 'var(--bad)' }}>ناشناس</span>}</td>
              <td className="td">{formatJalali(p.punched_at, { withTime: true })}</td>
              <td className="td">{p.direction === 'in' ? 'ورود' : p.direction === 'out' ? 'خروج' : 'خودکار'}</td>
              <td className="td">
                <Badge tone={p.status === 'applied' ? 'ok' : p.status === 'unknown_member' ? 'bad' : p.status === 'ignored' ? 'warn' : 'warn'}>
                  {p.status === 'applied' ? 'ثبت شد' : p.status === 'unknown_member' ? 'عضو ناشناس' : p.status === 'ignored' ? 'رد شد' : 'در انتظار'}
                </Badge>
              </td>
            </tr>
          ))}
        </Table>
      </Section>

      {/* فرم دستگاه */}
      <Modal
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title={form?.id ? 'ویرایش دستگاه' : 'دستگاه اثر انگشت جدید'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setForm(null)}>انصراف</Button>
            <Button onClick={save} disabled={busy === 'save'}>{busy === 'save' ? 'ذخیره…' : 'ذخیره'}</Button>
          </>
        }
      >
        {form ? (
          <>
            <Field label="برند" required>
              <select
                className="field"
                value={form.brand}
                onChange={(e) => {
                  const b = brandDef(e.target.value);
                  setForm({ ...form, brand: b.key, mode: b.modes[0].key, port: b.key === 'zkteco' ? '4370' : b.key === 'suprema' ? '443' : '9099' });
                }}
                aria-label="برند دستگاه"
              >
                {BRANDS.map((b) => (
                  <option key={b.key} value={b.key}>{b.label}</option>
                ))}
              </select>
            </Field>
            <p className="text-[11.5px] mb-2" style={{ color: 'var(--muted)' }}>{brandDef(form.brand).hint}</p>

            <Field label="نام دستگاه (برای خودت)" required>
              <TextInput value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} autoFocus placeholder="مثلاً دستگاه دم در" />
            </Field>

            <Field label="حالت اتصال" required>
              <select className="field" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} aria-label="حالت اتصال">
                {brandDef(form.brand).modes.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            </Field>

            {brandDef(form.brand).fields.includes('host') ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="آدرس IP / میزبان" hint={form.brand === 'suprema' ? 'مثلاً 192.168.1.50 (پورت ۴۴۳)' : 'IP دستگاه در شبکهٔ محلی'}>
                  <TextInput value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} dir="ltr" placeholder="192.168.1.201" />
                </Field>
                <Field label="پورت">
                  <TextInput value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} dir="ltr" />
                </Field>
              </div>
            ) : null}

            {form.brand === 'suprema' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="نام کاربری API">
                  <TextInput value={form.apiUser} onChange={(e) => setForm({ ...form, apiUser: e.target.value })} dir="ltr" />
                </Field>
                <Field label="رمز API">
                  <TextInput type="password" value={form.apiSecret} onChange={(e) => setForm({ ...form, apiSecret: e.target.value })} dir="ltr" />
                </Field>
              </div>
            ) : null}

            {form.brand === 'futronic' && form.mode === 'csv' ? (
              <Field label="پوشهٔ خروجی CSV" hint="پوشه‌ای که نرم‌افزار فوترونیک فایل تردد را در آن می‌سازد">
                <TextInput value={form.csvPath} onChange={(e) => setForm({ ...form, csvPath: e.target.value })} dir="ltr" placeholder="C:\\Futronic\\logs" />
              </Field>
            ) : null}

            <Field label="نوع رکورد دستگاه" hint="اگر دستگاه خودش IN/OUT می‌فرستد «ورود/خروج» را انتخاب کن">
              <select className="field" value={form.punchMode} onChange={(e) => setForm({ ...form, punchMode: e.target.value as 'toggle' | 'in_out' })} aria-label="نوع رکورد">
                <option value="toggle">فقط زمان (برنامه ورود/خروج را تشخیص می‌دهد)</option>
                <option value="in_out">دستگاه ورود و خروج را مشخص می‌کند</option>
              </select>
            </Field>

            <Field label="شماره سریال / مدل" hint="برای پشتیبانی">
              <TextInput value={form.serialNo} onChange={(e) => setForm({ ...form, serialNo: e.target.value })} dir="ltr" />
            </Field>
          </>
        ) : null}
      </Modal>

      {/* نتیجهٔ تست */}
      <Modal
        open={Boolean(test)}
        onClose={() => setTest(null)}
        title={`نتیجهٔ تست: ${test?.device?.label ?? ''}`}
        footer={<Button onClick={() => setTest(null)}>بستن</Button>}
      >
        {test ? (
          <div className="space-y-2">
            <p className="flex items-center gap-2 font-bold" style={{ color: test.result?.ok ? 'var(--ok)' : 'var(--bad)' }}>
              {test.result?.ok ? <CheckCircle2 size={17} /> : <XCircle size={17} />}
              {test.result?.ok ? 'اتصال برقرار است' : 'اتصال برقرار نشد'}
            </p>
            {test.result?.error ? <p className="text-[12.5px] leading-6">{test.result.error}</p> : null}
            {test.result?.info ? (
              <div className="text-[12.5px] space-y-1">
                {Object.entries(test.result.info).map(([k, v]) => (
                  <Row key={k} label={k} value={String(v ?? '—')} />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* نگاشت شناسه */}
      <MapModal open={Boolean(map)} data={map} onClose={() => setMap(null)} onSaved={() => { setMap(null); load(); }} />

      <EnrollModal device={enroll} onClose={() => setEnroll(null)} onChanged={load} />

      <Confirm
        open={Boolean(drop)}
        danger
        title="حذف دستگاه"
        message={`دستگاه «${drop?.label ?? ''}» حذف می‌شود. رکوردهای قبلی در سابقه می‌مانند.`}
        confirmLabel="حذف دستگاه"
        onClose={() => setDrop(null)}
        onConfirm={async () => {
          const target = drop;
          setDrop(null);
          if (!target) return;
          try {
            await api.bioRemoveDevice(target.id);
            toast('دستگاه حذف شد');
            load();
          } catch (e: any) {
            toast(e.message, 'bad');
          }
        }}
      />
    </div>
  );
}

function MapModal({ open, data, onClose, onSaved }: { open: boolean; data: { device: any; userNo: string; memberId: string } | null; onClose: () => void; onSaved: () => void }) {
  const toast = useStore((s) => s.toast);
  const [members, setMembers] = useState<any[]>([]);
  const [maps, setMaps] = useState<any[]>([]);
  const [userNo, setUserNo] = useState('');
  const [memberId, setMemberId] = useState('');

  useEffect(() => {
    if (!open || !data) return;
    api.bioEnrollment().then((r) => setMembers(r as any[])).catch(() => setMembers([]));
    api.bioMapList(data.device.id).then((r) => setMaps(r as any[])).catch(() => setMaps([]));
  }, [open, data]);

  if (!data) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`نگاشت شناسه — ${data.device.label}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>بستن</Button>
          <Button
            onClick={async () => {
              if (!userNo.trim() || !memberId) return toast('هر دو مقدار را انتخاب کنید', 'bad');
              try {
                await api.bioMapAdd({ deviceId: data.device.id, userNo, memberId });
                toast('نگاشت ثبت شد');
                setUserNo('');
                const r: any = await api.bioMapList(data.device.id);
                setMaps(r as any[]);
                onSaved();
              } catch (e: any) {
                toast(e.message, 'bad');
              }
            }}
          >
            افزودن
          </Button>
        </>
      }
    >
      <p className="text-[12px] mb-3 leading-6" style={{ color: 'var(--muted)' }}>
        اگر شناسهٔ کاربر روی دستگاه با شمارهٔ عضویت جیم‌پرو یکسان نیست، اینجا وصلش کن.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2 mb-3">
        <Field label="شناسه روی دستگاه">
          <TextInput value={userNo} onChange={(e) => setUserNo(e.target.value.replace(/\D/g, ''))} dir="ltr" />
        </Field>
        <Field label="عضو">
          <select className="field" value={memberId} onChange={(e) => setMemberId(e.target.value)} aria-label="عضو">
            <option value="">انتخاب عضو…</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.full_name} — {toPersianDigits(m.member_no)}</option>
            ))}
          </select>
        </Field>
      </div>
      <Table head={['شناسه دستگاه', 'عضو', '']} empty={maps.length === 0} minWidth={420}>
        {maps.map((m) => (
          <tr key={m.id}>
            <td className="td tabular-nums" dir="ltr" style={{ textAlign: 'right' }}>{m.device_user_no}</td>
            <td className="td">{m.memberName}</td>
            <td className="td">
              <Button
                variant="ghost"
                icon={<Trash2 size={13} />}
                onClick={async () => {
                  await api.bioMapRemove(m.id);
                  const r: any = await api.bioMapList(data.device.id);
                  setMaps(r as any[]);
                }}
              >
                حذف
              </Button>
            </td>
          </tr>
        ))}
      </Table>
    </Modal>
  );
}

function AdmsBanner() {
  const [st, setSt] = useState<any>(null);
  useEffect(() => {
    api.bioAdmsStatus().then((r) => setSt(r)).catch(() => setSt(null));
  }, []);
  if (!st) return null;
  return (
    <div className="rounded-xl p-3 text-[11.5px] leading-6" style={{ background: st.running ? 'color-mix(in srgb, var(--ok) 8%, transparent)' : 'color-mix(in srgb, var(--warn) 10%, transparent)', border: '1px solid var(--edge)' }}>
      <p className="font-bold mb-0.5">شنوندهٔ ADMS (برای ZKTeco که رکورد را push می‌کند): {st.running ? `روشن روی پورت ${toPersianDigits(st.port)}` : 'خاموش'}</p>
      {st.seen?.length ? (
        <div className="mt-1">
          <p>دستگاه‌هایی که تا حالا وصل شده‌اند:</p>
          <ul className="pr-4 list-disc">
            {st.seen.map((x: any) => (
              <li key={x.sn}>سریال <span dir="ltr">{x.sn}</span> — آخرین: {formatJalali(x.at, { withTime: true })} ({toPersianDigits(x.count)} رکورد)</li>
            ))}
          </ul>
        </div>
      ) : (
        <p style={{ color: 'var(--muted)' }}>هنوز دستگاهی وصل نشده. در دستگاه: Communication ← Cloud Server/ADMS ← Server Address = IP این رایانه، Port = {toPersianDigits(st.port || 8090)}</p>
      )}
    </div>
  );
}
/* ─────────── ثبت اثر انگشت برای اعضا ─────────── */

const ENROLL_STEPS: Record<string, string[]> = {
  zkteco: [
    'روی دستگاه: Menu → User Mgt → New User (یا User → Add).',
    'User ID را دقیقاً برابر شمارهٔ عضویت بگذار (مثل ۱۲۳) — همین عدد کلید اتصال است.',
    'نام عضو را وارد کن و اثر انگشت را سه بار بزن (برای کیفیت بهتر ۲ انگشت).',
    'اگر کارت RFID دارد همان‌جا ثبت کن؛ رمز عددی اختیاری است.',
    'Save بزن. از این به بعد هر بار انگشت بزند، رکورد در جیم‌پرو ثبت می‌شود.',
  ],
  suprema: [
    'در BioStar 2 (مرورگر) → User → Add User.',
    'User ID را برابر شمارهٔ عضویت جیم‌پرو بگذار.',
    'در Credential → Fingerprint، روی دستگاه اثر انگشت را ۲ تا ۳ بار ثبت کن.',
    'ذخیره کن؛ سپس در همین صفحه «خواندن رکوردها» را بزن.',
  ],
  futronic: [
    'در نرم‌افزار فوترونیک برای عضو یک User با شناسهٔ برابر شمارهٔ عضویت بساز.',
    'اثر انگشت را در همان نرم‌افزار ثبت و ذخیره کن.',
    'خروجی تردد را در همان پوشهٔ CSV بریز تا جیم‌پرو بخواند.',
  ],
};

function EnrollModal({ device, onClose, onChanged }: { device: any | null; onClose: () => void; onChanged: () => void }) {
  const toast = useStore((s) => s.toast);
  const [pending, setPending] = useState<any[]>([]);
  const [enrolled, setEnrolled] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    if (!device) return;
    try {
      const [p, e] = await Promise.all([api.bioUnenrolled(device.id), api.bioMapList(device.id)]);
      setPending(p as any[]);
      setEnrolled(e as any[]);
    } catch (err: any) {
      toast(err.message, 'bad');
    }
  }, [device, toast]);

  useEffect(() => {
    if (device) load();
  }, [device, load]);

  if (!device) return null;
  const steps = ENROLL_STEPS[device.brand] ?? [];
  const filtered = pending.filter((m) => !q.trim() || m.fullName.includes(q) || String(m.memberNo).includes(q));

  return (
    <Modal open onClose={onClose} wide title={`ثبت اثر انگشت — ${device.label}`} footer={<Button onClick={onClose}>بستن</Button>}>
      <div className="rounded-xl p-3 mb-3 text-[12px] leading-6" style={{ background: 'var(--brand-wash)', border: '1px solid var(--brand-line)' }}>
        <p className="font-bold mb-1">اثر انگشت روی خود دستگاه ثبت می‌شود، نه در جیم‌پرو</p>
        <ol className="pr-4 list-decimal">
          {steps.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
        <p className="mt-1" style={{ color: 'var(--muted)' }}>
          تمپلیت روی دستگاه می‌ماند؛ جیم‌پرو فقط نگه می‌دارد «چه کسی روی کدام دستگاه ثبت شده» تا بدانی چه کسی مانده است.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h3 className="font-bold text-[13px]">بدون اثر انگشت روی این دستگاه ({toPersianDigits(filtered.length)})</h3>
        <div className="flex-1" />
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی نام یا شماره" style={{ width: 200 }} aria-label="جستجوی عضو" />
      </div>
      <Table head={['شمارهٔ عضویت', 'نام', 'موبایل', 'عملیات']} empty={filtered.length === 0} minWidth={520}>
        {filtered.slice(0, 200).map((m) => (
          <tr key={m.id}>
            <td className="td tabular-nums" dir="ltr" style={{ textAlign: 'right' }}>{toPersianDigits(m.memberNo)}</td>
            <td className="td font-semibold">{m.fullName}</td>
            <td className="td tabular-nums" dir="ltr" style={{ textAlign: 'right' }}>{toPersianDigits(m.mobile ?? '')}</td>
            <td className="td">
              <Button
                variant="ghost"
                disabled={busy === m.id}
                icon={<CheckCircle2 size={13} />}
                onClick={async () => {
                  setBusy(m.id);
                  try {
                    await api.bioMapAdd({ deviceId: device.id, userNo: String(m.memberNo), memberId: m.id });
                    toast(`ثبت شد: ${m.fullName}`);
                    await load();
                    onChanged();
                  } catch (e: any) {
                    toast(e.message, 'bad');
                  } finally {
                    setBusy('');
                  }
                }}
              >
                ثبت شد
              </Button>
            </td>
          </tr>
        ))}
      </Table>

      <h3 className="font-bold text-[13px] mt-4 mb-2">ثبت‌شده روی این دستگاه ({toPersianDigits(enrolled.length)})</h3>
      <Table head={['شناسه دستگاه', 'عضو', 'تاریخ ثبت', 'عملیات']} empty={enrolled.length === 0} minWidth={520}>
        {enrolled.map((m) => (
          <tr key={m.id}>
            <td className="td tabular-nums" dir="ltr" style={{ textAlign: 'right' }}>{m.device_user_no}</td>
            <td className="td">{m.memberName}</td>
            <td className="td">{m.enrolled_at ? formatJalali(m.enrolled_at, { withTime: true }) : '—'}</td>
            <td className="td">
              <Button
                variant="ghost"
                icon={<Trash2 size={13} />}
                onClick={async () => {
                  try {
                    await api.bioMapRemove(m.id);
                    await load();
                    onChanged();
                  } catch (e: any) {
                    toast(e.message, 'bad');
                  }
                }}
              >
                حذف نگاشت
              </Button>
            </td>
          </tr>
        ))}
      </Table>
    </Modal>
  );
}
