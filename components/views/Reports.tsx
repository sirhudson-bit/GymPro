'use client';

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Download, Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Button, Empty, Row, Stat, Table } from '@/components/ui';
import { formatMoney, toPersianDigits, addDaysIso, compactMoney } from '@/lib/format';

export default function Reports() {
  const toast = useStore((s) => s.toast);
  const [monthly, setMonthly] = useState<any[]>([]);
  const [churn, setChurn] = useState<any>(null);
  const [dash, setDash] = useState<any>(null);

  useEffect(() => {
    const iso = new Date().toISOString().slice(0, 10);
    Promise.all([api.monthly(), api.churn(), api.dashboard(addDaysIso(iso, -30), iso)])
      .then(([m, c, d]) => {
        setMonthly((m as any[]).map((r: any) => ({ ...r, label: toPersianDigits(r.ym?.slice(2).replace('-', '/') ?? '') })));
        setChurn(c);
        setDash(d);
      })
      .catch((e) => toast(e.message, 'bad'));
  }, [toast]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 no-print">
        <Button variant="ghost" onClick={() => window.print()} icon={<Printer size={14} />}>چاپ گزارش</Button>
        <Button variant="ghost" onClick={async () => {
          try {
            const res: any = await api.exportMembersCsv();
            toast(`فایل ساخته شد: ${res.file}`);
          } catch (e: any) { toast(e.message, 'bad'); }
        }} icon={<Download size={14} />}>خروجی اکسل (CSV) اعضا</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="درآمد ۳۰ روز" value={formatMoney(dash?.revenue)} hint="ریال" />
        <Stat label="سود" value={formatMoney(dash?.profit)} tone={(dash?.profit ?? 0) >= 0 ? 'ok' : 'bad'} />
        <Stat label="نرخ ریزش" value={`${toPersianDigits(churn?.churnRate ?? 0)}٪`} tone="warn" hint={`${toPersianDigits(churn?.expired ?? 0)} قرارداد منقضی`} />
        <Stat label="نرخ تمدید" value={`${toPersianDigits(churn?.renewalRate ?? 0)}٪`} tone="ok" hint={`${toPersianDigits(churn?.renewed ?? 0)} تمدیدشده`} />
      </div>

      <div className="card p-4">
        <h2 className="font-bold text-[14px] mb-3">درآمد ماهانه (۶ ماه اخیر)</h2>
        <div style={{ height: 260 }} dir="ltr">
          {monthly.length === 0 ? (
            <Empty title="داده‌ای برای نمایش نیست" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[...monthly].reverse()}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--edge)" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} width={62} tickFormatter={(v: any) => compactMoney(v)} />
                <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--edge)', borderRadius: 10, fontSize: 12 }} formatter={(v: any) => [formatMoney(v), 'ریال']} />
                <Bar dataKey="total" fill="var(--brand)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card p-4">
          <h2 className="font-bold text-[14px] mb-2">جمع‌بندی مالی (۳۰ روز)</h2>
          <Row label="درآمد عضویت" value={`${formatMoney(dash?.membershipRevenue)} ریال`} />
          <Row label="درآمد بوفه" value={`${formatMoney(dash?.posRevenue)} ریال`} />
          <Row label="هزینه‌ها" value={`${formatMoney(dash?.expenses)} ریال`} />
          <Row label="سود خالص" value={<span style={{ color: (dash?.profit ?? 0) >= 0 ? 'var(--ok)' : 'var(--bad)' }}>{formatMoney(dash?.profit)} ریال</span>} />
        </div>
        <div className="card p-4">
          <h2 className="font-bold text-[14px] mb-2">شاخص‌های باشگاه</h2>
          <Row label="اعضا" value={toPersianDigits(dash?.memberCount ?? 0)} />
          <Row label="قرارداد فعال" value={toPersianDigits(dash?.activeContracts ?? 0)} />
          <Row label="تردد (۳۰ روز)" value={toPersianDigits(dash?.checkins ?? 0)} />
          <Row label="کالاهای رو به اتمام" value={toPersianDigits(dash?.lowStock ?? 0)} />
        </div>
      </div>

      <div className="card p-4">
        <h2 className="font-bold text-[14px] mb-2">توضیح روش محاسبه</h2>
        <p className="text-[12.5px] leading-7" style={{ color: 'var(--muted)' }}>
          نرخ ریزش = قراردادهای منقضی ÷ کل قراردادها. نرخ تمدید = اعضایی که بیش از یک قرارداد دارند ÷ کل قراردادهای فعال.
          درآمد فقط از پرداخت‌های «ثبت‌شده» محاسبه می‌شود؛ پرداخت‌های باطل‌شده در محاسبه نمی‌آیند.
        </p>
      </div>
    </div>
  );
}
