#!/usr/bin/env bash
# ============================================================
#  نصب خودکار پنل WireGuard روی VPS (Ubuntu / Debian)
#  باید با کاربر root اجرا شود:  sudo bash install.sh
# ============================================================
set -e

echo ">>> نصب WireGuard و Node.js ..."
apt-get update -y
apt-get install -y wireguard wireguard-tools iptables curl

# نصب Node.js 20 اگر نبود
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# فعال‌سازی IP forwarding
echo ">>> فعال‌سازی IP forwarding ..."
sysctl -w net.ipv4.ip_forward=1
grep -q "net.ipv4.ip_forward=1" /etc/sysctl.conf || echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf

# تشخیص اینترفیس خروجی و IP عمومی
WAN=$(ip route get 8.8.8.8 | grep -oP 'dev \K\S+' | head -1)
PUBIP=$(curl -s --max-time 5 ifconfig.me || echo "")

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
echo ">>> مسیر پنل: $APP_DIR"
echo ">>> اینترفیس خروجی: $WAN | IP عمومی: $PUBIP"

# رمز پنل (اگر ندادی، بپرس)
read -rp "رمز عبور پنل را وارد کن [پیش‌فرض: تصادفی]: " PANEL_PASS
[ -z "$PANEL_PASS" ] && PANEL_PASS=$(openssl rand -hex 8)

# ساخت سرویس systemd
cat > /etc/systemd/system/wg-panel.service <<EOF
[Unit]
Description=WireGuard Config Panel
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) $APP_DIR/server.js
Restart=always
Environment=PORT=3000
Environment=WG_INTERFACE=wg0
Environment=WG_PORT=51820
Environment=WAN_INTERFACE=$WAN
Environment=SERVER_ENDPOINT=$PUBIP
Environment=PANEL_PASSWORD=$PANEL_PASS
Environment=WG_MTU=1420

[Install]
WantedBy=multi-user.target
EOF

# باز کردن فایروال (در صورت وجود ufw)
if command -v ufw >/dev/null 2>&1; then
  ufw allow 51820/udp || true
  ufw allow 3000/tcp || true
fi

systemctl daemon-reload
systemctl enable wg-panel
systemctl restart wg-panel

echo ""
echo "============================================================"
echo " ✅ نصب کامل شد!"
echo " پنل:      http://$PUBIP:3000"
echo " رمز ورود: $PANEL_PASS"
echo " پورت UDP وایرگارد: 51820  (در Security Group / فایروال باز باشد)"
echo "============================================================"
echo " مدیریت سرویس:"
echo "   systemctl status wg-panel   # وضعیت"
echo "   journalctl -u wg-panel -f   # لاگ زنده"
echo "   systemctl restart wg-panel  # ری‌استارت"
echo "============================================================"
