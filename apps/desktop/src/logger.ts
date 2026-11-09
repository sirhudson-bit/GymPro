import fs from 'node:fs';
import path from 'node:path';

type Level = 'info' | 'warn' | 'error';

const SECRET_KEYS = new Set(['mobile', 'phone', 'fullName', 'full_name', 'nationalId', 'national_id', 'pin', 'password']);

let dir = '';
let current = '';
let logStream: fs.WriteStream | null = null;

export function initLogger(logDir: string) {
  dir = logDir;
  fs.mkdirSync(dir, { recursive: true });
  rotate();
}

function dayFile() {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return path.join(dir, `app-${stamp}.log`);
}

function rotate() {
  const file = dayFile();
  if (file === current && logStream) return;
  logStream?.end();
  current = file;
  logStream = fs.createWriteStream(file, { flags: 'a' });
  // keep last 7 files
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('app-') && f.endsWith('.log'))
      .sort();
    while (files.length > 7) {
      const old = files.shift()!;
      fs.unlinkSync(path.join(dir, old));
    }
  } catch {
    /* rotation is best-effort */
  }
}

function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 400 ? `${value.slice(0, 400)}…` : value;
  if (typeof value !== 'object' || depth > 3) return value;
  if (Array.isArray(value)) return value.slice(0, 30).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.has(k) ? '***' : redact(v, depth + 1);
  }
  return out;
}

function write(level: Level, msg: string, meta?: unknown) {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    msg,
    meta: meta === undefined ? undefined : redact(meta),
  });
  try {
    logStream?.write(line + '\n');
  } catch {
    /* never throw from logging */
  }
  if (!app_packaged()) {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

function app_packaged() {
  try {
    return require('electron').app.isPackaged === true;
  } catch {
    return false;
  }
}

export const log = {
  info: (msg: string, meta?: unknown) => write('info', msg, meta),
  warn: (msg: string, meta?: unknown) => write('warn', msg, meta),
  error: (msg: string, meta?: unknown) => write('error', msg, meta),
  tail: (lines = 200): string => {
    try {
      const all = fs.readFileSync(dayFile(), 'utf8').trim().split('\n');
      return all.slice(-lines).join('\n');
    } catch {
      return '';
    }
  },
};
