// Issues a licence key into server/data/keys.json
// usage: node server/make-key.mjs GP-DEMO-0001 pro 12 [maxActivations]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const [, , licenseKey, edition = 'pro', months = '12', maxActivations = '1', buyer = ''] = process.argv;

if (!licenseKey) {
  console.error('usage: node server/make-key.mjs <KEY> [edition] [updateMonths] [maxActivations] [buyer]');
  process.exit(1);
}

const file = path.join(__dirname, 'data', 'keys.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
const keys = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};

keys[licenseKey] = {
  edition,
  updateMonths: Number(months),
  maxActivations: Number(maxActivations),
  features: edition === 'basic' ? ['core'] : ['core', 'pos', 'kiosk', 'reports', 'support'],
  buyer: buyer || null,
  createdAt: new Date().toISOString(),
  disabled: false,
};

fs.writeFileSync(file, JSON.stringify(keys, null, 2));
console.log(`key ${licenseKey} written (${edition}, ${months}mo updates, ${maxActivations} activations)`);
