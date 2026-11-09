import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { migrationsDir } from './paths';
import { log } from './logger';

export type Row = Record<string, unknown>;

export function plainify<T = Row>(row: unknown): T {
  return row ? (Object.assign({}, row as Row) as T) : ({} as T);
}
export function plainRows<T = Row>(rows: unknown[]): T[] {
  return (rows || []).map((r) => Object.assign({}, r as Row) as T);
}

/** UUIDv7 — 48 bit timestamp + random; sortable by creation time, collision-free across devices. */
export function uuidv7(): string {
  const ms = BigInt(Date.now());
  const time = [0, 1, 2, 3, 4, 5].map((i) => Number((ms >> BigInt(8 * (5 - i))) & 0xffn));
  const rand = randomBytes(10);
  const bytes = new Uint8Array(16);
  bytes.set(time, 0);
  bytes[6] = 0x70 | (rand[0] & 0x0f); // version 7
  bytes[7] = rand[1];
  bytes[8] = 0x80 | (rand[2] & 0x3f); // RFC 4122 variant
  bytes.set(rand.subarray(3, 10), 9);
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const nowIso = () => new Date().toISOString().replace('Z', 'Z');
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export class Db {
  db: DatabaseSync;
  deviceId = '';
  branchId = '';
  constructor(public file: string) {
    const existed = fs.existsSync(file);
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    log.info('db.open', { file, existed });
  }

  all<T = Row>(sql: string, ...params: unknown[]): T[] {
    return plainRows<T>(this.db.prepare(sql).all(...(params as never[])));
  }
  get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
    const r = this.db.prepare(sql).get(...(params as never[]));
    return r ? plainify<T>(r) : undefined;
  }
  run(sql: string, ...params: unknown[]): { changes: number } {
    const r = this.db.prepare(sql).run(...(params as never[]));
    return { changes: Number(r.changes) };
  }
  exec(sql: string) {
    this.db.exec(sql);
  }
  tx<T>(fn: () => T): T {
    this.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.exec('COMMIT');
      return out;
    } catch (e) {
      try {
        this.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw e;
    }
  }

  /** Every domain write goes through here: row change + outbox record in one transaction. */
  write<T>(opts: { entity: string; entityId: string; op: 'create' | 'update' | 'delete' | 'restore'; version: number; payload: unknown }, fn: () => T): T {
    return this.tx(() => {
      const result = fn();
      this.run(
        `INSERT OR IGNORE INTO outbox (id, branch_id, device_id, entity, entity_id, op, payload_json, entity_version, happened_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        uuidv7(),
        this.branchId,
        this.deviceId,
        opts.entity,
        opts.entityId,
        opts.op,
        JSON.stringify(opts.payload ?? {}),
        opts.version,
        nowIso(),
      );
      return result;
    });
  }

  loadIdentity() {
    const b = this.get<{ id: string }>('SELECT id FROM branches WHERE deleted_at IS NULL ORDER BY is_default DESC, created_at LIMIT 1');
    this.branchId = b?.id ?? '';
    const d = this.get<{ id: string }>('SELECT id FROM devices ORDER BY created_at LIMIT 1');
    if (d) this.deviceId = d.id;
    else {
      this.deviceId = uuidv7();
      this.run('INSERT INTO devices (id, machine_id, label, is_local) VALUES (?,?,?,1)', this.deviceId, `local-${Date.now()}`, 'این دستگاه');
    }
  }

  migrate() {
    const dir = migrationsDir();
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    this.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`);
    const applied = this.all<{ version: string; checksum: string }>('SELECT version, checksum FROM schema_migrations');
    const appliedMap = new Map(applied.map((r) => [r.version, r.checksum]));
    for (const f of files) {
      const version = f.replace(/\.sql$/, '');
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      const checksum = sha256(raw);
      if (appliedMap.has(version)) {
        if (appliedMap.get(version) !== checksum) {
          throw new Error(`مایگریشن «${version}» پس از اجرا تغییر کرده است؛ اجرای برنامه متوقف شد (checksum mismatch).`);
        }
        continue;
      }
      const isEmptyDb = !this.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='members'`);
      // PRAGMAs (journal_mode/synchronous) must run OUTSIDE a transaction, so lift them out first.
      const pragmas = raw.match(/^\s*PRAGMA[^;]*;/gim) ?? [];
      const body = raw.replace(/^\s*PRAGMA[^;]*;/gim, '');
      log.info('db.migrate', { version, checksum, isEmptyDb, pragmas: pragmas.length });
      for (const p of pragmas) this.exec(p);
      this.exec('BEGIN IMMEDIATE');
      try {
        this.exec(body);
        this.run('INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?,?,?)', version, checksum, nowIso());
        this.exec('COMMIT');
      } catch (e) {
        this.exec('ROLLBACK');
        log.error('db.migrate.failed', { version, error: String(e) });
        throw e;
      }
    }
    this.loadIdentity();
  }
}

let instance: Db | null = null;
export function openDb(file: string): Db {
  if (!instance) {
    instance = new Db(file);
    instance.migrate();
  }
  return instance;
}
export function db(): Db {
  if (!instance) throw new Error('database not ready');
  return instance;
}
