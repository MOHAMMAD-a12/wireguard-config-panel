#!/usr/bin/env bash
# ============================================================
#  حالت ضدفیلتر: نصب AmneziaWG (هستهٔ WireGuard مقاوم در برابر DPI)
#  مخصوص عبور از فیلترینگ (ایران/روسیه) با حفظ پینگ پایین WireGuard
#  اجرا:  sudo bash install-amnezia.sh
# ============================================================
set -e

echo ">>> افزودن مخزن AmneziaWG و نصب ..."
apt-get update -y
apt-get install -y software-properties-common curl iptables
add-apt-repository -y ppa:amnezia/ppa
apt-get update -y
# ابزارها + ماژول کرنل (اگر DKMS نصب شد بهتر است)
apt-get install -y amneziawg amneziawg-tools || apt-get install -y amneziawg-tools

# فورواردینگ
sysctl -w net.ipv4.ip_forward=1
grep -q "net.ipv4.ip_forward=1" /etc/sysctl.conf || echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf

# مسیر کانفیگ AmneziaWG
mkdir -p /etc/amnezia/amneziawg

# تشخیص اینترفیس خروجی درست (مهم برای NAT)
WAN=$(ip route get 8.8.8.8 | grep -oP 'dev \K\S+' | head -1)
PUBIP=$(curl -s --max-time 5 ifconfig.me || echo "")
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_BIN="$(command -v node)"

read -rp "رمز عبور پنل [Enter = تصادفی]: " PANEL_PASS
[ -z "$PANEL_PASS" ] && PANEL_PASS=$(openssl rand -hex 8)

# توقف تونل قدیمی wg اگر بود
wg-quick down wg0 2>/dev/null || true

# بازنویسی سرویس با حالت AWG روشن
cat > /etc/systemd/system/wg-panel.service <<EOF
[Unit]
Description=WireGuard/AmneziaWG Config Panel
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN $APP_DIR/server.js
Restart=always
Environment=PORT=3000
Environment=AWG=1
Environment=WG_INTERFACE=awg0
Environment=WG_CONFIG=/etc/amnezia/amneziawg/awg0.conf
Environment=WG_DATA=/etc/amnezia/amneziawg/panel-clients.json
Environment=WG_PORT=51820
Environment=WAN_INTERFACE=$WAN
Environment=SERVER_ENDPOINT=$PUBIP
Environment=PANEL_PASSWORD=$PANEL_PASS
Environment=WG_MTU=1420

[Install]
WantedBy=multi-user.target
EOF

# فایروال
if command -v ufw >/dev/null 2>&1; then
  ufw allow 51820/udp || true
  ufw allow 3000/tcp || true
fi

# داده‌های قبلی را پاک کن تا پارامترهای ضدفیلتر از نو ساخته شوند
rm -f /etc/wireguard/panel-clients.json /etc/amnezia/amneziawg/panel-clients.json 2>/dev/null || true

systemctl daemon-reload
systemctl enable wg-panel
systemctl restart wg-panel

echo ""
echo "============================================================"
echo " ✅ حالت ضدفیلتر AmneziaWG فعال شد!"
echo " پنل:      http://$PUBIP:3000"
echo " رمز ورود: $PANEL_PASS"
echo ""
echo " ⚠️ مهم: کلاینت‌ها باید با اپ «AmneziaWG» وصل شوند، نه اپ استاندارد WireGuard."
echo "        اپ استاندارد WireGuard پارامترهای ضدفیلتر (Jc/S1/H1...) را نمی‌شناسد."
echo ""
echo " اپ‌ها: Android/iOS/Windows/Mac → «AmneziaWG» یا «AmneziaVPN»"
echo " کانفیگ‌های قبلی دیگر کار نمی‌کنند؛ در پنل کلاینت جدید بساز."
echo "============================================================"
