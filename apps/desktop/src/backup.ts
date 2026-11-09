import fs from 'node:fs';
import path from 'node:path';
import { db, uuidv7, nowIso, sha256 } from './db';
import { log } from './logger';

const KEEP = 14;

export function backupNow(dataDir: string, kind: 'manual' | 'daily' | 'pre_migration' | 'pre_restore' = 'manual') {
  const d = db();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(dataDir, 'backups', `${kind}-${stamp}.db`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  d.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const buf = fs.readFileSync(file);
  const checksum = sha256(buf.toString('base64'));
  d.run('INSERT INTO backups (id, kind, file_name, size_bytes, checksum) VALUES (?,?,?,?,?)', uuidv7(), kind, path.basename(file), buf.length, checksum);
  // rotation
  const rows = d.all<{ file_name: string }>('SELECT file_name FROM backups ORDER BY created_at DESC');
  for (const old of rows.slice(KEEP)) {
    try {
      fs.unlinkSync(path.join(dataDir, 'backups', old.file_name));
    } catch {
      /* ignore */
    }
    d.run('DELETE FROM backups WHERE file_name = ?', old.file_name);
  }
  log.info('backup.created', { kind, file: path.basename(file), size: buf.length });
  return { file, size: buf.length, checksum };
}

export function listBackups() {
  return db().all('SELECT * FROM backups ORDER BY created_at DESC LIMIT 50');
}

/** Restores by replacing the live DB file; caller must restart the app afterwards. */
export function restoreBackup(dataDir: string, fileName: string) {
  const source = path.join(dataDir, 'backups', path.basename(fileName));
  if (!fs.existsSync(source)) throw new Error('فایل پشتیبان یافت نشد');
  const target = path.join(dataDir, 'gympro.db');
  const safety = path.join(dataDir, 'backups', `pre_restore-${Date.now()}.db`);
  try {
    if (fs.existsSync(target)) fs.copyFileSync(target, safety);
  } catch {
    /* ignore */
  }
  fs.copyFileSync(source, target);
  for (const suffix of ['-wal', '-shm']) {
    try {
      fs.unlinkSync(target + suffix);
    } catch {
      /* ignore */
    }
  }
  return { restored: path.basename(source), safety: path.basename(safety) };
}

export function dailyBackupIfNeeded(dataDir: string) {
  const d = db();
  const last = d.get<{ created_at: string }>("SELECT created_at FROM backups WHERE kind = 'daily' ORDER BY created_at DESC LIMIT 1");
  const today = new Date().toISOString().slice(0, 10);
  if (last && String(last.created_at).slice(0, 10) === today) return null;
  return backupNow(dataDir, 'daily');
}
