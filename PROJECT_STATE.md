# PROJECT_STATE.md — GymPro

آخرین به‌روزرسانی: فاز ۰ (معماری و اسکیما) — **کد محصول نوشته نشده؛ عمداً.**

## ۱) تصمیم‌های قطعی

| # | تصمیم | وضعیت |
|---|---|---|
| ۱ | Electron + Next.js 15 `output: 'export'` (استاتیک، بدون سرور) | قطعی |
| ۲ | داده فقط از IPC؛ هیچ API Route / Server Action در رندرر | قطعی |
| ۳ | بارگذاری با پروتکل `app://` نه `file://` | قطعی (فاز ۱) |
| ۴ | SQLite + Drizzle (better-sqlite3) با WAL | قطعی |
| ۵ | UUIDv7 + `branch_id` + `outbox` + `version` + soft delete | **اجراشده در `migrations/0001_init.sql`** |
| ۶ | پول: INTEGER ریال. تاریخ کاری: `YYYY-MM-DD`. لحظه‌ها: ISO UTC | قطعی |
| ۷ | نقش‌ها: owner / manager / receptionist / trainer | قطعی |
| ۸ | لایسنس دائمی + اشتراک آپدیت ۱۲ ماهه، verify آفلاین با Ed25519 | قطعی |
| ۹ | بدون هیچ ترکر/آنالیتیکس داخل برنامه (تحلیل در `docs/legal-compliance.md`) | قطعی |
| ۱۰ | کاربران: **فقط ایران** → تحلیل حقوقی بر مبنای قانون ایران | تأییدشده توسط کارفرما |

## ۲) پنج سؤال شفاف‌ساز + فرض پیش‌فرض (اگر جواب ندهی، با فرض جلو می‌روم)

1. **نسخه‌ها**: Electron آخرین پایدار (۴۴.x) و Next 15.x با Node 24 روی این دستگاه تست شد؛
   هدف بیلد Node 20 LTS. → *فرض: همان.*
2. **کد ملی عضو لازم است؟** → *فرض: اختیاری و پیش‌فرض خالی.* باشگاه برای قرارداد کاغذی کد ملی
   را دارد؛ نگه‌داشتنش در نرم‌افزار ریسک اضافه است و لازم نیست. اگر قانوناً لازم شد، ستون از قبل هست.
3. **چند نفر هم‌زمان از یک نصب استفاده می‌کنند؟** → *فرض: یک دستگاه، نشست هم‌زمان یکی
   (قفل خودکار ۳ دقیقه).* چند کاربر هم‌زمان روی SQLite = صف نوشتن؛ اگر لازم شد، فاز ۱۲ با
   `better-sqlite3` در یک پروسه و صف IPC سریالی جواب می‌دهد، نه با چند پروسه.
4. **سرور لایسنس/آپدیت کجا باشد؟** → *فرض: همان VPS موجود (`194.56.148.100`, nginx + pm2)*
   با دو سرویس کوچک Node و فضای فایل برای مانیفست امضاشده. جزئیات: `docs/backends.md`.
5. **حق انصراف ۷ روزه نرم‌افزار را چطور اجرا کنیم؟** → *فرض: ۷ روز کاری بازگشت وجه بدون
   پرسش، با ذکر شرط در صفحه خرید* (م۳۷ قانون تجارت الکترونیک). تصمیم نهایی حقوقی با تو.

## ۳) ساختار پوشه‌ها (هدف نهایی)

```
gympro/
├─ package.json                # pnpm workspace
├─ pnpm-workspace.yaml
├─ PROJECT_STATE.md            # این فایل
├─ SCHEMA.md                   # دیاگرام و توضیح جداول
├─ docs/
│  ├─ architecture.md          # جریان داده Renderer↔Preload↔Main↔SQLite
│  ├─ backends.md              # معماری سرور لایسنس / آپدیت / تیکتینگ
│  ├─ legal-compliance.md      # بررسی ۶ بندی حقوقی + سیاست‌ها
│  └─ risks.md                 # ریسک‌های ویندوز و راه‌حل هرکدام
├─ legal/                      # متن‌های حقوقی آمادهٔ درج در برنامه و سایت
│  ├─ privacy-policy.md
│  ├─ terms.md
│  └─ cookies.md
├─ apps/
│  ├─ desktop/                 # پوستهٔ Electron
│  │  ├─ src/main/             # bootstrap، پنجره، tray، single-instance، app://
│  │  │  ├─ index.ts
│  │  │  ├─ protocol.ts
│  │  │  ├─ security.ts        # CSP، webPreferences، navigation guard
│  │  │  ├─ ipc/               # یک فایل به ازای هر دامنه
│  │  │  ├─ license/           # machineId، verify، anti-rollback، clock guard
│  │  │  ├─ update/            # electron-updater + verify امضا + rollback
│  │  │  ├─ support/           # صف ارسال، poller ۶۰ ثانیه
│  │  │  ├─ backup/            # بکاپ روزانه، چرخش، pre-migration
│  │  │  ├─ logging/           # لاگ چرخشی + crashReporter
│  │  │  └─ paths.ts           # resolveDataDir() — پرتابل / userData
│  │  ├─ preload/index.ts      # contextBridge، لیست سفید کانال‌ها
│  │  ├─ renderer/             # خروجی static Next.js (فقط بیلد)
│  │  └─ electron-builder.yml
│  └─ ui/                      # Next.js 15 (App Router, output: export)
│     ├─ app/(auth)/login/
│     ├─ app/(app)/dashboard|members|contracts|finance|attendance|kiosk|
│     │            classes|pos|lockers|reports|support|help|settings/
│     ├─ modules/              # هر ماژول مستقل: components + hooks + api-client
│     ├─ components/ui/        # shadcn/ui، RTL، focus-visible
│     ├─ lib/ipc.ts            # تایپ‌شده از shared/contracts
│     └─ styles/               # tailwind + فونت Vazirmatn محلی
├─ packages/
│  ├─ shared/                  # Zod schemaها + تایپ IPC + منطق تجاری خالص
│  │  ├─ schemas/              # member, contract, payment, ...
│  │  ├─ domain/               # expiry, freeze, renewal, sessions, cash close
│  │  └─ ipc-contracts.ts      # منبع واحد تایپ برای main و renderer
│  └─ db/
│     ├─ migrations/0001_init.sql   ✅ ساخته شد
│     ├─ src/schema.ts              # Drizzle (آینهٔ SQL)
│     ├─ src/repo/                  # تنها نقطهٔ نوشتن + withOutbox()
│     └─ src/migrate.ts             # بکاپ خودکار قبل از مایگریشن
├─ resources/                  # آیکون، فونت، قالب فیش، seed
└─ scripts/                    # rebuild بهتر-sqlite3، بیلد، امضای آپدیت
```

## ۴) وضعیت فازها

| فاز | عنوان | وضعیت |
|---|---|---|
| ۰ | معماری + اسکیما + لایسنس/آپدیت/تیکتینگ + ریسک‌ها | ✅ تمام |
| ۱ | اسکلت Electron + Next + `app://` + IPC + مایگریشن + بیلد پرتابل | ✅ تمام (خروجی ۱۵۵MB) |
| ۲ | Layout، سایدبار راست‌چین، تم، لاگین، نقش‌ها، Command Palette | ✅ تمام |
| ۳ | اعضا، تعرفه، قرارداد، تمدید/فریز، مالی، تردد، بارکدخوان | ✅ تمام |
| ۴ | داشبورد، گزارش، CSV، چاپ | ✅ تمام (PDF فیش در فاز بعد) |
| ۵ | کیوسک، QR، اسکن وبکم | ✅ کیوسک و QR تمام؛ اسکن وبکم باقی (jsQR نصب نشده) |
| ۶ | آنالیز بدنی، برنامه تمرینی، مربیان، کلاس | ✅ پایه تمام (UI تحلیل روند نموداری ندارد) |
| ۷ | بوفه/POS، انبار، کمد، پورسانت | ✅ بوفه/انبار/کمد تمام؛ پورسانت محاسبه نمی‌شود |
| ۸ | لایسنس دائمی، فعال/غیرفعال، ضد دستکاری ساعت | ✅ تمام و انتها‌به‌انتها تست‌شده |
| ۹ | آپدیت خودکار + بک‌اندها + تیکتینگ | ✅ تأیید امضا/دانلود و بک‌اند کامل؛ نصب خودکار exe دستی |
| ۱۰ | Setup Wizard + تور + مستندات | ✅ تمام |
| ۱۱ | پیامک آفلاین + گیمیفیکیشن + بکاپ | ✅ صف پیامک و بکاپ؛ گیمیفیکیشن حداقلی (امتیاز) |
| ۱۲ | بهینه‌سازی، تست، برندینگ، بیلد نهایی | ✅ تست دود، کنتراست، بیلد پرتابل |

### انحراف‌های آگاهانه از اسپک (با دلیل)

| اسپک | اجرا | دلیل |
|---|---|---|
| `better-sqlite3` + `@electron/rebuild` | `node:sqlite` داخلی Electron | این دستگاه Visual Studio Build Tools ندارد؛ هر ماژول native یعنی ریسک بیلد و حجم. `node:sqlite` همان موتور SQLite با API هم‌شکل است (تست‌شده) |
| Drizzle ORM | لایهٔ Repository با Prepared Statement + Zod | بدون native binary، بدون codegen؛ همهٔ کوئری‌ها پارامتردار و در `repo.ts` متمرکز |
| bcrypt | `scrypt` استاندارد Node | bcrypt کتابخانهٔ native است؛ scrypt در همان کلاس امنیتی و بدون بیلد |
| `react-joyride` | تور سبک اختصاصی | joyride با React 19 سازگار نیست (peer: 15–18) |
| `date-fns-jalali` | مبدل شمسی داخلی | با ۱۱۷۷ تاریخ در برابر `Intl` فارسی تست شد: صفر اختلاف |
| `electron-updater` | آپدیت‌گیر با Ed25519 | شرط اسپک «امضای Ed25519 قبل از نصب» با updater پیش‌فرض قابل اجرا نیست |
| `jsQR` (وبکم) | فقط بارکدخوان HID + QR تولیدی | وبکم فعلاً در سخت‌افزار باشگاه نیست؛ اسکلت آماده است |

## ۶) افزوده‌های پس از فاز ۱۲ (درخواست‌های بعدی کارفرما)

| افزوده | پیاده‌سازی | تست |
|---|---|---|
| بازیابی رمز عبور | migration `0002` + کد بازیابی یک‌بارمصرف (scrypt) + توکن پشتیبانی امضاشده (Ed25519، گره‌خورده به دستگاه + انقضا) + بازنشانی توسط مالک + محدودیت ۵ تلاش/۱۰ دقیقه + ثبت در `audit_logs` | انتها‌به‌انتها روی بیلد پرتابل |
| «مرا به خاطر بسپار» | `data\.session` رمزگذاری‌شده با DPAPI (`safeStorage`)، ۳۰ روز، ابطال با تغییر رمز/خروج/غیرفعال‌شدن کاربر؛ **رمز ذخیره نمی‌شود** | ری‌استارت واقعی |
| رنگ تم | `lib/theme.ts`: ۸ رنگ آماده + رنگ دلخواه، اصلاح خودکار روشنایی تا ۴٫۵:۱، ذخیره در `settings` (`ui.accent`) | `scripts/check-accents.ts` |
| چیدمان ثابت | پوسته `h-screen overflow-hidden`؛ فقط ناحیهٔ محتوا `overflow-y-auto`؛ سایدبار و هدر ثابت (`min-h-screen` حذف شد) | CDP: `scrollHeight == clientHeight` |
| حذف «پرش سریع» | دکمهٔ هدر + کامپوننت `Palette` + میان‌بر `Ctrl+K` کاملاً حذف شدند | CDP: `Ctrl+K` هیچ مودالی باز نمی‌کند |
| باگ صدور کارت | ریشه: ایندکس یکتای سراسری روی `member_cards.barcode_value` + بارکد ثابت `GP000123` برای هر کارت جدید. رفع: migration `0003` ایندکس را به `WHERE status='active'` محدود کرد و بارکد پسوند یکتا گرفت (`GP000004-3FA`)؛ جست‌وجو هم `GP…-` و شمارهٔ خالی را می‌پذیرد | CDP: دو صدور پشت‌سرهم بدون خطا |
| چاپ کارت | `@media print` با `body:has(.print-card)` فقط کارت را چاپ می‌کند؛ راهنما و دکمه‌ها `no-print`؛ عرض ۱۰۰mm وسط‌چین | `scripts/print-check.mjs` (media=print) |
| راهنمای اسکن | مقالهٔ «اسکن بارکد و QR» (نوع اسکنر، اتصال، آستانهٔ ۳۰۰ms/۶ کاراکتر، عیب‌یابی) + کادر راهنما در مودال کارت + مقالهٔ «صدور کارت QR» بازنویسی شد | متن در `components/views/Help.tsx` |
| پنل مدیریت لایسنس/آپدیت/تیکت | `server/admin.mjs` (بدون وابستگی): ورود scrypt، نشست HMAC با کوکی HttpOnly، CSRF، rate limit، ساخت/غیرفعال‌سازی کلید، آزادکردن اسلات، توکن بازیابی، انتشار مانیفست امضاشده، پاسخ تیکت، سرو فایل `releases` | `scripts/test-admin.mjs` + `test-admin-publish.mjs` |
| حذف عضو | `members.remove`: حذف نرم + باطل‌کردن کارت‌های فعال + پایان اجارهٔ کمد؛ برگشت‌پذیر با `restore` | CDP |
| لغو قرارداد / حذف تعرفه | `contracts.cancel` (وضعیت `cancelled`) و `plans.remove` (غیرفعال + حذف نرم) + دکمه و تأییدیه در UI | CDP |
| کمد/مربی/کلاس: ویرایش و حذف | `lockers.update/remove`، `trainers.update/remove`، `classes.update/remove` با اعتبارسنجی (کمد اجاره‌ای قابل حذف نیست، ظرفیت کلاس کمتر از ثبت‌نام‌ها نمی‌شود، کلاس‌های مربی حذف‌شده بدون مربی می‌مانند) | CDP |
| کلاس چندروزه | `classes.createMany` برای هر روز یک ردیف می‌سازد؛ UI با ۷ دکمهٔ روز (aria-pressed) انتخاب چندگانه می‌دهد | CDP |
| اسکنر لیزری یک‌بعدی | کارت حالا `Code128` (JsBarcode) هم دارد؛ اسکنر رشتهٔ `GP000001-XXX` را می‌فرستد و `cards.lookup` آن را می‌پذیرد | SVG در DOM + PNG خروجی |
| کیوسک روی نمایشگر دوم | `kiosk:openWindow` پنجرهٔ دوم بدون سایدبار؛ `?kiosk=1` در App باعث رندر فقط کیوسک می‌شود | CDP روی تب دوم |


## ۷) افزوده‌های کارفرما (از پیام جدا) و جای هرکدام در نقشه راه


| درخواست | تصمیم معماری | فاز |
|---|---|---|
| چت‌بات هوش مصنوعی با مستندات | **نه** چت‌بات آنلاین داخل برنامه. جایگزین: دستیار راهنمای آفلاین مبتنی بر ایندکس محلی مستندات (FTS5 فارسی) + دکمهٔ «تیکت بفرست» | ۱۰ |
| فارسی/RTL + فونت وزیر | فونت محلی باندل‌شده (بدون CDN)، `dir=rtl`, `lang=fa`, اعداد فارسی قابل تغییر | ۲ |
| بخش راهنما + تور آموزشی | `react-joyride` + F1 + جستجوی فارسی + ویدیوی کش‌شده | ۱۰ |
| بررسی امنیتی | `docs/risks.md` + `security.ts` + Zod مشترک + CSP + تعطیل nodeIntegration | ۱ و ۱۲ |
| ماژول مستقل هر بخش | `apps/ui/modules/<feature>` با مرز مشخص و صفر ایمپورت متقابل | ۲ به بعد |
| طراحی با سبک scroll trigger | فقط در **سایت** محصول (فروش/معرفی)؛ داخل برنامهٔ منشی با `prefers-reduced-motion` خاموش می‌شود | سایت جدا |
