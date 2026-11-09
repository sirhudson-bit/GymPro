#!/usr/bin/env bash
# سرویس API لایسنس/آپدیت/تیکت را کنار پنل بالا می‌آورد و /v1/ و /latest.json را از همان دامنه سرو می‌کند.
set -euo pipefail
APP_DIR=/var/www/gym-admin
DOMAIN=gym.academyr.ir
API_PORT=8788

echo "== pm2: gympro-api =="
cd "$APP_DIR"
HOST=127.0.0.1 PORT=$API_PORT pm2 delete gympro-api >/dev/null 2>&1 || true
HOST=127.0.0.1 PORT=$API_PORT pm2 start api.mjs --name gympro-api --cwd "$APP_DIR" --time >/dev/null
pm2 save >/dev/null
sleep 2
ss -tlnp | grep ":$API_PORT" || echo "  ! پورت بسته است"

echo "== nginx: /v1/ + /latest.json =="
python3 - <<'PY'
import re
path = '/etc/nginx/sites-available/gym.academyr.ir'
conf = open(path, encoding='utf-8').read()
block = '''    location /v1/ {
        proxy_pass http://127.0.0.1:8788;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
    location = /latest.json {
        proxy_pass http://127.0.0.1:8788;
        proxy_set_header Host $host;
    }

    location / {'''
if '/v1/' not in conf:
    conf = conf.replace('    location / {', block, 1)
    open(path, 'w', encoding='utf-8').write(conf)
    print('  vhost به‌روزرسانی شد')
else:
    print('  از قبل هست')
PY
nginx -t && systemctl reload nginx

echo "== آزمون =="
curl -s -o /dev/null -w "  /v1/activate (بدون کلید) → %{http_code}\n" -X POST -H 'content-type: application/json' -d '{}' https://$DOMAIN/v1/activate
curl -s -o /dev/null -w "  /login                    → %{http_code}\n" https://$DOMAIN/login
curl -s https://$DOMAIN/v1/activate -X POST -H 'content-type: application/json' -d '{"licenseKey":"GP-NOPE","machineId":"0123456789ABCDEF0123456789ABCDEF"}' | head -c 120; echo
