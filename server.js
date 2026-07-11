// ============================================================
//  WireGuard Panel — پنل مدیریت واقعی WireGuard روی VPS
//  بدون هیچ وابستگی npm — فقط Node.js داخلی
//  با هستهٔ واقعی wg / wg-quick کار می‌کند
// ============================================================
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, execFileSync } = require('child_process');

// ---------- تنظیمات از متغیرهای محیطی ----------
const PORT       = process.env.PORT || 3000;
const WG_IF      = process.env.WG_INTERFACE || 'wg0';
const WG_CONF    = process.env.WG_CONFIG    || `/etc/wireguard/${WG_IF}.conf`;
const DATA_FILE  = process.env.WG_DATA      || `/etc/wireguard/panel-clients.json`;
const SUBNET     = process.env.WG_SUBNET    || '10.7.0.0/24';   // شبکهٔ تونل
const WG_PORT    = process.env.WG_PORT      || '51820';         // پورت UDP وایرگارد
const WAN_IF     = process.env.WAN_INTERFACE|| 'eth0';          // اینترفیس خروجی سرور
const PANEL_PASS = process.env.PANEL_PASSWORD || 'admin';       // رمز ورود پنل
const DEFAULT_MTU= process.env.WG_MTU       || '1420';
const DEFAULT_DNS= process.env.WG_DNS       || '1.1.1.1, 8.8.8.8';
let   ENDPOINT   = process.env.SERVER_ENDPOINT || '';           // IP عمومی سرور

// ---- حالت ضدفیلتر AmneziaWG (DPI-resistant) ----
// AWG=1 → از باینری awg / awg-quick استفاده کن و پارامترهای obfuscation را به کانفیگ اضافه کن
const USE_AWG    = process.env.AWG === '1' || process.env.AWG === 'true';
const WG_BIN     = USE_AWG ? 'awg' : 'wg';
const WGQUICK    = USE_AWG ? 'awg-quick' : 'wg-quick';

const ROOT = path.join(__dirname, 'public');
const IS_LINUX = process.platform === 'linux';

// ---------- ابزارها ----------
function sh(cmd) { return execSync(cmd, { encoding: 'utf8' }).trim(); }
function wg(args) { return execFileSync(WG_BIN, args, { encoding: 'utf8' }).trim(); }

// پارامترهای obfuscation برای AmneziaWG — یک‌بار ساخته و بین سرور و همهٔ کلاینت‌ها مشترک می‌شود
function genObfuscation() {
  const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  // H1..H4 باید متمایز و بزرگ‌تر از 4 باشند
  const hs = new Set();
  while (hs.size < 4) hs.add(rnd(5, 2147483000));
  const [H1, H2, H3, H4] = [...hs];
  return { Jc: rnd(3, 8), Jmin: 40, Jmax: 70, S1: rnd(15, 100), S2: rnd(15, 100), H1, H2, H3, H4 };
}
function obfLines(o) {
  if (!USE_AWG || !o) return '';
  return `Jc = ${o.Jc}\nJmin = ${o.Jmin}\nJmax = ${o.Jmax}\nS1 = ${o.S1}\nS2 = ${o.S2}\n`
       + `H1 = ${o.H1}\nH2 = ${o.H2}\nH3 = ${o.H3}\nH4 = ${o.H4}\n`;
}

function detectEndpoint() {
  if (ENDPOINT) return ENDPOINT;
  try { ENDPOINT = sh('curl -s --max-time 4 ifconfig.me || curl -s --max-time 4 ipinfo.io/ip'); }
  catch { ENDPOINT = ''; }
  return ENDPOINT;
}

// جفت‌کلید واقعی WireGuard (Curve25519) با خود wg
function genKeypair() {
  if (IS_LINUX) {
    const priv = wg(['genkey']);
    const pub  = execSync(`${WG_BIN} pubkey`, { input: priv, encoding: 'utf8' }).trim();
    return { priv, pub };
  }
  // fallback فقط برای تست روی ویندوز/مک (بدون wg)
  const kp = crypto.generateKeyPairSync('x25519');
  const rawPriv = kp.privateKey.export({ type: 'pkcs8', format: 'der' }).slice(-32);
  const rawPub  = kp.publicKey.export({ type: 'spki', format: 'der' }).slice(-32);
  return { priv: rawPriv.toString('base64'), pub: rawPub.toString('base64') };
}

// ---------- ذخیرهٔ داده ----------
function loadData() {
  let d;
  try { d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch {
    d = { server: genKeypair(), clients: [] };
  }
  // پارامترهای ضدفیلتر را یک‌بار بساز و ثابت نگه‌دار (باید سرور و کلاینت یکسان باشند)
  if (!d.obf) { d.obf = genObfuscation(); saveData(d); }
  return d;
}
function saveData(d) {
  try { fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true }); } catch {}
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

// IP بعدیِ آزاد در ساب‌نت
function nextIP(d) {
  const base = SUBNET.split('/')[0].split('.').slice(0, 3).join('.'); // مثل 10.7.0
  const used = new Set(d.clients.map(c => c.ip.split('/')[0]));
  used.add(`${base}.1`); // خود سرور
  for (let i = 2; i < 255; i++) {
    const ip = `${base}.${i}`;
    if (!used.has(ip)) return `${ip}/32`;
  }
  throw new Error('ساب‌نت پر شده است');
}

function serverIP() {
  const base = SUBNET.split('/')[0].split('.').slice(0, 3).join('.');
  const cidr = SUBNET.split('/')[1] || '24';
  return `${base}.1/${cidr}`;
}

// ---------- ساخت فایل کانفیگ سرور ----------
function buildServerConf(d) {
  let out =
`[Interface]
Address = ${serverIP()}
ListenPort = ${WG_PORT}
PrivateKey = ${d.server.priv}
MTU = ${DEFAULT_MTU}
${obfLines(d.obf)}PostUp   = iptables -A FORWARD -i %i -j ACCEPT; iptables -t nat -A POSTROUTING -o ${WAN_IF} -j MASQUERADE
PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -t nat -D POSTROUTING -o ${WAN_IF} -j MASQUERADE
`;
  for (const c of d.clients) {
    out += `\n[Peer]\n# ${c.name}\nPublicKey = ${c.pub}\nAllowedIPs = ${c.ip}\n`;
  }
  return out;
}

// نوشتن روی دیسک + اعمال زندهٔ بدون قطعی
function applyServer(d) {
  if (!IS_LINUX) { console.log('[dev] skip applying wg (not linux)'); return; }
  fs.writeFileSync(WG_CONF, buildServerConf(d));
  try {
    // اگر اینترفیس بالا نیست، بالا بیاور؛ در غیر این صورت زنده سینک کن
    try { sh(`${WG_BIN} show ${WG_IF} >/dev/null 2>&1`); sh(`bash -c '${WG_BIN} syncconf ${WG_IF} <(${WGQUICK} strip ${WG_IF})'`); }
    catch { sh(`${WGQUICK} up ${WG_IF}`); }
  } catch (e) {
    // اجرای syncconf با bash برای پشتیبانی از <()
    try { sh(`bash -c '${WG_BIN} syncconf ${WG_IF} <(${WGQUICK} strip ${WG_IF})'`); }
    catch (e2) { console.error('apply error:', e2.message); }
  }
}

// ---------- ساخت کانفیگ کلاینت ----------
function buildClientConf(d, c, opts = {}) {
  const allowed = opts.allowedIps || c.allowedIps || '0.0.0.0/0, ::/0';
  const dns     = opts.dns || c.dns || DEFAULT_DNS;
  const mtu     = opts.mtu || c.mtu || DEFAULT_MTU;
  return `[Interface]
PrivateKey = ${c.priv}
Address = ${c.ip}
DNS = ${dns}
MTU = ${mtu}
${obfLines(d.obf)}
[Peer]
PublicKey = ${d.server.pub}
AllowedIPs = ${allowed}
Endpoint = ${detectEndpoint()}:${WG_PORT}
PersistentKeepalive = 25
`;
}

// ---------- احراز هویت ساده ----------
const sessions = new Set();
function newToken() { const t = crypto.randomBytes(24).toString('hex'); sessions.add(t); return t; }
function getCookie(req, name) {
  const c = req.headers.cookie || '';
  const m = c.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
function isAuthed(req) { const t = getCookie(req, 'sid'); return t && sessions.has(t); }

// ---------- کمک‌کننده‌های HTTP ----------
function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = ''; req.on('data', d => b += d);
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}

// ---------- روتر API ----------
async function handleAPI(req, res, url) {
  // ورود
  if (url === '/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    if (body.password === PANEL_PASS) {
      const t = newToken();
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': `sid=${t}; HttpOnly; Path=/; Max-Age=86400; SameSite=Strict`,
      });
      return res.end(JSON.stringify({ ok: true }));
    }
    return sendJSON(res, 401, { ok: false, error: 'رمز اشتباه است' });
  }

  if (url === '/api/logout' && req.method === 'POST') {
    const t = getCookie(req, 'sid'); if (t) sessions.delete(t);
    return sendJSON(res, 200, { ok: true });
  }

  // بقیهٔ APIها نیاز به لاگین دارند
  if (!isAuthed(req)) return sendJSON(res, 401, { ok: false, error: 'نیاز به ورود' });

  const d = loadData();

  // وضعیت کلی + لیست کلاینت‌ها
  if (url === '/api/state' && req.method === 'GET') {
    let live = {};
    if (IS_LINUX) {
      try {
        const dump = wg(['show', WG_IF, 'dump']).split('\n').slice(1);
        for (const line of dump) {
          const f = line.split('\t');
          if (f[0]) live[f[0]] = { endpoint: f[2], latestHandshake: +f[4] || 0, rx: +f[5] || 0, tx: +f[6] || 0 };
        }
      } catch {}
    }
    return sendJSON(res, 200, {
      ok: true,
      endpoint: detectEndpoint(),
      wgPort: WG_PORT,
      serverPub: d.server.pub,
      subnet: SUBNET,
      clients: d.clients.map(c => ({
        id: c.id, name: c.name, ip: c.ip, pub: c.pub, createdAt: c.createdAt,
        live: live[c.pub] || null,
      })),
    });
  }

  // ساخت کلاینت جدید
  if (url === '/api/clients' && req.method === 'POST') {
    const body = await readBody(req);
    const name = (body.name || 'client').replace(/[^\w\-آ-ی ]/g, '').slice(0, 30) || 'client';
    const kp = genKeypair();
    const c = {
      id: crypto.randomBytes(6).toString('hex'),
      name, ...kp, ip: nextIP(d),
      allowedIps: body.allowedIps || '0.0.0.0/0, ::/0',
      dns: body.dns || DEFAULT_DNS,
      mtu: body.mtu || DEFAULT_MTU,
      createdAt: Date.now(),
    };
    d.clients.push(c);
    saveData(d);
    applyServer(d);
    return sendJSON(res, 200, { ok: true, id: c.id, config: buildClientConf(d, c) });
  }

  // گرفتن کانفیگ یک کلاینت
  let m;
  if ((m = url.match(/^\/api\/clients\/([^\/]+)\/config$/)) && req.method === 'GET') {
    const c = d.clients.find(x => x.id === m[1]);
    if (!c) return sendJSON(res, 404, { ok: false, error: 'یافت نشد' });
    return sendJSON(res, 200, { ok: true, name: c.name, config: buildClientConf(d, c) });
  }

  // حذف کلاینت
  if ((m = url.match(/^\/api\/clients\/([^\/]+)$/)) && req.method === 'DELETE') {
    const idx = d.clients.findIndex(x => x.id === m[1]);
    if (idx < 0) return sendJSON(res, 404, { ok: false, error: 'یافت نشد' });
    const [removed] = d.clients.splice(idx, 1);
    saveData(d);
    if (IS_LINUX) { try { sh(`${WG_BIN} set ${WG_IF} peer ${removed.pub} remove`); } catch {} }
    applyServer(d);
    return sendJSON(res, 200, { ok: true });
  }

  return sendJSON(res, 404, { ok: false, error: 'مسیر نامعتبر' });
}

// ---------- سرو فایل استاتیک ----------
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };
function serveStatic(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const filePath = path.join(ROOT, path.normalize(p).replace(/^(\.\.[\/\\])+/, ''));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- سرور ----------
const server = http.createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0];
    if (url === '/health' || url === '/healthz') { res.writeHead(200); return res.end('ok'); }
    if (url.startsWith('/api/')) return handleAPI(req, res, url);
    return serveStatic(req, res);
  } catch (e) {
    console.error(e);
    sendJSON(res, 500, { ok: false, error: e.message });
  }
});

// راه‌اندازی اولیه
loadData();          // مطمئن شو کلید سرور ساخته شده
if (IS_LINUX) applyServer(loadData());   // اینترفیس را بالا بیاور/سینک کن
detectEndpoint();

server.listen(PORT, () => {
  console.log(`\n🛡️  WireGuard Panel روی http://0.0.0.0:${PORT}`);
  console.log(`   اینترفیس: ${WG_IF} | پورت UDP: ${WG_PORT} | Endpoint: ${ENDPOINT || '(تشخیص نشد)'}`);
  console.log(`   رمز ورود پنل: ${PANEL_PASS === 'admin' ? 'admin  ⚠️ حتماً عوضش کن!' : '(از PANEL_PASSWORD)'}\n`);
});
