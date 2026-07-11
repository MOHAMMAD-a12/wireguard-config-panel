# 🛡️ WireGuard Config Panel — پنل بهینهٔ گیم

پنل تحت وب برای مدیریت **واقعی** WireGuard روی VPS. با هستهٔ `wg`/`wg-quick` کار می‌کند،
از داخل مرورگر کلاینت می‌سازد و همان لحظه روی سرور اعمال می‌کند. بدون هیچ وابستگی npm.

## ویژگی‌ها
- ساخت/حذف کلاینت با اعمال زندهٔ روی `wg0` (`wg set`) بدون قطع اتصال بقیه
- ورود با رمز عبور
- QR Code و دانلود `.conf` برای هر کلاینت
- نمایش وضعیت آنلاین/آفلاین، آخرین handshake و ترافیک هر کلاینت
- تنظیمات بهینهٔ گیم: `MTU=1420`, `PersistentKeepalive=25`
- حالت **Full** (کل ترافیک) یا **Split / فقط بازی** (فقط رنج IP سرور بازی برای پینگ کمتر)

> ⚠️ WireGuard به **UDP** و دسترسی **root** نیاز دارد؛ روی سرویس‌های فقط-HTTP مثل Railway
> «هستهٔ تونل» اجرا نمی‌شود. این پنل برای **VPS واقعی (Ubuntu/Debian)** است.

---

## نصب سریع روی VPS (Ubuntu/Debian)

```bash
# ۱) کلون
git clone https://github.com/MOHAMMAD-a12/wireguard-config-panel.git
cd wireguard-config-panel

# ۲) نصب خودکار (WireGuard + Node + سرویس systemd)
sudo bash install.sh
```

بعد از نصب، پنل روی `http://IP-سرور:3000` بالا می‌آید و رمز ورود نمایش داده می‌شود.

---

## اجرای دستی (بدون install.sh)

```bash
# پیش‌نیازها
sudo apt update && sudo apt install -y wireguard wireguard-tools nodejs npm curl
sudo sysctl -w net.ipv4.ip_forward=1

# اجرا (به‌صورت root چون wg را مدیریت می‌کند)
sudo PORT=3000 \
     WG_INTERFACE=wg0 \
     WG_PORT=51820 \
     WAN_INTERFACE=eth0 \
     SERVER_ENDPOINT=IP-عمومی-سرور \
     PANEL_PASSWORD=رمز-دلخواه \
     node server.js
```

---

## متغیرهای محیطی

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `PORT` | `3000` | پورت وب پنل |
| `WG_INTERFACE` | `wg0` | نام اینترفیس WireGuard |
| `WG_PORT` | `51820` | پورت UDP وایرگارد |
| `WAN_INTERFACE` | `eth0` | اینترفیس خروجی سرور (برای NAT) |
| `WG_SUBNET` | `10.7.0.0/24` | شبکهٔ داخلی تونل |
| `SERVER_ENDPOINT` | خودکار | IP عمومی سرور |
| `PANEL_PASSWORD` | `admin` | رمز ورود پنل (**حتماً عوض کن**) |
| `WG_MTU` | `1420` | MTU |

---

## 🎮 کاهش پینگ در بازی
- **مهم‌ترین عامل:** موقعیت VPS. سروری نزدیک دیتاسنتر بازی و با پیرینگ خوب بگیر.
- اگر لگ/قطعی داری: `WG_MTU` را روی `1380` یا `1280` بگذار.
- برای پینگ کمتر، در ساخت کلاینت حالت **«فقط بازی»** را بزن و فقط رنج IP سرورهای آن بازی را در AllowedIPs بگذار تا کل ترافیک تونل نشود.
- مطمئن شو پورت **UDP 51820** در فایروال و Security Group ارائه‌دهندهٔ VPS باز است.

## 🔒 امنیت
پنل با دسترسی root سرور را مدیریت می‌کند. حتماً:
- `PANEL_PASSWORD` قوی بگذار.
- در تولید، پنل را پشت **Nginx + HTTPS** بگذار یا پورت 3000 را فقط از IP خودت باز کن.

## License
MIT
