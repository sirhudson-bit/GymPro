import fs from 'node:fs';
import path from 'node:path';
import { settings } from './repo';
import { db, nowIso, uuidv7 } from './db';
import { log } from './logger';

function deviceToken(dataDir: string): string {
  const file = path.join(dataDir, '.device');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const token = Buffer.from(`${Date.now()}-${Math.random()}`).toString('base64url');
    fs.writeFileSync(file, token, { mode: 0o600 });
    return token;
  }
}

async function post(url: string, body: unknown, token: string) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-token': token },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** One offline-first sync tick: push queued tickets, pull answers. Never throws. */
export async function syncTick(dataDir: string): Promise<{ pushed: number; pulled: number; error?: string }> {
  const base = settings.get('support.url', '');
  if (!base) return { pushed: 0, pulled: 0, error: 'unset' };
  const d = db();
  const token = deviceToken(dataDir);
  let pushed = 0;
  let pulled = 0;

  const queued = d.all<{ id: string; subject: string; category: string; priority: string }>(
    "SELECT id, subject, category, priority FROM support_tickets WHERE status = 'queued' ORDER BY created_at LIMIT 5",
  );
  for (const ticket of queued) {
    const first = d.get<{ body: string }>('SELECT body FROM support_messages WHERE ticket_id = ? ORDER BY created_at LIMIT 1', ticket.id);
    try {
      const out = await post(`${base.replace(/\/$/, '')}/v1/tickets`, {
        subject: ticket.subject,
        category: ticket.category,
        priority: ticket.priority,
        body: first?.body ?? '',
        clientTicketId: ticket.id,
        appVersion: settings.get('app.version', '1.0.0'),
        licenseKey: d.get<{ license_key: string }>('SELECT license_key FROM license_state ORDER BY created_at LIMIT 1')?.license_key ?? null,
      }, token);
      d.run("UPDATE support_tickets SET status = 'sent', remote_id = ?, updated_at = ? WHERE id = ?", String(out.remoteId ?? ''), nowIso(), ticket.id);
      pushed += 1;
    } catch (e) {
      d.run('UPDATE support_tickets SET updated_at = ? WHERE id = ?', nowIso(), ticket.id);
      log.warn('support.push_failed', { ticket: ticket.id, error: String(e) });
    }
  }

  const open = d.all<{ id: string; remote_id: string }>("SELECT id, remote_id FROM support_tickets WHERE status IN ('sent','answered') AND remote_id IS NOT NULL");
  for (const ticket of open) {
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/v1/tickets/${ticket.remote_id}`, { headers: { 'x-device-token': token } });
      if (!res.ok) continue;
      const body = (await res.json()) as { messages?: { id: string; body: string; createdAt: string }[]; status?: string };
      for (const msg of body.messages ?? []) {
        const exists = d.get('SELECT id FROM support_messages WHERE ticket_id = ? AND remote_id = ?', ticket.id, msg.id);
        if (exists) continue;
        d.run(
          'INSERT INTO support_messages (id, branch_id, ticket_id, direction, body, remote_id, is_read, received_at) VALUES (?,?,?,?,?,?,0,?)',
          uuidv7(),
          d.branchId,
          ticket.id,
          'in',
          msg.body,
          msg.id,
          msg.createdAt ?? nowIso(),
        );
        pulled += 1;
      }
      if (body.status === 'answered') {
        d.run("UPDATE support_tickets SET status = 'answered', unread_count = unread_count + ?, updated_at = ? WHERE id = ?", pulled, nowIso(), ticket.id);
      }
    } catch (e) {
      log.warn('support.pull_failed', { ticket: ticket.id, error: String(e) });
    }
  }
  return { pushed, pulled };
}

export function startSupportPoller(dataDir: string, onEvent: (payload: { pushed: number; pulled: number }) => void) {
  let timer: NodeJS.Timeout | null = null;
  let delay = 60_000;
  const run = async () => {
    const res = await syncTick(dataDir);
    if (res.pushed || res.pulled) onEvent({ pushed: res.pushed, pulled: res.pulled });
    delay = res.error && res.error !== 'unset' ? Math.min(delay * 2, 15 * 60_000) : 60_000;
    timer = setTimeout(run, delay);
  };
  timer = setTimeout(run, 15_000);
  return () => {
    if (timer) clearTimeout(timer);
  };
}
