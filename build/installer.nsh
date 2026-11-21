; GymPro — اسکریپت‌های اضافی نصب‌کننده (NSIS)
; مسیر داده‌ها زیر AppData کاربر می‌ماند؛ حذف برنامه داده‌ها را پاک نمی‌کند.

!macro customInstall
  ; پوشهٔ دادهٔ برنامه را از پیش می‌سازیم تا اولین اجرا سریع‌تر باشد
  CreateDirectory "$APPDATA\GymPro\data"
  CreateDirectory "$APPDATA\GymPro\data\backups"
  CreateDirectory "$APPDATA\GymPro\data\logs"
!macroend

!macro customUnInstall
  ; داده‌ها عمداً باقی می‌مانند (قراردادها، پرداخت‌ها، عکس اعضا)
!macroend
