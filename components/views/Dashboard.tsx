'use client';

import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from 'recharts';
import { Users, Wallet, Activity, AlertTriangle, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Stat, Table, Badge, Empty, Button } from '@/components/ui';
import { formatMoney, formatJalali, toPersianDigits, addDaysIso, daysLeftLabel, compactMoney } from '@/lib/format';

export default function Dashboard() {
  const toast = useStore((s) => s.toast);
  const setView = useStore((s) => s.setView);
  const [data, setData] = useState<any>(null);
  const [series, setSeries] = useState<any[]>([]);
  const [hourly, setHourly] = useState<any[]>([]);

  useEffect(() => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    Promise.all([api.dashboard(addDaysIso(iso, -30), iso), api.series(30), api.attendanceHourly()])
      .then(([d, s, h]) => {
        setData(d);
        setSeries((s as any[]).map((r: any) => ({ ...r, label: formatJalali(r.date) })));
        setHourly((h as any[]).map((r: any) => ({ ...r, label: `${toPersianDigits(r.hour)}:۰۰` })));
      })
      .catch((e) => toast(e.message, 'bad'));
  }, [toast]);

  if (!data) return <Empty title="در حال بارگذاری داشبورد…" />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="درآمد ۳۰ روز"
          value={formatMoney(data.revenue)}
          hint="ریال"
          icon={<Wallet size={14} />}
          bars={series.map((r: any) => r.amount)}
        />
        <Stat
          label="سود خالص"
          value={formatMoney(data.profit)}
          tone={data.profit >= 0 ? 'ok' : 'bad'}
          hint={`هزینه: ${formatMoney(data.expenses)}`}
          icon={<Activity size={14} />}
          trend={data.revenue > 0 ? { dir: data.profit >= 0 ? 'up' : 'down', text: data.profit >= 0 ? 'سودده' : 'زیان‌ده' } : undefined}
        />
        <Stat label="اعضای فعال" value={toPersianDigits(data.memberCount)} hint={`${toPersianDigits(data.activeContracts)} قرارداد فعال`} icon={<Users size={14} />} />
        <Stat label="حاضرین امروز" value={toPersianDigits(data.present)} hint={`${toPersianDigits(data.checkins)} تردد در ۳۰ روز`} icon={<Activity size={14} />} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-[14px]">روند درآمد (۳۰ روز)</h2>
            <Badge tone="brand">ریال</Badge>
          </div>
          <div style={{ height: 220 }} dir="ltr">
            {series.length === 0 ? (
              <Empty title="هنوز پرداختی ثبت نشده" hint="با ثبت اولین قرارداد، نمودار فعال می‌شود." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--edge)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--muted)' }} interval={Math.max(0, Math.floor(series.length / 6))} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} width={62} tickFormatter={(v: any) => compactMoney(v)} />
                  <Tooltip
                    contentStyle={{ background: 'var(--panel)', border: '1px solid var(--edge)', borderRadius: 10, fontSize: 12 }}
                    formatter={(v: any) => [formatMoney(v), 'ریال']}
                  />
                  <Line type="monotone" dataKey="amount" stroke="var(--brand)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="card p-4">
          <h2 className="font-bold text-[14px] mb-3">شلوغی ساعات امروز</h2>
          <div style={{ height: 220 }} dir="ltr">
            {hourly.length === 0 ? (
              <Empty title="امروز ترددی ثبت نشده" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourly} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barCategoryGap="24%">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--edge)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--muted)' }} interval={0} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} width={30} allowDecimals={false} tickFormatter={(v: any) => toPersianDigits(v)} />
                  <Tooltip
                    contentStyle={{ background: 'var(--panel)', border: '1px solid var(--edge)', borderRadius: 10, fontSize: 12 }}
                    formatter={(v: any) => [`${toPersianDigits(v)} نفر`, 'تردد']}
                  />
                  <Bar dataKey="count" fill="var(--brand)" radius={[4, 4, 0, 0]} maxBarSize={34} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-[14px] flex items-center gap-1.5">
              <AlertTriangle size={15} style={{ color: 'var(--warn)' }} /> انقضای نزدیک (۷ روز)
            </h2>
            <Button variant="ghost" onClick={() => setView('contracts')} icon={<ArrowLeft size={14} />}>همهٔ قراردادها</Button>
          </div>
          <Table head={['عضو', 'موبایل', 'پایان', 'وضعیت']} empty={(data.expiring ?? []).length === 0}>
            {(data.expiring ?? []).map((r: any) => {
              const d = daysLeftLabel(r.endDate);
              return (
                <tr key={r.id}>
                  <td className="td font-semibold">{r.memberName}</td>
                  <td className="td tabular-nums" dir="ltr" style={{ textAlign: 'right' }}>{toPersianDigits(r.memberMobile ?? '')}</td>
                  <td className="td">{formatJalali(r.endDate)}</td>
                  <td className="td"><Badge tone={d.tone === 'ok' ? 'ok' : d.tone === 'warn' ? 'warn' : 'bad'}>{d.text}</Badge></td>
                </tr>
              );
            })}
          </Table>
        </div>

        <div>
          <h2 className="font-bold text-[14px] mb-2 flex items-center gap-1.5">
            <Activity size={15} style={{ color: 'var(--brand)' }} /> وضعیت عملیاتی
          </h2>
          <div className="card p-4 space-y-2 text-[13px]">
            <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>کالاهای رو به اتمام</span><span className="font-bold">{toPersianDigits(data.lowStock)}</span></div>
            <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>درآمد عضویت (۳۰ روز)</span><span className="font-bold">{formatMoney(data.membershipRevenue)}</span></div>
            <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>درآمد بوفه (۳۰ روز)</span><span className="font-bold">{formatMoney(data.posRevenue)}</span></div>
            <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>هزینه‌ها</span><span className="font-bold" style={{ color: 'var(--bad)' }}>{formatMoney(data.expenses)}</span></div>
            <div className="pt-2 grid grid-cols-2 gap-2">
              <Button variant="ghost" onClick={() => setView('members')} icon={<Users size={14} />}>عضو جدید</Button>
              <Button variant="ghost" onClick={() => setView('finance')} icon={<Wallet size={14} />}>صندوق</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
