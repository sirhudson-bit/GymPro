'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, Database, FolderOpen, HardDriveDownload, KeyRound, Plus, ShieldCheck, UserPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { ACCENT_PRESETS, DEFAULT_ACCENT, deriveAccent } from '@/lib/theme';
import { Badge, Button, Empty, Field, Modal, Row, Section, Select, Table, TextInput, Toggle } from '@/components/ui';
import { formatJalali, toPersianDigits } from '@/lib/format';

export default function Settings({ onPortableWarning }: { onPortableWarning?: (v: boolean) => void }) {
  const toast = useStore((s) => s.toast);
  const user = useStore((s) => s.user);
  const theme = useStore((s) => s.theme);
  const accent = useStore((s) => s.accent);
  const setAccent = useStore((s) => s.setAccent);
  const tint = useStore((s) => s.tint);
  const setTint = useStore((s) => s.setTint);
  const [settingsMap, setSettingsMap] = useState<Record<string, string>>({});
  const [backups, setBackups] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [newUser, setNewUser] = useState(false);
  const [log, setLog] = useState('');
  const [pw, setPw] = useState({ current: '', next: '', repeat: '' });
  const [showCode, setShowCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, b, u] = await Promise.all([api.settingsAll(), api.backups(), api.users()]);
      setSettingsMap(s as Record<string, string>);
      setBackups(b as any[]);
      setUsers(u as any[]);
    } catch (e: any) {
      toast(e.message, 'bad');
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(key: string, value: string) {
    try {
      const res = (await api.setSetting(key, value)) as Record<string, string>;
      setSettingsMap(res);
      toast('ذخیره شد');
    } catch (e: any) {
      toast(e.message, 'bad');
    }
  }

  return (
    <div>
      <Section title="ظاهر برنامه" defaultOpen>
        <p className="text-[12.5px] mb-3" style={{ color: 'var(--muted)' }}>
          رنگ تم را انتخاب کن؛ متن‌ها و دکمه‌ها به‌صورت خودکار با همان رنگ هماهنگ می‌شوند و کنتراست خوانایی (۴٫۵:۱) حفظ می‌شود.
        </p>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {ACCENT_PRESETS.map((p) => {
            const preview = deriveAccent(p.hex, theme);
            const active = accent.toLowerCase() === p.hex.toLowerCase();
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setAccent(p.hex)}
                aria-label={`رنگ ${p.label}`}
                aria-pressed={active}
                title={p.label}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 999,
                  background: preview.brand,
                  border: active ? '2px solid var(--ink)' : '1px solid var(--edge-strong)',
                  outlineOffset: 2,
                }}
              />
            );
          })}
          <label className="flex items-center gap-2 text-[12.5px] px-2 py-1" style={{ border: '1px solid var(--edge-strong)', borderRadius: 10 }}>
            <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} aria-label="رنگ دلخواه" style={{ width: 26, height: 26, background: 'none', border: 'none' }} />
            رنگ دلخواه
          </label>
          <Button variant="ghost" onClick={() => setAccent(DEFAULT_ACCENT)}>بازگشت به پیش‌فرض</Button>
        </div>
        <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--muted)' }}>
          <span>پیش‌نمایش:</span>
          <span className="btn btn-primary" style={{ padding: '0.25rem 0.7rem', fontSize: 12 }}>دکمهٔ اصلی</span>
          <span className="chip" style={{ color: 'var(--brand)', borderColor: 'var(--brand)' }}>وضعیت فعال</span>
          <span style={{ color: 'var(--brand)' }}>متن با رنگ تم</span>
        </div>
        <div className="mt-3 pt-3" style={{ borderTop: '1px dashed var(--edge)' }}>
          <Toggle label="رنگ‌آمیزی کامل رابط (سایدبار و نوار بالا هم رنگ می‌شوند)" checked={tint} onChange={(v) => setTint(v)} />
          <p className="text-[11.5px] mt-1" style={{ color: 'var(--muted)' }}>
            خاموش = فقط دکمه‌ها و آیکون‌ها رنگ تم می‌گیرند؛ روشن = سطح سایدبار و نوار بالا هم با همان رنگ ملایم پوشیده می‌شود.
          </p>
        </div>
      </Section>

      <Section title="اطلاعات باشگاه">
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="نام باشگاه">
            <TextInput defaultValue={settingsMap['club.name'] ?? ''} onBlur={(e) => save('club.name', e.target.value)} />
          </Field>
          <Field label="تلفن">
            <TextInput defaultValue={settingsMap['club.phone'] ?? ''} onBlur={(e) => save('club.phone', e.target.value)} dir="ltr" style={{ textAlign: 'right' }} />
          </Field>
          <Field label="نشانی">
            <TextInput defaultValue={settingsMap['club.address'] ?? ''} onBlur={(e) => save('club.address', e.target.value)} />
          </Field>
          <Field label="سقف فریز (روز)" hint="حداکثر روزهای مجاز فریز در هر قرارداد">
            <TextInput defaultValue={settingsMap['freeze.cap_days'] ?? '30'} onBlur={(e) => save('freeze.cap_days', e.target.value.replace(/\D/g, ''))} dir="ltr" style={{ textAlign: 'right' }} />
          </Field>
        </div>
      </Section>

      <Section title="رفتار برنامه">
        <div className="space-y-3">
          <Toggle
            label="بستن پنجره = کوچک‌شدن به سینی سیستم"
            checked={(settingsMap['ui.minimize_to_tray'] ?? '1') === '1'}
            onChange={(v) => save('ui.minimize_to_tray', v ? '1' : '0')}
          />
          <p className="text-[12px]" style={{ color: 'var(--muted)' }}>برای خروج کامل، از منوی سینی سیستم «خروج» را بزنید.</p>
        </div>
      </Section>

      <Section title="اتصال به سرورها (اختیاری)" defaultOpen={false}>
        <Field label="آدرس سرور پشتیبانی" hint="بدون این آدرس، تیکت‌ها به‌صورت پیش‌نویس محلی می‌مانند">
          <TextInput defaultValue={settingsMap['support.url'] ?? ''} onBlur={(e) => save('support.url', e.target.value)} dir="ltr" style={{ textAlign: 'right' }} placeholder="https://support.gympro.ir" />
        </Field>
        <Field label="آدرس سرور آپدیت" hint="مانیفست امضاشدهٔ نسخه‌ها">
          <TextInput defaultValue={settingsMap['update.url'] ?? ''} onBlur={(e) => save('update.url', e.target.value)} dir="ltr" style={{ textAlign: 'right' }} placeholder="https://updates.gympro.ir" />
        </Field>
        <div className="rounded-lg p-2 text-[12px]" style={{ background: 'color-mix(in srgb, var(--brand) 8%, transparent)', color: 'var(--muted)' }}>
          این برنامه هیچ داده‌ای را به‌صورت پیش‌فرض ارسال نمی‌کند. تنها همین دو سرور (که خودتان وارد می‌کنید) و سرویس پیامک، مسیرهای خروج داده هستند.
        </div>
      </Section>

      <Section title="پشتیبان‌گیری" defaultOpen>
        <div className="flex flex-wrap gap-2 mb-3">
          <Button icon={<HardDriveDownload size={14} />} onClick={async () => {
            try {
              const res: any = await api.backup();
              toast(`پشتیبان ساخته شد (${toPersianDigits(Math.round(res.size / 1024))} کیلوبایت)`);
              load();
            } catch (e: any) { toast(e.message, 'bad'); }
          }}>پشتیبان‌گیری همین حالا</Button>
          <Button variant="ghost" icon={<FolderOpen size={14} />} onClick={() => api.openDataDir()}>باز کردن پوشهٔ داده</Button>
        </div>
        <Table head={['فایل', 'نوع', 'حجم', 'تاریخ']} empty={backups.length === 0}>
          {backups.map((b) => (
            <tr key={b.id}>
              <td className="td" dir="ltr" style={{ textAlign: 'right', fontSize: 12 }}>{b.file_name}</td>
              <td className="td">{b.kind === 'daily' ? 'روزانه' : b.kind === 'pre_migration' ? 'قبل از مهاجرت' : b.kind === 'pre_restore' ? 'قبل از بازیابی' : 'دستی'}</td>
              <td className="td tabular-nums">{toPersianDigits(Math.round(b.size_bytes / 1024))} KB</td>
              <td className="td">{formatJalali(b.created_at, { withTime: true })}</td>
            </tr>
          ))}
        </Table>
        <p className="text-[11.5px] mt-2" style={{ color: 'var(--muted)' }}>۱۴ نسخهٔ آخر نگه داشته می‌شود. نسخهٔ پشتیبان را روی فلش یا دیسک جدا هم کپی کنید.</p>
      </Section>

      <Section title="امنیت حساب" defaultOpen={false}>
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="رمز فعلی" required><TextInput type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} dir="ltr" style={{ textAlign: 'right' }} /></Field>
          <Field label="رمز جدید" required hint="حداقل ۶ کاراکتر"><TextInput type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} dir="ltr" style={{ textAlign: 'right' }} /></Field>
          <Field label="تکرار رمز جدید" required><TextInput type="password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} dir="ltr" style={{ textAlign: 'right' }} /></Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={async () => {
              if (pw.next.length < 6) return toast('رمز جدید حداقل ۶ کاراکتر باشد', 'bad');
              if (pw.next !== pw.repeat) return toast('رمز جدید و تکرار آن یکسان نیست', 'bad');
              try {
                await api.changePassword({ currentPassword: pw.current, newPassword: pw.next });
                setPw({ current: '', next: '', repeat: '' });
                toast('رمز عبور تغییر کرد');
              } catch (e: any) {
                toast(e.message, 'bad');
              }
            }}
          >
            تغییر رمز من
          </Button>
          <Button
            variant="ghost"
            icon={<KeyRound size={14} />}
            onClick={async () => {
              try {
                const res = await api.issueRecoveryCode();
                setShowCode(res.code);
              } catch (e: any) {
                toast(e.message, 'bad');
              }
            }}
          >
            ساخت کد بازیابی جدید
          </Button>
        </div>
        <p className="text-[11.5px] mt-2" style={{ color: 'var(--muted)' }}>
          کد بازیابی فقط یک‌بار نمایش داده می‌شود و برای بازگشت به حساب پس از فراموشی رمز لازم است. با ساخت کد جدید، کد قبلی باطل می‌شود.
        </p>
      </Section>

      <Section title="کاربران و نقش‌ها" defaultOpen={false}>
        <div className="flex justify-end mb-2">
          <Button variant="ghost" onClick={() => setNewUser(true)} icon={<UserPlus size={14} />}>کاربر جدید</Button>
        </div>
        <Table head={['نام', 'نام کاربری', 'نقش', 'کد بازیابی', 'آخرین ورود', 'عملیات']} empty={users.length === 0}>
          {users.map((u) => (
            <tr key={u.id}>
              <td className="td font-semibold">{u.fullName}</td>
              <td className="td" dir="ltr" style={{ textAlign: 'right' }}>{u.username}</td>
              <td className="td">{u.role === 'owner' ? 'مالک' : u.role === 'manager' ? 'مدیر' : u.role === 'receptionist' ? 'منشی' : 'مربی'}</td>
              <td className="td">{u.recoverySet ? <Badge tone="ok">دارد</Badge> : <Badge tone="warn">ندارد</Badge>}</td>
              <td className="td">{u.lastLoginAt ? formatJalali(u.lastLoginAt, { withTime: true }) : '—'}</td>
              <td className="td">
                {user?.role === 'owner' ? (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        const next = window.prompt(`رمز جدید برای ${u.username} (حداقل ۶ کاراکتر):`);
                        if (!next) return;
                        try {
                          await api.ownerResetPassword({ userId: u.id, newPassword: next });
                          toast(`رمز ${u.username} بازنشانی شد`);
                          load();
                        } catch (e: any) {
                          toast(e.message, 'bad');
                        }
                      }}
                    >
                      بازنشانی رمز
                    </Button>
                    {u.recoverySet ? null : (
                      <Button
                        variant="ghost"
                        icon={<KeyRound size={13} />}
                        onClick={async () => {
                          try {
                            const res = await api.issueRecoveryCode(u.id);
                            setShowCode(res.code);
                            load();
                          } catch (e: any) {
                            toast(e.message, 'bad');
                          }
                        }}
                      >
                        کد بازیابی
                      </Button>
                    )}
                  </div>
                ) : (
                  <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>—</span>
                )}
              </td>
            </tr>
          ))}
        </Table>
        <p className="text-[11.5px] mt-2" style={{ color: 'var(--muted)' }}>
          منشی به حذف، گزارش سود و تنظیمات دسترسی ندارد؛ مربی فقط اعضای خودش را می‌بیند.
        </p>
      </Section>

      <Section title="سلامت سیستم" defaultOpen={false}>
        <div className="flex gap-2 mb-2">
          <Button variant="ghost" onClick={async () => {
            try {
              const res: any = await api.logTail();
              setLog(res.log);
            } catch (e: any) { toast(e.message, 'bad'); }
          }} icon={<Database size={14} />}>نمایش لاگ امروز</Button>
        </div>
        {log ? <pre dir="ltr" className="text-[10.5px] p-2 rounded-lg overflow-auto max-h-60" style={{ background: 'var(--canvas)', whiteSpace: 'pre-wrap' }}>{log}</pre> : <Empty title="لاگی نمایش داده نشده" hint="دکمهٔ نمایش لاگ را بزنید." />}
      </Section>

      <Modal open={Boolean(showCode)} onClose={() => setShowCode(null)} title="کد بازیابی" footer={
        <>
          <Button variant="ghost" onClick={() => setShowCode(null)}>بستن</Button>
          <Button onClick={() => { navigator.clipboard.writeText(showCode ?? ''); toast('کپی شد'); }} icon={<Copy size={14} />}>کپی کد</Button>
        </>
      }>
        <p className="text-[13px] leading-7 mb-3">
          این کد را روی کاغذ بنویس و جای امن نگه دار. اگر رمز را فراموش کنی، تنها راه بازگشت به حساب همین است. کد قبلی باطل شد.
        </p>
        <div className="card p-3 text-center" dir="ltr">
          <code className="text-[16px] font-bold tracking-widest">{showCode}</code>
        </div>
        <p className="text-[11.5px] mt-2" style={{ color: 'var(--muted)' }}>پس از بستن این پنجره، دیگر نمایش داده نمی‌شود.</p>
      </Modal>

      <Modal open={newUser} onClose={() => setNewUser(false)} title="کاربر جدید" footer={<><Button variant="ghost" onClick={() => setNewUser(false)}>انصراف</Button>
        <Button onClick={async () => {
          try {
            await api.createUser({
              username: (document.getElementById('nu-user') as HTMLInputElement).value,
              fullName: (document.getElementById('nu-name') as HTMLInputElement).value,
              role: (document.getElementById('nu-role') as HTMLSelectElement).value,
              password: (document.getElementById('nu-pass') as HTMLInputElement).value,
              pin: (document.getElementById('nu-pin') as HTMLInputElement).value || null,
            });
            toast('کاربر ساخته شد');
            setNewUser(false);
            load();
          } catch (e: any) { toast(e.message, 'bad'); }
        }}>ایجاد</Button></>}>
        <Field label="نام و نام خانوادگی" required><TextInput id="nu-name" autoFocus aria-label="نام کاربر" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="نام کاربری" required><TextInput id="nu-user" dir="ltr" style={{ textAlign: 'right' }} aria-label="نام کاربری" /></Field>
          <Field label="نقش" required>
            <select id="nu-role" className="field" aria-label="نقش">
              <option value="receptionist">منشی</option>
              <option value="manager">مدیر</option>
              <option value="trainer">مربی</option>
              <option value="owner">مالک</option>
            </select>
          </Field>
          <Field label="رمز عبور" required><TextInput id="nu-pass" type="password" dir="ltr" style={{ textAlign: 'right' }} aria-label="رمز عبور" /></Field>
          <Field label="PIN (۴ رقم)"><TextInput id="nu-pin" dir="ltr" style={{ textAlign: 'right' }} aria-label="PIN" /></Field>
        </div>
      </Modal>
    </div>
  );
}
