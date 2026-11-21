// انتشار نسخه در GitHub Releases — یک دستور برای همهٔ مراحل
// usage: node scripts/release.mjs 1.2.2 "یادداشت۱|یادداشت۲"
// ۱) نسخهٔ package.json را می‌نویسد و build می‌کند
// ۲) نصب‌کننده را می‌سازد (electron-builder)
// ۳) release می‌سازد و فایل‌ها را ضمیمه می‌کند
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const version = String(process.argv[2] ?? '').replace(/^v/, '');
const notes = String(process.argv[3] ?? '').split('|').filter(Boolean);
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('نسخه را به شکل 1.2.3 بدهید');
  process.exit(1);
}
const repo = 'sirhudson-bit/GymPro';
const run = (cmd) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
};

// ۱) نسخه
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = version;
fs.writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`version → ${version}`);

// ۲) ساخت
run('npm run build');
run('node scripts/build-main.mjs');

// ۳) نصب‌کننده (پروسه‌های زنده باید بسته باشند تا dist قفل نشود)
if (process.platform === 'win32') {
  try {
    execSync('MSYS2_ARG_CONV_EXCL=* taskkill /F /IM GymPro.exe', { stdio: 'ignore' });
  } catch {
    /* برنامه باز نبود */
  }
}
const exe = `dist/GymPro-Setup-${version}.exe`;
fs.rmSync(exe, { force: true });
run('npx electron-builder --win nsis');

const size = fs.statSync(exe).size;
if (size < 150_000_000) {
  console.error(`نصب‌کننده کوچک‌تر از حد انتظار است: ${size}`);
  process.exit(1);
}
console.log(`installer ${exe} ${size} bytes`);

// ۴) انتشار
const body = notes.length ? notes.map((n) => `- ${n}`).join('\n') : `- نسخهٔ ${version}`;
try {
  run(`gh release delete v${version} --repo ${repo} --yes --cleanup-tag`);
} catch {
  /* نسخهٔ قبلی نبود */
}
run(`gh release create v${version} --repo ${repo} --title "GymPro ${version}" --notes "${body.replace(/"/g, '\\"')}"`);
run(`gh release upload v${version} ${exe} ${exe}.blockmap --repo ${repo} --clobber`);

const json = execSync(`gh release view v${version} --repo ${repo} --json assets`, { encoding: 'utf8' });
const assets = JSON.parse(json).assets ?? [];
console.log('\nassets:', assets.map((a) => `${a.name} (${a.size})`).join(', '));
console.log(`\nhttps://github.com/${repo}/releases/tag/v${version}`);
