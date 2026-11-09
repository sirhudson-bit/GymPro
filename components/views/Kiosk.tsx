'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, ScanLine } from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { TextInput } from '@/components/ui';
import { toPersianDigits, formatJalali } from '@/lib/format';

type Result = { ok: boolean; name?: string; message: string; endDate?: string; sessionsLeft?: number | null };

export default function Kiosk() {
  const toast = useStore((s) => s.toast);
  const [value, setValue] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [clock, setClock] = useState(new Date());
  const inputRef = useRef<HTMLInputElement>(null);
  const isKioskWindow = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('kiosk') === '1';

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    inputRef.current?.focus();
    const onScan = () => inputRef.current?.focus();
    window.addEventListener('gp:scan', onScan);
    return () => {
      clearInterval(t);
      window.removeEventListener('gp:scan', onScan);
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const token = value.trim();
    if (!token) return;
    setValue('');
    try {
      const res: any = await api.checkin({ token, method: 'kiosk' });
      setResult({ ok: true, name: res.memberName, message: res.override ? 'ورود ثبت شد (ارفاقی)' : 'خوش آمدید', endDate: res.endDate, sessionsLeft: res.sessionsLeft });
      try {
        const ctx = new AudioContext();
        const o = ctx.createOscillator();
        o.frequency.value = 880;
        o.connect(ctx.destination);
        o.start();
        setTimeout(() => { o.stop(); ctx.close(); }, 120);
      } catch { /* صدا اختیاری است */ }
    } catch (err: any) {
      setResult({ ok: false, message: err.message });
    }
    setTimeout(() => inputRef.current?.focus(), 50);
    setTimeout(() => setResult(null), 6000);
  }

  return (
    <div className="card p-8 text-center" style={{ minHeight: '70vh' }}>
      <p className="text-[40px] font-bold tabular-nums" style={{ color: 'var(--brand)' }}>
        {toPersianDigits(clock.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }))}
      </p>
      <p className="text-[13px] mb-6" style={{ color: 'var(--muted)' }}>{formatJalali(new Date().toISOString(), { withMonthName: true })}</p>

      {!result ? (
        <>
          <ScanLine size={46} style={{ color: 'var(--muted)', margin: '0 auto 10px' }} />
          <h2 className="text-[18px] font-bold">کارت عضویت خود را اسکن کنید</h2>
          <p className="text-[12.5px] mt-1 mb-5" style={{ color: 'var(--muted)' }}>بارکد یا QR را روی دستگاه بگیرید</p>
        </>
      ) : (
        <div className="mb-4">
          {result.ok ? <CheckCircle2 size={54} style={{ color: 'var(--ok)', margin: '0 auto' }} /> : <XCircle size={54} style={{ color: 'var(--bad)', margin: '0 auto' }} />}
          <p className="text-[24px] font-bold mt-3">{result.ok ? result.name : 'ورود ممکن نیست'}</p>
          <p className="text-[13px] mt-1" style={{ color: result.ok ? 'var(--ok)' : 'var(--bad)' }}>{result.message}</p>
          {result.ok && result.endDate ? (
            <p className="text-[12px] mt-1" style={{ color: 'var(--muted)' }}>
              اعتبار تا {formatJalali(result.endDate)}{result.sessionsLeft != null ? ` — ${toPersianDigits(result.sessionsLeft)} جلسه باقی` : ''}
            </p>
          ) : null}
        </div>
      )}

      <form onSubmit={submit} className="max-w-sm mx-auto mt-4">
        <TextInput ref={inputRef as any} value={value} onChange={(e) => setValue(e.target.value)} placeholder="کد کارت" autoFocus dir="ltr" style={{ textAlign: 'center', letterSpacing: 2 }} aria-label="کد کارت عضویت" />
      </form>

      <p className="text-[11.5px] mt-8" style={{ color: 'var(--muted)' }}>
        {isKioskWindow
          ? 'این پنجره مخصوص نمایشگر ورودی است. برای بستن: Alt+F4 (یا دکمهٔ پایین).'
          : 'این حالت برای نمایشگر ورودی باشگاه است؛ می‌توانید آن را روی نمایشگر دوم باز کنید.'}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
        {isKioskWindow ? (
          <button className="btn btn-ghost" onClick={() => window.close()}>بستن پنجرهٔ کیوسک</button>
        ) : (
          <>
            <button
              className="btn"
              onClick={async () => {
                try {
                  await api.openKioskWindow();
                  toast('پنجرهٔ کیوسک باز شد — آن را به نمایشگر دوم بکشید');
                } catch (e: any) {
                  toast(e.message, 'bad');
                }
              }}
            >
              نمایش روی نمایشگر دوم
            </button>
            <button className="btn btn-ghost" onClick={() => history.back()}>بازگشت</button>
          </>
        )}
      </div>
      <div className="max-w-md mx-auto mt-6 text-right text-[11.5px] leading-6 p-3 rounded-xl no-print" style={{ background: 'var(--brand-wash)', border: '1px solid var(--brand-line)' }}>
        <p className="font-bold mb-1 text-[12px]">راه‌اندازی حالت کیوسک</p>
        <p>۱) اسکنر را به USB بزنید (بارکدخوان HID یا اسکنر دوبعدی برای QR).</p>
        <p>۲) «نمایش روی نمایشگر دوم» را بزنید؛ پنجرهٔ تازه بدون منو باز می‌شود.</p>
        <p>۳) پنجره را با کشیدن به نمایشگر دوم ببرید و F11 بزنید تا تمام‌صفحه شود.</p>
        <p style={{ color: 'var(--muted)' }}>بستن: Alt+F4 — ورود دستی هم ممکن است: شمارهٔ عضویت را تایپ و Enter بزنید.</p>
      </div>
    </div>
  );
}
