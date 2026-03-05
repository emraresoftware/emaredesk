#!/usr/bin/env python3
"""
RemoteView v2.0 - Tüm rakip özellikler:
  Şifre koruması, Clipboard, Dosya transferi, Chat,
  Çoklu monitör, Adaptif kalite, Sistem bilgisi,
  Ekran görüntüsü kaydetme, Mouse press/release ayrımı,
  Çift tık, Yatay scroll, Akış duraklat/devam
"""

import asyncio, json, io, time, os, sys, hashlib, base64
import struct, platform, socket, mimetypes, urllib.parse
from pathlib import Path
from datetime import datetime

import websockets
import mss
from PIL import Image
import ssl

# ─── E2E Şifreleme (cryptography ile) ─────────────────────────────
E2E_OK = False
try:
    from cryptography.hazmat.primitives.asymmetric.ec import (
        SECP256R1, generate_private_key, ECDH, EllipticCurvePublicNumbers
    )
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.backends import default_backend
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives.asymmetric import rsa as _rsa
    import ipaddress as _ipaddress
    import datetime as _dt
    E2E_OK = True
except ImportError:
    pass

try:
    import pyperclip; CLIPBOARD_OK = True
except ImportError:
    CLIPBOARD_OK = False

try:
    import pyautogui; pyautogui.FAILSAFE = False; INPUT_OK = True
except ImportError:
    INPUT_OK = False

# ─── TLS Sertifikası ───────────────────────────────────────────────
def ensure_tls_cert():
    """Self-signed TLS sertifikası yoksa otomatik üretir."""
    if not E2E_OK:
        return None, None
    cert_path = Path(__file__).parent / "cert.pem"
    key_path  = Path(__file__).parent / "key.pem"
    if cert_path.exists() and key_path.exists():
        return str(cert_path), str(key_path)
    print("[TLS] Sertifika üretiliyor (ilk çalıştırma)...")
    key  = _rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME,          "RemoteView"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME,    "RemoteView"),
    ])
    san  = x509.SubjectAlternativeName([
        x509.DNSName("localhost"),
        x509.IPAddress(_ipaddress.IPv4Address("127.0.0.1")),
    ])
    cert = (
        x509.CertificateBuilder()
        .subject_name(name).issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(_dt.datetime.now(_dt.timezone.utc))
        .not_valid_after(_dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(days=3650))
        .add_extension(san, critical=False)
        .sign(key, hashes.SHA256())
    )
    key_path.write_bytes(key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption()
    ))
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    print(f"[TLS] ✓ Sertifika: {cert_path}")
    return str(cert_path), str(key_path)


# ─── Wake-on-LAN ─────────────────────────────────────────────
def send_wol(mac: str, broadcast: str = "255.255.255.255", port: int = 9) -> str:
    """MAC adresine Magic Packet gönderir."""
    mac_clean = mac.replace(":", "").replace("-", "").replace(".", "").upper()
    if len(mac_clean) != 12:
        raise ValueError(f"Geçersiz MAC adresi: {mac}")
    mac_bytes = bytes.fromhex(mac_clean)
    magic     = b"\xff" * 6 + mac_bytes * 16
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        s.sendto(magic, (broadcast, port))
    return mac_clean


def local_sleep():
    """Sunucu makinesini uyku moduna alır (platform bağımlı)."""
    system = platform.system()
    if system == "Darwin":
        os.system("pmset sleepnow")
    elif system == "Linux":
        os.system("systemctl suspend")
    elif system == "Windows":
        os.system("rundll32.exe powrprof.dll,SetSuspendState 0,1,0")


# ─── Yapılandırma ─────────────────────────────────────────────
WEB_PORT  = int(os.environ.get("RV_WEB_PORT", 8080))
PORT      = WEB_PORT   # HTTP + WS aynı port (tek TLS sertifikası)
HOST      = os.environ.get("RV_HOST",         "0.0.0.0")
PASSWORD  = os.environ.get("RV_PASSWORD",     "")
DOWNLOADS = Path.home() / "Downloads" / "RemoteView"
MAX_FILE  = 500 * 1024 * 1024  # 500 MB

PRESETS = {
    "low":    {"format": "JPEG", "quality": 25,  "scale": 0.40, "fps": 10,
               "description": "Düşük kalite - Hızlı (~50-150 KB/s)"},
    "medium": {"format": "JPEG", "quality": 55,  "scale": 0.60, "fps": 20,
               "description": "Orta kalite (~200-500 KB/s)"},
    "high":   {"format": "JPEG", "quality": 85,  "scale": 0.85, "fps": 30,
               "description": "Yüksek kalite (~500 KB-2 MB/s)"},
    "ultra":  {"format": "PNG",  "quality": 100, "scale": 1.00, "fps": 30,
               "description": "Ultra kalite - PNG kayıpsız (~2-10 MB/s)"},
}

clients: dict = {}
_cid = 0


# ─── Ekran Yakalama ───────────────────────────────────────────
class ScreenCapture:
    def __init__(self):
        self.sct      = mss.mss()
        self.monitors = self.sct.monitors
        self.active   = 1
        self.last_md5 = None

    def monitor_list(self):
        return [{"index": i, "width": m["width"], "height": m["height"],
                 "left": m["left"], "top": m["top"],
                 "label": f"Monitör {i} ({m['width']}x{m['height']})"}
                for i, m in enumerate(self.monitors[1:], 1)]

    def active_mon(self):
        return self.monitors[min(self.active, len(self.monitors) - 1)]

    def mon_info(self):
        m = self.active_mon()
        return {"width": m["width"], "height": m["height"], "index": self.active}

    def set_monitor(self, idx):
        if 1 <= idx <= len(self.monitors) - 1:
            self.active = idx
            self.last_md5 = None

    def capture(self, scale=0.5, fmt="JPEG", quality=50):
        raw  = self.sct.grab(self.active_mon())
        img  = Image.frombytes("RGB", (raw.width, raw.height), raw.rgb)
        if scale < 1.0:
            img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
        buf = io.BytesIO()
        if fmt == "PNG":
            img.save(buf, "PNG", optimize=True)
        else:
            img.save(buf, "JPEG", quality=quality, optimize=True)
        data     = buf.getvalue()
        md5      = hashlib.md5(data).hexdigest()
        changed  = md5 != self.last_md5
        self.last_md5 = md5
        return data, changed, img.width, img.height

    def screenshot(self):
        DOWNLOADS.mkdir(parents=True, exist_ok=True)
        ts   = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = DOWNLOADS / f"screenshot_{ts}.png"
        raw  = self.sct.grab(self.active_mon())
        Image.frombytes("RGB", (raw.width, raw.height), raw.rgb).save(path, "PNG")
        return path


scr = ScreenCapture()


# ─── İstemci Oturumu ──────────────────────────────────────────
class Session:
    def __init__(self, cid, ws):
        self.id        = cid
        self.ws        = ws
        self.ip        = ws.remote_address[0] if ws.remote_address else "?"
        self.auth      = not bool(PASSWORD)
        self.quality   = "low"
        self.streaming = True
        self.input_on  = False
        self.adaptive  = False
        self.latency   = 0
        self.name      = f"İstemci-{cid}"
        self.stats     = {"frames": 0, "bytes": 0, "files_sent": 0, "files_rcv": 0, "start": time.time()}
        self._fbuf     = b""
        self._fmeta    = {}
        # ── E2E Şifreleme ──
        self.e2e_key   = None   # AESGCM nesnesi (el sıkışması sonrası)
        if E2E_OK:
            _priv = generate_private_key(SECP256R1())
            _pub  = _priv.public_key()
            _raw  = _pub.public_bytes(serialization.Encoding.X962,
                                      serialization.PublicFormat.UncompressedPoint)
            self._ecdh_priv  = _priv
            self.e2e_pub_b64 = base64.b64encode(_raw).decode()
        else:
            self._ecdh_priv  = None
            self.e2e_pub_b64 = None

    @property
    def preset(self):
        return PRESETS[self.quality]

    async def send(self, data):
        """E2E şifreli veya düz gönderim. e2e_key yoksa düz iletir."""
        if self.e2e_key is None:
            await self.ws.send(data)
            return
        nonce = os.urandom(12)
        if isinstance(data, (bytes, bytearray)):
            ct = self.e2e_key.encrypt(nonce, bytes(data), b"bin")
            await self.ws.send(b"\x01" + nonce + ct)
        else:
            enc = data.encode() if isinstance(data, str) else data
            ct  = self.e2e_key.encrypt(nonce, enc, b"json")
            await self.ws.send(json.dumps({
                "type": "e",
                "n":    base64.b64encode(nonce).decode(),
                "d":    base64.b64encode(ct).decode()
            }))


# ─── Ekran Akışı ──────────────────────────────────────────────
async def stream_loop(sess: Session):
    while sess.streaming:
        if not sess.auth:
            await asyncio.sleep(0.5)
            continue
        try:
            p = sess.preset
            data, changed, w, h = scr.capture(p["scale"], p["format"], p["quality"])
            if changed:
                await sess.send(struct.pack("!III", w, h, len(data)) + data)
                sess.stats["frames"] += 1
                sess.stats["bytes"]  += len(data)
            await asyncio.sleep(1.0 / p["fps"])
        except websockets.exceptions.ConnectionClosed:
            break
        except Exception as e:
            print(f"[Akış] #{sess.id}: {e}")
            await asyncio.sleep(0.5)


# ─── Girdi ────────────────────────────────────────────────────
KEY_MAP = {
    "Enter": "enter", "Backspace": "backspace", "Tab": "tab",
    "Escape": "escape", "Delete": "delete", "Home": "home", "End": "end",
    "PageUp": "pageup", "PageDown": "pagedown",
    "ArrowUp": "up", "ArrowDown": "down", "ArrowLeft": "left", "ArrowRight": "right",
    "Control": "ctrl", "Alt": "alt", "Shift": "shift", "Meta": "command",
    " ": "space", "CapsLock": "capslock", "Insert": "insert",
}
for _i in range(1, 13):
    KEY_MAP[f"F{_i}"] = f"f{_i}"


async def handle_input(sess: Session, data: dict):
    if not sess.input_on or not INPUT_OK:
        return
    scale = sess.preset["scale"]
    mi    = scr.mon_info()

    def sc(ax, ay):
        return min(int(ax / scale), mi["width"] - 1), min(int(ay / scale), mi["height"] - 1)

    et = data.get("type")
    try:
        if et == "mousemove":
            x, y = sc(data["x"], data["y"])
            pyautogui.moveTo(x, y, _pause=False)
        elif et == "mousedown":
            x, y = sc(data["x"], data["y"])
            btn  = {0: "left", 1: "middle", 2: "right"}.get(data.get("button", 0), "left")
            pyautogui.mouseDown(x, y, button=btn, _pause=False)
        elif et == "mouseup":
            x, y = sc(data["x"], data["y"])
            btn  = {0: "left", 1: "middle", 2: "right"}.get(data.get("button", 0), "left")
            pyautogui.mouseUp(x, y, button=btn, _pause=False)
        elif et == "dblclick":
            x, y = sc(data["x"], data["y"])
            pyautogui.doubleClick(x, y, _pause=False)
        elif et == "scroll":
            x, y = sc(data["x"], data["y"])
            pyautogui.moveTo(x, y, _pause=False)
            dy = int(data.get("deltaY", 0) / -120)
            dx = int(data.get("deltaX", 0) / -50)
            if dy: pyautogui.scroll(dy, _pause=False)
            if dx: pyautogui.hscroll(dx, _pause=False)
        elif et == "keydown":
            key    = data.get("key", "")
            mapped = KEY_MAP.get(key, key.lower() if len(key) == 1 else key)
            mods   = (["ctrl"]    if data.get("ctrlKey")  else []) + \
                     (["alt"]     if data.get("altKey")   else []) + \
                     (["shift"]   if data.get("shiftKey") and len(mapped) > 1 else []) + \
                     (["command"] if data.get("metaKey")  else [])
            if mapped in ("ctrl", "alt", "shift", "command"):
                pyautogui.keyDown(mapped, _pause=False)
            elif mods:
                pyautogui.hotkey(*mods, mapped, _pause=False)
            elif len(mapped) == 1:
                pyautogui.write(mapped, _pause=False)
            else:
                pyautogui.press(mapped, _pause=False)
        elif et == "keyup":
            m = KEY_MAP.get(data.get("key", ""))
            if m in ("ctrl", "alt", "shift", "command"):
                pyautogui.keyUp(m, _pause=False)
    except Exception as e:
        print(f"[Girdi] {e}")


# ─── Clipboard ────────────────────────────────────────────────
async def handle_clipboard(sess: Session, data: dict):
    if not CLIPBOARD_OK:
        await sess.send(json.dumps({"type": "clipboard_error", "message": "pyperclip kurulu değil."}))
        return
    try:
        if data.get("action") == "read":
            await sess.send(json.dumps({"type": "clipboard_data", "text": pyperclip.paste()}))
        elif data.get("action") == "write":
            pyperclip.copy(data.get("text", ""))
            await sess.send(json.dumps({"type": "clipboard_ack", "message": "Pano güncellendi."}))
    except Exception as e:
        await sess.send(json.dumps({"type": "clipboard_error", "message": str(e)}))


# ─── Dosya Transferi ──────────────────────────────────────────
async def file_receive(sess: Session, data: dict):
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    act = data.get("action")
    if act == "start":
        sess._fmeta = {"name": data.get("name", "dosya")}
        sess._fbuf  = b""
        await sess.send(json.dumps({"type": "file_ack", "action": "ready",
                                        "name": sess._fmeta["name"]}))
    elif act == "chunk":
        sess._fbuf += base64.b64decode(data.get("data", ""))
    elif act == "end":
        if not sess._fmeta:
            return
        sn   = Path(sess._fmeta["name"]).name
        dest = DOWNLOADS / sn
        c    = 1
        while dest.exists():
            dest = DOWNLOADS / f"{Path(sn).stem}_{c}{Path(sn).suffix}"
            c   += 1
        dest.write_bytes(sess._fbuf)
        kb = round(len(sess._fbuf) / 1024, 1)
        sess.stats["files_rcv"] += 1
        sess._fbuf  = b""
        sess._fmeta = {}
        print(f"[Dosya↓] #{sess.id} → {dest.name} ({kb} KB)")
        await sess.send(json.dumps({"type": "file_ack", "action": "saved",
                                        "name": dest.name, "size_kb": kb}))


async def file_send(sess: Session, path_str: str):
    p = Path(path_str)
    if not p.exists() or not p.is_file():
        await sess.send(json.dumps({"type": "file_error",
                                        "message": f"Bulunamadı: {p.name}"}))
        return
    if p.stat().st_size > MAX_FILE:
        await sess.send(json.dumps({"type": "file_error",
                                        "message": "Dosya çok büyük (500 MB limit)."}))
        return
    mime, _ = mimetypes.guess_type(str(p))
    RAW     = p.read_bytes()
    CHUNK   = 64 * 1024
    total   = (len(RAW) + CHUNK - 1) // CHUNK
    await sess.send(json.dumps({"type": "file_incoming", "name": p.name,
                                    "size": len(RAW),
                                    "mime": mime or "application/octet-stream",
                                    "total_chunks": total}))
    for i in range(total):
        await sess.send(json.dumps({
            "type": "file_chunk", "index": i,
            "data": base64.b64encode(RAW[i * CHUNK:(i + 1) * CHUNK]).decode()
        }))
        await asyncio.sleep(0)
    await sess.send(json.dumps({"type": "file_done", "name": p.name}))
    sess.stats["files_sent"] += 1
    print(f"[Dosya↑] #{sess.id} ← {p.name} ({round(len(RAW)/1024,1)} KB)")


# ─── Chat ─────────────────────────────────────────────────────
async def broadcast_chat(from_id: int, text: str):
    ts  = datetime.now().strftime("%H:%M:%S")
    msg = json.dumps({"type": "chat_message",
                      "from":    clients[from_id].name if from_id in clients else "Sunucu",
                      "message": text, "ts": ts})
    await asyncio.gather(
        *[s.send(msg) for s in clients.values() if s.auth],
        return_exceptions=True
    )


# ─── Sistem Bilgisi ───────────────────────────────────────────
def sysinfo() -> dict:
    try:    hn = socket.gethostname()
    except: hn = "bilinmiyor"
    return {"hostname": hn, "os": platform.system(), "os_ver": platform.release(),
            "arch": platform.machine(), "monitors": scr.monitor_list(),
            "clipboard": CLIPBOARD_OK, "input": INPUT_OK, "version": "2.0"}


# ─── Ana İşleyici ─────────────────────────────────────────────
async def handle_client(ws):
    global _cid
    _cid += 1
    cid  = _cid
    sess = Session(cid, ws)
    clients[cid] = sess
    print(f"[+] #{cid}: {sess.ip}")

    try:
        await sess.send(json.dumps({
            "type":              "welcome",
            "client_id":         cid,
            "requires_password": bool(PASSWORD),
            "system":            sysinfo(),
            "monitor":           scr.mon_info(),
            "quality_presets":   {k: v["description"] for k, v in PRESETS.items()},
            "current_quality":   sess.quality,
            "input_enabled":     sess.input_on,
            "e2e_pubkey":        sess.e2e_pub_b64,
            "e2e_enabled":       E2E_OK,
        }))

        st = asyncio.create_task(stream_loop(sess))

        async for raw in ws:
            try:
                # ── E2E şifre çözme ────────────────────────────────────────
                if sess.e2e_key is not None:
                    if isinstance(raw, (bytes, bytearray)) and len(raw) > 1 and raw[0] == 0x01:
                        _n   = bytes(raw[1:13])
                        _ct  = bytes(raw[13:])
                        raw  = sess.e2e_key.decrypt(_n, _ct, b"json").decode()
                    elif isinstance(raw, str):
                        _tmp = json.loads(raw)
                        if _tmp.get("type") == "e":
                            _n   = base64.b64decode(_tmp["n"])
                            _ct  = base64.b64decode(_tmp["d"])
                            raw  = sess.e2e_key.decrypt(_n, _ct, b"json").decode()
                if isinstance(raw, (bytes, bytearray)):
                    raw = raw.decode("utf-8", "ignore")

                d = json.loads(raw)
                t = d.get("type", "")

                # ── E2E el sıkışması ─────────────────────────────────────
                if t == "e2e_init" and E2E_OK and sess._ecdh_priv is not None:
                    try:
                        _cb = base64.b64decode(d["pub"])
                        _x  = int.from_bytes(_cb[1:33], "big")
                        _y  = int.from_bytes(_cb[33:65], "big")
                        _cp = EllipticCurvePublicNumbers(_x, _y, SECP256R1()).public_key(default_backend())
                        _sh = sess._ecdh_priv.exchange(ECDH(), _cp)
                        _ak = HKDF(hashes.SHA256(), 32, None, b"remoteview-e2e-v1").derive(_sh)
                        sess.e2e_key = AESGCM(_ak)
                        await sess.send(json.dumps({"type": "e2e_ready"}))
                        print(f"[E2E] #{sess.id} ✓ AES-256-GCM + ECDH-P256")
                    except Exception as _ex:
                        print(f"[E2E] #{sess.id} hata: {_ex}")
                    continue

                # Auth
                if t == "auth":
                    if not PASSWORD or d.get("password") == PASSWORD:
                        sess.auth = True
                        await sess.send(json.dumps({"type": "auth_ok", "message": "Kimlik doğrulandı."}))
                        print(f"[Auth] #{cid} OK")
                    else:
                        await sess.send(json.dumps({"type": "auth_fail", "message": "Hatalı şifre."}))
                    continue

                if not sess.auth:
                    await sess.send(json.dumps({"type": "auth_required"}))
                    continue

                # Kalite
                if t == "set_quality":
                    p = d.get("preset", "low")
                    if p in PRESETS:
                        sess.quality   = p
                        sess.adaptive  = False
                        scr.last_md5   = None
                        await sess.send(json.dumps({"type": "quality_changed", "preset": p,
                                                   "description": PRESETS[p]["description"]}))

                elif t == "set_adaptive":
                    sess.adaptive = bool(d.get("enabled"))
                    await sess.send(json.dumps({"type": "adaptive_status", "enabled": sess.adaptive}))

                # Monitör
                elif t == "set_monitor":
                    scr.set_monitor(int(d.get("index", 1)))
                    await sess.send(json.dumps({"type": "monitor_changed", "monitor": scr.mon_info()}))

                # Girdi
                elif t == "toggle_input":
                    sess.input_on = not sess.input_on
                    await sess.send(json.dumps({"type": "input_status", "enabled": sess.input_on}))

                elif t in ("mousemove", "mousedown", "mouseup", "dblclick",
                           "scroll", "keydown", "keyup"):
                    await handle_input(sess, d)

                # Clipboard
                elif t == "clipboard":
                    await handle_clipboard(sess, d)

                # Dosya
                elif t == "file_transfer":
                    await file_receive(sess, d)
                elif t == "request_file":
                    asyncio.create_task(file_send(sess, d.get("path", "")))

                # Ekran görüntüsü
                elif t == "take_screenshot":
                    path = scr.screenshot()
                    asyncio.create_task(file_send(sess, str(path)))
                    await sess.send(json.dumps({"type": "screenshot_saved",
                                               "name": path.name, "path": str(path)}))

                # Chat
                elif t == "chat":
                    txt = str(d.get("message", "")).strip()[:2000]
                    if txt:
                        await broadcast_chat(cid, txt)
                elif t == "set_username":
                    sess.name = str(d.get("name", sess.name))[:32]

                # İstatistik
                elif t == "get_stats":
                    el = time.time() - sess.stats["start"]
                    await sess.send(json.dumps({
                        "type":              "stats",
                        "frames_sent":       sess.stats["frames"],
                        "mb_sent":           round(sess.stats["bytes"] / 1048576, 2),
                        "avg_fps":           round(sess.stats["frames"] / el if el else 0, 1),
                        "uptime_seconds":    round(el),
                        "files_sent":        sess.stats["files_sent"],
                        "files_received":    sess.stats["files_rcv"],
                        "connected_clients": len(clients),
                    }))

                elif t == "get_sysinfo":
                    await sess.send(json.dumps({"type": "sysinfo", **sysinfo()}))

                # Ping / adaptif
                elif t == "ping":
                    await sess.send(json.dumps({"type": "pong"}))

                elif t == "pong_latency":
                    sess.latency = int(d.get("latency", 0))
                    if sess.adaptive:
                        nq = "high" if sess.latency < 120 else "medium" if sess.latency < 300 else "low"
                        if nq != sess.quality:
                            sess.quality  = nq
                            scr.last_md5  = None
                            await sess.send(json.dumps({"type": "quality_changed", "preset": nq,
                                                       "description": PRESETS[nq]["description"],
                                                       "auto": True}))

                # Akış duraklat/devam
                elif t == "pause_stream":
                    sess.streaming = False
                    await sess.send(json.dumps({"type": "stream_paused"}))
                elif t == "resume_stream":
                    sess.streaming = True
                    await sess.send(json.dumps({"type": "stream_resumed"}))

            except json.JSONDecodeError:
                pass
            except Exception as e:
                print(f"[MSG] #{cid}: {e}")

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        sess.streaming = False
        st.cancel()
        clients.pop(cid, None)
        print(f"[-] #{cid} ayrıldı")


# ─── HTTP + WS Tek Port (process_request) ────────────────────
async def process_request(connection, request):
    """websockets.serve için HTTP isteklerini yakalar.
    WebSocket Upgrade gelirse None döndürür → WS handshake devam eder.
    """
    from websockets.http11 import Response as WsResp
    from websockets.datastructures import Headers as WsHdrs

    path_full = request.path          # '/app.js', '/api/wol?mac=...', vb.
    parsed    = urllib.parse.urlparse(path_full)
    path      = parsed.path
    qs        = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)

    # WebSocket Upgrade → None döndür, handshake devam etsin
    if request.headers.get("Upgrade", "").strip().lower() == "websocket":
        return None

    base  = Path(__file__).parent / "web"
    ROUTE = {"/": "index.html", "/index.html": "index.html",
             "/style.css": "style.css", "/app.js": "app.js"}
    CTYPE = {"html": "text/html", "css": "text/css", "js": "application/javascript"}

    def resp(status, reason, body, ctype="text/plain"):
        if isinstance(body, str): body = body.encode()
        h = WsHdrs([
            ("Content-Type",   f"{ctype}; charset=utf-8"),
            ("Content-Length", str(len(body))),
            ("Access-Control-Allow-Origin", "*"),
            ("Cache-Control",  "no-cache"),
        ])
        return WsResp(status, reason, h, body)

    def jresp(data, status=200):
        return resp(status, "OK" if status == 200 else "Error",
                    json.dumps(data, ensure_ascii=False), "application/json")

    # ── GET /api/wol?mac=AA:BB:...&broadcast=255.255.255.255 ───
    if path == "/api/wol":
        try:
            mac   = qs.get("mac",  [""])[0].strip()
            bcast = qs.get("broadcast", ["255.255.255.255"])[0].strip() or "255.255.255.255"
            wport = int(qs.get("port", ["9"])[0])
            cleaned = send_wol(mac, bcast, wport)
            return jresp({"ok": True, "mac": cleaned, "broadcast": bcast})
        except Exception as e:
            return jresp({"ok": False, "error": str(e)}, 400)

    # ── GET /api/sleep ─────────────────────────────────────────
    if path == "/api/sleep":
        asyncio.get_event_loop().call_later(1.5, local_sleep)
        return jresp({"ok": True, "message": "Uyku moduna geçiliyor..."})

    # ── Favicon ────────────────────────────────────────────────
    if path == "/favicon.ico":
        return WsResp(204, "No Content", WsHdrs([]), b"")

    # ── Statik dosyalar ────────────────────────────────────────
    if path in ROUTE:
        fp = base / ROUTE[path]
        ct = CTYPE.get(fp.suffix.lstrip("."), "text/plain")
        try:
            return resp(200, "OK", fp.read_bytes(), ct)
        except FileNotFoundError:
            return resp(404, "Not Found", b"Not found")

    return resp(404, "Not Found", b"Not found")


# ─── Main ─────────────────────────────────────────────────────
async def main():
    print("\n  RemoteView Desktop Server v2.0 + E2E")
    print("  Şifre • Clipboard • Dosya • Chat • Çoklu Monitör • Adaptif Kalite • E2E Şifreleme\n")
    for m in scr.monitor_list():
        print(f"  {m['label']}")
    print(f"\n  Port     : {WEB_PORT}  (HTTP + WebSocket)")
    print(f"  Şifre    : {'AÇIK' if PASSWORD else 'KAPALI'}")
    print(f"  Clipboard: {'OK' if CLIPBOARD_OK else '✗ pip install pyperclip'}")
    print(f"  Girdi    : {'OK' if INPUT_OK else '✗ pip install pyautogui'}")
    print(f"  E2E      : {'OK (ECDH-P256 + AES-256-GCM)' if E2E_OK else '✗ pip install cryptography'}")
    print(f"  İndirmeler: {DOWNLOADS}\n")

    ssl_ctx = None
    cert, key = ensure_tls_cert()
    if cert and key:
        ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ssl_ctx.load_cert_chain(cert, key)
        print(f"  TLS      : AÇIK (WSS + HTTPS)")
        print(f"  Not      : Tarayıcıda sertifika uyarısı alırsanız 'Gelişmiş > Devam et' deyin.")
    else:
        print(f"  TLS      : KAPALI (pip install cryptography ile aktifleştirin)")

    # HTTP + WS aynı portta (tek TLS sertifikası)
    ws_srv = await websockets.serve(
        handle_client, HOST, WEB_PORT,
        process_request=process_request,
        max_size=None, ping_interval=20, ping_timeout=60,
        ssl=ssl_ctx
    )

    webscheme = "https" if ssl_ctx else "http"
    print(f"\n  [OK] {webscheme}://localhost:{WEB_PORT}")
    print(f"  [i] Şifreli: RV_PASSWORD=gizli python3 server.py")
    print(f"  [i] NAT/tünel: RV_TUNNEL=1 python3 server.py (cloudflared gerekli)\n")

    # Opsiyonel: cloudflared tüneli
    if os.environ.get("RV_TUNNEL"):
        asyncio.create_task(_start_tunnel(WEB_PORT))

    await ws_srv.wait_closed()


async def _start_tunnel(port: int):
    """cloudflared ile genel URL açar, konsola basar."""
    import shutil, asyncio.subprocess as asp
    exe = shutil.which("cloudflared")
    if not exe:
        print("[Tünel] cloudflared bulunamadı. Kur: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/")
        return
    print(f"[Tünel] cloudflared başlatılıyor...")
    proc = await asp.create_subprocess_exec(
        exe, "tunnel", "--url", f"http://localhost:{port}",
        stderr=asp.PIPE, stdout=asp.PIPE
    )
    async for line in proc.stderr:
        txt = line.decode("utf-8", "ignore").strip()
        if "trycloudflare.com" in txt or ".cloudflare.com" in txt:
            import re
            m = re.search(r'https://[\w\-\.]+\.cloudflare\.com|https://[\w\-]+\.trycloudflare\.com', txt)
            if m:
                print(f"\n  [🌍 Tünel] {m.group(0)}\n")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n  [x] Kapatıldı.")
        sys.exit(0)
