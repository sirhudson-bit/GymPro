'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, ShieldCheck, ShieldOff } from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Badge, Button, Confirm, Empty, Field, Row, Section, TextArea, TextInput } from '@/components/ui';
import { formatJalali, toPersianDigits } from '@/lib/format';

export default function License() {
  const toast = useStore((s) => s.toast);
  const setLicense = useStore((s) => s.setLicense);
  const [status, setStatus] = useState<any>(null);
  const [json, setJson] = useState('');
  const [signature, setSignature] = useState('');
  const [confirmOff, setConfirmOff] = useState(false);

  const load = useCallback(async () => {
    try {
      const s: any = await api.licenseStatus();
      setStatus(s);
      setLicense(s);
    } catch (e: any) {
      toast(e.message, 'bad');
    }
  }, [toast, setLicense]);

  useEffect(() => {
    load();
  }, [load]);

  if (!status) return <Empty title="در حال خواندن وضعیت لایسنس…" />;

  const tone = status.status === 'active' ? 'ok' : status.status === 'trial' ? 'warn' : 'bad';
  const label = status.status === 'active' ? 'لایسنس دائمی فعال' : status.status === 'trial' ? 'دورهٔ آزمایشی' : status.status === 'expired' ? 'دورهٔ آزمایشی تمام‌شده' : 'نیازمند بررسی';

  return (
    <div>
      <div className="card p-4 mb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-[15px] flex items-center gap-2">
              <ShieldCheck size={17} style={{ color: `var(--${tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : 'bad'})` }} />
              {label}
            </h2>
            <p className="text-[12.5px] mt-1" style={{ color: 'var(--muted)' }}>{status.message}</p>
          </div>
          <Badge tone={tone as any}>{status.edition === 'trial' ? 'آزمایشی' : status.edition.toUpperCase()}</Badge>
        </div>
        <div className="mt-3 grid md:grid-cols-2 gap-x-6">
          <Row label="شناسهٔ دستگاه" value={<span dir="ltr" className="text-[11.5px]">{status.machineId}</span>} />
          <Row label="اعضای ثبت‌شده" value={toPersianDigits(status.membersUsed)} />
          {status.status === 'trial' ? <Row label="روزهای باقی‌مانده" value={toPersianDigits(status.trialDaysLeft)} /> : null}
          <Row label="اشتراک آپدیت" value={status.updateEntitlementUntil ? `${formatJalali(status.updateEntitlementUntil)} (${toPersianDigits(status.updateDaysLeft)} روز)` : '—'} />
        </div>
        <div className="flex gap-2 mt-3">
          <Button variant="ghost" icon={<Copy size={14} />} onClick={() => { navigator.clipboard.writeText(status.machineId); toast('شناسهٔ دستگاه کپی شد'); }}>
            کپی شناسهٔ دستگاه
          </Button>
          {status.status === 'active' ? (
            <Button variant="ghost" icon={<ShieldOff size={14} />} onClick={() => setConfirmOff(true)}>غیرفعال‌سازی این دستگاه</Button>
          ) : null}
        </div>
      </div>

      <Section title="فعال‌سازی لایسنس">
        <p className="text-[12.5px] mb-3 leading-7" style={{ color: 'var(--muted)' }}>
          پس از خرید، دو مقدار «بدنهٔ لایسنس» و «امضا» را از ایمیل/پیام فروشنده دریافت می‌کنید. فعال‌سازی کاملاً آفلاین انجام می‌شود و برای اجرای برنامه به اینترنت نیاز نیست.
        </p>
        <Field label="بدنهٔ لایسنس (JSON)" required hint="شامل licenseKey، machineId، edition، features و تاریخ‌ها">
          <TextArea value={json} onChange={setJson} rows={6} placeholder='{"licenseKey":"GP-...","machineId":"...","edition":"pro",...}' />
        </Field>
        <Field label="امضای Ed25519 (Base64)" required>
          <TextInput value={signature} onChange={(e) => setSignature(e.target.value)} dir="ltr" style={{ textAlign: 'right' }} />
        </Field>
        <Button icon={<KeyRound size={14} />} onClick={async () => {
          try {
            const s: any = await api.activateLicense({ licenseJson: json, signature });
            setStatus(s);
            setLicense(s);
            toast('لایسنس فعال شد');
          } catch (e: any) {
            toast(e.message, 'bad');
          }
        }}>فعال‌سازی</Button>
      </Section>

      <Section title="این لایسنس دقیقاً چه می‌کند؟" defaultOpen={false}>
        <ul className="text-[12.5px] leading-7 pr-4 list-disc" style={{ color: 'var(--muted)' }}>
          <li>لایسنس <b>دائمی</b> است: پس از فعال‌سازی، برنامه برای همیشه کار می‌کند، حتی بدون اینترنت.</li>
          <li>«اشتراک آپدیت» جداست: پس از پایان آن، برنامه متوقف نمی‌شود؛ فقط نسخهٔ جدید نمی‌گیرید.</li>
          <li>اگر ساعت سیستم را به عقب ببرید، برنامه وارد حالت احتیاطی می‌شود — <b>هیچ داده‌ای حذف نمی‌شود</b> و می‌توانید پشتیبان بگیرید.</li>
          <li>با «غیرفعال‌سازی این دستگاه» یک اسلات آزاد می‌شود تا روی رایانهٔ دیگری فعال کنید.</li>
        </ul>
      </Section>

      <Confirm
        open={confirmOff}
        danger
        title="غیرفعال‌سازی لایسنس روی این دستگاه"
        message="پس از این کار، برنامه فقط با لایسنس جدید یا دورهٔ آزمایشی کار می‌کند. داده‌های باشگاه حذف نمی‌شوند و قابل پشتیبان‌گیری هستند. ادامه می‌دهید؟"
        confirmLabel="غیرفعال کن"
        onClose={() => setConfirmOff(false)}
        onConfirm={async () => {
          setConfirmOff(false);
          try {
            const s: any = await api.deactivateLicense();
            setStatus(s);
            setLicense(s);
            toast('لایسنس این دستگاه غیرفعال شد');
          } catch (e: any) {
            toast(e.message, 'bad');
          }
        }}
      />
    </div>
  );
}
