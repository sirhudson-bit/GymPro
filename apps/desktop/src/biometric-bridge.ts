// پل نازک بین IPC و درایور اثر انگشت — تا ipc.ts به کتابخانهٔ سخت‌افزار وابسته نباشد
import { devices, punches, syncAll, syncDevice, simulatePunch, testConnection, userMap, devicesForEnrollment, unenrolled } from './biometric';

export const bioDevices = {
  list: () => devices.list(),
  create: (p: Record<string, unknown>) =>
    devices.create({
      brand: String(p.brand) as 'zkteco' | 'suprema' | 'futronic',
      label: String(p.label ?? ''),
      mode: p.mode ? String(p.mode) : undefined,
      host: p.host ? String(p.host) : null,
      port: p.port === undefined || p.port === '' ? undefined : Number(p.port),
      serial_no: p.serialNo ? String(p.serialNo) : null,
      api_user: p.apiUser ? String(p.apiUser) : null,
      api_secret: p.apiSecret ? String(p.apiSecret) : null,
      csv_path: p.csvPath ? String(p.csvPath) : null,
      punch_mode: (p.punchMode === 'in_out' ? 'in_out' : 'toggle') as 'in_out' | 'toggle',
    }),
  update: (p: Record<string, unknown>) =>
    devices.update(String(p.id), {
      label: p.label === undefined ? undefined : String(p.label),
      mode: p.mode === undefined ? undefined : String(p.mode),
      host: p.host === undefined ? undefined : p.host ? String(p.host) : null,
      port: p.port === undefined ? undefined : p.port === '' ? null : Number(p.port),
      serial_no: p.serialNo === undefined ? undefined : String(p.serialNo),
      api_user: p.apiUser === undefined ? undefined : String(p.apiUser),
      api_secret: p.apiSecret === undefined ? undefined : String(p.apiSecret),
      csv_path: p.csvPath === undefined ? undefined : String(p.csvPath),
      punch_mode: p.punchMode,
      ...(p.isActive === undefined ? {} : { is_active: Number(p.isActive) }),
    } as never),
  remove: (id: string) => devices.remove(id),
  test: async (id: string) => testConnection(devices.get(id)),
  sync: (id: string, userId: string | null) => syncDevice(id, userId),
  syncAll: (userId: string | null) => syncAll(userId),
  simulate: (p: { deviceId: string; userNo: string; direction?: 'in' | 'out' | null }) => simulatePunch(p.deviceId, p.userNo, p.direction ?? null),
  punches: (p: { deviceId?: string; limit?: number }) => punches(p),
  enrollment: () => devicesForEnrollment(),
  unenrolled: (deviceId: string) => unenrolled(deviceId),
};

export const bioUserMap = {
  list: (deviceId?: string) => userMap.list(deviceId),
  add: (p: { deviceId: string; userNo: string; memberId: string }, userId: string | null = null) => userMap.add(p.deviceId, String(p.userNo), p.memberId, userId),
  remove: (id: string) => userMap.remove(id),
};

export const biometric = { devices, userMap };
