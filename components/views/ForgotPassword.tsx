'use client';

import { useState } from 'react';
import { Copy, KeyRound, LifeBuoy, ShieldQuestion } from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Button, Field, Modal, TextArea, TextInput } from '@/components/ui';

type Tab = 'code' | 'token' | 'help';

export default function ForgotPassword({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (username: string) => void }) {
  const toast = useStore((s) => s.toast);
  const [tab, setTab] = useState<Tab>('code');
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [signature, setSignature] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);

  function validate(): string | null {
    if (!username.trim()) return 'نام کاربری را وارد کنید';
    if (password.length < 6) return 'رمز جدید حداقل ۶ کاراکتر باشد';
    if (password !== repeat) return 'رمز جدید و تکرار آن یکسان نیست';
    if (tab === 'code' && code.replace(/[^A-Za-z0-9]/g, '').length < 20) return 'کد بازیابی ۲۰ کاراکتر است (مثل K7QM-3XPD-9RTB-W2HN-5JVC)';
    if (tab === 'token' && (token.trim().length < 10 || signature.trim().length < 10)) return 'متن توکن و امضا را کامل وارد کنید';
    return null;
  }

  async function submit() {
    const error = validate();
    if (error) {
      toast(error, 'bad');
      return;
    }
    setBusy(true);
    try {
      if (tab === 'code') {
        const res: any = await api.resetWithCode({ username: username.trim(), code, newPassword: password });
        setNewCode(res.recoveryCode);
        toast('رمز تغییر کرد. کد بازیابی جدید را یادداشت کنید.');
      } else {
        await api.resetWithToken({ username: username.trim(), token, signature, newPassword: password });
        toast('رمز با توکن پشتیبانی تغییر کرد. حالا وارد شوید.');
        onDone(username.trim());
        onClose();
      }
    } catch (e: any) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    toast('کپی شد');
  }

  return (
    <Modal open={open} onClose={onClose} title="بازیابی رمز عبور" wide footer={
      newCode ? (
        <Button onClick={() => { onDone(username.trim()); onClose(); }}>رفتن به ورود</Button>
      ) : (
        <>
          <Button variant="ghost" onClick={onClose}>انصراف</Button>
          <Button onClick={submit} loading={busy}>تغییر رمز</Button>
        </>
      )
    }>
      {newCode ? (
        <div>
          <p className="text-[13px] leading-7 mb-2">رمز عوض شد. این **کد بازیابی جدید** را جایی امن بنویسید — دیگر نمایش داده نمی‌شود:</p>
          <div className="card p-3 flex items-center justify-between" dir="ltr">
            <code className="text-[15px] font-bold tracking-widest">{newCode}</code>
            <Button variant="ghost" onClick={() => copy(newCode)} icon={<Copy size={14} />}>کپی</Button>
          </div>
          <p className="text-[11.5px] mt-2" style={{ color: 'var(--muted)' }}>کد قبلی سوخته است. این کد یک‌بارمصرف است.</p>
        </div>
      ) : (
        <>
          <div className="flex gap-1 mb-3">
            {([['code', 'کد بازیابی', KeyRound], ['token', 'توکن پشتیبانی', LifeBuoy], ['help', 'کمک', ShieldQuestion]] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                aria-pressed={tab === key}
                className="btn btn-ghost text-[12px]"
                style={tab === key ? { background: 'color-mix(in srgb, var(--brand) 14%, transparent)', borderColor: 'var(--brand)', color: 'var(--brand)' } : undefined}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>

          {tab === 'help' ? (
            <div className="text-[12.5px] leading-7">
              <p className="mb-2">رمزها با scrypt هش می‌شوند؛ هیچ‌کس (نه پشتیبانی، نه سازنده) نمی‌تواند رمز فعلی را بخواند. سه راه برای برگشتن به حساب:</p>
              <ol className="pr-4 list-decimal space-y-1" style={{ color: 'var(--muted)' }}>
                <li><b>کد بازیابی</b> — هنگام راه‌اندازی اولیه یک‌بار نمایش داده شد (۲۰ کاراکتر، مثل K7QM-…).</li>
                <li><b>توکن پشتیبانی</b> — اگر کد را نداری، شناسهٔ دستگاه را از صفحهٔ «لایسنس» برای پشتیبانی بفرست؛ توکن امضاشدهٔ یک‌بارمصرف صادر می‌شود.</li>
                <li><b>مالک باشگاه</b> — اگر حساب مالک در دسترس است، از تنظیمات → کاربران رمز دیگران را بازنشانی کن.</li>
              </ol>
              <p className="mt-2" style={{ color: 'var(--muted)' }}>
                راه چهارم (آخرین راه): اگر هیچ‌کدام در دسترس نیست، فقط با دسترسی به فایل `<code dir="ltr">data\gympro.db</code>` می‌توان رمز را بیرون از برنامه عوض کرد. این کار نیاز به ابزار فنی دارد و برای همین در برنامه تعبیه نشده است.
              </p>
            </div>
          ) : (
            <>
              <Field label="نام کاربری" required>
                <TextInput value={username} onChange={(e) => setUsername(e.target.value)} dir="ltr" style={{ textAlign: 'right' }} autoFocus />
              </Field>

              {tab === 'code' ? (
                <Field label="کد بازیابی" required hint="۲۰ کاراکتر در ۵ گروه ۴ حرفی؛ خط تیره اختیاری است">
                  <TextInput value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} dir="ltr" style={{ textAlign: 'right', letterSpacing: 1 }} placeholder="K7QM-3XPD-9RTB-W2HN-5JVC" />
                </Field>
              ) : (
                <>
                  <Field label="متن توکن (JSON)" required>
                    <TextArea value={token} onChange={setToken} rows={5} placeholder='{"v":1,"kind":"password-recovery",...}' />
                  </Field>
                  <Field label="امضا (Base64)" required>
                    <TextInput value={signature} onChange={(e) => setSignature(e.target.value)} dir="ltr" style={{ textAlign: 'right' }} />
                  </Field>
                </>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="رمز جدید" required><TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" style={{ textAlign: 'right' }} /></Field>
                <Field label="تکرار رمز جدید" required><TextInput type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} dir="ltr" style={{ textAlign: 'right' }} /></Field>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
