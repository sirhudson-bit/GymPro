#!/usr/bin/env bash
# راه‌اندازی پنل مدیریت جیم‌پرو روی VPS — gym.academyr.ir
set -euo pipefail

APP_DIR=/var/www/gym-admin
DOMAIN=gym.academyr.ir
PORT=8899
PM2_NAME=gympro-admin
ENV_FILE=/root/gym-admin.env

echo "== 1) پوشه‌ها =="
mkdir -p "$APP_DIR"/{data,keys,releases}
chmod 700 "$APP_DIR/keys"

echo "== 2) متغیرهای محیطی (رمز یک‌بار ساخته می‌شود، چاپ نمی‌شود) =="
if [ ! -f "$ENV_FILE" ]; then
  PASS=$(openssl rand -base64 24 | tr -d '\n')
  cat > "$ENV_FILE" <<EOF
ADMIN_PASSWORD=$PASS
PORT=$PORT
BASE_URL=https://$DOMAIN
EOF
  chmod 600 "$ENV_FILE"
  echo "   ساخته شد: $ENV_FILE (رمز داخلش است — با cat بخوان)"
else
  echo "   از قبل هست: $ENV_FILE"
fi
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

echo "== 3) pm2 =="
pm2 delete "$PM2_NAME" >/dev/null 2>&1 || true
cd "$APP_DIR"
ADMIN_PASSWORD="$ADMIN_PASSWORD" PORT="$PORT" BASE_URL="$BASE_URL" \
  pm2 start admin.mjs --name "$PM2_NAME" --cwd "$APP_DIR" --time >/dev/null
pm2 save >/dev/null
sleep 2
pm2 describe "$PM2_NAME" | grep -E "status|uptime" | head -2

echo "== 4) nginx =="
cat > /etc/nginx/sites-available/$DOMAIN <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    client_max_body_size 300m;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy no-referrer always;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
EOF
ln -sfn /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
nginx -t && systemctl reload nginx

echo "== 5) TLS =="
if [ "$(getent hosts $DOMAIN | awk '{print $1}' | head -1)" = "194.56.148.100" ]; then
  certbot --nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos \
    --register-unsafely-without-email 2>&1 | tail -4
  nginx -t && systemctl reload nginx
else
  echo "   DNS هنوز به این سرور اشاره نمی‌کند: $(getent hosts $DOMAIN | awk '{print $1}' | head -1) — certbot رد شد"
fi

echo "== 6) آزمون =="
curl -s -o /dev/null -w "  /health  → %{http_code}\n" http://127.0.0.1:$PORT/health
curl -s -H "Host: $DOMAIN" -o /dev/null -w "  vhost    → %{http_code}\n" http://127.0.0.1/login
curl -s -H "Host: $DOMAIN" http://127.0.0.1/login | grep -c "پنل مدیریت جیم‌پرو" | sed 's/^/  صفحهٔ ورود: /'
