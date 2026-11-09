import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export type DataPaths = {
  root: string;
  db: string;
  backups: string;
  photos: string;
  attachments: string;
  logs: string;
  updates: string;
  help: string;
  portableWarning: boolean;
};

const SUB = ['backups', 'photos', 'attachments', 'logs', 'updates', 'help'];

function probeWritable(dir: string): boolean {
  const probe = path.join(dir, `.write-test-${Date.now()}`);
  try {
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function ensure(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export function resolveDataPaths(): DataPaths {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  let root = '';
  let portableWarning = false;

  if (portableDir) {
    root = path.join(portableDir, 'data');
    ensure(root);
    if (!probeWritable(root)) {
      root = path.join(app.getPath('userData'), 'data');
      portableWarning = true;
    }
  } else if (app.isPackaged) {
    root = path.join(app.getPath('userData'), 'data');
  } else {
    root = path.join(process.cwd(), '.dev-data');
  }

  ensure(root);
  for (const s of SUB) ensure(path.join(root, s));
  if (!probeWritable(root)) {
    // last resort: userData even in dev
    root = path.join(app.getPath('userData'), 'data');
    ensure(root);
    for (const s of SUB) ensure(path.join(root, s));
    portableWarning = true;
  }

  return {
    root,
    db: path.join(root, 'gympro.db'),
    backups: path.join(root, 'backups'),
    photos: path.join(root, 'photos'),
    attachments: path.join(root, 'attachments'),
    logs: path.join(root, 'logs'),
    updates: path.join(root, 'updates'),
    help: path.join(root, 'help'),
    portableWarning,
  };
}

export function migrationsDir(): string {
  const packaged = path.join(app.getAppPath(), 'packages', 'db', 'migrations');
  if (fs.existsSync(packaged)) return packaged;
  return path.join(process.cwd(), 'packages', 'db', 'migrations');
}
