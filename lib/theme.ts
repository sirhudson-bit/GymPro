/** Accent (theme colour) engine — derives AA-safe brand colours for both themes. */

export type Rgb = { r: number; g: number; b: number };

export const PANEL = { light: '#ffffff', dark: '#121b29' } as const;

export function hexToRgb(hex: string): Rgb {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
}

function channelLum(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channelLum(r) + 0.7152 * channelLum(g) + 0.0722 * channelLum(b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* ── HSL helpers (kept small, no dependency) ───────────────────── */

export function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
    }
    h /= 6;
  }
  return { h: h * 360, s, l };
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const hh = ((h % 360) + 360) % 360 / 360;
  const ss = Math.max(0, Math.min(1, s));
  const ll = Math.max(0, Math.min(1, l));
  let r: number;
  let g: number;
  let b: number;
  if (ss === 0) {
    r = g = b = ll;
  } else {
    const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
    const p = 2 * ll - q;
    r = hue2rgb(p, q, hh + 1 / 3);
    g = hue2rgb(p, q, hh);
    b = hue2rgb(p, q, hh - 1 / 3);
  }
  return rgbToHex({ r: r * 255, g: g * 255, b: b * 255 });
}

export type Accent = { brand: string; ink: string; ring: string; soft: string };

/**
 * Adjusts the chosen colour until it is legible in the given theme:
 *  - brand must reach 4.5:1 against the panel (it is used for text/links/active nav)
 *  - ink must reach 4.5:1 against brand (button labels)
 * The hue is preserved; only lightness is moved.
 */
export function deriveAccent(input: string, theme: 'light' | 'dark'): Accent {
  const panel = PANEL[theme];
  const raw = rgbToHsl(hexToRgb(input));
  const { h } = raw;
  // a neutral grey stays neutral instead of picking up the fallback red hue
  const sat = raw.s < 0.08 ? 0 : Math.max(0.28, Math.min(0.95, raw.s));
  let l = theme === 'light' ? Math.min(0.48, raw.l) : Math.max(0.5, raw.l);
  let brand = hslToHex(h, sat, l);

  const inkFor = (bg: string) => {
    const white = '#ffffff';
    const black = theme === 'light' ? '#04120d' : '#06110d';
    return contrast(white, bg) >= contrast(black, bg) ? white : black;
  };

  // move lightness until the brand is readable on the panel …
  for (let i = 0; i < 40; i += 1) {
    if (contrast(brand, panel) >= 4.5) break;
    l += theme === 'light' ? -0.02 : 0.02;
    if (l <= 0.05 || l >= 0.95) break;
    brand = hslToHex(h, sat, l);
  }
  // … and until its own label has 4.5:1 on it
  for (let i = 0; i < 40; i += 1) {
    if (contrast(inkFor(brand), brand) >= 4.5) break;
    l += theme === 'light' ? -0.02 : 0.02;
    if (l <= 0.04 || l >= 0.96) break;
    brand = hslToHex(h, sat, l);
  }

  return { brand, ink: inkFor(brand), ring: brand, soft: hslToHex(h, sat, theme === 'light' ? 0.94 : 0.16) };
}

export const ACCENT_PRESETS: { id: string; label: string; hex: string }[] = [
  { id: 'teal', label: 'سبز زیتونی', hex: '#0d6e57' },
  { id: 'blue', label: 'آبی', hex: '#1d4ed8' },
  { id: 'indigo', label: 'نیلی', hex: '#4338ca' },
  { id: 'violet', label: 'بنفش', hex: '#7e22ce' },
  { id: 'rose', label: 'سرخابی', hex: '#be123c' },
  { id: 'orange', label: 'نارنجی', hex: '#c2410c' },
  { id: 'amber', label: 'کهربایی', hex: '#a16207' },
  { id: 'slate', label: 'خاکستری آبی', hex: '#334155' },
];

export const DEFAULT_ACCENT = '#0d6e57';

/** Applies the accent to <html> for the current theme without touching other tokens. */
export function applyAccent(hex: string, theme: 'light' | 'dark') {
  if (typeof document === 'undefined') return;
  const accent = deriveAccent(hex || DEFAULT_ACCENT, theme);
  const root = document.documentElement;
  root.style.setProperty('--brand', accent.brand);
  root.style.setProperty('--brand-ink', accent.ink);
  root.style.setProperty('--ring', accent.ring);
  root.style.setProperty('--brand-soft', accent.soft);
  // surfaces used by the tinted mode (sidebar / header / cards)
  root.style.setProperty('--brand-wash', theme === 'light' ? accent.soft : hslToHex(rgbToHsl(hexToRgb(accent.brand)).h, 0.42, 0.14));
  root.style.setProperty('--brand-line', theme === 'light' ? hslToHex(rgbToHsl(hexToRgb(accent.brand)).h, 0.45, 0.82) : hslToHex(rgbToHsl(hexToRgb(accent.brand)).h, 0.4, 0.3));
  root.dataset.accent = hex || DEFAULT_ACCENT;
}

/**
 * Keeps the accent in sync with the theme, whichever way `data-theme` changes
 * (toggle button, restore from storage, or a future settings path).
 * Without this, a theme switch that bypasses `toggleTheme()` leaves the light
 * variant of the accent applied in dark mode — the exact "some parts still look
 * like the default colour" symptom.
 */
let observer: MutationObserver | null = null;
export function watchTheme(onChange?: (theme: 'light' | 'dark') => void) {
  if (typeof document === 'undefined' || observer) return;
  observer = new MutationObserver(() => {
    const theme = (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light') as 'light' | 'dark';
    const accent = document.documentElement.dataset.accent || DEFAULT_ACCENT;
    applyAccent(accent, theme);
    onChange?.(theme);
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
