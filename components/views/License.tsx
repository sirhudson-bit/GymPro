'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, ShieldCheck, ShieldOff, Wifi } from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Badge, Button, Confirm, Empty, Field, Row, Section, TextArea, TextInput } from '@/components/ui';
import { formatJalali, toPersianDigits } from '@/lib/format';

// همان برچسب‌هایی که پنل مدیریت لایسنس نشان می‌دهد — دو طرف باید یک چیز بگویند.
const EDITION_LABEL: Record<string, string> = { basic: 'پایه', pro: 'حرفه‌ای', enterprise: 'سازمانی', trial: 'آزمایشی' };
const FEATURE_LABEL: Record<string, string> = {
  core: 'هستهٔ باشگاه',
  pos: 'بوفه',
  kiosk: 'کیوسک',
  reports: 'گزارش‌ها',
  support: 'پشتیبانی',
  sms: 'پیامک',
  multi_branch: 'چندشعبه',
};
const DEFAULT_SERVER = 'https://gym.academyr.ir';

export default function License() {
  const toast = useStore((s) => s.toast);
  const setLicense = useStore((s) => s.setLicense);
  const [status, setStatus] = useState<any>(null);
  const [key, setKey] = useState('');
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER);
  const [busy, setBusy] = useState(false);
  const [json, setJson] = useState('');
  const [signature, setSignature] = useState('');
  const [confirmOff, setConfirmOff] = useState(false);

  const load = useCallback(async () => {
    try {
      const s: any = await api.licenseStatus();
      setStatus(s);
      setLicense(s);
      const all: any = await api.settingsAll().catch(() => ({}));
      if (all?.['license.server']) setServerUrl(all['license.server']);
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
  const features: string[] = Array.isArray(status.features) ? status.features : [];

  async function activateOnline() {
    const cleaned = key.trim().toUpperCase();
    if (!cleaned) {
      toast('کلید لایسنس را وارد کنید', 'bad');
      return;
    }
    setBusy(true);
    try {
      const s: any = await api.activateLicenseOnline({ licenseKey: cleaned, serverUrl: serverUrl.trim() || DEFAULT_SERVER });
      setStatus(s);
      setLicense(s);
      setKey('');
      toast('لایسنس روی این دستگاه فعال شد');
    } catch (e: any) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

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
          <Badge tone={tone as any}>{EDITION_LABEL[String(status.edition)] ?? String(status.edition)}</Badge>
        </div>
        <div className="mt-3 grid md:grid-cols-2 gap-x-6">
          <Row label="کلید لایسنس" value={<span dir="ltr" className="text-[11.5px]">{status.licenseKey ?? '—'}</span>} />
          <Row label="نسخه" value={EDITION_LABEL[String(status.edition)] ?? String(status.edition)} />
          <Row
            label="دستگاه‌های فعال"
            value={status.status === 'active' ? `${toPersianDigits(status.activationsUsed ?? 1)} از ${toPersianDigits(status.maxActivations ?? 1)}` : '—'}
          />
          <Row label="شناسهٔ دستگاه" value={<span dir="ltr" className="text-[11.5px]">{status.machineId}</span>} />
          <Row label="اعضای ثبت‌شده" value={toPersianDigits(status.membersUsed)} />
          {status.status === 'trial' ? <Row label="روزهای باقی‌مانده" value={toPersianDigits(status.trialDaysLeft)} /> : null}
          <Row label="اشتراک آپدیت" value={status.updateEntitlementUntil ? `${formatJalali(status.updateEntitlementUntil)} (${toPersianDigits(status.updateDaysLeft)} روز)` : '—'} />
          {status.buyer ? <Row label="خریدار" value={status.buyer} /> : null}
          {status.issuedAt ? <Row label="تاریخ صدور" value={formatJalali(status.issuedAt)} /> : null}
        </div>
        {features.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[12px]" style={{ color: 'var(--muted)' }}>ویژگی‌های این نسخه:</span>
            {features.map((f) => (
              <span key={f} className="chip text-[11.5px]">{FEATURE_LABEL[f] ?? f}</span>
            ))}
          </div>
        ) : null}
        <div className="flex gap-2 mt-3">
          <Button variant="ghost" icon={<Copy size={14} />} onClick={() => { navigator.clipboard.writeText(status.machineId); toast('شناسهٔ دستگاه کپی شد'); }}>
            کپی شناسهٔ دستگاه
          </Button>
          {status.status === 'active' ? (
            <Button variant="ghost" icon={<ShieldOff size={14} />} onClick={() => setConfirmOff(true)}>غیرفعال‌سازی این دستگاه</Button>
          ) : null}
        </div>
      </div>

      <Section title="فعال‌سازی با کلید لایسنس">
        <p className="text-[12.5px] mb-3 leading-7" style={{ color: 'var(--muted)' }}>
          همان کلیدی که در پنل مدیریت لایسنس ساخته شده (مثل <span dir="ltr">GP-7K2M-9XQA-B3TD</span>) را اینجا بگذارید. این مرحله فقط یک بار به اینترنت نیاز دارد؛ بعد از آن برنامه کاملاً آفلاین کار می‌کند.
        </p>
        <div className="grid md:grid-cols-[1fr_auto] gap-2 items-end">
          <Field label="کلید لایسنس" required hint="حروف بزرگ/کوچک مهم نیست">
            <TextInput value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="GP-XXXX-XXXX-XXXX" dir="ltr" style={{ textAlign: 'right' }} onKeyDown={(e) => e.key === 'Enter' && activateOnline()} />
          </Field>
          <Button icon={<Wifi size={14} />} onClick={activateOnline} disabled={busy}>
            {busy ? 'در حال فعال‌سازی…' : 'فعال‌سازی'}
          </Button>
        </div>
        <Field label="آدرس سرور لایسنس" hint="فقط اگر سرور شما جای دیگری است تغییر دهید">
          <TextInput value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder={DEFAULT_SERVER} dir="ltr" style={{ textAlign: 'right' }} />
        </Field>
      </Section>

      <Section title="فعال‌سازی دستی (بدون اینترنت)" defaultOpen={false}>
        <p className="text-[12.5px] mb-3 leading-7" style={{ color: 'var(--muted)' }}>
          اگر رایانه به اینترنت وصل نیست، دو مقدار «بدنهٔ لایسنس» و «امضا» را از فروشنده بگیرید و اینجا جای‌گذاری کنید.
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
        }}>فعال‌سازی دستی</Button>
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
