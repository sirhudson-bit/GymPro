export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

declare global {
  interface Window {
    api?: {
      invoke: (channel: string, payload?: unknown) => Promise<ApiResult<any>>;
      onEvent: (cb: (event: { type: string; payload: unknown }) => void) => void;
      platform: string;
    };
  }
}

export function hasApi(): boolean {
  return typeof window !== 'undefined' && Boolean(window.api);
}

export async function call<T = unknown>(channel: string, payload?: unknown): Promise<T> {
  if (!window.api) throw new Error('این صفحه فقط داخل برنامهٔ جیم‌پرو اجرا می‌شود');
  const res = await window.api.invoke(channel, payload);
  if (!res || !res.ok) throw new Error(res?.ok === false ? res.error.message : 'خطای نامشخص');
  return res.data as T;
}

export const api = {
  info: () => call('app:info'),
  bootstrap: () => call('app:bootstrap'),
  setup: (p: unknown) => call('setup:run', p),
  login: (p: { username: string; password: string; remember?: boolean }) => call('auth:login', p),
  logout: () => call('auth:logout'),
  changePassword: (p: { currentPassword: string; newPassword: string }) => call('auth:changePassword', p),
  resetWithCode: (p: { username: string; code: string; newPassword: string }) => call('auth:resetWithCode', p),
  resetWithToken: (p: { username: string; token: string; signature: string; newPassword: string }) => call('auth:resetWithToken', p),
  issueRecoveryCode: (userId?: string) => call<{ code: string }>('auth:issueRecoveryCode', { userId }),
  ownerResetPassword: (p: { userId: string; newPassword: string }) => call('auth:ownerResetPassword', p),
  users: () => call('auth:users'),
  createUser: (p: unknown) => call('auth:createUser', p),
  members: (p?: unknown) => call('members:list', p),
  member: (id: string) => call('members:get', { id }),
  createMember: (p: unknown) => call('members:create', p),
  updateMember: (p: unknown) => call('members:update', p),
  archiveMember: (id: string) => call('members:archive', { id }),
  issueCard: (memberId: string) => call('cards:issue', { memberId }),
  qr: (text: string) => call<{ dataUrl: string }>('ui:qr', { text }),
  plans: (includeInactive = false) => call('plans:list', { includeInactive }),
  createPlan: (p: unknown) => call('plans:create', p),
  updatePlan: (p: unknown) => call('plans:update', p),
  contracts: (p?: unknown) => call('contracts:list', p),
  createContract: (p: unknown) => call('contracts:create', p),
  renewContract: (p: unknown) => call('contracts:renew', p),
  freezeContract: (p: unknown) => call('contracts:freeze', p),
  payments: (p?: unknown) => call('payments:list', p),
  createPayment: (p: unknown) => call('payments:create', p),
  voidPayment: (p: unknown) => call('payments:void', p),
  cashCurrent: () => call('cash:current'),
  cashOpen: (openingFloat: number) => call('cash:open', { openingFloat }),
  cashClose: (sessionId: string, counted: number, note: string) => call('cash:close', { sessionId, counted, note }),
  cashList: () => call('cash:list'),
  expenses: () => call('expenses:list'),
  createExpense: (p: unknown) => call('expenses:create', p),
  walletBalance: (memberId: string) => call<{ balance: number }>('wallet:balance', { memberId }),
  walletTopup: (p: unknown) => call('wallet:topup', p),
  attendanceToday: () => call('attendance:today'),
  attendancePresent: () => call<{ present: number }>('attendance:present'),
  attendanceHistory: (p?: unknown) => call('attendance:history', p),
  attendanceHourly: () => call('attendance:hourly'),
  checkin: (p: unknown) => call('attendance:checkin', p),
  checkout: (id: string) => call('attendance:checkout', { id }),
  products: (includeInactive = false) => call('pos:products', { includeInactive }),
  createProduct: (p: unknown) => call('pos:createProduct', p),
  restock: (p: unknown) => call('pos:restock', p),
  sell: (p: unknown) => call('pos:sell', p),
  sales: () => call('pos:sales'),
  lockers: () => call('lockers:list'),
  createLocker: (p: unknown) => call('lockers:create', p),
  rentLocker: (p: unknown) => call('lockers:rent', p),
  endLocker: (rentalId: string) => call('lockers:end', { rentalId }),
  classes: () => call('classes:list'),
  createClass: (p: unknown) => call('classes:create', p),
  enroll: (p: unknown) => call('classes:enroll', p),
  trainers: () => call('trainers:list'),
  createTrainer: (p: unknown) => call('trainers:create', p),
  bodyMeasurements: (memberId: string) => call('body:list', { memberId }),
  addMeasurement: (p: unknown) => call('body:create', p),
  programs: (memberId?: string) => call('programs:list', { memberId }),
  createProgram: (p: unknown) => call('programs:create', p),
  programItems: (programId: string) => call('programs:items', { programId }),
  addProgramItem: (p: unknown) => call('programs:addItem', p),
  exercises: () => call('programs:exercises'),
  loyalty: (memberId: string) => call('loyalty:member', { memberId }),
  leaderboard: () => call('loyalty:leaderboard'),
  tickets: () => call('support:tickets'),
  ticketMessages: (ticketId: string) => call('support:messages', { ticketId }),
  createTicket: (p: unknown) => call('support:create', p),
  replyTicket: (p: unknown) => call('support:reply', p),
  closeTicket: (ticketId: string) => call('support:close', { ticketId }),
  dashboard: (from: string, to: string) => call('reports:dashboard', { from, to }),
  series: (days: number) => call('reports:series', { days }),
  monthly: () => call('reports:monthly'),
  churn: () => call('reports:churn'),
  licenseStatus: () => call('license:status'),
  activateLicense: (p: unknown) => call('license:activate', p),
  activateLicenseOnline: (p: unknown) => call('license:activateOnline', p),
  saveImage: (p: unknown) => call('ui:saveImage', p),

  deactivateLicense: () => call('license:deactivate'),
  settingsAll: () => call('settings:all'),
  setSetting: (key: string, value: string) => call('settings:set', { key, value }),
  backup: () => call('system:backup'),
  backups: () => call('system:backups'),
  openDataDir: () => call('system:openDataDir'),
  logTail: () => call<{ log: string }>('system:logTail'),
  exportMembersCsv: () => call('system:exportMembersCsv'),
  openExternal: (url: string) => call('system:openExternal', { url }),
};
