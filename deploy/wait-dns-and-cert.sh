#!/usr/bin/env bash
# منتظر تغییر رکورد A می‌ماند؛ به‌محض دیده‌شدن 194.56.148.100 گواهی TLS را می‌گیرد.
set -uo pipefail
DOMAIN=gym.academyr.ir
TARGET=194.56.148.100
HOST=194.56.148.100
DEADLINE=$(( $(date +%s) + 1200 ))

seen() {
  nslookup -norecurse -type=A "$DOMAIN" irns1.netafraz.com 2>/dev/null \
    | awk '/^Name:/{f=1;next} f && /^Address:/{print $2; exit}'
}

while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  ip=$(seen)
  echo "$(date +%H:%M:%S) → ${ip:-?}"
  if [ "$ip" = "$TARGET" ]; then
    echo "READY: DNS به سرور اشاره می‌کند"
    ssh -o BatchMode=yes "root@$HOST" "certbot --nginx -d $DOMAIN --redirect --non-interactive --agree-tos --register-unsafely-without-email 2>&1 | tail -6; nginx -t 2>&1 | tail -1; systemctl reload nginx" || exit 1
    echo "--- verify ---"
    curl -s -o /dev/null -w "https root      → %{http_code}\n" "https://$DOMAIN/"
    curl -s -o /dev/null -w "https /login    → %{http_code}\n" "https://$DOMAIN/login" --resolve "$DOMAIN:443:$HOST"
    curl -s -o /dev/null -w "http redirect   → %{http_code} %{redirect_url}\n" "http://$DOMAIN/login" --resolve "$DOMAIN:80:$HOST"
    echo | openssl s_client -servername "$DOMAIN" -connect "$HOST:443" 2>/dev/null | openssl x509 -noout -subject -dates
    exit 0
  fi
  sleep 30
done
echo "TIMEOUT: در ۲۰ دقیقه رکورد عوض نشد (هنوز ${ip:-?})"
exit 2
