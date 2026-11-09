'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutDashboard, Users, FileSignature, Wallet, ScanLine, MonitorSmartphone, ShoppingBasket,
  CalendarClock, KeyRound, BarChart3, LifeBuoy, Settings as SettingsIcon, ShieldCheck, BookOpen,
  Sun, Moon, LogOut, CheckCircle2, AlertTriangle, XCircle, ArrowLeft, ArrowRight, X,
} from 'lucide-react';
import { api, hasApi } from '@/lib/api';
import { useStore, initTheme, type ViewKey } from '@/lib/store';
import { Button, Field, TextInput, Spinner } from '@/components/ui';
import { toPersianDigits } from '@/lib/format';

import Dashboard from '@/components/views/Dashboard';
import ForgotPassword from '@/components/views/ForgotPassword';
import Members from '@/components/views/Members';
import Contracts from '@/components/views/Contracts';
import Finance from '@/components/views/Finance';
import Attendance from '@/components/views/Attendance';
import Kiosk from '@/components/views/Kiosk';
import Pos from '@/components/views/Pos';
import Classes from '@/components/views/Classes';
import Lockers from '@/components/views/Lockers';
import Reports from '@/components/views/Reports';
import Support from '@/components/views/Support';
import SettingsView from '@/components/views/Settings';
import LicenseView from '@/components/views/License';
import Help from '@/components/views/Help';

const NAV: { key: ViewKey; label: string; icon: any; roles?: string[] }[] = [
  { key: 'dashboard', label: 'داشبورد', icon: LayoutDashboard },
  { key: 'members', label: 'اعضا', icon: Users },
  { key: 'contracts', label: 'قرارداد و تعرفه', icon: FileSignature },
  { key: 'finance', label: 'مالی و صندوق', icon: Wallet, roles: ['owner', 'manager'] },
  { key: 'attendance', label: 'تردد', icon: ScanLine },
  { key: 'kiosk', label: 'حالت کیوسک', icon: MonitorSmartphone },
  { key: 'pos', label: 'بوفه', icon: ShoppingBasket },
  { key: 'classes', label: 'کلاس و مربی', icon: CalendarClock },
  { key: 'lockers', label: 'کمدها', icon: KeyRound },
  { key: 'reports', label: 'گزارش‌ها', icon: BarChart3, roles: ['owner', 'manager'] },
  { key: 'support', label: 'پشتیبانی', icon: LifeBuoy },
  { key: 'license', label: 'لایسنس', icon: ShieldCheck, roles: ['owner', 'manager'] },
  { key: 'settings', label: 'تنظیمات', icon: SettingsIcon, roles: ['owner', 'manager'] },
  { key: 'help', label: 'راهنما', icon: BookOpen },
];

/* ─────────────────────────── toasts ─────────────────────────── */

function Toasts() {
  const { toasts, dismiss } = useStore();
  return (
    <div className="fixed bottom-4 left-4 z-[60] flex flex-col gap-2 no-print" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="card px-3 py-2 flex items-center gap-2 text-[13px]" style={{ borderColor: `color-mix(in srgb, var(--${t.tone === 'ok' ? 'ok' : t.tone === 'warn' ? 'warn' : 'bad'}) 45%, var(--edge))` }}>
          {t.tone === 'ok' ? <CheckCircle2 size={16} style={{ color: 'var(--ok)' }} /> : t.tone === 'warn' ? <AlertTriangle size={16} style={{ color: 'var(--warn)' }} /> : <XCircle size={16} style={{ color: 'var(--bad)' }} />}
          <span>{t.message}</span>
          <button aria-label="بستن پیام" onClick={() => dismiss(t.id)} className="mr-2 opacity-60 hover:opacity-100"><X size={13} /></button>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────── setup wizard ─────────────────────────── */

function SetupWizard({ onDone }: { onDone: () => void }) {
  const toast = useStore((s) => s.toast);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ clubName: '', phone: '', address: '', genderType: 'mixed', ownerName: '', username: 'admin', password: '', pin: '1234' });
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState('');

  const steps = ['خوش‌آمد', 'اطلاعات باشگاه', 'حساب مدیر', 'پایان'];
  const canNext = step === 1 ? form.clubName.trim().length >= 3 : step === 2 ? form.ownerName.trim().length >= 3 && form.username.length >= 3 && form.password.length >= 6 && /^\d{4}$/.test(form.pin) : true;

  async function finish() {
    setBusy(true);
    try {
      const res: any = await api.setup(form);
      useStore.setState({ user: res.user });
      setRecovery(res.recoveryCode ?? '');
      toast('راه‌اندازی کامل شد. کد بازیابی را یادداشت کنید.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'خطا در راه‌اندازی', 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--canvas)' }}>
      <div className="card w-full max-w-xl p-6">
        <div className="flex items-center gap-2 mb-5">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold" style={{ background: i <= step ? 'var(--brand)' : 'var(--edge)', color: i <= step ? 'var(--brand-ink)' : 'var(--muted)' }}>{toPersianDigits(i + 1)}</span>
              <span className="text-[12px]" style={{ color: i === step ? 'var(--ink)' : 'var(--muted)' }}>{s}</span>
              {i < steps.length - 1 ? <span className="w-6 h-px" style={{ background: 'var(--edge)' }} /> : null}
            </div>
          ))}
        </div>

        {step === 0 ? (
          <div>
            <h1 className="text-[20px] font-bold mb-2">به جیم‌پرو خوش آمدید</h1>
            <p className="text-[13px] leading-7 mb-3" style={{ color: 'var(--muted)' }}>
              سه مرحله کوتاه تا شروع کار: نام باشگاه، حساب مدیر، و تمام. همهٔ داده‌ها روی همین رایانه و بدون اینترنت ذخیره می‌شود.
            </p>
            <ul className="text-[13px] leading-7 pr-4 list-disc" style={{ color: 'var(--muted)' }}>
              <li>داده‌ای به اینترنت فرستاده نمی‌شود (تنها با اجازهٔ شما برای تیکت پشتیبانی).</li>
              <li>رمز مدیر را جایی امن نگه دارید؛ قابل بازیابی از اینترنت نیست.</li>
              <li>پشتیبان‌گیری خودکار روزانه فعال می‌شود.</li>
            </ul>
          </div>
        ) : null}

        {step === 1 ? (
          <div>
            <Field label="نام باشگاه" required>
              <TextInput value={form.clubName} onChange={(e) => setForm({ ...form, clubName: e.target.value })} placeholder="مثلاً باشگاه آرمان" autoFocus />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="تلفن">
                <TextInput value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" style={{ textAlign: 'right' }} />
              </Field>
              <Field label="نوع باشگاه">
                <select className="field" value={form.genderType} onChange={(e) => setForm({ ...form, genderType: e.target.value })} aria-label="نوع باشگاه">
                  <option value="mixed">خانوادگی</option>
                  <option value="men">آقایان</option>
                  <option value="women">بانوان</option>
                </select>
              </Field>
            </div>
            <Field label="نشانی">
              <TextInput value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
          </div>
        ) : null}

        {step === 2 ? (
          <div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="نام و نام خانوادگی مدیر" required>
                <TextInput value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} autoFocus />
              </Field>
              <Field label="نام کاربری" required hint="فقط حروف لاتین، رقم و . _ -">
                <TextInput value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.replace(/[^a-zA-Z0-9_.-]/g, '') })} dir="ltr" style={{ textAlign: 'right' }} />
              </Field>
              <Field label="رمز عبور" required hint="حداقل ۶ کاراکتر">
                <TextInput type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} dir="ltr" style={{ textAlign: 'right' }} />
              </Field>
              <Field label="PIN چهاررقمی" required hint="برای تأیید سریع عملیات">
                <TextInput value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 4) })} dir="ltr" style={{ textAlign: 'right' }} />
              </Field>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div>
            {recovery ? (
              <>
                <h2 className="font-bold mb-2">این کد بازیابی را یادداشت کنید</h2>
                <p className="text-[13px] leading-7 mb-3" style={{ color: 'var(--muted)' }}>
                  اگر روزی رمز عبور را فراموش کردی، تنها راه بازگشت به همین حساب، این کد است. آن را روی کاغذ بنویس و جای امن نگه دار —
                  فقط یک‌بار نمایش داده می‌شود و در برنامه قابل مشاهده نیست.
                </p>
                <div className="card p-3 flex items-center justify-between mb-3" dir="ltr">
                  <code className="text-[15px] font-bold tracking-widest">{recovery}</code>
                  <Button variant="ghost" onClick={() => { navigator.clipboard.writeText(recovery); toast('کپی شد'); }}>کپی</Button>
                </div>
                <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
                  بعداً می‌توانی از تنظیمات → کاربران، کد تازه بسازی (کد قبلی باطل می‌شود).
                </p>
              </>
            ) : (
              <>
                <h2 className="font-bold mb-2">همه‌چیز آماده است</h2>
                <p className="text-[13px] leading-7" style={{ color: 'var(--muted)' }}>
                  با زدن «شروع» حساب مدیر ساخته می‌شود و وارد داشبورد می‌شوید. دورهٔ آزمایشی ۱۴ روزه با تمام امکانات فعال است.
                </p>
              </>
            )}
          </div>
        ) : null}

        <div className="flex items-center justify-between mt-6">
          <Button variant="ghost" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0} icon={<ArrowRight size={15} />}>قبلی</Button>
          {step < 3 ? (
            <Button onClick={() => setStep(step + 1)} disabled={!canNext} icon={<ArrowLeft size={15} />}>بعدی</Button>
          ) : recovery ? (
            <Button onClick={onDone}>ورود به برنامه</Button>
          ) : (
            <Button onClick={finish} loading={busy}>شروع</Button>
          )}
        </div>
      </div>
      <Toasts />
    </div>
  );
}

/* ─────────────────────────── login ─────────────────────────── */

function Login({ onDone }: { onDone: () => void }) {
  const toast = useStore((s) => s.toast);
  const [username, setUsername] = useState(() => {
    try {
      return localStorage.getItem('gp.lastUser') ?? '';
    } catch {
      return '';
    }
  });
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res: any = await api.login({ username, password, remember });
      useStore.setState({ user: res.user });
      try {
        localStorage.setItem('gp.lastUser', username);
      } catch {
        /* ignore */
      }
      toast(remember ? 'خوش آمدید — تا ۳۰ روز بدون رمز وارد می‌شوید' : 'خوش آمدید');
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'ورود ناموفق', 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <div className="mb-5">
          <h1 className="text-[19px] font-bold">جیم‌پرو</h1>
          <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>نرم‌افزار مدیریت باشگاه — ورود</p>
        </div>
        <Field label="نام کاربری" required>
          <TextInput value={username} onChange={(e) => setUsername(e.target.value)} autoFocus dir="ltr" style={{ textAlign: 'right' }} />
        </Field>
        <Field label="رمز عبور" required>
          <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" style={{ textAlign: 'right' }} />
        </Field>
        <label className="flex items-center gap-2 text-[12.5px] mt-3 cursor-pointer" style={{ color: 'var(--muted)' }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          مرا به خاطر بسپار (۳۰ روز، روی همین دستگاه)
        </label>
        <Button type="submit" loading={busy} className="w-full mt-3">ورود</Button>
        <button type="button" onClick={() => setForgot(true)} className="w-full text-center text-[12px] mt-3" style={{ color: 'var(--brand)' }}>
          رمز عبور را فراموش کرده‌ام
        </button>
        <p className="text-[11.5px] mt-3" style={{ color: 'var(--muted)' }}>
          پس از ۵ تلاش ناموفق، حساب ۵ دقیقه قفل می‌شود.
        </p>
      </form>
      <ForgotPassword open={forgot} onClose={() => setForgot(false)} onDone={(u) => { setUsername(u); setForgot(false); }} />
      <Toasts />
    </div>
  );
}

/* ─────────────────────────── tour ─────────────────────────── */

const TOUR = [
  { title: 'سایدبار راست', body: 'از این‌جا بین بخش‌های برنامه جابه‌جا شوید. هر بخش مستقل است و فقط موارد مجازِ نقش شما را نشان می‌دهد.' },
  { title: 'ثبت عضو و قرارداد', body: 'ابتدا تعرفه بسازید، بعد عضو را ثبت و قرارداد را صادر کنید. تمدید همیشه به انتهای اعتبار فعلی اضافه می‌شود.' },
  { title: 'تردد با بارکدخوان', body: 'در هر صفحه‌ای که باشید، اسکن بارکد یا QR کارت عضو کار می‌کند. برای عضویت منقضی، دلیل ورود ارفاقی خواسته می‌شود.' },
  { title: 'میان‌برها', body: 'Ctrl+K جستجوی سراسری، F1 راهنما، F2 عضو جدید، F4 چک‌این. همه با کیبورد قابل استفاده‌اند.' },
];

function Tour({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const step = TOUR[i];
  return (
    <div className="fixed inset-0 z-[70] pointer-events-none">
      <div
        className="card w-full max-w-md p-5 pointer-events-auto absolute bottom-6 left-6"
        role="dialog"
        aria-modal="false"
        aria-label="تور آموزشی"
        style={{ boxShadow: '0 18px 50px -20px rgba(0,0,0,0.5)' }}
      >
        <p className="text-[11.5px] mb-1" style={{ color: 'var(--muted)' }}>گام {toPersianDigits(i + 1)} از {toPersianDigits(TOUR.length)}</p>
        <h3 className="font-bold text-[16px] mb-2">{step.title}</h3>
        <p className="text-[13px] leading-7 mb-4">{step.body}</p>
        <div className="flex justify-between">
          <Button variant="ghost" onClick={onDone}>رد کردن</Button>
          <Button onClick={() => (i === TOUR.length - 1 ? onDone() : setI(i + 1))}>{i === TOUR.length - 1 ? 'شروع کار' : 'بعدی'}</Button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── shell ─────────────────────────── */

export default function App() {
  const { user, setUser, view, setView, theme, toggleTheme, license, setLicense, toast, accent, setAccent, tint, setTint } = useStore();
  const [ready, setReady] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [tour, setTour] = useState(false);
  const [portableWarning, setPortableWarning] = useState(false);
  const scanBuffer = useRef({ text: '', last: 0 });

  useEffect(() => {
    initTheme();
    if (!hasApi()) {
      setReady(true);
      return;
    }
    (async () => {
      try {
        const boot: any = await api.bootstrap();
        setNeedsSetup(boot.usersCount === 0);
        setLicense(boot.license);
        if (boot.settings?.['ui.accent']) setAccent(boot.settings['ui.accent'], false);
        if (boot.settings?.['ui.tint'] === '0') setTint(false, false);
        if (boot.user) {
          // remembered session ("مرا به خاطر بسپار") — no password involved
          setUser(boot.user);
        } else if (boot.lastUsername) {
          try {
            localStorage.setItem('gp.lastUser', boot.lastUsername);
          } catch {
            /* ignore */
          }
        }
        if (boot.license?.status === 'trial') {
          try {
            if (!localStorage.getItem('gp.tourSeen')) setTour(true);
          } catch {
            /* ignore */
          }
        }
      } catch {
        setNeedsSetup(false);
      } finally {
        setReady(true);
      }
    })();
  }, [setLicense]);

  // hash routing
  useEffect(() => {
    const applyHash = () => {
      const key = (window.location.hash || '').replace('#/', '') as ViewKey;
      if (NAV.some((n) => n.key === key)) useStore.setState({ view: key });
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);

  // keyboard: F1 help, F2 new member, F4 attendance scan, F8 close cash
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        setView('help');
      } else if (e.key === 'F2' && user) {
        e.preventDefault();
        setView('members');
        window.dispatchEvent(new CustomEvent('gp:new-member'));
      } else if (e.key === 'F4' && user) {
        e.preventDefault();
        setView('attendance');
        window.dispatchEvent(new CustomEvent('gp:focus-scan'));
      } else if (e.key === 'F8' && user) {
        e.preventDefault();
        setView('finance');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setView, user]);

  // global HID barcode listener: fast keystrokes ending with Enter
  useEffect(() => {
    if (!user) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typingInField = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (e.key === 'Enter') {
        const buf = scanBuffer.current;
        const fast = Date.now() - buf.last < 300;
        if (buf.text.length >= 6 && fast) {
          const token = buf.text;
          scanBuffer.current = { text: '', last: 0 };
          api.checkin({ token, method: 'barcode' })
            .then((res: any) => {
              toast(`ورود ${res.memberName} ثبت شد${res.override ? ' (ارفاقی)' : ''}`);
              window.dispatchEvent(new CustomEvent('gp:scan', { detail: res }));
            })
            .catch((err) => toast(err.message, 'bad'));
          e.preventDefault();
        } else {
          scanBuffer.current = { text: '', last: 0 };
        }
        return;
      }
      if (typingInField && e.key.length > 1) return;
      if (e.key.length === 1) {
        const now = Date.now();
        const buf = scanBuffer.current;
        buf.text = now - buf.last > 250 ? e.key : buf.text + e.key;
        buf.last = now;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [user, toast]);

  const allowedNav = NAV.filter((n) => !n.roles || (user && n.roles.includes(user.role)));

  if (!hasApi()) {
    return (
      <div className="min-h-screen grid place-items-center p-8">
        <div className="card p-6 max-w-md text-center">
          <h1 className="font-bold text-[17px] mb-2">جیم‌پرو</h1>
          <p className="text-[13px] leading-7" style={{ color: 'var(--muted)' }}>
            این فایل رابط کاربری است و فقط داخل برنامهٔ دسکتاپ جیم‌پرو اجرا می‌شود. برای اجرا از فایل <code>GymPro.exe</code> استفاده کنید.
          </p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="flex items-center gap-3 text-[13px]" style={{ color: 'var(--muted)' }}>
          <Spinner size={18} /> در حال آماده‌سازی…
        </div>
      </div>
    );
  }

  if (needsSetup) return <SetupWizard onDone={() => { setNeedsSetup(false); setTour(true); }} />;
  if (!user) return <Login onDone={() => {}} />;

  return (
    <div className="h-screen flex overflow-hidden">
      <aside className="w-[212px] shrink-0 flex flex-col no-print surface-tint h-full" style={{ borderLeft: '1px solid var(--edge)' }}>
        <div className="px-4 py-4">
          <p className="font-bold text-[15px]">جیم‌پرو</p>
          <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
            {license ? (license.edition === 'trial' ? `آزمایشی — ${toPersianDigits(license.trialDaysLeft ?? 0)} روز` : 'لایسنس فعال') : ''}
          </p>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-2" aria-label="منوی اصلی">
          {allowedNav.map((n) => {
            const active = view === n.key;
            return (
              <button
                key={n.key}
                onClick={() => setView(n.key)}
                aria-current={active ? 'page' : undefined}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] mb-0.5 text-right"
                style={{ background: active ? 'color-mix(in srgb, var(--brand) 14%, transparent)' : 'transparent', color: active ? 'var(--brand)' : 'var(--ink)', fontWeight: active ? 700 : 500 }}
              >
                <n.icon size={16} />
                {n.label}
              </button>
            );
          })}
        </nav>
        <div className="p-2" style={{ borderTop: '1px solid var(--edge)' }}>
          <button
            onClick={() => {
              api.logout();
              setUser(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] rounded-lg"
            style={{ color: 'var(--bad)' }}
          >
            <LogOut size={15} /> خروج
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
        <header className="flex items-center justify-between px-5 py-3 no-print surface-tint shrink-0" style={{ borderBottom: '1px solid var(--edge)' }}>
          <div className="flex items-center gap-3">
            <h1 className="text-[15px] font-bold">{NAV.find((n) => n.key === view)?.label}</h1>
            {license?.status === 'trial' ? (
              <button onClick={() => setView('license')} className="chip" style={{ color: 'var(--warn)', borderColor: 'color-mix(in srgb, var(--warn) 40%, transparent)' }}>
                آزمایشی: {toPersianDigits(license.trialDaysLeft ?? 0)} روز
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <button className="btn btn-ghost px-2" onClick={toggleTheme} aria-label={theme === 'light' ? 'حالت تاریک' : 'حالت روشن'}>
              {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
            </button>
            <div className="text-[12px] pr-2" style={{ color: 'var(--muted)' }}>
              {user.fullName} · {user.role === 'owner' ? 'مالک' : user.role === 'manager' ? 'مدیر' : user.role === 'receptionist' ? 'منشی' : 'مربی'}
            </div>
          </div>
        </header>

        {portableWarning ? (
          <div className="px-5 py-2 text-[12.5px]" style={{ background: 'color-mix(in srgb, var(--warn) 14%, transparent)', color: 'var(--warn)' }}>
            پوشهٔ کنار فایل اجرایی قابل نوشتن نبود؛ داده‌ها در پوشهٔ کاربر ذخیره می‌شود.
          </div>
        ) : null}

        <div className="p-5 flex-1 min-h-0 overflow-y-auto">
          {view === 'dashboard' ? <Dashboard /> : null}
          {view === 'members' ? <Members /> : null}
          {view === 'contracts' ? <Contracts /> : null}
          {view === 'finance' ? <Finance /> : null}
          {view === 'attendance' ? <Attendance /> : null}
          {view === 'kiosk' ? <Kiosk /> : null}
          {view === 'pos' ? <Pos /> : null}
          {view === 'classes' ? <Classes /> : null}
          {view === 'lockers' ? <Lockers /> : null}
          {view === 'reports' ? <Reports /> : null}
          {view === 'support' ? <Support /> : null}
          {view === 'settings' ? <SettingsView onPortableWarning={setPortableWarning} /> : null}
          {view === 'license' ? <LicenseView /> : null}
          {view === 'help' ? <Help onStartTour={() => setTour(true)} /> : null}
        </div>
      </main>

      {tour ? <Tour onDone={() => { setTour(false); try { localStorage.setItem('gp.tourSeen', '1'); } catch { /* ignore */ } }} /> : null}
      <Toasts />
    </div>
  );
}
