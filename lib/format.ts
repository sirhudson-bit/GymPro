import { toPersianDigits } from './jalali';

export { formatJalali, todayJalali, toPersianDigits, toLatinDigits, parseJalaliInput, addDaysIso, daysBetween, gregorianToJalali, jalaliToGregorian } from './jalali';

/** Money is stored in IRR; the UI speaks Toman. Persian thousands separator, no latin commas. */
export function formatMoney(irr: number | null | undefined): string {
  const value = Number(irr ?? 0);
  if (!Number.isFinite(value)) return '۰';
  return toPersianDigits(value.toLocaleString('en-US')).replace(/,/g, '٬');
}

export function formatToman(irr: number | null | undefined): string {
  return `${formatMoney(Math.trunc(Number(irr ?? 0) / 10))} تومان`;
}

export function tomanToRial(input: string | number): number {
  const latin = String(input).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/,/g, '').replace(/[^\d]/g, '');
  const toman = Number(latin || 0);
  return Math.round(toman * 10);
}

export function rialToToman(irr: number): number {
  return Math.round(Number(irr || 0) / 10);
}

export function formatPercent(v: number): string {
  return `${toPersianDigits(Math.round(v))}٪`;
}

/** Compact axis label: 3.3M rial → «۳٫۳ م». Keeps chart ticks short in a narrow card. */
export function compactMoney(irr: number): string {
  const v = Number(irr ?? 0);
  if (v === 0) return '۰';
  if (Math.abs(v) >= 1_000_000_000) return `${toPersianDigits((v / 1_000_000_000).toFixed(1)).replace('.', '٫')} میلیارد`;
  if (Math.abs(v) >= 1_000_000) return `${toPersianDigits((v / 1_000_000).toFixed(1)).replace('.', '٫')} م`;
  if (Math.abs(v) >= 1_000) return `${toPersianDigits(Math.round(v / 1_000))} هزار`;
  return toPersianDigits(v);
}

export function daysLeftLabel(endDate: string | null | undefined): { text: string; tone: 'ok' | 'warn' | 'bad' } {
  if (!endDate) return { text: 'بدون قرارداد', tone: 'warn' };
  const today = new Date();
  const end = new Date(`${endDate}T23:59:59`);
  const days = Math.ceil((end.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { text: `${toPersianDigits(Math.abs(days))} روز منقضی`, tone: 'bad' };
  if (days <= 7) return { text: `${toPersianDigits(days)} روز مانده`, tone: 'warn' };
  return { text: `${toPersianDigits(days)} روز مانده`, tone: 'ok' };
}

export const WEEKDAYS = ['شنبه', 'یک‌شنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];

export const METHOD_LABEL: Record<string, string> = {
  cash: 'نقدی',
  card_to_card: 'کارت به کارت',
  cheque: 'چک',
  installment: 'اقساط',
  wallet: 'کیف پول',
  credit: 'نسیه',
  bank: 'بانک',
};
