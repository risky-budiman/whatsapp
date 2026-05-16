# 📡 WhatsApp Gateway — API Documentation

> Referensi lengkap semua endpoint REST API yang tersedia pada WhatsApp Gateway v1.9.5.
> Swagger UI interaktif tersedia di: `http://server:3100/api-docs`

---

## Informasi Umum

| Item | Detail |
|------|--------|
| **Base URL** | `http://server-ip:3100` |
| **Prefix API** | Semua endpoint dimulai dengan `/api` |
| **Format** | JSON (`Content-Type: application/json`) |
| **Autentikasi** | API Key via header `X-API-Key` atau query `?api_key=` |

### Autentikasi

Setiap request API memerlukan API Key yang valid, kecuali:
- Request `GET` dari Dashboard Web (`/`) — bypass otomatis untuk kenyamanan akses UI.
- Health check (`/health`) — selalu terbuka.

```bash
# Via Header (Direkomendasikan)
curl -H "X-API-Key: your-api-key" http://server:3100/api/sessions

# Via Query Parameter (untuk integrasi GET sederhana)
curl "http://server:3100/api/chats/send-message?phone=628xxx&message=Hello&api_key=your-key"
```

### Format Response Standar

```json
{
  "success": true,
  "data": { ... },
  "message": "Deskripsi hasil",
  "meta": { "total": 100, "limit": 50, "offset": 0 }
}
```

---

## 1. Sessions Management

Kelola koneksi WhatsApp — buat sesi, scan QR, restart, dan hapus.

| Method | Endpoint | Deskripsi |
|:------:|----------|-----------|
| `GET` | `/api/sessions` | Daftar semua sesi dengan status live |
| `POST` | `/api/sessions` | Buat sesi baru |
| `GET` | `/api/sessions/:id/status` | Status detail sesi |
| `GET` | `/api/sessions/:id/qr` | Stream QR Code via SSE |
| `GET` | `/api/sessions/:id/qr-image` | QR Code sebagai Data URL |
| `PATCH` | `/api/sessions/:id` | Update nama/limit sesi |
| `DELETE` | `/api/sessions/:id` | Hapus sesi (logout + hapus auth) |
| `POST` | `/api/sessions/:id/connect` | Koneksikan ulang sesi yang sudah ada |
| `POST` | `/api/sessions/:id/restart` | Restart sesi (destroy + reconnect) |
| `POST` | `/api/sessions/:id/disconnect` | Putuskan koneksi (shutdown browser) |
| `POST` | `/api/sessions/:id/sync` | Trigger sinkronisasi kontak per sesi |
| `POST` | `/api/sessions/sync-all-contacts` | Sinkronisasi kontak dari semua sesi aktif |
| `POST` | `/api/sessions/:id/clear-data` | Hapus semua chat & kontak per sesi |
| `POST` | `/api/sessions/reset-all-data` | **⚠️ NUCLEAR** — Hapus semua data (kecuali sesi) |

### Buat Sesi Baru

```bash
POST /api/sessions
```
```json
{
  "name": "Nomor Utama",
  "dailyLimit": 200
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid-session-id",
    "name": "Nomor Utama",
    "status": "connecting"
  },
  "message": "Session \"Nomor Utama\" created with limit 200."
}
```

### QR Code Stream (SSE)

```bash
GET /api/sessions/:id/qr
```

Server-Sent Events stream yang mengirim QR Code saat tersedia.

**Event types:**

| Event | Deskripsi |
|-------|-----------|
| `qr` | QR Code Data URL untuk ditampilkan |
| `connected` | Sesi berhasil terhubung (termasuk `phone_number`) |
| `sync_progress` | Progress sinkronisasi kontak |

---

## 2. Contacts Management

Kelola daftar kontak WhatsApp — individual dan grup.

| Method | Endpoint | Deskripsi |
|:------:|----------|-----------|
| `GET` | `/api/contacts` | Daftar kontak individual |
| `POST` | `/api/contacts` | Tambah kontak manual |
| `POST` | `/api/contacts/import` | Import kontak dari JSON array |
| `GET` | `/api/contacts/groups` | Daftar grup WhatsApp |
| `DELETE` | `/api/contacts/:id` | Hapus kontak |

### Daftar Kontak

```bash
GET /api/contacts?limit=500&offset=0
```

Mengembalikan kontak individual (bukan grup). Mendukung paginasi.

### Tambah Kontak Manual

```bash
POST /api/contacts
```
```json
{
  "phone": "6281234567890",
  "name": "Budi Santoso",
  "tags": ["VIP", "Jakarta"]
}
```

> **Catatan:** Nomor otomatis dikonversi ke format JID (`6281234567890@c.us`).

### Import Kontak (Bulk)

```bash
POST /api/contacts/import
```
```json
{
  "contacts": [
    { "phone": "6281234567890", "name": "Budi" },
    { "phone": "6289876543210", "name": "Ani" }
  ]
}
```

---

## 3. Campaigns / Broadcast

Kelola kampanye broadcast — buat, jalankan, pantau progress.

| Method | Endpoint | Deskripsi |
|:------:|----------|-----------|
| `GET` | `/api/campaigns` | Daftar semua kampanye |
| `POST` | `/api/campaigns` | Buat kampanye baru |
| `GET` | `/api/campaigns/:id` | Detail kampanye + daftar pesan |
| `POST` | `/api/campaigns/:id/start` | Mulai/resume broadcast |
| `POST` | `/api/campaigns/:id/pause` | Jeda broadcast |
| `POST` | `/api/campaigns/:id/resume` | Lanjutkan broadcast |
| `POST` | `/api/campaigns/:id/resend-failed` | Kirim ulang pesan gagal |
| `GET` | `/api/campaigns/:id/progress` | Progress real-time via SSE |
| `GET` | `/api/campaigns/send-tag` | **Quick Broadcast** by tag via URL |

### Buat Kampanye

```bash
POST /api/campaigns
```
```json
{
  "name": "Promo Mei 2026",
  "template": "Halo {nama}, ada promo spesial bulan ini! Cek detailnya di website kami.",
  "recipients": [
    { "phone": "6281234567890", "name": "Budi" },
    { "phone": "6289876543210", "name": "Ani" }
  ],
  "variationPool": {
    "halo": ["Halo", "Hi", "Selamat siang", "Hai"]
  }
}
```

**Template Variables:**
- `{nama}` — Diganti dengan nama penerima
- `{phone}` — Diganti dengan nomor telepon

### Quick Broadcast by Tag (GET)

Endpoint ini cocok untuk integrasi dengan sistem alert (Mikrotik, monitoring, dll) yang hanya bisa mengirim via URL:

```
GET /api/campaigns/send-tag?tag=VIP&message=Server+down!&api_key=your-key&name=Alert+Server
```

| Parameter | Wajib | Deskripsi |
|-----------|:-----:|-----------|
| `tag` | ✅ | Nama tag kontak yang akan dikirim |
| `message` | ✅ | Isi pesan broadcast |
| `api_key` | ✅ | API Key autentikasi |
| `name` | ❌ | Nama kampanye (opsional) |

### Progress Stream (SSE)

```bash
GET /api/campaigns/:id/progress
```

Mengirim data statistik setiap 3 detik:
```json
{
  "total": 100,
  "sent": 45,
  "failed": 2,
  "pending": 53
}
```

---

## 4. Live Chat

Baca dan balas pesan WhatsApp secara real-time.

| Method | Endpoint | Deskripsi |
|:------:|----------|-----------|
| `GET` | `/api/chats` | Daftar percakapan terbaru (1 per kontak) |
| `GET` | `/api/chats/logs` | Riwayat log pengiriman pesan |
| `GET` | `/api/chats/:phone` | Riwayat chat per nomor/JID |
| `POST` | `/api/chats/:phone` | Kirim balasan manual |
| `POST` | `/api/chats/:phone/read` | Tandai pesan sebagai sudah dibaca |
| `GET` | `/api/chats/send-message` | Kirim pesan via GET (untuk alert) |
| `GET` | `/api/chats/stream/events` | Stream SSE untuk real-time updates |
| `DELETE` | `/api/chats/message/:id` | Hapus satu pesan |
| `DELETE` | `/api/chats/log/:id` | Hapus satu log pesan |
| `DELETE` | `/api/chats/history/:phone` | Hapus seluruh riwayat chat kontak |

### Kirim Balasan

```bash
POST /api/chats/6281234567890@c.us
```
```json
{
  "message": "Terima kasih, pesan Anda sudah kami terima!",
  "sessionId": "auto"
}
```

| Field | Wajib | Deskripsi |
|-------|:-----:|-----------|
| `message` | ✅ | Teks pesan yang akan dikirim |
| `sessionId` | ❌ | ID sesi pengirim. `"auto"` atau kosongkan untuk rotasi otomatis |

### Kirim Pesan via GET (untuk External Alert)

Endpoint sederhana yang cocok untuk integrasi dengan perangkat seperti **Mikrotik**, **Zabbix**, atau sistem monitoring lainnya yang hanya mendukung HTTP GET:

```
GET /api/chats/send-message?phone=6281234567890&message=Alert!+CPU+Usage+95%25&api_key=your-key
```

| Parameter | Wajib | Deskripsi |
|-----------|:-----:|-----------|
| `phone` | ✅ | Nomor tujuan |
| `message` | ✅ | Isi pesan |
| `api_key` | ✅ | API Key |
| `sessionId` | ❌ | ID sesi (default: otomatis pilih yang aktif) |

### Real-time Event Stream (SSE)

```bash
GET /api/chats/stream/events
```

Stream untuk membangun UI reaktif. Event types yang dikirim:

| Event Type | Deskripsi |
|------------|-----------|
| `message` | Pesan baru masuk atau terkirim |
| `qr` | Update QR Code sesi |
| `status` | Perubahan status koneksi sesi |
| `sync_progress` | Progress sinkronisasi kontak |
| `message_ack` | Update status pengiriman (sent/delivered/read) |

---

## 5. Settings

Kelola pengaturan aplikasi.

| Method | Endpoint | Deskripsi |
|:------:|----------|-----------|
| `GET` | `/api/settings` | Ambil pengaturan saat ini |
| `POST` | `/api/settings` | Update pengaturan |
| `GET` | `/api/settings/stats` | Statistik ringkasan dashboard |
| `POST` | `/api/settings/regenerate-api-key` | Generate API Key baru |

### Statistik Dashboard

```bash
GET /api/settings/stats
```

```json
{
  "success": true,
  "data": {
    "activeSessions": 2,
    "totalContacts": 1250,
    "messagesToday": 45,
    "totalBroadcasts": 12
  }
}
```

### Toggle Live Chat

```bash
POST /api/settings
```
```json
{
  "liveChatEnabled": true
}
```

---

## 6. System & Health

| Method | Endpoint | Deskripsi |
|:------:|----------|-----------|
| `GET` | `/health` | Health check (tanpa auth) |
| `GET` | `/api-docs` | Swagger UI interaktif |

### Health Check

```bash
GET /health
```

```json
{
  "status": "ok",
  "uptime": 3600.5,
  "memory": {
    "heapUsed": 85,
    "rss": 150
  },
  "platform": "win32",
  "version": "1.9.5"
}
```

---

## Status Codes

| Code | Deskripsi |
|:----:|-----------|
| `200` | Request berhasil |
| `400` | Request tidak valid (parameter kurang/salah) |
| `401` | API Key tidak diberikan |
| `403` | API Key tidak valid |
| `404` | Resource tidak ditemukan |
| `500` | Kesalahan server internal |

---

## Contoh Integrasi

### PHP / Laravel

```php
$response = Http::withHeaders([
    'X-API-Key' => config('services.wa_gateway.key'),
])->post(config('services.wa_gateway.url') . '/api/chats/628123456789@c.us', [
    'message' => 'Halo dari Laravel!',
]);
```

### Mikrotik Script

```routeros
/tool fetch url="http://server-ip:3100/api/chats/send-message\?phone=628123456789&message=Router+restarted&api_key=your-key" mode=http
```

### Python

```python
import requests

headers = {"X-API-Key": "your-api-key"}
data = {"message": "Halo dari Python!"}

response = requests.post(
    "http://server-ip:3100/api/chats/628123456789@c.us",
    headers=headers,
    json=data
)
print(response.json())
```

### cURL

```bash
# Kirim pesan
curl -X POST http://localhost:3100/api/chats/628123456789@c.us \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello World!"}'

# Buat kampanye broadcast
curl -X POST http://localhost:3100/api/campaigns \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Campaign",
    "template": "Hi {nama}!",
    "recipients": [
      {"phone": "628123456789", "name": "Budi"}
    ]
  }'
```
