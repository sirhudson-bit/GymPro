import { contextBridge, ipcRenderer } from 'electron';

// The channel list is provided by the main process (single source of truth: registerIpc()).
const channels = new Set<string>(ipcRenderer.sendSync('__allowed_channels') as string[]);

const api = {
  invoke: (channel: string, payload?: unknown) => {
    if (!channels.has(channel)) return Promise.resolve({ ok: false, error: { code: 'E_CHANNEL', message: 'کانال مجاز نیست' } });
    return ipcRenderer.invoke(channel, payload);
  },
  onEvent: (cb: (event: { type: string; payload: unknown }) => void) => {
    ipcRenderer.on('app:event', (_e, event) => cb(event));
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld('api', api);
