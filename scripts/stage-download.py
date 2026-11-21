# -*- coding: utf-8 -*-
# نصب‌کنندهٔ آماده‌دانلود + info.json در سرور
import hashlib, json, os, shutil, datetime, pathlib

src = 'dist/GymPro-Setup-1.2.2.exe'
dst_dir = 'server/downloads'
os.makedirs(dst_dir, exist_ok=True)
dst = os.path.join(dst_dir, 'GymPro-Setup.exe')

h = hashlib.sha256()
with open(src, 'rb') as f:
    for chunk in iter(lambda: f.read(1 << 20), b''):
        h.update(chunk)
digest = h.hexdigest()

shutil.copyfile(src, dst)
size = os.path.getsize(dst)

# فایل چک‌سام برای دانلود مستقیم
with open(dst + '.sha256', 'w', encoding='utf-8', newline='\n') as f:
    f.write(f'{digest}  GymPro-Setup.exe\n')

info = {
    'filename': 'GymPro-Setup.exe',
    'version': '1.2.2',
    'size': size,
    'date': datetime.date.today().isoformat(),
    'sha256': digest,
}
with open(os.path.join(dst_dir, 'info.json'), 'w', encoding='utf-8', newline='\n') as f:
    json.dump(info, f, ensure_ascii=False, indent=2)

print(json.dumps(info, ensure_ascii=False, indent=2))
print('copied to', dst, size, 'bytes')
