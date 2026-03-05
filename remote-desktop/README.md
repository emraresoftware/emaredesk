# RemoteView - Uzak Masaüstü Yazılımı

Hafif, cross-platform uzak masaüstü çözümü. Varsayılan olarak düşük kalitede hızlı çalışır, istendiğinde yüksek kaliteye geçiş yapılabilir.

## Özellikler

- **Dinamik kalite**: Düşük / Orta / Yüksek / Ultra (PNG) arasında anlık geçiş
- **Cross-platform**: Sunucu Windows/macOS/Linux, istemci herhangi bir tarayıcı
- **Fare & klavye kontrolü**: Uzak bilgisayarı tam kontrol
- **Düşük bant genişliği**: Varsayılan düşük kalitede ~25 JPEG sıkıştırma
- **Gerçek zamanlı metrikler**: FPS, gecikme, bant genişliği takibi
- **Otomatik yeniden bağlanma**: Bağlantı koparsa otomatik tekrar dener
- **Tam ekran modu**: Tarayıcıyı tam ekran yaparak çalışabilir

## Hızlı Başlangıç

### 1. Bağımlılıkları Yükle
```bash
pip install -r requirements.txt
```

### 2. Sunucuyu Başlat (kontrol edilecek bilgisayarda)

**macOS / Linux:**
```bash
./start.sh
```

**Windows:**
```bat
start.bat
```

**veya doğrudan:**
```bash
python3 server.py
```

### 3. Bağlan (herhangi bir cihazdan)

Tarayıcıyı aç ve şu adrese git:
```
http://<sunucu-ip>:8080
```

Aynı bilgisayardan test için: `http://localhost:8080`

## Kalite Modları

| Mod | Format | Kalite | Ölçek | FPS | Kullanım |
|------|--------|--------|-------|-----|----------|
| 🟢 Düşük | JPEG | 25% | 40% | 10 | Yavaş ağlar, günlük izleme |
| 🟡 Orta | JPEG | 55% | 60% | 20 | Normal kullanım |
| 🟠 Yüksek | JPEG | 85% | 85% | 30 | Detaylı çalışma |
| 🔴 Ultra | PNG | 100% | 100% | 30 | Piksel-hassas, tasarım |

İstemci tarafında üst çubuktaki butonlarla anlık geçiş yapılır.

## Yapılandırma

Çevresel değişkenlerle ayarlanabilir:

```bash
RV_HOST=0.0.0.0      # Dinleme adresi (varsayılan: 0.0.0.0)
RV_PORT=8765          # WebSocket portu (varsayılan: 8765)
RV_WEB_PORT=8080      # Web sunucu portu (varsayılan: 8080)
```

Örnek:
```bash
RV_PORT=9000 RV_WEB_PORT=9001 python3 server.py
```

## Güvenlik Notları

- Bu yazılım **yerel ağ** kullanımı için tasarlanmıştır
- İnternet üzerinden kullanmak için VPN veya SSH tüneli kullanın:
  ```bash
  ssh -L 8080:localhost:8080 -L 8765:localhost:8765 kullanici@sunucu
  ```
- Varsayılanda şifreleme yoktur, hassas kullanım için tünel şarttır

## Dosya Yapısı

```
remote-desktop/
├── server.py           # Ana sunucu (ekran yakalama + WebSocket)
├── requirements.txt    # Python bağımlılıkları
├── start.sh            # macOS/Linux başlatma
├── start.bat           # Windows başlatma
├── README.md           # Bu dosya
└── web/
    ├── index.html      # İstemci HTML
    ├── style.css       # İstemci stilleri
    └── app.js          # İstemci JavaScript
```

## Gereksinimler

- **Sunucu**: Python 3.8+
- **İstemci**: Modern tarayıcı (Chrome, Firefox, Safari, Edge)
- **Ağ**: Sunucu ve istemci aynı ağda olmalı (veya port yönlendirmesi)
