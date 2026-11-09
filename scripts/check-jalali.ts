// Verifies the hand-written Jalali converter against the platform calendar (Intl fa-IR-u-ca-persian).
// Run: node scripts/check-jalali.ts
import { gregorianToJalali, jalaliToGregorian, formatJalali } from '../lib/jalali.ts';

const fmt = new Intl.DateTimeFormat('en-US-u-ca-persian', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  timeZone: 'UTC',
});

let checked = 0;
let bad = 0;
const start = Date.UTC(1990, 0, 1);
for (let i = 0; i < 20000; i += 17) {
  const d = new Date(start + i * 86400000);
  const gy = d.getUTCFullYear();
  const gm = d.getUTCMonth() + 1;
  const gd = d.getUTCDate();
  const parts = fmt.formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const expect = { jy: get('year'), jm: get('month'), jd: get('day') };
  const got = gregorianToJalali(gy, gm, gd);
  checked += 1;
  if (got.jy !== expect.jy || got.jm !== expect.jm || got.jd !== expect.jd) {
    bad += 1;
    if (bad < 8) console.log('MISMATCH', `${gy}-${gm}-${gd}`, 'expected', expect, 'got', got);
  }
}

// round-trip
let roundtripBad = 0;
for (let y = 1380; y <= 1420; y += 1) {
  for (let m = 1; m <= 12; m += 1) {
    for (const day of [1, 15, 29]) {
      const g = jalaliToGregorian(y, m, day);
      const back = gregorianToJalali(g.gy, g.gm, g.gd);
      if (back.jy !== y || back.jm !== m || back.jd !== day) {
        roundtripBad += 1;
        if (roundtripBad < 5) console.log('ROUNDTRIP', y, m, day, back);
      }
    }
  }
}

console.log(JSON.stringify({ checked, mismatches: bad, roundtripMismatches: roundtripBad, sample: formatJalali('2026-11-07', { withMonthName: true }) }, null, 0));
if (bad || roundtripBad) process.exit(1);
