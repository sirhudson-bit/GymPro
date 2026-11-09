'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Inbox, Plus, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Badge, Button, Empty, Field, Modal, Select, Table, TextArea, TextInput } from '@/components/ui';
import { formatJalali, toPersianDigits } from '@/lib/format';

const STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' | 'brand' }> = {
  draft: { label: 'پیش‌نویس (آفلاین)', tone: 'neutral' },
  queued: { label: 'در صف ارسال', tone: 'warn' },
  sent: { label: 'ارسال‌شده', tone: 'brand' },
  answered: { label: 'پاسخ داده شد', tone: 'ok' },
  closed: { label: 'بسته‌شده', tone: 'neutral' },
};

const CATEGORY: Record<string, string> = {
  install: 'نصب و راه‌اندازی',
  license: 'لایسنس',
  billing: 'مالی و خرید',
  bug: 'خطای نرم‌افزار',
  howto: 'راهنمای استفاده',
  data: 'داده‌ها و پشتیبان',
  other: 'سایر',
};

export default function Support() {
  const toast = useStore((s) => s.toast);
  const [tickets, setTickets] = useState<any[]>([]);
  const [open, setOpen] = useState<any | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [reply, setReply] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ category: 'bug', subject: '', body: '' });

  const load = useCallback(async () => {
    try {
      setTickets((await api.tickets()) as any[]);
    } catch (e: any) {
      toast(e.message, 'bad');
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function openTicket(t: any) {
    setOpen(t);
    try {
      setMessages((await api.ticketMessages(t.id)) as any[]);
    } catch (e: any) {
      toast(e.message, 'bad');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
          تیکت را می‌توانید بدون اینترنت ثبت کنید؛ به‌محض اتصال، خودکار ارسال می‌شود.
        </p>
        <div className="flex-1" />
        <Button variant="ghost" onClick={load}>بازخوانی</Button>
        <Button onClick={() => setCreating(true)} icon={<Plus size={15} />}>تیکت جدید</Button>
      </div>

      <Table head={['موضوع', 'دسته', 'وضعیت', 'آخرین به‌روزرسانی', '']} empty={tickets.length === 0}>
        {tickets.map((t) => (
          <tr key={t.id}>
            <td className="td font-semibold">
              {t.subject}
              {t.unread_count > 0 ? <Badge tone="bad"> {toPersianDigits(t.unread_count)} پاسخ جدید</Badge> : null}
            </td>
            <td className="td">{CATEGORY[t.category] ?? t.category}</td>
            <td className="td"><Badge tone={STATUS[t.status]?.tone ?? 'neutral'}>{STATUS[t.status]?.label ?? t.status}</Badge></td>
            <td className="td">{formatJalali(t.last_message_at ?? t.created_at, { withTime: true })}</td>
            <td className="td"><Button variant="ghost" onClick={() => openTicket(t)} icon={<Inbox size={13} />}>گفت‌وگو</Button></td>
          </tr>
        ))}
      </Table>

      <Modal open={creating} onClose={() => setCreating(false)} title="تیکت پشتیبانی" wide footer={<><Button variant="ghost" onClick={() => setCreating(false)}>انصراف</Button>
        <Button icon={<Send size={14} />} onClick={async () => {
          try {
            await api.createTicket({ category: form.category, priority: 'normal', subject: form.subject, body: form.body });
            toast('تیکت ثبت شد');
            setCreating(false);
            setForm({ category: 'bug', subject: '', body: '' });
            load();
          } catch (e: any) { toast(e.message, 'bad'); }
        }}>ثبت تیکت</Button></>}>
        <div className="rounded-lg p-2 mb-3 text-[12px] flex gap-2" style={{ background: 'color-mix(in srgb, var(--warn) 12%, transparent)', color: 'var(--warn)' }}>
          <AlertTriangle size={15} />
          اطلاعات شخصی اعضا (نام، موبایل، کد ملی) را در متن تیکت ننویسید. برای بررسی خطا، فقط متن خطا و نسخهٔ برنامه کافی است.
        </div>
        <Field label="دسته‌بندی" required>
          <Select value={form.category} onChange={(v) => setForm({ ...form, category: v })} ariaLabel="دسته‌بندی تیکت" options={Object.entries(CATEGORY).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="موضوع" required><TextInput value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
        <Field label="شرح مشکل" required hint="چه کاری کردید، چه اتفاقی افتاد، چه انتظاری داشتید">
          <TextArea value={form.body} onChange={(v) => setForm({ ...form, body: v })} rows={6} />
        </Field>
      </Modal>

      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={open?.subject ?? ''} wide footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(null)}>بستن</Button>
          <Button
            icon={<Send size={14} />}
            onClick={async () => {
              try {
                await api.replyTicket({ ticketId: open.id, body: reply });
                setReply('');
                setMessages((await api.ticketMessages(open.id)) as any[]);
                toast('پاسخ ثبت شد (در اولین اتصال ارسال می‌شود)');
                load();
              } catch (e: any) { toast(e.message, 'bad'); }
            }}
          >
            ارسال پاسخ
          </Button>
        </>
      }>
        <div className="max-h-80 overflow-y-auto space-y-2 mb-3">
          {messages.map((m) => (
            <div key={m.id} className="text-[12.5px] p-2 rounded-lg" style={{ background: m.direction === 'in' ? 'color-mix(in srgb, var(--brand) 10%, transparent)' : 'var(--canvas)' }}>
              <div className="flex justify-between text-[11px] mb-1" style={{ color: 'var(--muted)' }}>
                <span>{m.direction === 'in' ? 'پشتیبانی' : 'شما'}</span>
                <span>{formatJalali(m.sent_at ?? m.received_at ?? m.created_at, { withTime: true })}</span>
              </div>
              <p className="whitespace-pre-wrap leading-6">{m.body}</p>
            </div>
          ))}
          {messages.length === 0 ? <Empty title="پیامی نیست" /> : null}
        </div>
        <Field label="پاسخ شما">
          <TextArea value={reply} onChange={setReply} rows={3} />
        </Field>
      </Modal>
    </div>
  );
}
