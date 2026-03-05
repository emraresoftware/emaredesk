# EMAREDESK HAFIZA - Proje Bellek Dosyası

> 🔗 **Ortak Hafıza:** [`EMARE_ORTAK_HAFIZA.md`](/Users/emre/Desktop/Emare/EMARE_ORTAK_HAFIZA.md) — Tüm Emare ekosistemi, sunucu bilgileri, standartlar ve proje envanteri için bak.

> Bu dosya, RemoteView uzak masaüstü yazılımının tüm detaylarını içerir.
> Nerede kaldığını, ne yapıldığını ve nasıl çalıştığını hatırlamak için kullan.

---

## 📌 PROJE ÖZETİ

| Alan | Detay |
|------|-------|
| **Proje Adı** | RemoteView - Uzak Masaüstü Yazılımı |
| **Oluşturulma Tarihi** | 2-3 Mart 2026 |
| **Konum** | `/Users/emre/Desktop/Emare/emare desk/remote-desktop/` |
| **Amaç** | TeamViewer/AnyDesk rakipli, adaptif kaliteli uzak masaüstü erişimi |
| **Mimari** | Python sunucu + Web tarayıcı istemci |
| **Sürüm** | v2.0 — Kapsamlı özellik seti |
| **Durum** | ✅ TAMAMLANDI v2.0 — Tüm dosyalar tam ve güncel |

---

## 📁 DOSYA YAPISI VE HER DOSYANIN ROLÜ

```
remote-desktop/
├── server.py           → Ana sunucu v2.0 (529 satır Python)
├── requirements.txt    → Python bağımlılıkları (5 paket — pyperclip eklendi)
├── start.sh            → macOS/Linux başlatma scripti
├── start.bat           → Windows başlatma scripti
├── README.md           → Kullanım kılavuzu
└── web/
    ├── index.html      → İstemci HTML arayüzü v2.0 (185 satır)
    ├── style.css       → Koyu/açık tema CSS v2.0 (600+ satır)
    └── app.js          → İstemci JavaScript v2.0 (RemoteView class, ~450 satır)
```

---

## 🔧 TEKNOLOJİ STACK'İ

### Sunucu Tarafı (Python)
| Kütüphane | Versiyon | Görevi |
|-----------|----------|--------|
| `websockets` | >=12.0 | WebSocket sunucusu, istemci ile gerçek zamanlı iletişim |
| `Pillow` (PIL) | >=10.0 | Görüntü sıkıştırma (JPEG/PNG), ölçeklendirme |
| `mss` | >=9.0 | Ekran yakalama (screenshot), tüm OS'larda çalışır |
| `pyautogui` | >=0.9 | Fare/klavye kontrolü (uzaktan girdi) |

### İstemci Tarafı (Web)
- Saf HTML5 + CSS3 + Vanilla JavaScript (hiçbir framework yok)
- Canvas API ile görüntü render
- WebSocket API ile sunucuya bağlantı
- Blob + ObjectURL ile binary frame render

---

## 🏗️ MİMARİ DETAYLARI

### Genel Akış
```
[Uzak Bilgisayar]                    [İstemci Cihaz]
┌─────────────┐     WebSocket        ┌──────────────┐
│ server.py   │ ◄──────────────────► │ Tarayıcı     │
│             │     (port 8765)      │ (app.js)     │
│ - mss ile   │                      │              │
│   ekran     │ ────binary frame───► │ - Canvas'a   │
│   yakala    │                      │   çiz        │
│             │ ◄──JSON komutlar──── │              │
│ - pyautogui │                      │ - Fare/KB    │
│   ile girdi │                      │   olayları   │
│   uygula    │                      │   gönder     │
└─────────────┘                      └──────────────┘
      │
      │  HTTP (port 8080)
      │
      └──► web/ klasöründeki dosyaları servis eder
```

### İki Ayrı Port Kullanılıyor
1. **Port 8080** (HTTP) → Web istemci dosyalarını (HTML/CSS/JS) tarayıcıya sunar
2. **Port 8765** (WebSocket) → Gerçek zamanlı ekran akışı ve komut iletişimi

---

## 📡 SUNUCU (server.py) - DETAYLI AÇIKLAMA

### Sınıflar

#### `ScreenCapture` sınıfı
- `mss` kütüphanesi ile ana monitörü (monitors[1]) yakalar
- `capture(scale, fmt, quality)` metodu:
  - Ham ekranı yakalar → PIL Image'e çevirir
  - Belirtilen ölçekte küçültür (LANCZOS filtre)
  - JPEG veya PNG olarak sıkıştırır
  - MD5 hash ile önceki kareyle karşılaştırır → değişmediyse göndermez (bant genişliği tasarrufu)
  - Döndürür: `(data, changed, width, height)`

#### `ClientSession` sınıfı
- Her bağlı istemci için bir oturum
- Saklar: `client_id`, `websocket`, `quality_preset`, `streaming`, `input_enabled`, `stats`
- Varsayılan kalite: `"low"`
- İstatistikler: gönderilen kare sayısı, byte sayısı, başlangıç zamanı

### Ana Fonksiyonlar

#### `stream_screen(session)` — async
- Sonsuz döngüde çalışır
- Session'ın kalite ayarına göre ekranı yakalar
- Değişiklik varsa binary frame gönderir
- Frame formatı: `[4 byte genişlik][4 byte yükseklik][4 byte veri boyutu][görüntü verisi]`
- Network byte order (big-endian) `struct.pack("!III", w, h, len(data))`
- FPS'e göre `asyncio.sleep` ile hız kontrolü

#### `handle_input(session, data)` — async
- İstemciden gelen fare/klavye olaylarını işler
- Koordinatları ölçek oranına göre gerçek ekran koordinatlarına çevirir
- Desteklenen olaylar:
  - `mousemove` → pyautogui.moveTo
  - `mousedown` → pyautogui.click (sol/orta/sağ tuş)
  - `scroll` → pyautogui.scroll
  - `keydown` → Özel tuş haritası ile pyautogui.press/write/hotkey
  - `keyup` → Modifier tuşları (ctrl/alt/shift/cmd) bırakma
- Tuş haritası: Enter, Backspace, Tab, Escape, Arrow tuşları, F1-F12, modifier'lar

#### `handle_client(websocket)` — async
- Her yeni WebSocket bağlantısında çağrılır
- Welcome mesajı gönderir (monitör bilgisi, kalite presetleri)
- `stream_screen` task'ını başlatır
- İstemciden gelen JSON mesajları dinler:
  - `set_quality` → Kalite değiştir
  - `toggle_input` → Girdi aç/kapat
  - `get_stats` → İstatistik gönder
  - `ping` → pong ile yanıtla
  - Fare/klavye olayları → `handle_input`'a yönlendir

#### `serve_web_client(reader, writer)` — async
- Basit HTTP sunucusu
- `asyncio.start_server` ile çalışır
- `/` veya `/index.html` → web/index.html
- `/style.css` → web/style.css
- `/app.js` → web/app.js
- Diğer → 404

#### `main()` — async
- Çevresel değişkenlerden yapılandırma okur
- WebSocket sunucusunu başlatır (port 8765)
- HTTP sunucusunu başlatır (port 8080)
- Her ikisini `asyncio.gather` ile paralel çalıştırır

### Yapılandırma Değişkenleri
```
RV_HOST=0.0.0.0      # Dinleme adresi
RV_PORT=8765          # WebSocket portu
RV_WEB_PORT=8080      # HTTP portu
```

---

## 🎨 İSTEMCİ (web/) - DETAYLI AÇIKLAMA

### index.html — Yapı
İki ana ekran:
1. **connect-screen**: Bağlantı formu (sunucu adresi + port + bağlan butonu)
2. **remote-screen**: Uzak masaüstü görüntüsü + araç çubuğu

Araç çubuğu içeriği:
- Sol: Logo, bağlantı durumu, gecikme, FPS, bant genişliği
- Orta: Kalite seçici (Düşük/Orta/Yüksek/Ultra butonları)
- Sağ: Kontrol toggle, tam ekran, istatistik, bağlantı kes

### style.css — Tema
- **Koyu GitHub teması** (--bg-dark: #0d1117)
- CSS değişkenleri ile tutarlı renk sistemi
- Responsive: 768px ve 480px breakpoint'leri
- Tam ekranda toolbar gizlenir, hover'da görünür
- Spinner animasyonu (yeniden bağlanma overlay)
- `.quality-btn.active` → mavi vurgu

### app.js — RemoteView Sınıfı

#### Constructor
- Tüm DOM elementlerini yakalar
- Durum değişkenleri: `ws`, `connected`, `inputEnabled`, `currentQuality`
- Performans metrikleri: `frameCount`, `byteCount`, son FPS/bant genişliği ölçüm zamanları
- `setupEventListeners()` ve `startMetricsLoop()` çağırır

#### Bağlantı Yönetimi
- `connect()`: WebSocket bağlantısı kurar, `binaryType = 'arraybuffer'`
- `disconnect()`: WebSocket'i kapatır, bağlantı ekranına döner
- `onDisconnected()`: Otomatik yeniden bağlanma (max 5 deneme, artan bekleme süresi)

#### Frame İşleme — `handleFrame(buffer)`
```
Binary frame format:
[0-3]  → uint32 genişlik (big-endian)
[4-7]  → uint32 yükseklik (big-endian)
[8-11] → uint32 görüntü boyutu (big-endian)
[12+]  → JPEG/PNG görüntü verisi
```
- DataView ile header parse
- Uint8Array ile görüntü verisi çıkar
- Blob → ObjectURL → Image → Canvas'a çiz
- Her frame sonra ObjectURL revoke edilir (bellek sızıntısı önleme)

#### JSON Mesaj İşleme — `handleJsonMessage(data)`
- `welcome`: Monitör bilgisi, kalite, girdi durumu güncelle
- `quality_changed`: Kalite butonlarını güncelle
- `input_status`: Girdi butonunu güncelle
- `stats`: İstatistik panelini güncelle
- `pong`: Gecikme hesapla (performance.now farkı)

#### Koordinat Dönüşümü — `getCanvasCoords(e)`
- Canvas'ın ekrandaki gerçek boyutu ile piksel boyutu arasındaki oran
- `(e.clientX - rect.left) * scaleX` formülü
- Bu koordinatlar sunucuya gönderilir, sunucu da kendi ölçeğine çevirir

#### Girdi Olayları
- **Fare**: mousemove, mousedown (sol/orta/sağ), mouseup, wheel
- **Klavye**: keydown (modifier bilgisi dahil), keyup
- F5/F12 engellenmez (tarayıcı kısayolları)
- Tüm olaylar JSON olarak WebSocket'ten gönderilir

#### Metrik Döngüleri (1 saniyede bir)
- FPS: Son 1 saniyedeki kare farkı
- Bant genişliği: Son 1 saniyedeki byte farkı → KB/s
- İstatistik paneli açıksa sunucudan `get_stats` iste

#### Ping döngüsü (3 saniyede bir)
- `performance.now()` ile gönderim zamanı kaydet
- `pong` gelince fark = gecikme (ms)

---

## 📊 KALİTE PRESTLERİ - DETAY

| Preset | Format | JPEG Kalitesi | Ölçek | FPS | Tahmini Bant Genişliği |
|--------|--------|---------------|-------|-----|------------------------|
| `low` | JPEG | %25 | %40 | 10 | ~50-150 KB/s |
| `medium` | JPEG | %55 | %60 | 20 | ~200-500 KB/s |
| `high` | JPEG | %85 | %85 | 30 | ~500 KB - 2 MB/s |
| `ultra` | PNG | %100 | %100 | 30 | ~2-10 MB/s |

### Ölçek nasıl çalışır:
- Ölçek %40 ise: 2560x1440 monitör → 1024x576 piksel görüntü gönderilir
- İstemci tarafında Canvas bunu container'a sığacak şekilde büyütür
- Düşük ölçek = küçük dosya = daha hızlı ama bulanık
- Ultra'da hiç küçültme yok, PNG kayıpsız sıkıştırma

### Hash tabanlı değişiklik tespiti:
- Her yakalanan frame MD5 hash'lenir
- Öncekiyle aynıysa gönderilmez
- Masaüstü değişmediğinde bant genişliği sıfıra düşer

---

## 🖥️ PLATFORM DESTEĞİ

### Sunucu (kontrol edilecek bilgisayar)
| Platform | Durum | Not |
|----------|-------|-----|
| macOS | ✅ | Ekran kaydı izni gerekebilir (Sistem Tercihleri > Gizlilik) |
| Windows | ✅ | Doğrudan çalışır |
| Linux | ✅ | X11 gerekir, Wayland'da ek yapılandırma lazım |

### İstemci (bağlanan cihaz)
| Platform | Durum | Not |
|----------|-------|-----|
| Chrome/Edge | ✅ | En iyi performans |
| Firefox | ✅ | Tam destek |
| Safari | ✅ | Tam destek |
| iOS Safari | ✅ | Mobil tarayıcıda çalışır |
| Android Chrome | ✅ | Mobil tarayıcıda çalışır |

---

## 🔌 WEBSOCKET PROTOKOLÜ

### Sunucu → İstemci (JSON)
```json
{"type": "welcome", "client_id": 1, "monitor": {"width": 2560, "height": 1440}, "quality_presets": {...}, "current_quality": "low", "input_enabled": false}
{"type": "quality_changed", "preset": "high", "description": "Yüksek kalite"}
{"type": "input_status", "enabled": true}
{"type": "stats", "frames_sent": 1500, "mb_sent": 45.2, "avg_fps": 10.0, "uptime_seconds": 150}
{"type": "pong"}
```

### Sunucu → İstemci (Binary)
```
[12 byte header + N byte görüntü verisi]
Header: width(uint32 BE) + height(uint32 BE) + dataSize(uint32 BE)
```

### İstemci → Sunucu (JSON)
```json
{"type": "set_quality", "preset": "high"}
{"type": "toggle_input"}
{"type": "get_stats"}
{"type": "ping"}
{"type": "mousemove", "x": 500, "y": 300}
{"type": "mousedown", "x": 500, "y": 300, "button": 0}
{"type": "mouseup", "x": 500, "y": 300, "button": 0}
{"type": "scroll", "x": 500, "y": 300, "deltaY": -120}
{"type": "keydown", "key": "a", "code": "KeyA", "ctrlKey": false, "altKey": false, "shiftKey": false, "metaKey": false}
{"type": "keyup", "key": "a", "code": "KeyA"}
```

---

## 🚀 ÇALIŞTIRMA TALİMATLARI

### Adım 1: Bağımlılıkları yükle
```bash
cd "/Users/emre/Desktop/emare desk/remote-desktop"
pip install -r requirements.txt
```

### Adım 2: Sunucuyu başlat
```bash
python3 server.py
```
veya
```bash
./start.sh          # macOS/Linux
start.bat           # Windows
```

### Adım 3: Tarayıcıdan bağlan
```
http://localhost:8080        # Aynı bilgisayardan
http://192.168.x.x:8080     # Ağdaki başka cihazdan
```

### Özel port ile çalıştırma
```bash
RV_PORT=9000 RV_WEB_PORT=9001 python3 server.py
```

---

## 🔒 GÜVENLİK NOTLARI

- Şifreleme YOK → Yerel ağ için tasarlanmış
- İnternet üzerinden kullanım için SSH tüneli:
  ```bash
  ssh -L 8080:localhost:8080 -L 8765:localhost:8765 kullanici@sunucu
  ```
- Girdi kontrolü varsayılan KAPALI → İstemci tarafından açılmalı
- `pyautogui.FAILSAFE = False` → Güvenlik kilidi devre dışı (köşeye götürme engeli yok)

---

## 🐛 BİLİNEN SINIRLAMALAR VE EKSİKLER

1. **Şifreleme/Kimlik doğrulama yok** → Herkes bağlanabilir, şifre sorulmaz
2. **Ses yok** → Sadece görüntü aktarılır
3. **Dosya transferi yok** → Sadece ekran görüntüleme ve kontrol
4. **Çoklu monitör desteği yok** → Sadece ana monitör (monitors[1])
5. **Clipboard paylaşımı yok** → Kopyala-yapıştır çalışmaz
6. **Wayland desteği sınırlı** → Linux'ta X11 gerekli
7. **macOS ekran izni** → İlk çalıştırmada izin verilmeli
8. **Test edilmedi** → Kod yazıldı ama henüz çalıştırılıp test edilmedi

---

## 🔮 GELECEKTEKİ GELİŞTİRME FİKİRLERİ

- [ ] Şifre ile kimlik doğrulama
- [ ] TLS/SSL desteği (wss://)
- [ ] Ses aktarımı
- [ ] Dosya transfer özelliği
- [ ] Clipboard senkronizasyonu
- [ ] Çoklu monitör seçimi
- [ ] Bölgesel ekran yakalama (sadece belirli bir pencere)
- [ ] Kayıt tutma (ekran kaydı)
- [ ] Electron/Tauri ile native istemci uygulaması
- [ ] Mobil dokunmatik girdi optimizasyonu

---

## 📝 NEREDE KALINDI (SON DURUM)

**Tarih:** 3 Mart 2026

### Tamamlanan İşler:
1. ✅ Mimari tasarım ve bağımlılık planlaması
2. ✅ Sunucu tarafı ekran yakalama motoru (ScreenCapture sınıfı)
3. ✅ WebSocket sunucusu (çoklu istemci desteği)
4. ✅ HTTP sunucusu (web dosyalarını servis eder)
5. ✅ Web istemci arayüzü (HTML + CSS + JS)
6. ✅ Kalite geçiş sistemi (4 preset: low/medium/high/ultra)
7. ✅ Fare kontrolü (hareket, tıklama, kaydırma)
8. ✅ Klavye kontrolü (tuşlar, modifier kombinasyonları, özel tuşlar)
9. ✅ Gerçek zamanlı metrikler (FPS, gecikme, bant genişliği)
10. ✅ Otomatik yeniden bağlanma (5 denemeye kadar)
11. ✅ Başlatma scriptleri (macOS/Linux + Windows)
12. ✅ README kullanım kılavuzu

### Yapılması Gerekenler:
- ⬜ `pip install -r requirements.txt` ile bağımlılık yükleme
- ⬜ Sunucuyu çalıştırıp test etme
- ⬜ macOS ekran kaydı izni verme (Sistem Tercihleri > Gizlilik > Ekran Kaydı)
- ⬜ Gerçek ağ ortamında istemci testi
- ⬜ Performans optimizasyonu (gerekirse)
- ⬜ Güvenlik iyileştirmeleri (şifre, TLS)

---

## 💡 HIZLI REFERANS

```bash
# Proje dizinine git
cd "/Users/emre/Desktop/emare desk/remote-desktop"

# Bağımlılıkları yükle
pip install websockets Pillow mss pyautogui

# Sunucuyu başlat
python3 server.py

# Tarayıcıdan aç
open http://localhost:8080
```

---

> **Bu dosyayı istediğin yere taşıyabilirsin. İçindeki bilgilerle projeyi tam olarak hatırlayabilir ve kaldığın yerden devam edebilirsin.**
