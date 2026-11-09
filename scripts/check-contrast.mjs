// WCAG 2.2 SC 1.4.3 contrast check for the real palette in app/globals.css.
import fs from 'node:fs';

const css = fs.readFileSync('app/globals.css', 'utf8');

function parseBlock(selector) {
  const start = css.indexOf(selector);
  const open = css.indexOf('{', start);
  const close = css.indexOf('\n}', open);
  const body = css.slice(open + 1, close);
  const vars = {};
  for (const line of body.split('\n')) {
    const m = line.match(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})/);
    if (m) vars[m[1]] = m[2];
  }
  return vars;
}

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const themes = { light: parseBlock(':root'), dark: parseBlock("[data-theme='dark']") };

let failures = 0;
const rows = [];
for (const [name, vars] of Object.entries(themes)) {
  const pairs = [
    ['ink on panel', vars.ink, vars.panel, 4.5],
    ['ink on canvas', vars.ink, vars.canvas, 4.5],
    ['muted on panel', vars.muted, vars.panel, 4.5],
    ['muted on canvas', vars.muted, vars.canvas, 4.5],
    ['brand-ink on brand', vars['brand-ink'], vars.brand, 4.5],
    ['bad on panel', vars.bad, vars.panel, 4.5],
    ['ok on panel', vars.ok, vars.panel, 4.5],
    ['warn on panel', vars.warn, vars.panel, 4.5],
    ['edge-strong on panel (non-text 3:1)', vars['edge-strong'], vars.panel, 3],
    ['brand focus ring on panel (non-text 3:1)', vars.brand, vars.panel, 3],
  ];
  for (const [label, fg, bg, min] of pairs) {
    if (!fg || !bg) {
      rows.push({ theme: name, label, error: 'missing var' });
      failures += 1;
      continue;
    }
    const r = ratio(fg, bg);
    const ok = r >= min;
    if (!ok) failures += 1;
    rows.push({ theme: name, label, ratio: Number(r.toFixed(2)), min, ok });
  }
}

for (const row of rows) {
  console.log(`${row.ok ? '✓' : '✗'} [${row.theme}] ${row.label} = ${row.ratio ?? '?'}:1 (min ${row.min})`);
}
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
