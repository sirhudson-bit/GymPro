# لندینگ عمومی و پنل مالک

`https://gym.academyr.ir/` یک صفحهٔ معرفی عمومی است.

## پنل مالک: لینک اختصاصی

پنل هیچ آدرس عمومی‌ای ندارد. مسیر آن یک **اسلاگ تصادفی ۱۶ کاراکتری** است که فقط در سرور ساخته می‌شود:

```
/var/www/gym-admin/data/admin-path.json   (0600)
→ {"slug":"DCkx6ZthhPzBhPU","createdAt":"..."}
```

آدرس ورود: `https://gym.academyr.ir/<slug>/login`

| مسیر | وضعیت |
|---|---|
| `/<slug>/login` | ورود مالک |
| `/<slug>/dashboard`، `/licenses`، `/tickets`، `/updates`، `/landing`، `/help` | پنل (نیازمند کوکی) |
| `/login`، `/dashboard`، `/licenses`، `/updates`، `/tickets`، `/help` | **404** — این آدرس‌ها وجود ندارند |
| `/` | لندینگ |
| `/download/*` | دانلود نصب‌کننده |

اگر اسلاگ لو رفت، فایل `admin-path.json` را پاک کن و سرویس را ری‌استارت کن؛ اسلاگ تازه ساخته می‌شود (نشست‌ها باطل نمی‌شوند چون امضای کوکی جداست).

از درون لندینگ هیچ لینک یا اشاره‌ای به پنل وجود ندارد.

## ویرایش لندینگ از پنل

پنل → **لندینگ** (`/<slug>/landing`):

- ۹ متن کلیدی: عنوان صفحه، سه خط عنوان، توضیح زیر عنوان، عنوان/توضیح امکانات، عنوان/توضیح دانلود، عنوان پرسش‌ها
- اطلاعیهٔ بالای صفحه (هر خط یک مورد) — با `<!--landing-notes-->` تزریق می‌شود
- «پنهان کردن لندینگ»: بازدیدکننده پیام «این سایت موقتاً در دسترس نیست» می‌بیند؛ پنل و دانلود کار می‌کنند
- فیلد خالی = متن پیش‌فرض فایل `landing/index.html`

ذخیره در `data/landing.json`. متن‌ها با `esc()` فرار می‌کنند و **فقط داخل عناصر `data-lx`** جای می‌گیرند؛ ساختار HTML تغییر نمی‌کند.

## منابع تصویری

| نوع | اندازه | محل |
|---|---|---|
| اسکرین‌شات برنامه | ۱۱۰۰×۷۲۰ (رندر ۲x → `2200×1440`) | `landing/img/s-*.png` |
| طرح‌های ساده (SVG درون‌خطی) | برداری | داخل `landing/index.html` |
| عکس فیتنس | ۱۶۰۰px | `landing/img/f1.jpg` |

**قانون کیفیت تصویر:** اسکرین‌شات باید در همان عرضی گرفته شود که نمایش داده می‌شود. عکس ۲۲۰۰ پیکسلی که در ۵۰۰ پیکسل نمایش داده شود متن را خمیر می‌کند. `scripts/shot-hd.mjs` با `deviceScaleFactor=2` و عرض ۱۱۰۰ عکس می‌گیرد.

## بازسازی اسکرین‌شات‌ها

```bash
# ۱) برنامه را با دادهٔ نمونه بالا بیاور
PORTABLE_EXECUTABLE_DIR=... electron . --remote-debugging-port=9580
node scripts/cdp-probe.mjs "$(cat scripts/seed-demo.js)" 9580    # داخل async بپیچ
# ۲) از هر صفحه عکس ۲x بگیر
for v in dashboard members lockers attendance reports; do
  node scripts/shot-hd.mjs ".hd/w-$v.png" 9580 1100 720 2
done
# ۳) به عرض نمایش برش بزن
python -c "from PIL import Image; ..."   # 2200 → 1100
```

## پالت

| نقش | مقدار |
|---|---|
| صورتی (اصلی) | `#ff0057` |
| بنفش | `#a34eff` |
| آبی | `#53a5ff` |
| پس‌زمینه | `#0a0c12` |

## انتشار نسخه
```bash
node scripts/release.mjs 1.2.3 "یادداشت"
python scripts/stage-download.py
scp server/downloads/{GymPro-Setup.exe,info.json,GymPro-Setup.exe.sha256} root@194.56.148.100:/var/www/gym-admin/downloads/
```
