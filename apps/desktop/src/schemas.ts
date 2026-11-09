import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ نامعتبر');
const mobile = z.string().regex(/^09\d{9}$/, 'شمارهٔ موبایل باید ۱۱ رقم و با ۰۹ شروع شود');
const money = z.number().int().min(0).max(1_000_000_000_000);

export const MemberCreate = z.object({
  fullName: z.string().trim().min(3, 'نام کامل را وارد کنید').max(80),
  mobile,
  gender: z.enum(['male', 'female']).nullish(),
  birthDate: isoDate.nullish(),
  nationalId: z.string().trim().regex(/^\d{10}$/, 'کد ملی باید ۱۰ رقم باشد').nullish().or(z.literal('')),
  address: z.string().trim().max(300).nullish(),
  emergencyName: z.string().trim().max(80).nullish(),
  emergencyMobile: z.string().trim().max(20).nullish(),
  photo: z.string().max(2048).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  consent: z.boolean().optional(),
});

export const MemberUpdate = MemberCreate.partial().extend({ id: z.string().min(8), version: z.number().int().min(1) });

export const PlanCreate = z.object({
  name: z.string().trim().min(2).max(60),
  kind: z.enum(['time', 'session', 'hybrid', 'vip', 'guest']),
  durationDays: z.number().int().min(0).max(3650).nullish(),
  sessionCount: z.number().int().min(0).max(1000).nullish(),
  priceIrr: money,
  vatRateBp: z.number().int().min(0).max(10000).default(0),
  isActive: z.boolean().default(true),
});

export const ContractCreate = z.object({
  memberId: z.string().min(8),
  planId: z.string().min(8),
  startDate: isoDate,
  discountIrr: money.default(0),
  discountReason: z.string().trim().max(200).nullish(),
  payment: z
    .object({
      amountIrr: money,
      method: z.enum(['cash', 'card_to_card', 'cheque', 'installment', 'wallet']),
      reference: z.string().trim().max(60).nullish(),
      installments: z.number().int().min(2).max(24).optional(),
    })
    .nullish(),
});

export const PaymentCreate = z.object({
  memberId: z.string().min(8),
  contractId: z.string().nullish(),
  amountIrr: z.number().int().refine((v) => v !== 0, 'مبلغ نمی‌تواند صفر باشد'),
  method: z.enum(['cash', 'card_to_card', 'cheque', 'installment', 'wallet']),
  paidAt: z.string().min(10),
  reference: z.string().trim().max(60).nullish(),
  note: z.string().trim().max(300).nullish(),
});

export const ExpenseCreate = z.object({
  category: z.string().trim().min(2).max(40),
  amountIrr: z.number().int().min(1),
  paidAt: z.string().min(10),
  method: z.enum(['cash', 'card_to_card', 'cheque', 'bank']),
  payee: z.string().trim().max(80).nullish(),
  note: z.string().trim().max(300).nullish(),
});

export const ProductCreate = z.object({
  name: z.string().trim().min(2).max(60),
  priceIrr: money,
  costIrr: money.default(0),
  stockQty: z.number().int().min(0).max(100000).default(0),
  lowStockThreshold: z.number().int().min(0).max(1000).default(3),
});

export const SaleCreate = z.object({
  memberId: z.string().nullish(),
  items: z.array(z.object({ productId: z.string().min(8), qty: z.number().int().min(1).max(999) })).min(1),
  method: z.enum(['cash', 'card_to_card', 'wallet', 'credit']),
  discountIrr: money.default(0),
});

export const UserCreate = z.object({
  username: z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9_.-]+$/, 'فقط حروف لاتین، رقم و ._-'),
  fullName: z.string().trim().min(3).max(80),
  role: z.enum(['owner', 'manager', 'receptionist', 'trainer']),
  password: z.string().min(6, 'رمز حداقل ۶ کاراکتر'),
  pin: z.string().regex(/^\d{4}$/, 'PIN باید ۴ رقم باشد').nullish(),
});

export const LoginInput = z.object({ username: z.string().trim().min(1), password: z.string().min(1) });
export const PinInput = z.object({ pin: z.string().regex(/^\d{4}$/) });

export const ChangePasswordInput = z.object({
  currentPassword: z.string().min(1, 'رمز فعلی را وارد کنید'),
  newPassword: z.string().min(6, 'رمز جدید حداقل ۶ کاراکتر'),
});

export const ResetWithCodeInput = z.object({
  username: z.string().trim().min(1, 'نام کاربری را وارد کنید'),
  code: z.string().trim().min(8, 'کد بازیابی را کامل وارد کنید'),
  newPassword: z.string().min(6, 'رمز جدید حداقل ۶ کاراکتر'),
});

export const ResetWithTokenInput = z.object({
  username: z.string().trim().min(1, 'نام کاربری را وارد کنید'),
  token: z.string().trim().min(10, 'متن توکن را وارد کنید'),
  signature: z.string().trim().min(10, 'امضا را وارد کنید'),
  newPassword: z.string().min(6, 'رمز جدید حداقل ۶ کاراکتر'),
});

export const CheckinInput = z.object({
  token: z.string().trim().min(3).optional(),
  memberId: z.string().min(8).optional(),
  method: z.enum(['barcode', 'qr_webcam', 'manual', 'kiosk']).default('barcode'),
  overrideReason: z.string().trim().max(200).optional(),
});

export const TicketCreate = z.object({
  subject: z.string().trim().min(5).max(120),
  category: z.enum(['install', 'license', 'billing', 'bug', 'howto', 'data', 'other']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  body: z.string().trim().min(10).max(5000),
});

export const SettingsSet = z.object({ key: z.string().min(1).max(60), value: z.string().max(2000) });

export type MemberCreateInput = z.infer<typeof MemberCreate>;
export type ContractCreateInput = z.infer<typeof ContractCreate>;
export type PaymentCreateInput = z.infer<typeof PaymentCreate>;
export type PlanCreateInput = z.infer<typeof PlanCreate>;
export type ProductCreateInput = z.infer<typeof ProductCreate>;
export type SaleCreateInput = z.infer<typeof SaleCreate>;
