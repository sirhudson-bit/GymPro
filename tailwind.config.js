/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        vazir: ['Vazirmatn', 'Tahoma', 'sans-serif'],
      },
      colors: {
        canvas: 'var(--canvas)',
        panel: 'var(--panel)',
        edge: 'var(--edge)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        brand: 'var(--brand)',
        'brand-ink': 'var(--brand-ink)',
        ok: 'var(--ok)',
        warn: 'var(--warn)',
        bad: 'var(--bad)',
      },
      borderRadius: { xl2: '1rem' },
    },
  },
  plugins: [],
};
