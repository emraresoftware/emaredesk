# Emare Desk — Dervişin Çeyizi

> Bu dosya **olmazsa olmaz** çeyiz dosyasıdır.
> Her Emare projesi doğduğunda bu yapı hazır gelir.
> Kaynak: EmareCloud RBAC Sistemi

---

## 1. KULLANICI AĞACI (ROL HİYERARŞİSİ)

```
🔴 SÜPER ADMİN (level: 100)
│   Tam yetki — tüm işlemler, tüm modüller
│   Wildcard: *
│
├── 🟡 ADMİN (level: 75)
│   │   Yönetim yetkisi — kullanıcı, ayar, modül yönetimi
│   │
│   ├── 🔵 OPERATÖR (level: 50)
│   │       İşlem yetkisi — günlük operasyonlar, komut çalıştırma
│   │
│   └── ⚪ SALT OKUNUR (level: 10)
│           Sadece görüntüleme — hiçbir yazma/silme yetkisi yok
│
└── 🤖 SİSTEM / API (level: 100)
        Servis hesabı — machine-to-machine iletişim
```

---

## 2. ROL TANIMLARI

| Rol | Level | Renk | Açıklama |
|-----|-------|------|----------|
| `super_admin` | 100 | 🔴 `#f87171` | Tam yetki — tüm işlemler |
| `admin` | 75 | 🟡 `#fbbf24` | Sunucu yönetimi, kullanıcı görüntüleme |
| `operator` | 50 | 🔵 `#4c8dff` | Komut çalıştırma, servis yönetimi |
| `read_only` | 10 | ⚪ `#8b8fa3` | Sadece görüntüleme |

---

## 3. YETKİ MATRİSİ

### Modül Grupları

| Modül | Yetkiler | 🔴 Super | 🟡 Admin | 🔵 Operator | ⚪ ReadOnly |
|-------|----------|----------|----------|-------------|------------|
| **Kullanıcı** | view, manage | ✅ | ✅ view | ❌ | ❌ |
| **Ayarlar** | view, edit | ✅ | ✅ | ❌ | ❌ |
| **İçerik** | view, add, edit, delete | ✅ | ✅ | ✅ view+add | ✅ view |
| **API** | view, manage, keys | ✅ | ✅ | ✅ view | ❌ |
| **Raporlar** | view, export | ✅ | ✅ | ✅ view | ✅ view |
| **Finans** | view, manage | ✅ | ✅ view | ❌ | ❌ |
| **Denetim** | view | ✅ | ✅ | ❌ | ❌ |
| **Admin Panel** | access | ✅ | ✅ | ❌ | ❌ |

### Projeye Özel Yetkiler

> Bu bölümü projenin ihtiyacına göre genişletin.

```python
# Emare Desk — Yetki Tanımları
PROJE_PERMISSIONS = [
    # Temel
    'emare desk.view',      # Görüntüleme
    'emare desk.create',    # Oluşturma
    'emare desk.edit',      # Düzenleme
    'emare desk.delete',    # Silme
    'emare desk.manage',    # Tam yönetim
    # Admin
    'emare desk.admin',     # Admin panele erişim
    'emare desk.users',     # Kullanıcı yönetimi
    'emare desk.settings',  # Ayar yönetimi
]
```

---

## 4. ORGANİZASYON YAPISI (Multi-Tenant)

```
Emare Ekosistemi
├── Organizasyon (Tenant)
│   ├── Sahibi (super_admin)
│   ├── Yöneticiler (admin)
│   ├── Operatörler (operator)
│   └── Kullanıcılar (read_only)
│
├── Abonelik Planı
│   ├── community (ücretsiz)
│   ├── starter
│   ├── professional
│   └── enterprise
│
└── Kaynak Kotası
    ├── max_users
    ├── max_storage
    └── max_api_calls
```

---

## 5. PYTHON RBAC İSKELETİ

```python
# emare desk/auth/rbac.py — Kopyala, uyarla, kullan.

from functools import wraps

ROLES = {
    'super_admin': {'label': 'Süper Admin', 'level': 100, 'color': '#f87171'},
    'admin':       {'label': 'Admin',       'level': 75,  'color': '#fbbf24'},
    'operator':    {'label': 'Operatör',    'level': 50,  'color': '#4c8dff'},
    'read_only':   {'label': 'Salt Okunur', 'level': 10,  'color': '#8b8fa3'},
}

PERMISSIONS = {
    'super_admin': {'*'},
    'admin': {
        'emare desk.view', 'emare desk.create',
        'emare desk.edit', 'emare desk.delete',
        'emare desk.manage', 'emare desk.users',
        'emare desk.settings', 'emare desk.admin',
    },
    'operator': {
        'emare desk.view', 'emare desk.create',
        'emare desk.edit',
    },
    'read_only': {
        'emare desk.view',
    },
}

def check_permission(role: str, perm: str) -> bool:
    perms = PERMISSIONS.get(role, set())
    return '*' in perms or perm in perms

def role_required(*roles):
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            # current_user.role kontrolü
            user_role = getattr(kwargs.get('current_user'), 'role', 'read_only')
            if user_role not in roles and user_role != 'super_admin':
                return {'error': 'Yetkiniz yok'}, 403
            return f(*args, **kwargs)
        return decorated
    return decorator

def permission_required(perm: str):
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            user_role = getattr(kwargs.get('current_user'), 'role', 'read_only')
            if not check_permission(user_role, perm):
                return {'error': f'Yetkiniz yok: {perm}'}, 403
            return f(*args, **kwargs)
        return decorated
    return decorator
```

---

## 6. VARSAYILAN KULLANICILAR

| Kullanıcı | Email | Rol | Not |
|-----------|-------|-----|-----|
| Emre (Kurucu) | emre@emare.dev | super_admin | Ekosistem sahibi |
| Proje Admini | admin@emare desk.emare.dev | admin | Proje yöneticisi |
| API Servisi | api@emare desk.emare.dev | super_admin | Machine-to-machine |

---

## 7. GÜVENLİK KURALLARI

1. **super_admin** rolü sadece Emre'ye verilir
2. Her proje en az 1 admin hesabıyla başlar
3. API anahtarları `token.manage` yetkisi gerektirir
4. Denetim logu her yetki değişikliğini kaydeder
5. Şifre hashleme: `werkzeug.security` (bcrypt)
6. JWT token süresi: 24 saat (yenilenebilir)
7. Rate limiting: Rol bazlı (admin: 1000/saat, user: 100/saat)

---

*Bu çeyiz dosyası emarework Dervishi tarafından otomatik oluşturulmuştur.*
*Kaynak: EmareCloud RBAC (rbac.py + models.py)*
*Tarih: 06 March 2026*
