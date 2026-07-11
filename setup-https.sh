#!/usr/bin/env bash
# ============================================================
#  اسکریپت اختیاری: HTTPS با Nginx + دامنه + Let's Encrypt
#  پنل را پشت ریورس‌پروکسی امن می‌برد.
#  اجرا:  sudo bash setup-https.sh example.com
#  (اختیاری است — پنل بدون این هم روی HTTP کار می‌کند)
# ============================================================
set -e

DOMAIN="$1"
if [ -z "$DOMAIN" ]; then
  read -rp "دامنه‌ات را وارد کن (مثلاً vpn.example.com): " DOMAIN
fi
[ -z "$DOMAIN" ] && { echo "❌ دامنه لازم است."; exit 1; }

read -rp "ایمیل برای Let's Encrypt: " EMAIL
[ -z "$EMAIL" ] && { echo "❌ ایمیل لازم است."; exit 1; }

PANEL_PORT="${PANEL_PORT:-3000}"

echo ">>> نصب Nginx و Certbot ..."
apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx

echo ">>> ساخت کانفیگ Nginx برای $DOMAIN ..."
cat > /etc/nginx/sites-available/wg-panel <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$PANEL_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

ln -sf /etc/nginx/sites-available/wg-panel /etc/nginx/sites-enabled/wg-panel
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# باز کردن پورت‌های وب در فایروال در صورت وجود ufw
if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
fi

echo ">>> گرفتن گواهی SSL از Let's Encrypt ..."
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect

echo ""
echo "============================================================"
echo " ✅ HTTPS فعال شد!"
echo " پنل امن:  https://$DOMAIN"
echo " گواهی به‌صورت خودکار هر ۹۰ روز تمدید می‌شود (certbot timer)."
echo ""
echo " ⚠️ اکنون پورت 3000 را از دسترسی عمومی ببند (فقط از طریق Nginx):"
echo "     ufw deny 3000/tcp"
echo "============================================================"
