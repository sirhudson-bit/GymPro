// شنوندهٔ ADMS/iClock — دستگاه ZKTeco خودش رکورد را به این سرور POST می‌کند.
// پروتکل: GET /iclock/cdata?SN=... (تنظیمات) و POST /iclock/cdata?SN=...&table=ATTLOG (رکوردها)
import http from 'node:http';
import { db, nowIso } from './db';
import { log } from './logger';

export type ParsedPunch = { deviceUserNo: string; punchedAt: string; direction: 'in' | 'out' | null };

let server: http.Server | null = null;
let currentPort = 0;
let onPunch: ((sn: string, punch: ParsedPunch) => void) | null = null;

/** رکورد ATTLOG: «PIN \t YYYY-MM-DD HH:mm:ss \t status \t verify \t workcode …» */
export function parseAttLog(body: string): ParsedPunch[] {
  const out: ParsedPunch[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\t|\s{2,}/).map((s) => s.trim());
    if (parts.length < 2) continue;
    const userNo = parts[0].replace(/\D/g, '');
    if (!userNo) continue;
    // تاریخ ممکن است در یک ستون یا دو ستون (تاریخ و ساعت) بیاید
    let stamp = parts[1] ?? '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(stamp) && parts[2] && /^\d{2}:\d{2}/.test(parts[2])) stamp = `${stamp} ${parts[2]}`;
    const when = new Date(stamp.replace(' ', 'T'));
    if (Number.isNaN(when.getTime())) continue;
    // state: 0=ورود، 1=خروج در بعضی مدل‌ها؛ اگر نامشخص باشد null تا برنامه خودش تشخیص دهد
    const state = parts[2] && /^\d+$/.test(parts[2]) && stamp === parts[1] ? Number(parts[2]) : null;
    out.push({
      deviceUserNo: userNo,
      punchedAt: when.toISOString(),
      direction: state === 1 ? 'out' : state === 0 ? 'in' : null,
    });
  }
  return out;
}

function optionReply(sn: string) {
  return [
    `GET OPTION FROM: ${sn}`,
    'Stamp=9999',
    'OpStamp=9999',
    'ErrorDelay=30',
    'Delay=10',
    'TransTimes=00:00;14:05',
    'TransInterval=1',
    'TransFlag=TransData AttLog OpLog UserInfo',
    'TimeZone=3.5',
    'Realtime=1',
    'Encrypt=0',
    '',
  ].join('\n');
}

export function startAdmsListener(port: number, handler: (sn: string, punch: ParsedPunch) => void): { ok: boolean; port: number; error?: string } {
  onPunch = handler;
  if (server && currentPort === port) return { ok: true, port };
  if (server) {
    server.close();
    server = null;
  }
  try {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      const sn = url.searchParams.get('SN') ?? url.searchParams.get('sn') ?? 'unknown';
      const table = (url.searchParams.get('table') ?? '').toUpperCase();

      if (req.method === 'GET' && url.pathname.startsWith('/iclock/cdata')) {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(optionReply(sn));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/iclock/getrequest') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('OK');
        return;
      }
      if (req.method === 'POST' && url.pathname.startsWith('/iclock/cdata')) {
        let body = '';
        req.on('data', (c) => {
          body += String(c);
          if (body.length > 5_000_000) req.destroy();
        });
        req.on('end', () => {
          let count = 0;
          if (table === 'ATTLOG' || /^\d+\t/.test(body)) {
            for (const punch of parseAttLog(body)) {
              try {
                onPunch?.(sn, punch);
                count += 1;
              } catch (e) {
                log.warn('adms.punch.failed', { sn, error: String(e) });
              }
            }
          } else if (table === 'OPERLOG') {
            // لاگ عملیات دستگاه؛ لازم نیست ذخیره شود
          }
          db().run(
            `INSERT INTO adms_seen (sn, at, table_name, count) VALUES (?,?,?,?)
             ON CONFLICT(sn) DO UPDATE SET at = excluded.at, table_name = excluded.table_name, count = excluded.count`,
            sn,
            nowIso(),
            table || 'unknown',
            count,
          );
          res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(`OK: ${count}`);
        });
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
    });
    server.on('error', (e) => log.error('adms.listen.error', { error: String(e) }));
    server.listen(port, '0.0.0.0', () => log.info('adms.listening', { port }));
    currentPort = port;
    return { ok: true, port };
  } catch (e) {
    return { ok: false, port, error: String((e as Error).message ?? e) };
  }
}

export function stopAdmsListener() {
  if (server) {
    server.close();
    server = null;
    currentPort = 0;
  }
}

export function admsStatus() {
  return { running: Boolean(server), port: currentPort };
}

/** دستگاه‌هایی که تا حالا به شنونده وصل شده‌اند (برای تأیید پیکربندی) */
export function admsSeen() {
  return db().all<{ sn: string; at: string; table_name: string; count: number }>('SELECT sn, at, table_name, count FROM adms_seen ORDER BY at DESC');
}
