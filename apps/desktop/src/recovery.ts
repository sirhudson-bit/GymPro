import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

/** Same Ed25519 public key that signs licences and update manifests. */
const PUBLIC_KEY_DER_B64 = 'MCowBQYDK2VwAyEAunIeRCXHcGrbtguiM7xRbRbudHYnaK835veFZShDIsc=';

export type RecoveryToken = { v: number; kind: 'password-recovery'; machineId: string; username: string; exp: string; note?: string };

function canonical(body: Record<string, unknown>): string {
  return JSON.stringify(body, Object.keys(body).sort());
}

/**
 * Offline password-recovery token, issued by support for one machine + one username.
 * Verifies: signature, token kind, machine binding, expiry. Never needs a network call at verify time.
 */
export function verifyRecoveryToken(tokenJson: string, signatureB64: string, machineId: string): { ok: true; username: string } | { ok: false; error: string } {
  let body: RecoveryToken;
  try {
    body = JSON.parse(tokenJson);
  } catch {
    return { ok: false, error: 'متن توکن قابل خواندن نیست (JSON نامعتبر)' };
  }
  if (body.kind !== 'password-recovery' || body.v !== 1) return { ok: false, error: 'نوع توکن پشتیبانی نمی‌شود' };
  if (!body.exp || new Date(body.exp).getTime() < Date.now()) return { ok: false, error: 'توکن منقضی شده است؛ از پشتیبانی توکن تازه بگیرید' };
  if (body.machineId !== machineId) return { ok: false, error: 'این توکن برای دستگاه دیگری صادر شده است' };
  try {
    const key = createPublicKey({ key: Buffer.from(PUBLIC_KEY_DER_B64, 'base64'), format: 'der', type: 'spki' });
    const ok = cryptoVerify(null, Buffer.from(canonical(body as unknown as Record<string, unknown>)), key, Buffer.from(signatureB64, 'base64'));
    if (!ok) return { ok: false, error: 'امضای توکن معتبر نیست' };
  } catch {
    return { ok: false, error: 'امضای توکن قابل بررسی نیست' };
  }
  return { ok: true, username: body.username };
}
