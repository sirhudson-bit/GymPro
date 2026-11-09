import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import { log } from './logger';

const FILE = '.session';
const PREFIX = 'v1:';

export type RememberedSession = {
  userId: string;
  username: string;
  /** ms epoch */
  exp: number;
  /** snapshot of users.password_changed_at — a password change invalidates the session */
  pwdAt: string | null;
};

/**
 * "مرا به خاطر بسپار" — stores a device-local session marker, never the password.
 * On Windows the payload is encrypted with DPAPI via Electron safeStorage, so another
 * Windows user account cannot read it.
 */
export function saveSession(dataDir: string, session: RememberedSession): { encrypted: boolean } {
  const json = JSON.stringify(session);
  let payload = json;
  let encrypted = false;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      payload = PREFIX + safeStorage.encryptString(json).toString('base64');
      encrypted = true;
    }
  } catch (e) {
    log.warn('session.encrypt_failed', { error: String(e) });
  }
  fs.writeFileSync(path.join(dataDir, FILE), payload, { mode: 0o600 });
  return { encrypted };
}

export function readSession(dataDir: string): RememberedSession | null {
  try {
    const raw = fs.readFileSync(path.join(dataDir, FILE), 'utf8').trim();
    if (!raw) return null;
    const json = raw.startsWith(PREFIX) ? safeStorage.decryptString(Buffer.from(raw.slice(PREFIX.length), 'base64')) : raw;
    const parsed = JSON.parse(json) as RememberedSession;
    if (!parsed?.userId || !parsed?.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSession(dataDir: string) {
  try {
    fs.unlinkSync(path.join(dataDir, FILE));
  } catch {
    /* nothing to clear */
  }
}

export const SESSION_DAYS = 30;
