// GymPro backend — license server + update manifest + support tickets, no dependencies.
// run: node server/index.mjs  (PORT=8787 by default)
// dev keys: node server/make-key.mjs GP-DEMO-0001 pro 12
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateKey, sign, randomUUID, createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, 'data');
const RELEASES = path.join(__dirname, 'releases');
const PORT = Number(process.env.PORT ?? 8787);

fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(RELEASES, { recursive: true });

const privateKey = createPrivateKey(fs.readFileSync(path.join(__dirname, 'keys', 'license-private.pem'), 'utf8'));

function load(name, fallback) {
  const file = path.join(DATA, name);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}
function save(name, value) {
  fs.writeFileSync(path.join(DATA, name), JSON.stringify(value, null, 2));
}

/** Must match the client: JSON.stringify(body, Object.keys(body).sort()) */
function canonical(body) {
  return JSON.stringify(body, Object.keys(body).sort());
}
function signBody(body) {
  return sign(null, Buffer.from(canonical(body)), privateKey).toString('base64');
}

const json = (res, code, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) });
  res.end(body);
};
const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('bad json'));
      }
    });
  });

const hits = new Map();
function rateLimited(key, max = 10, windowMs = 15 * 60_000) {
  const now = Date.now();
  const rec = hits.get(key) ?? [];
  const recent = rec.filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}

function activationCount(licenseKey) {
  const activations = load('activations.json', {});
  return Object.keys(activations).filter((mid) => activations[mid].licenseKey === licenseKey).length;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const route = `${req.method} ${url.pathname.replace(/\/$/, '')}`;
  const ip = req.socket.remoteAddress ?? 'unknown';
  try {
    if (route === 'GET /health') return json(res, 200, { ok: true, service: 'gympro-backend', time: new Date().toISOString() });

    if (route === 'GET /v1/pubkey') {
      const der = fs.readFileSync(path.join(__dirname, 'keys', 'public.b64'), 'utf8').trim();
      return json(res, 200, { alg: 'Ed25519', key: der });
    }

    if (route === 'POST /v1/activate') {
      if (rateLimited(`act:${ip}`)) return json(res, 429, { error: 'too many attempts' });
      const body = await readBody(req);
      const { licenseKey, machineId, appVersion } = body;
      if (!licenseKey || !machineId || machineId.length !== 32) return json(res, 400, { error: 'licenseKey and 32-char machineId required' });
      const keys = load('keys.json', {});
      const record = keys[licenseKey];
      if (!record) return json(res, 404, { error: 'unknown licence key' });
      if (record.disabled) return json(res, 403, { error: 'licence revoked' });

      const activations = load('activations.json', {});
      const already = activations[machineId]?.licenseKey === licenseKey;
      const used = activationCount(licenseKey);
      if (!already && used >= record.maxActivations) return json(res, 409, { error: 'activation limit reached', maxActivations: record.maxActivations });
      if (!already) {
        activations[machineId] = { licenseKey, at: new Date().toISOString(), appVersion: appVersion ?? null };
        save('activations.json', activations);
      }

      const issued = new Date();
      const entitlement = new Date(issued.getTime());
      entitlement.setMonth(entitlement.getMonth() + (record.updateMonths ?? 12));
      const payload = {
        licenseKey,
        machineId,
        edition: record.edition ?? 'pro',
        issuedAt: issued.toISOString(),
        updateEntitlementUntil: entitlement.toISOString(),
        features: record.features ?? ['core', 'pos', 'kiosk', 'reports', 'support'],
        maxActivations: record.maxActivations ?? 1,
        activationsUsed: already ? used : used + 1,
        buyer: record.buyer ?? null,
      };
      return json(res, 200, { license: payload, signature: signBody(payload) });
    }

    if (route === 'POST /v1/deactivate') {
      const body = await readBody(req);
      const activations = load('activations.json', {});
      const rec = activations[body.machineId];
      if (!rec || rec.licenseKey !== body.licenseKey) return json(res, 404, { error: 'not activated on this machine' });
      delete activations[body.machineId];
      save('activations.json', activations);
      const audit = load('audit.json', []);
      audit.push({ event: 'deactivate', key: body.licenseKey, machineId: body.machineId, at: new Date().toISOString() });
      save('audit.json', audit);
      return json(res, 200, { ok: true });
    }

    if (route === 'GET /latest.json') {
      const file = path.join(DATA, 'manifest.signed.json');
      if (!fs.existsSync(file)) return json(res, 404, { error: 'no release published' });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(file));
    }

    if (req.method === 'GET' && url.pathname.startsWith('/releases/')) {
      const file = path.join(RELEASES, path.basename(url.pathname));
      if (!fs.existsSync(file)) return json(res, 404, { error: 'not found' });
      const data = fs.readFileSync(file);
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': data.length,
        'content-disposition': `attachment; filename="${path.basename(file)}"`,
      });
      return res.end(data);
    }

    if (route === 'POST /v1/tickets') {
      const token = req.headers['x-device-token'];
      if (!token) return json(res, 401, { error: 'device token required' });
      const body = await readBody(req);
      const tickets = load('tickets.json', {});
      const remoteId = randomUUID();
      tickets[remoteId] = {
        remoteId,
        clientTicketId: body.clientTicketId ?? null,
        subject: body.subject ?? '(بدون موضوع)',
        category: body.category ?? 'other',
        priority: body.priority ?? 'normal',
        status: 'open',
        licenseKey: body.licenseKey ?? null,
        appVersion: body.appVersion ?? null,
        createdAt: new Date().toISOString(),
        messages: body.body ? [{ id: randomUUID(), direction: 'in', body: body.body, createdAt: new Date().toISOString() }] : [],
      };
      save('tickets.json', tickets);
      return json(res, 200, { remoteId, ticketNo: Object.keys(tickets).length });
    }

    if (route === 'GET' || req.method === 'POST') {
      const m = url.pathname.match(/^\/v1\/tickets\/([0-9a-zA-Z-]+)(\/messages)?$/);
      if (m) {
        const tickets = load('tickets.json', {});
        const t = tickets[m[1]];
        if (!t) return json(res, 404, { error: 'ticket not found' });
        if (req.method === 'POST') {
          const body = await readBody(req);
          t.messages.push({ id: randomUUID(), direction: 'out', body: body.body ?? '', createdAt: new Date().toISOString() });
          t.status = 'answered';
          save('tickets.json', tickets);
          return json(res, 200, { ok: true });
        }
        return json(res, 200, { status: t.status, messages: t.messages, subject: t.subject, updatedAt: t.updatedAt ?? t.createdAt });
      }
      return json(res, 404, { error: 'not found', route });
    }

    return json(res, 404, { error: 'not found', route });
  } catch (e) {
    console.error('[server] error', e);
    return json(res, 500, { error: String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`GymPro backend on http://127.0.0.1:${PORT} — data: ${DATA}`);
});
