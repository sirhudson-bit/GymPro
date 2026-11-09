'use client';

import { createContext, isValidElement, cloneElement, useContext, useEffect, useId, useRef, useState } from 'react';
import { X, Search, ChevronDown, Check } from 'lucide-react';
import { toPersianDigits, formatMoney, tomanToRial } from '@/lib/format';

/* ─────────── Field wrapper ─────────── */

export function Field({ label, hint, error, children, required }: { label: string; hint?: string; error?: string; children: React.ReactNode; required?: boolean }) {
  const id = useId();
  // Give the control a real accessible name: clone the single child and wire label → control.
  const child = isValidElement(children)
    ? cloneElement(children as React.ReactElement<any>, {
        id: (children as React.ReactElement<any>).props?.id ?? id,
        'aria-label': (children as React.ReactElement<any>).props?.['aria-label'] ?? label,
        'aria-invalid': error ? true : (children as React.ReactElement<any>).props?.['aria-invalid'],
        'aria-describedby': (children as React.ReactElement<any>).props?.['aria-describedby'] ?? (hint || error ? `${id}-hint` : undefined),
      })
    : children;
  return (
    <div className="mb-3">
      <label htmlFor={id} className="label">
        {label}
        {required ? <span style={{ color: 'var(--bad)' }}> *</span> : <span style={{ color: 'var(--muted)', fontWeight: 400 }}> (اختیاری)</span>}
      </label>
      {child}
      {hint && !error ? <p id={`${id}-hint`} className="mt-1 text-[11.5px]" style={{ color: 'var(--muted)' }}>{hint}</p> : null}
      {error ? <p id={`${id}-hint`} className="mt-1 text-[12px]" style={{ color: 'var(--bad)' }} role="alert">{error}</p> : null}
    </div>
  );
}

/* ─────────── Inputs ─────────── */

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const { invalid, style, ...rest } = props;
  return <input {...rest} className="field" style={{ borderColor: invalid ? 'var(--bad)' : undefined, ...style }} />;
}

export function MoneyInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <TextInput
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d۰-۹,]/g, ''))}
        placeholder={placeholder ?? 'مثلاً ۲٬۵۰۰٬۰۰۰'}
        aria-describedby={undefined}
      />
      <span className="absolute top-1/2 -translate-y-1/2 left-3 text-[11.5px]" style={{ color: 'var(--muted)' }}>
        تومان
      </span>
    </div>
  );
}

export function Select({ value, onChange, options, ariaLabel }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; ariaLabel: string }) {
  return (
    <select className="field" value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function TextArea({ value, onChange, rows = 3, placeholder, ...rest }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...rest}
      className="field"
      rows={rows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

/* ─────────── Buttons ─────────── */

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger'; icon?: React.ReactNode; loading?: boolean };
export function Button({ variant = 'primary', icon, loading, children, ...rest }: BtnProps) {
  return (
    <button {...rest} className={`btn ${variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : 'btn-ghost'}`} disabled={rest.disabled || loading}>
      {loading ? <Spinner size={14} /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, onClick, children, title }: { label: string; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button type="button" aria-label={label} title={title ?? label} onClick={onClick} className="btn btn-ghost px-2 py-1.5" style={{ borderColor: 'transparent' }}>
      {children}
    </button>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        border: `2px solid color-mix(in srgb, var(--brand) 35%, transparent)`,
        borderTopColor: 'var(--brand)',
        borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
      }}
    />
  );
}

/* ─────────── Badge / Stat / Empty ─────────── */

export function Badge({ tone = 'neutral', children }: { tone?: 'ok' | 'warn' | 'bad' | 'neutral' | 'brand'; children: React.ReactNode }) {
  const color = tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--bad)' : tone === 'brand' ? 'var(--brand)' : 'var(--muted)';
  return (
    <span className="chip" style={{ color, borderColor: `color-mix(in srgb, ${color} 35%, transparent)`, background: `color-mix(in srgb, ${color} 10%, transparent)` }}>
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
  icon,
  trend,
  bars,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'ok' | 'bad' | 'warn';
  icon?: React.ReactNode;
  trend?: { dir: 'up' | 'down'; text: string };
  bars?: number[];
}) {
  const color = tone === 'ok' ? 'var(--ok)' : tone === 'bad' ? 'var(--bad)' : tone === 'warn' ? 'var(--warn)' : 'var(--ink)';
  const max = bars && bars.length ? Math.max(...bars, 1) : 1;
  return (
    <div className="card p-4 relative overflow-hidden">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12.5px] mb-1 flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
            {icon ? <span style={{ color: 'var(--brand)' }}>{icon}</span> : null}
            {label}
          </p>
          <p className="text-[22px] font-bold tabular-nums leading-tight break-words" style={{ color }}>{value}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {trend ? (
              <span
                className="chip"
                style={{
                  color: trend.dir === 'up' ? 'var(--ok)' : 'var(--bad)',
                  borderColor: `color-mix(in srgb, ${trend.dir === 'up' ? 'var(--ok)' : 'var(--bad)'} 40%, transparent)`,
                  background: `color-mix(in srgb, ${trend.dir === 'up' ? 'var(--ok)' : 'var(--bad)'} 10%, transparent)`,
                }}
              >
                {trend.dir === 'up' ? '▲' : '▼'} {trend.text}
              </span>
            ) : null}
            {hint ? <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>{hint}</p> : null}
          </div>
        </div>
        {bars && bars.length ? (
          <div className="flex items-end gap-[3px] h-10 shrink-0" aria-hidden="true">
            {bars.slice(-12).map((b, i) => (
              <span
                key={i}
                style={{
                  width: 4,
                  height: `${Math.max(8, Math.round((b / max) * 40))}px`,
                  background: i === bars.slice(-12).length - 1 ? 'var(--brand)' : 'color-mix(in srgb, var(--brand) 35%, transparent)',
                  borderRadius: 2,
                  display: 'block',
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="text-center py-10">
      <p className="font-semibold" style={{ color: 'var(--ink)' }}>{title}</p>
      {hint ? <p className="text-[12.5px] mt-1" style={{ color: 'var(--muted)' }}>{hint}</p> : null}
    </div>
  );
}

/* ─────────── Modal ─────────── */

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const nodes = ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus(), 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto" style={{ background: 'rgba(6,10,16,0.55)' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className="card w-full my-8" style={{ maxWidth: wide ? 880 : 520 }}>
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid var(--edge)' }}>
          <h2 id={titleId} className="font-bold text-[15px]">{title}</h2>
          <IconButton label="بستن" onClick={onClose}>
            <X size={17} />
          </IconButton>
        </div>
        <div className="p-5">{children}</div>
        {footer ? <div className="px-5 py-3 flex gap-2 justify-end" style={{ borderTop: '1px solid var(--edge)' }}>{footer}</div> : null}
      </div>
    </div>
  );
}

export function Confirm({ open, title, message, confirmLabel = 'تأیید', onConfirm, onClose, danger }: { open: boolean; title: string; message: string; confirmLabel?: string; onConfirm: () => void; onClose: () => void; danger?: boolean }) {
  return (
    <Modal open={open} onClose={onClose} title={title} footer={<>
      <Button variant="ghost" onClick={onClose}>انصراف</Button>
      <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
    </>}>
      <p className="text-[13.5px] leading-7">{message}</p>
    </Modal>
  );
}

/* ─────────── Table ─────────── */

export function Table({ head, children, empty, emptyHint = 'موردی برای نمایش نیست.' }: { head: string[]; children: React.ReactNode; empty?: boolean; emptyHint?: string }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} className="th" scope="col">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {empty ? (
              <tr>
                <td className="td" colSpan={head.length}>
                  <Empty title="موردی ثبت نشده است" hint={emptyHint} />
                </td>
              </tr>
            ) : (
              children
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────── Search box ─────────── */

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-full max-w-xs">
      <Search size={15} className="absolute top-1/2 -translate-y-1/2 right-3" style={{ color: 'var(--muted)' }} />
      <input aria-label={placeholder} className="field pr-9" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

/* ─────────── Jalali date input ─────────── */

export function DateInput({ value, onChange, label, invalid }: { value: string; onChange: (v: string) => void; label: string; invalid?: boolean }) {
  return (
    <div>
      <span className="label">{label}</span>
      <TextInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="۱۴۰۴/۰۸/۱۶"
        inputMode="numeric"
        aria-label={label}
        invalid={invalid}
        dir="ltr"
        style={{ textAlign: 'right' }}
      />
      <p className="mt-1 text-[11px]" style={{ color: invalid ? 'var(--bad)' : 'var(--muted)' }}>
        {invalid ? 'تاریخ شمسی معتبر نیست' : 'قالب: سال/ماه/روز شمسی'}
      </p>
    </div>
  );
}

/* ─────────── Collapsible section ─────────── */

export function Section({ title, children, action, defaultOpen = true }: { title: string; children: React.ReactNode; action?: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="card mb-4">
      <div className="flex items-center justify-between px-4 py-3">
        <button type="button" className="flex items-center gap-2 font-bold text-[14px] min-h-[32px] py-1" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={id}>
          <ChevronDown size={15} style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 120ms' }} />
          {title}
        </button>
        {action}
      </div>
      {open ? <div id={id} className="px-4 pb-4">{children}</div> : null}
    </section>
  );
}

export function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-[13px]" style={{ borderBottom: '1px dashed color-mix(in srgb, var(--edge) 70%, transparent)' }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className="flex items-center gap-2 py-1.5 min-h-[32px] text-right">
      <span
        style={{
          width: 40,
          height: 24,
          borderRadius: 999,
          background: checked ? 'var(--brand)' : 'var(--edge-strong)',
          position: 'relative',
          transition: 'background 150ms',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            right: checked ? 19 : 3,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
            transition: 'right 150ms',
          }}
        />
      </span>
      <span className="text-[13px]">{label}</span>
    </button>
  );
}

export { formatMoney, tomanToRial, toPersianDigits };
