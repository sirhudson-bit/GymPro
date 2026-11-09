'use client';

import { create } from 'zustand';
import { todayJalali, parseJalaliInput, formatJalali, toPersianDigits } from './format';
import { applyAccent, DEFAULT_ACCENT, watchTheme } from './theme';

export type Toast = { id: number; message: string; tone: 'ok' | 'bad' | 'warn' };

export type ViewKey =
  | 'dashboard'
  | 'members'
  | 'contracts'
  | 'finance'
  | 'attendance'
  | 'kiosk'
  | 'pos'
  | 'classes'
  | 'lockers'
  | 'reports'
  | 'support'
  | 'settings'
  | 'license'
  | 'help';

type Store = {
  user: { id: string; username: string; fullName: string; role: string } | null;
  license: any;
  view: ViewKey;
  theme: 'light' | 'dark';
  accent: string;
  toasts: Toast[];
  setUser: (u: Store['user']) => void;
  setLicense: (l: any) => void;
  setView: (v: ViewKey) => void;
  toggleTheme: () => void;
  setAccent: (hex: string, persist?: boolean) => void;
  tint: boolean;
  setTint: (on: boolean, persist?: boolean) => void;
  toast: (message: string, tone?: Toast['tone']) => void;
  dismiss: (id: number) => void;
};

let toastSeq = 1;

export const useStore = create<Store>((set, get) => ({
  user: null,
  license: null,
  view: 'dashboard',
  theme: 'light',
  accent: DEFAULT_ACCENT,
  toasts: [],
  setUser: (user) => set({ user }),
  setLicense: (license) => set({ license }),
  setView: (view) => {
    if (typeof window !== 'undefined') window.location.hash = `#/${view}`;
    set({ view });
  },
  toggleTheme: () => {
    const theme = get().theme === 'light' ? 'dark' : 'light';
    if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme;
    applyAccent(get().accent, theme);
    try {
      localStorage.setItem('gp.theme', theme);
    } catch {
      /* ignore */
    }
    set({ theme });
  },
  setAccent: (hex, persist = true) => {
    const clean = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : DEFAULT_ACCENT;
    applyAccent(clean, get().theme);
    try {
      localStorage.setItem('gp.accent', clean);
    } catch {
      /* ignore */
    }
    set({ accent: clean });
    if (persist) {
      // stored per branch in the database so it survives reinstalls of the renderer
      import('./api')
        .then(({ api }) => api.setSetting('ui.accent', clean))
        .catch(() => undefined);
    }
  },
  setTint: (on, persist = true) => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.tint = on ? 'on' : 'off';
    }
    try {
      localStorage.setItem('gp.tint', on ? '1' : '0');
    } catch {
      /* ignore */
    }
    set({ tint: on });
    if (persist) {
      import('./api')
        .then(({ api }) => api.setSetting('ui.tint', on ? '1' : '0'))
        .catch(() => undefined);
    }
  },
  toast: (message, tone = 'ok') => {
    const id = toastSeq++;
    set({ toasts: [...get().toasts, { id, message, tone }] });
    setTimeout(() => get().dismiss(id), tone === 'bad' ? 6000 : 3500);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export function initTheme() {
  let theme: 'light' | 'dark' = 'light';
  let accent = DEFAULT_ACCENT;
  let tint = true;
  try {
    const saved = localStorage.getItem('gp.theme');
    if (saved === 'dark' || saved === 'light') theme = saved;
    const savedAccent = localStorage.getItem('gp.accent');
    if (savedAccent && /^#[0-9a-fA-F]{6}$/.test(savedAccent)) accent = savedAccent;
    const savedTint = localStorage.getItem('gp.tint');
    if (savedTint === '0') tint = false;
  } catch {
    /* ignore */
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.tint = tint ? 'on' : 'off';
  applyAccent(accent, theme);
  watchTheme((t) => useStore.setState({ theme: t }));
  useStore.setState({ theme, accent, tint });
  return theme;
}

/** Jalali text input: shows and accepts "1404/08/16", stores gregorian ISO. */
export function useJalaliField(initialIso?: string) {
  const initial = initialIso ? formatJalali(initialIso) : todayJalali();
  return {
    initial,
    toIso: (text: string) => parseJalaliInput(text),
    hint: `مثال: ${toPersianDigits(todayJalali())}`,
  };
}
