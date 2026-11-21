import { app, BrowserWindow, Menu, Tray, nativeImage, protocol, net, ipcMain, shell, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveDataPaths, type DataPaths } from './paths';
import { initLogger, log } from './logger';
import { openDb, db, todayLocal } from './db';
import { license } from './license';
import { registerIpc } from './ipc';
import { backupNow, dailyBackupIfNeeded } from './backup';
import { startSupportPoller } from './support-sync';
import { checkNow } from './updater';
import { startAdmsListener, stopAdmsListener } from './adms';
import { applyAdmsPunch, devices as bioDevicesRepo } from './biometric';
import { settings } from './repo';
import { runSmokeTest } from './smoke';

const isDev = process.argv.includes('--dev');
const isSmoke = process.argv.includes('--smoke-test');
const APP_ORIGIN = 'app://gympro';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true } },
]);

let mainWindow: BrowserWindow | null = null;
let updateTimer: NodeJS.Timeout | null = null;
let tray: Tray | null = null;
let paths: DataPaths;
let stopping = false;

const CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function rendererRoot() {
  return path.join(app.getAppPath(), 'out');
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const FONT_MIME: Record<string, string> = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

async function registerAppProtocol() {
  const root = rendererRoot();
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url);
      let rel = decodeURIComponent(url.pathname);
      if (rel === '' || rel === '/') rel = '/index.html';
      /* فونت‌های بارگذاری‌شده در data/fonts هستند، نه داخل بستهٔ برنامه */
      if (rel.startsWith('/user-fonts/')) {
        const name = path.basename(rel);
        const fontFile = path.resolve(path.join(paths.root, 'fonts', name));
        if (!fontFile.startsWith(path.resolve(path.join(paths.root, 'fonts'))) || !fs.existsSync(fontFile)) {
          return new Response('not found', { status: 404 });
        }
        const data = fs.readFileSync(fontFile);
        return new Response(data, {
          status: 200,
          headers: new Headers({
            'content-type': FONT_MIME[path.extname(fontFile).toLowerCase()] ?? 'application/octet-stream',
            'content-security-policy': CSP,
            'x-content-type-options': 'nosniff',
            'cache-control': 'no-store',
          }),
        });
      }
      const resolved = path.resolve(path.join(root, rel));
      if (!resolved.startsWith(path.resolve(root))) {
        return new Response('forbidden', { status: 403 });
      }
      let file = resolved;
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        const withHtml = `${resolved}.html`;
        const withIndex = path.join(resolved, 'index.html');
        if (fs.existsSync(withIndex)) file = withIndex;
        else if (fs.existsSync(withHtml)) file = withHtml;
        else return new Response('not found', { status: 404 });
      }
      // read through fs (works inside app.asar, unlike some file:// fetches)
      const data = fs.readFileSync(file);
      const headers = new Headers({
        'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'content-security-policy': CSP,
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
      });
      return new Response(data, { status: 200, headers });
    } catch (e) {
      log.error('protocol.failed', { error: String(e), url: request.url });
      return new Response('error', { status: 500 });
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b1220',
    title: 'جیم‌پرو',
    icon: path.join(app.getAppPath(), 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: isDev,
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (!isSmoke) mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_ORIGIN)) {
      event.preventDefault();
      if (/^https:\/\//.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log.error('renderer.gone', details);
    dialog.showErrorBox('خطای غیرمنتظره', 'رابط برنامه بسته شد. برنامه دوباره باز می‌شود.');
    if (!stopping) mainWindow?.reload();
  });

  mainWindow.on('close', (event) => {
    if (!stopping && settings.get('ui.minimize_to_tray', '1') === '1') {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
}

function createTray() {
  // آیکون سینی: لوگوی شفاف و فشرده (خوانا در ۱۶ پیکسل)، با بازگشت به آیکون اصلی
  const trayPath = path.join(app.getAppPath(), 'build', 'tray.png');
  const iconPath = path.join(app.getAppPath(), 'build', 'icon.png');
  let image = nativeImage.createFromPath(trayPath);
  if (image.isEmpty()) image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) image = nativeImage.createEmpty();
  tray = new Tray(image.resize({ width: 16, height: 16 }));
  const menu = Menu.buildFromTemplate([
    {
      label: 'باز کردن جیم‌پرو',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      label: 'پشتیبان‌گیری سریع',
      click: () => {
        try {
          const res = backupNow(paths.root, 'manual');
          dialog.showMessageBox({ message: `پشتیبان ساخته شد: ${path.basename(res.file)}`, type: 'info' });
        } catch (e) {
          dialog.showErrorBox('خطا در پشتیبان‌گیری', String(e));
        }
      },
    },
    { type: 'separator' },
    {
      label: 'خروج',
      click: () => {
        stopping = true;
        app.quit();
      },
    },
  ]);
  tray.setToolTip('جیم‌پرو — مدیریت باشگاه');
  tray.setContextMenu(menu);
  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

function bootstrapData() {
  paths = resolveDataPaths();
  initLogger(paths.logs);
  log.info('app.start', {
    version: app.getVersion(),
    portable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR),
    dataDir: paths.root,
    electron: process.versions.electron,
    node: process.versions.node,
  });

  const existed = fs.existsSync(paths.db);
  if (existed) {
    try {
      const stat = fs.statSync(paths.db);
      if (stat.size > 0) backupNow(paths.root, 'pre_migration');
    } catch (e) {
      log.warn('backup.pre_migration_failed', { error: String(e) });
    }
  }

  openDb(paths.db);
  license.dataDir = paths.root;
  license.ensureTrial();
  settings.set('app.version', app.getVersion());
  const pending = license.status();
  log.info('license.status', { status: pending.status, edition: pending.edition });

  dailyBackupIfNeeded(paths.root);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      bootstrapData();
    } catch (e) {
      if (isSmoke) {
        console.log(`BOOT_ERROR ${String(e)}`);
        app.exit(3);
        return;
      }
      dialog.showErrorBox('خطا در راه‌اندازی پایگاه داده', String(e));
      app.quit();
      return;
    }

    await registerAppProtocol();
    const channels = registerIpc({
      dataDir: paths.root,
      openDataDir: () => shell.openPath(paths.root),
      nightlyBackup: () => dailyBackupIfNeeded(paths.root),
    });
    ipcMain.on('__allowed_channels', (event) => {
      event.returnValue = channels;
    });

    if (isSmoke) {
      try {
        const result = await runSmokeTest(paths.root);
        console.log(`SMOKE_RESULT ${JSON.stringify(result)}`);
        app.exit(result.ok ? 0 : 1);
      } catch (e) {
        console.log(`SMOKE_ERROR ${String(e)}`);
        app.exit(2);
      }
      return;
    }

    // شنوندهٔ ADMS برای دستگاه‌های ZKTeco که خودشان push می‌کنند
    try {
      const admsPort = Number(settings.get('bio.admsPort', '8090')) || 8090;
      startAdmsListener(admsPort, (sn, punch) => {
        const target = bioDevicesRepo.list().find((d) => String((d as { serial_no?: string }).serial_no ?? '') === sn && (d as { mode?: string }).mode === 'adms');
        if (!target) return;
        const res = applyAdmsPunch(String((target as { id: string }).id), punch);
        mainWindow?.webContents.send('app:event', { type: 'bio:punch', payload: { sn, punch, result: res } });
      });
    } catch (e) {
      log.warn('adms.start.failed', { error: String(e) });
    }

    createWindow();
    createTray();

    /* بررسی خودکار نسخه: ۲۰ ثانیه پس از باز شدن، سپس هر ۶ ساعت.
       نتیجه از همین‌جا به رابط کاربری فرستاده می‌شود تا نوتیفیکیشن نشان داده شود. */
    const runUpdateCheck = async () => {
      if (settings.get('update.autoCheck', '1') !== '1') return;
      const state = await checkNow({ quiet: true });
      if (state.status === 'available' && state.latest) {
        mainWindow?.webContents.send('app:event', {
          type: 'update:available',
          payload: { version: state.latest.version, notes: state.latest.notes, current: state.current, url: state.latest.url },
        });
      }
      mainWindow?.webContents.send('app:event', { type: 'update:state', payload: state });
    };
    setTimeout(() => void runUpdateCheck(), 20_000);
    updateTimer = setInterval(() => void runUpdateCheck(), 6 * 60 * 60 * 1000);
    startSupportPoller(paths.root, (payload) => {
      mainWindow?.webContents.send('app:event', { type: 'support:synced', payload });
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (settings.get('ui.minimize_to_tray', '1') !== '1') app.quit();
  });

  app.on('before-quit', () => {
    if (updateTimer) clearInterval(updateTimer);
    stopping = true;
    stopAdmsListener();
    log.info('app.quit', { today: todayLocal() });
  });
}
