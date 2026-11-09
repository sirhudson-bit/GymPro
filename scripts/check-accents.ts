// Verifies that every accent preset stays WCAG AA in both themes after deriveAccent().
import { ACCENT_PRESETS, deriveAccent, contrast, PANEL } from '../lib/theme.ts';

let failures = 0;
for (const theme of ['light', 'dark']) {
  for (const preset of ACCENT_PRESETS) {
    const a = deriveAccent(preset.hex, theme);
    const onPanel = contrast(a.brand, PANEL[theme]);
    const label = contrast(a.ink, a.brand);
    const ok = onPanel >= 4.5 && label >= 4.5;
    if (!ok) failures += 1;
    console.log(`${ok ? '✓' : '✗'} [${theme}] ${preset.id.padEnd(7)} brand=${a.brand} ink=${a.ink} text/bg=${onPanel.toFixed(2)} label/brand=${label.toFixed(2)}`);
  }
}

// a deliberately hostile near-white and near-black input must still be repaired
for (const raw of ['#ffff00', '#000000', '#777777', '#f8fafc']) {
  const a = deriveAccent(raw, 'light');
  const ok = contrast(a.brand, PANEL.light) >= 4.5 && contrast(a.ink, a.brand) >= 4.5;
  if (!ok) failures += 1;
  console.log(`${ok ? '✓' : '✗'} [custom ${raw}] → brand=${a.brand} text/bg=${contrast(a.brand, PANEL.light).toFixed(2)}`);
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
