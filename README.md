# 📱 WhatsApp Gateway v1.9.5

> **Self-hosted WhatsApp Broadcasting Gateway** dengan sistem Anti-Ban cerdas, Live Chat, dan Dashboard Manajemen — ditenagai oleh **whatsapp-web.js** + **Puppeteer**.

---

## 📋 Daftar Isi

- [Gambaran Umum](#-gambaran-umum)
- [Fitur Utama](#-fitur-utama)
- [Arsitektur Sistem](#-arsitektur-sistem)
- [Persyaratan Sistem](#-persyaratan-sistem)
- [Instalasi (Development)](#-instalasi-development)
- [Deploy ke Production (Ubuntu Server)](#-deploy-ke-production-ubuntu-server)
- [Konfigurasi Environment](#-konfigurasi-environment)
- [Menjalankan Aplikasi](#-menjalankan-aplikasi)
- [Dashboard Web](#-dashboard-web)
- [Integrasi dengan Sistem Eksternal](#-integrasi-dengan-sistem-eksternal)
- [Maintenance & Troubleshooting](#-maintenance--troubleshooting)
- [Dokumentasi Lebih Lanjut](#-dokumentasi-lebih-lanjut)

---

## 🌟 Gambaran Umum

WhatsApp Gateway adalah server API mandiri yang memungkinkan Anda mengirim pesan WhatsApp secara terprogram melalui REST API — tanpa bergantung pada layanan pihak ketiga (Fonnte, Wablas, dll). Dibangun sebagai solusi *self-hosted* yang terintegrasi dengan infrastruktur internal Anda.

**Mengapa Self-Hosted?**

| Aspek | Provider Pihak Ketiga | Self-Hosted Gateway |
|-------|----------------------|---------------------|
| Biaya | Bayar per pesan | **Gratis** (hanya biaya server) |
| Privasi | Data lewat pihak ketiga | **Data tetap di server Anda** |
| Kustomisasi | Terbatas | **Penuh** — API, UI, logika |
| Ketergantungan | Bergantung uptime provider | **Mandiri** |

---

## ✨ Fitur Utama

### 🔌 Multi-Session WhatsApp
- Kelola beberapa nomor WhatsApp secara bersamaan
- Scan QR Code langsung dari Dashboard Web
- Auto-reconnect jika koneksi terputus
- Rotasi nomor otomatis (round-robin) saat broadcast

### 🛡️ Sistem Anti-Ban Cerdas
- **Random Delay** (20-90 detik) antar pesan
- **Batch Rest** — istirahat 10-20 menit setiap 40 pesan
- **Typing Simulation** — mensimulasikan ketikan sebelum kirim
- **Content Variation** — variasi teks otomatis untuk menghindari deteksi spam
- **Daily Limit** — batas 200 pesan/nomor/hari (konfigurabel)

### 📢 Campaign & Broadcast
- Buat kampanye broadcast dengan template variabel (`{nama}`, `{phone}`, dll)
- Start / Pause / Resume kampanye
- Progress tracking real-time via SSE (Server-Sent Events)
- Retry otomatis untuk pesan gagal
- Quick Broadcast by Tag via URL (cocok untuk alert Mikrotik, monitoring, dll)

### 💬 Live Chat / Inbox
- Tampilan mirip WhatsApp Web
- Pesan masuk & keluar real-time (SSE)
- Riwayat chat tersimpan di database
- Kirim balasan manual langsung dari Dashboard

### 👥 Manajemen Kontak
- Sinkronisasi kontak otomatis dari WhatsApp
- Tambah kontak manual
- Import kontak via JSON array
- Sinkronisasi dari database Laravel (opsional)
- Dukungan kontak Grup WhatsApp

### 📊 Dashboard Monitoring
- Statistik sesi aktif, total kontak, pesan hari ini
- Log pengiriman pesan
- Manajemen API Key dari UI
- Toggle Live Chat on/off
- Swagger API Documentation built-in (`/api-docs`)

---

## 🏗️ Arsitektur Sistem

```
┌──────────────────────────────────────────────────────────────┐
│                    Sistem Eksternal                           │
│   (Laravel, Mikrotik, Monitoring, Postman, dll)              │
└──────────────┬───────────────────────────────────────────────┘
               │ HTTP REST API + API Key
               ▼
┌──────────────────────────────────────────────────────────────┐
│                WhatsApp Gateway (Node.js)                     │
│                                                              │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ REST API   │  │ Queue Engine │  │ Anti-Ban Engine       │  │
│  │ (Express)  │──│  (BullMQ)    │──│ - Random delay       │  │
│  │ + Swagger  │  └──────┬───────┘  │ - Typing simulation  │  │
│  └────────────┘         │          │ - Content variation   │  │
│                         │          │ - Daily limit         │  │
│  ┌────────────┐  ┌──────▼───────┐  └───────┬──────────────┘  │
│  │ Dashboard  │  │   Workers    │          │                 │
│  │  (Web UI)  │  │ (BullMQ)    │──────────┘                 │
│  │  SSE Live  │  └──────┬───────┘                            │
│  └────────────┘         │                                    │
│                ┌────────▼─────────────────────────────┐      │
│                │  Session Manager (whatsapp-web.js)    │      │
│                │  📱 Session 1  │  📱 Session 2  │ …  │      │
│                │      (Puppeteer / Chromium)           │      │
│                └──────────────────────────────────────┘      │
│                         │                                    │
│              ┌──────────▼──────────┐                         │
│              │  MySQL   │  Redis   │                         │
│              │ (Data)   │ (Queue)  │                         │
│              └─────────────────────┘                         │
└──────────────────────────────────────────────────────────────┘
```

---

## 📦 Persyaratan Sistem

### Software Wajib

| Software | Versi Minimum | Rekomendasi |
|----------|:------------:|:-----------:|
| **Node.js** | 18.x LTS | 20.x LTS atau 22.x LTS |
| **MySQL** | 5.7 | 8.0+ |
| **Redis** | 6.x | 7.x |
| **npm** | 9.x | 10.x |

> **Catatan:** Chromium akan diunduh otomatis oleh Puppeteer saat `npm install`. Tidak perlu install Chrome secara manual.

### Hardware Minimum

| Skenario | CPU | RAM | Storage |
|----------|:---:|:---:|:-------:|
| 1 sesi WhatsApp (Development) | 2 Core | 4 GB | 10 GB SSD |
| 1-3 sesi (Production Ringan) | 4 Core | 8 GB | 20 GB SSD |
| 5+ sesi (Production Berat) | 8 Core | 16 GB | 50 GB NVMe |

> **⚠️ Penting:** Setiap sesi WhatsApp = 1 instance Chromium headless (~200-400 MB RAM). Ini adalah faktor utama kebutuhan RAM.

---

## 🚀 Instalasi (Development)

### 1. Persiapan Database

Buat database baru di MySQL:
```sql
CREATE DATABASE whatsapp_gateway CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Pastikan Redis sudah berjalan di `localhost:6379`.

### 2. Clone / Ekstrak Repository

```bash
git clone <repository-url>
cd Whatsapps-Gateway
```

### 3. Install Dependensi

```bash
npm install
```

### 4. Konfigurasi Environment

Salin `.env.example` ke `.env` dan sesuaikan:
```bash
cp .env.example .env
```

Edit file `.env`:
```ini
APP_PORT=3100
APP_ENV=development
API_KEY=ganti-dengan-kunci-rahasia-anda

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=whatsapp_gateway

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
```

> **⚠️ PENTING:** Selalu ganti `API_KEY` dari nilai default sebelum menjalankan di production!

### 5. Jalankan Migrasi Database

```bash
npm run migrate
```

Perintah ini akan:
- Membuat database jika belum ada
- Membuat 9 tabel yang diperlukan
- Memperbaiki skema kolom secara otomatis

### 6. Jalankan Aplikasi

```bash
npm run dev
```

Dashboard tersedia di: **http://localhost:3100**
API Docs (Swagger): **http://localhost:3100/api-docs**

---

## 🐧 Deploy ke Production (Ubuntu Server)

### Langkah 1: Install Dependensi Sistem (Wajib untuk Puppeteer)

Ubuntu Server tidak memiliki library grafis yang dibutuhkan Chromium. Install terlebih dahulu:

```bash
sudo apt update && sudo apt install -y \
  gconf-service libgbm-dev libasound2 libatk1.0-0 libc6 \
  libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 \
  libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 \
  libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 \
  libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
  libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \
  libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates \
  fonts-liberation libappindicator1 libnss3 lsb-release \
  xdg-utils wget
```

### Langkah 2: Build Aplikasi

```bash
npm install --production
npm run build
npm run migrate
```

### Langkah 3: Konfigurasi PM2

Install PM2 jika belum tersedia:
```bash
sudo npm install -g pm2
```

File `ecosystem.config.js` sudah tersedia di root project:
```javascript
module.exports = {
  apps: [{
    name: 'wa-gateway',
    script: 'dist/index.js',
    instances: 1,           // WAJIB 1 — SessionManager adalah Singleton
    autorestart: true,
    watch: false,            // JANGAN aktifkan watch!
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
    },
  }],
};
```

> **⚠️ PERINGATAN KRITIKAL:**
> - **`instances` harus tetap `1`** — SessionManager menggunakan pola Singleton. Menjalankan lebih dari 1 instance akan menyebabkan konflik sesi WhatsApp.
> - **Jangan gunakan `pm2 start --watch`** — WhatsApp menulis file cache ke `wa_auth/` secara terus-menerus. PM2 watch akan mendeteksi ini sebagai perubahan dan me-restart server tanpa henti.

### Langkah 4: Jalankan dengan PM2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup    # Agar otomatis start setelah reboot
```

### Langkah 5: Monitor

```bash
pm2 logs wa-gateway     # Lihat log real-time
pm2 monit               # Monitor CPU/RAM
pm2 status              # Status proses
```

---

## ⚙️ Konfigurasi Environment

### Variabel Lengkap (`.env`)

```ini
# ═══════════════════════════════════════
# APLIKASI
# ═══════════════════════════════════════
APP_PORT=3100               # Port HTTP server
APP_ENV=production          # 'development' atau 'production'
API_KEY=kunci-rahasia-anda  # API Key untuk autentikasi

# ═══════════════════════════════════════
# DATABASE MYSQL
# ═══════════════════════════════════════
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=password-anda
DB_NAME=whatsapp_gateway

# ═══════════════════════════════════════
# REDIS (untuk BullMQ Message Queue)
# ═══════════════════════════════════════
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=             # Kosongkan jika tanpa autentikasi

# ═══════════════════════════════════════
# PENGATURAN ANTI-BAN
# ═══════════════════════════════════════
DELAY_MIN=20                # Delay minimum antar pesan (detik)
DELAY_MAX=90                # Delay maksimum antar pesan (detik)
BATCH_SIZE=40               # Jumlah pesan per batch
REST_MIN=600                # Istirahat minimum antar batch (detik) = 10 menit
REST_MAX=1200               # Istirahat maksimum antar batch (detik) = 20 menit
DAILY_LIMIT=200             # Batas pesan per sesi per hari

# ═══════════════════════════════════════
# WEBHOOK (Opsional)
# ═══════════════════════════════════════
WEBHOOK_URL=                # URL callback setelah pengiriman pesan
WEBHOOK_SECRET=             # Secret untuk verifikasi webhook
```

### Penjelasan Anti-Ban Settings

| Parameter | Default | Deskripsi |
|-----------|:-------:|-----------|
| `DELAY_MIN` | 20s | Jeda minimum sebelum mengirim pesan berikutnya |
| `DELAY_MAX` | 90s | Jeda maksimum (dipilih acak antara MIN-MAX) |
| `BATCH_SIZE` | 40 | Setelah mengirim 40 pesan, sistem istirahat |
| `REST_MIN` | 600s | Waktu istirahat minimum antar batch (10 menit) |
| `REST_MAX` | 1200s | Waktu istirahat maksimum antar batch (20 menit) |
| `DAILY_LIMIT` | 200 | Tidak akan mengirim lebih dari 200 pesan per nomor per hari |

**Estimasi kapasitas:**

| Jumlah Nomor | Kapasitas/Hari | Waktu untuk 1000 Kontak |
|:------------:|:--------------:|:-----------------------:|
| 2 nomor | ~400 pesan | ~2.5 hari |
| 3 nomor | ~600 pesan | ~2 hari |
| 5 nomor | ~1000 pesan | ~1 hari |

---

## ▶️ Menjalankan Aplikasi

### Mode Development
```bash
npm run dev          # Hot-reload via ts-node-dev
```

### Mode Production
```bash
npm run build        # Compile TypeScript → dist/
npm run start        # Jalankan dari dist/index.js
# atau
pm2 start ecosystem.config.js
```

### Perintah Tersedia

| Perintah | Deskripsi |
|----------|-----------|
| `npm run dev` | Jalankan server development (hot-reload) |
| `npm run build` | Compile TypeScript ke JavaScript |
| `npm run start` | Jalankan server production |
| `npm run migrate` | Buat/perbarui skema database |
| `npm run check-db` | Diagnostic tool untuk cek koneksi database |

---

## 🖥️ Dashboard Web

Setelah server berjalan, akses Dashboard di browser:

```
http://localhost:3100
```

### Fitur Dashboard

| Modul | Deskripsi |
|-------|-----------|
| **Dashboard** | Statistik ringkasan (sesi aktif, total kontak, pesan hari ini) |
| **Sessions** | Kelola koneksi WhatsApp — buat sesi, scan QR, restart, hapus |
| **Contacts** | Lihat, tambah, import kontak; sinkronisasi dari WhatsApp |
| **Campaigns** | Buat dan pantau kampanye broadcast |
| **Live Chat** | Inbox real-time — baca dan balas pesan WhatsApp |
| **Message Logs** | Riwayat pengiriman semua pesan |
| **Settings** | Toggle Live Chat, regenerate API Key |
| **API Docs** | Dokumentasi Swagger interaktif |

---

## 🔌 Integrasi dengan Sistem Eksternal

### Autentikasi API

Semua request API memerlukan API Key melalui salah satu metode:

```
# Via Header (Direkomendasikan)
X-API-Key: kunci-api-anda

# Via Query Parameter
?api_key=kunci-api-anda
```

> **Pengecualian:** Request GET dari Dashboard Web (`/`) tidak memerlukan API Key untuk kemudahan akses.

### Contoh: Kirim Pesan (POST)

```bash
curl -X POST http://localhost:3100/api/chats/6281234567890@c.us \
  -H "X-API-Key: kunci-api-anda" \
  -H "Content-Type: application/json" \
  -d '{"message": "Halo dari API!"}'
```

### Contoh: Kirim Pesan via GET (Cocok untuk Mikrotik/Alert)

```
http://server-ip:3100/api/chats/send-message?phone=6281234567890&message=Peringatan+sistem&api_key=kunci-api-anda
```

### Contoh: Broadcast by Tag

```
http://server-ip:3100/api/campaigns/send-tag?tag=VIP&message=Promo+khusus+VIP&api_key=kunci-api-anda
```

### Integrasi Laravel

Tambahkan ke `.env` Laravel:
```ini
WA_GATEWAY_URL=http://server-ip:3100
WA_GATEWAY_API_KEY=kunci-api-anda
```

Lihat [API_DOCUMENTATION.md](API_DOCUMENTATION.md) untuk referensi endpoint lengkap.

---

## 🛠 Maintenance & Troubleshooting

### Sinkronisasi Kontak

Setelah menghubungkan sesi WhatsApp baru:
1. Tunggu **1-2 menit** agar Chrome mengunduh buku telepon dari HP
2. Tekan tombol **"Sync WhatsApp"** di Dashboard
3. Kontak dan grup akan muncul di halaman Contacts

### Membersihkan Data Duplikat

Jika terjadi penumpukan data atau format lama:
```bash
npx ts-node clean_data.ts
```
> **⚠️** Matikan server terlebih dahulu sebelum menjalankan skrip ini, lalu restart dan lakukan sinkronisasi ulang.

### Health Check

```bash
curl http://localhost:3100/health
```
Response menunjukkan uptime, penggunaan memori, dan versi aplikasi.

### Melihat Log

```bash
# Jika menggunakan PM2
pm2 logs wa-gateway

# File log tersimpan di
ls logs/
```

### Port & Firewall

| Port | Service | Akses |
|:----:|---------|-------|
| `3100` | HTTP API + Dashboard | Buka untuk jaringan lokal |
| `3306` | MySQL | Batasi ke localhost saja |
| `6379` | Redis | Batasi ke localhost saja |

---

## 📚 Dokumentasi Lebih Lanjut

| Dokumen | Deskripsi |
|---------|-----------|
| [API_DOCUMENTATION.md](API_DOCUMENTATION.md) | Referensi lengkap semua API endpoint |
| [ROADMAP.md](ROADMAP.md) | Riwayat pengembangan dan daftar fitur |
| `/api-docs` | Swagger UI interaktif (saat server berjalan) |

---

## ⚠️ Peringatan Penting

> **whatsapp-web.js adalah library tidak resmi.** WhatsApp dapat memblokir/ban nomor kapan saja jika mendeteksi aktivitas otomatis yang mencurigakan.

**Untuk meminimalisir risiko:**
- ✅ Gunakan nomor khusus (bukan nomor pribadi)
- ✅ Siapkan 3-5 nomor cadangan
- ✅ Jangan melebihi 200 pesan/nomor/hari
- ✅ Pastikan semua kontak sudah opt-in
- ✅ Monitor block rate — jika > 5%, hentikan campaign
- ✅ Gunakan setting Anti-Ban yang konservatif

---

<p align="center">
  <b>WhatsApp Gateway v1.9.5</b> — Powered by whatsapp-web.js + Puppeteer<br>
  Built with ❤️ using Node.js, TypeScript, Express, MySQL, Redis & BullMQ
</p>
