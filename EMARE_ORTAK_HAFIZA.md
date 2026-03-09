# 🧠 Emare Ekosistemi — Ortak Hafıza (Emare Desk)

> **Son Güncelleme:** 06 March 2026
> **Kapsam:** Emare Desk için paylaşılan bilgi tabanı
> **Bu dosya tüm projelerden referans alınan ortak hafızadır.**

---

## ⚠️ ÖNEMLİ: ANAYASA ZORUNLULUĞU

**KOD YAZMAYA BAŞLAMADAN ÖNCE MUTLAKA OKU:**

📖 **EMARE_ANAYASA.md** — Tüm yapay zekalar için bağlayıcı kurallar

**Okuma Sırası:**
1. ✅ EMARE_ORTAK_HAFIZA.md (bu dosya)
2. ✅ EMARE_ANAYASA.md (kodlama kuralları)
3. ✅ EMARE_AI_COLLECTIVE.md (AI deneyimleri)
4. ✅ DOSYA_YAPISI.md (dosya yapısı)
5. ✅ DERVISHIN_CEYIZI.md (RBAC — rol hiyerarşisi)
6. ✅ emare desk_HAFIZA.md (proje hafızası)

---

## 1. Proje Bilgileri

| Alan | Değer |
|------|-------|
| Ad | Emare Desk |
| Klasör | `emare desk` |
| Kategori | Platform |
| Port | 8000 |
| Teknoloji | Python |
| Çeyiz Tarihi | 06 March 2026 |

---

## 2. Emare Ekosistemi

Emare Desk, **Emare ekosisteminin** bir parçasıdır.

### Ekosistem Yapısı
- **Derviş**: Her proje bir Derviş tarafından korunur
- **Dergah**: Dervişlerin ortak iletişim alanı
- **Ortak Hafıza**: Bu dosya + proje hafızası
- **Anayasa**: Tüm AI'lar için bağlayıcı kurallar
- **Hub**: Merkezi yönetim paneli

### Komşu Projeler
Emare ekosistemindeki diğer projeleri görmek için:
```bash
cat /Users/emre/Desktop/Emare/projects.json | python3 -m json.tool
```

---

## 3. Ortak Teknoloji Standartları

### Backend
- Python 3.10+ (FastAPI veya Flask)
- SQLAlchemy (async tercih edilir)
- Pydantic (veri doğrulama)
- Redis (cache + pub/sub)

### Frontend
- React + Next.js (TypeScript)
- Tailwind CSS (tema: projeye özel renk paleti)
- Inter font ailesi

### DevOps
- Docker + docker-compose
- Git (commit mesajı: conventional commits)
- CI/CD: GitHub Actions

### Güvenlik
- RBAC: SuperAdmin → Admin → Operator → ReadOnly
- JWT token (24 saat)
- bcrypt şifre hashleme
- Rate limiting (rol bazlı)

---

## 4. Geliştirme Kuralları

1. **Yeni dosya açmadan önce** DOSYA_YAPISI.md kontrol et
2. **Yeni dependency eklemeden önce** requirements.txt kontrol et
3. **Her modül** en az 1 test dosyasına sahip olmalı
4. **Her API endpoint** /health check'e sahip olmalı
5. **Her değişiklik** hafıza dosyasında kaydedilmeli
6. **.env dosyası** asla commit edilmemeli

---

## 5. İletişim Kanalları

| Kanal | Açıklama |
|-------|----------|
| Derviş | Proje bazlı sorumluluk |
| Dergah | Çapraz proje iletişim |
| Hub | Merkezi dashboard |
| Ortak Çalışma | Paylaşılan belgeler |

---

*Otomatik oluşturuldu — emarework Dervishi Çeyiz Sistemi v2.0*
