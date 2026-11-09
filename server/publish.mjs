// Publishes a signed update manifest: node server/publish.mjs <version> <exePath> [mandatory]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createPrivateKey, sign } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const [, , version, exePath, mandatoryFlag] = process.argv;
if (!version || !exePath) {
  console.error('usage: node server/publish.mjs <version> <path-to-exe> [mandatory]');
  process.exit(1);
}

const releases = path.join(__dirname, 'releases');
fs.mkdirSync(releases, { recursive: true });
const fileName = `GymPro-Setup-${version}.exe`;
fs.copyFileSync(exePath, path.join(releases, fileName));

const buf = fs.readFileSync(path.join(releases, fileName));
const manifest = {
  version,
  mandatory: mandatoryFlag === 'mandatory',
  notes: [`نسخهٔ ${version} منتشر شد.`],
  url: `https://updates.gympro.ir/releases/${fileName}`,
  sha256: createHash('sha256').update(buf).digest('hex'),
  size: buf.length,
  publishedAt: new Date().toISOString(),
};

const key = createPrivateKey(fs.readFileSync(path.join(__dirname, 'keys', 'license-private.pem'), 'utf8'));
const signature = sign(null, Buffer.from(JSON.stringify(manifest, Object.keys(manifest).sort())), key).toString('base64');

fs.writeFileSync(path.join(__dirname, 'data', 'manifest.signed.json'), JSON.stringify({ manifest, signature }, null, 2));
console.log(JSON.stringify({ version, sha256: manifest.sha256, size: manifest.size }, null, 2));
