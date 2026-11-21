'use client';

/**
 * فونت برنامه — سه منبع:
 * ۱) فونت‌های آماده (Vazirmatn باندل‌شده) با نام خانواده‌شان
 * ۲) فونت‌های نصب‌شده روی ویندوز (Tahoma، Segoe UI، …) با نام خانواده
 * ۳) فونت بارگذاری‌شده از فایل — با نام خانوادهٔ ثابت `GymProCustom` تا
 *    مستقل از نام واقعی داخل فایل باشد (woff2 نام خانواده را لو نمی‌دهد)
 *
 * مقدار در `--app-font` نگه داشته می‌شود و `body` از همان استفاده می‌کند.
 */
export type FontChoice = { id: string; label: string; family: string; hint?: string };

export const BUILTIN_FONTS: FontChoice[] = [
  { id: 'vazirmatn', label: 'وزیرمتن', family: 'Vazirmatn', hint: 'همراه برنامه' },
  { id: 'tahoma', label: 'تاهوما', family: 'Tahoma', hint: 'ویندوز' },
  { id: 'segoe', label: 'سگووی یوآی', family: 'Segoe UI', hint: 'ویندوز' },
  { id: 'iraniansans', label: 'ایران‌سنس', family: 'IRANSans, IRANSansX, IranSans', hint: 'اگر نصب شده باشد' },
  { id: 'nazanin', label: 'نازنین', family: 'Nazanin, B Nazanin', hint: 'اگر نصب شده باشد' },
  { id: 'system', label: 'فونت پیش‌فرض سیستم', family: 'system-ui', hint: 'بدون فونت فارسی' },
];

export const CUSTOM_FAMILY = 'GymProCustom';

const STYLE_ID = 'gp-font-face';
const VAR = '--app-font';

export type FontState = {
  kind: 'builtin' | 'custom';
  family: string;
  label: string;
  url?: string;
  scale?: number;
};

/** اعمال فونت روی کل رابط کاربری (بدون نیاز به بازخوانی صفحه) */
export function applyFont(state: FontState) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  let family = state.family;
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;

  if (state.kind === 'custom' && state.url) {
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = `@font-face{font-family:'${CUSTOM_FAMILY}';src:url("${state.url}") format("${state.url.endsWith('.woff2') ? 'woff2' : state.url.endsWith('.woff') ? 'woff' : state.url.endsWith('.otf') ? 'opentype' : 'truetype'}");font-display:swap;font-weight:100 900;}`;
    family = CUSTOM_FAMILY;
    root.dataset.fontSource = 'custom';
  } else {
    if (style) {
      style.remove();
      style = null;
    }
    root.dataset.fontSource = 'builtin';
  }

  root.style.setProperty(VAR, family);
  root.dataset.fontFamily = family;
  if (state.scale && state.scale !== 1) root.style.setProperty('--app-font-scale', String(state.scale));
  else root.style.removeProperty('--app-font-scale');
}

/** خانوادهٔ فونتی که همین حالا اعمال شده (برای canvas/PDF) */
export function currentFontFamily(): string {
  if (typeof document === 'undefined') return 'Vazirmatn';
  return document.documentElement.style.getPropertyValue(VAR) || 'Vazirmatn';
}

/** فونت در localStorage نگه داشته می‌شود تا پیش از پاسخ IPC هم اعمال شود */
export function cacheFont(state: FontState) {
  try {
    localStorage.setItem('gp.font', JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function readCachedFont(): FontState | null {
  try {
    const raw = localStorage.getItem('gp.font');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FontState;
    if (!parsed?.family && parsed?.kind !== 'custom') return null;
    return parsed;
  } catch {
    return null;
  }
}
