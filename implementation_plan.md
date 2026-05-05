# 🚀 WhatsApp Gateway — Design Plan & Task Queue

> **Project:** WhatsApp Broadcasting Gateway (Anti-Ban)
> **Database:** MySQL
> **Integrasi:** Laravel SahabatIT (ISP Billing)
> **Dibuat:** 5 Mei 2026

---

## 📋 Daftar Isi

1. [Ringkasan Masalah](#1-ringkasan-masalah)
2. [Arsitektur Sistem](#2-arsitektur-sistem)
3. [Tech Stack](#3-tech-stack)
4. [Database Schema (MySQL)](#4-database-schema-mysql)
5. [Struktur Folder Project](#5-struktur-folder-project)
6. [Fitur & Modul](#6-fitur--modul)
7. [Strategi Anti-Ban](#7-strategi-anti-ban)
8. [Integrasi dengan Laravel SahabatIT](#8-integrasi-dengan-laravel-sahabtit)
9. [API Endpoints](#9-api-endpoints)
10. [Antrian Pengerjaan (Task Queue)](#10-antrian-pengerjaan-task-queue)

---

## 1. Ringkasan Masalah

| Masalah | Penyebab | Solusi |
|---------|----------|-------|
| Nomor WA sering diblokir | Kirim massal tanpa delay | Smart queue + random delay |
| 1000+ pelanggan harus dibroadcast | Satu nomor menanggung semua | Multi-session + rotasi nomor |
| Pesan identik terdeteksi spam | Tidak ada variasi konten | Content variation engine |
| Saat ini pakai provider pihak ke-3 (Fonnte/Wablas) | Biaya per pesan, terbatas | Self-hosted gateway via Baileys |

---

## 2. Arsitektur Sistem

```
┌─────────────────────────────────────────────────────────┐
│                   Laravel SahabatIT                      │
│  (Trigger broadcast via HTTP API ke WA Gateway)         │
└──────────────┬──────────────────────────────────────────┘
               │ HTTP REST API
               ▼
┌─────────────────────────────────────────────────────────┐
│              WhatsApp Gateway (Node.js)                  │
│                                                          │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ REST API │──│ Queue Engine │──│ Anti-Ban Engine    │  │
│  │ Express  │  │  (BullMQ)    │  │ - Random delay    │  │
│  └──────────┘  └──────┬───────┘  │ - Typing sim      │  │
│                       │          │ - Content variation│  │
│  ┌──────────┐  ┌──────▼───────┐  └────────┬──────────┘  │
│  │ Dashboard│  │   Workers    │           │              │
│  │  (Web UI)│  │ (Processors) │───────────┘              │
│  └──────────┘  └──────┬───────┘                          │
│                       │                                  │
│  ┌────────────────────▼──────────────────────────────┐   │
│  │           Session Manager (Baileys)                │   │
│  │  📱 Session 1  │  📱 Session 2  │  📱 Session 3  │   │
│  └────────────────────────────────────────────────────┘   │
│                       │                                  │
│              ┌────────▼────────┐                         │
│              │  MySQL Database │                         │
│              │  + Redis Cache  │                         │
│              └─────────────────┘                         │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Tech Stack

| Komponen | Teknologi | Keterangan |
|----------|-----------|------------|
| Runtime | Node.js 20+ | Event-driven, cocok WebSocket |
| Framework | Express.js | REST API server |
| Language | TypeScript | Type-safe |
| WA Library | `@whiskeysockets/baileys` | Multi-session, ringan |
| Queue | BullMQ | Rate limiting, retry, backoff |
| Database | **MySQL** | Shared dengan Laravel SahabatIT |
| Cache | Redis | Backend BullMQ + session cache |
| Dashboard | HTML/CSS/JS (Vanilla) | Monitoring UI |
| Process Mgr | PM2 | Auto-restart |

---

## 4. Database Schema (MySQL)

> Database: `whatsapp_gateway` (atau tabel baru di `laravel_radius`)

### Tabel: `wa_sessions`
```sql
CREATE TABLE wa_sessions (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20),
    status ENUM('connecting','active','disconnected','banned') DEFAULT 'connecting',
    daily_sent_count INT DEFAULT 0,
    daily_limit INT DEFAULT 200,
    last_sent_at TIMESTAMP NULL,
    last_connected_at TIMESTAMP NULL,
    priority INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### Tabel: `wa_campaigns`
```sql
CREATE TABLE wa_campaigns (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    template_message TEXT NOT NULL,
    variation_pool JSON COMMENT 'Variasi kata untuk anti-spam',
    status ENUM('draft','scheduled','running','paused','completed','failed') DEFAULT 'draft',
    scheduled_at TIMESTAMP NULL,
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    total_recipients INT DEFAULT 0,
    sent_count INT DEFAULT 0,
    failed_count INT DEFAULT 0,
    delay_min INT DEFAULT 20 COMMENT 'Delay minimum (detik)',
    delay_max INT DEFAULT 90 COMMENT 'Delay maksimum (detik)',
    batch_size INT DEFAULT 40,
    rest_min INT DEFAULT 600 COMMENT 'Istirahat minimum (detik)',
    rest_max INT DEFAULT 1200 COMMENT 'Istirahat maksimum (detik)',
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### Tabel: `wa_campaign_messages`
```sql
CREATE TABLE wa_campaign_messages (
    id VARCHAR(36) PRIMARY KEY,
    campaign_id VARCHAR(36) NOT NULL,
    session_id VARCHAR(36),
    target_phone VARCHAR(20) NOT NULL,
    target_name VARCHAR(255),
    message_content TEXT,
    status ENUM('pending','queued','sending','sent','failed') DEFAULT 'pending',
    error_message TEXT,
    retry_count INT DEFAULT 0,
    max_retries INT DEFAULT 3,
    sent_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES wa_campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES wa_sessions(id) ON DELETE SET NULL,
    INDEX idx_status (status),
    INDEX idx_campaign (campaign_id)
);
```

### Tabel: `wa_contacts`
```sql
CREATE TABLE wa_contacts (
    id VARCHAR(36) PRIMARY KEY,
    phone_number VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(255),
    tags JSON,
    is_opted_out BOOLEAN DEFAULT FALSE,
    opted_out_at TIMESTAMP NULL,
    source VARCHAR(50) DEFAULT 'manual' COMMENT 'manual|import|laravel_sync',
    laravel_customer_id INT COMMENT 'FK ke customers.id di Laravel',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_phone (phone_number),
    INDEX idx_opted_out (is_opted_out)
);
```

### Tabel: `wa_message_logs`
```sql
CREATE TABLE wa_message_logs (
    id VARCHAR(36) PRIMARY KEY,
    session_id VARCHAR(36),
    campaign_id VARCHAR(36),
    target_phone VARCHAR(20) NOT NULL,
    message_content TEXT,
    direction ENUM('outgoing','incoming') DEFAULT 'outgoing',
    status ENUM('sent','failed','received') DEFAULT 'sent',
    error TEXT,
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_session (session_id),
    INDEX idx_created (created_at)
);
```

### Tabel: `wa_session_auth`
```sql
CREATE TABLE wa_session_auth (
    id VARCHAR(36) PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL UNIQUE,
    auth_data LONGTEXT NOT NULL COMMENT 'JSON auth state dari Baileys',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES wa_sessions(id) ON DELETE CASCADE
);
```

---

## 5. Struktur Folder Project

```
d:\AI Code\Whatsapps-Gateway\
├── package.json
├── tsconfig.json
├── .env
├── .env.example
├── ecosystem.config.js          # PM2 config
├── src/
│   ├── index.ts                 # Entry point
│   ├── config/
│   │   ├── database.ts          # MySQL connection (mysql2)
│   │   ├── redis.ts             # Redis connection
│   │   └── env.ts               # Env loader + validasi
│   ├── api/
│   │   ├── routes/
│   │   │   ├── session.routes.ts
│   │   │   ├── campaign.routes.ts
│   │   │   ├── contact.routes.ts
│   │   │   └── dashboard.routes.ts
│   │   ├── controllers/
│   │   │   ├── SessionController.ts
│   │   │   ├── CampaignController.ts
│   │   │   ├── ContactController.ts
│   │   │   └── DashboardController.ts
│   │   └── middleware/
│   │       └── apiKey.ts        # API Key auth (untuk Laravel)
│   ├── services/
│   │   ├── SessionManager.ts    # Multi-session Baileys
│   │   ├── QueueService.ts      # BullMQ queue setup
│   │   ├── AntiBanEngine.ts     # Delay, rotation, variation
│   │   ├── BroadcastEngine.ts   # Orkestrasi campaign
│   │   └── ContactSync.ts       # Sync kontak dari Laravel
│   ├── workers/
│   │   └── MessageWorker.ts     # BullMQ worker processor
│   ├── models/
│   │   ├── Session.ts
│   │   ├── Campaign.ts
│   │   ├── CampaignMessage.ts
│   │   ├── Contact.ts
│   │   └── MessageLog.ts
│   └── utils/
│       ├── logger.ts
│       ├── phone.ts             # Format & validasi nomor
│       └── contentVariation.ts  # Variasi konten pesan
├── public/                       # Dashboard UI
│   ├── index.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── app.js
├── auth_sessions/                # Baileys auth (gitignored)
└── logs/
```

---

## 6. Fitur & Modul

### A. Session Manager
- Kelola beberapa nomor WhatsApp (multi-session via Baileys)
- QR code generation & scan dari dashboard
- Auto-reconnect jika terputus
- Health check per session
- Deteksi dan tandai session yang terkena ban

### B. Queue & Anti-Ban Engine
- BullMQ queue dengan Redis backend
- Random delay 20-90 detik antar pesan
- Istirahat 10-20 menit setiap 30-50 pesan
- Rotasi nomor (round-robin antar session aktif)
- Typing simulation sebelum kirim
- Content variation (variasi teks otomatis)
- Exponential backoff saat gagal
- Daily limit enforcement (200/nomor/hari)

### C. Campaign Management
- CRUD campaign dengan template
- Variabel template: `{nama}`, `{id_pelanggan}`, `{amount}`, dll
- Start / Pause / Resume campaign
- Progress tracking real-time (SSE)
- Retry otomatis untuk pesan gagal

### D. Contact Management
- Import kontak dari CSV
- Sync otomatis dari database Laravel (tabel `customers`)
- Opt-out management (keyword STOP/BERHENTI)
- Tag/segmentasi kontak

### E. Dashboard Monitoring
- Status semua session (aktif/mati/banned)
- Progress campaign berjalan
- Statistik harian (sent/failed/rate)
- Log pesan real-time

---

## 7. Strategi Anti-Ban

### Parameter Default

| Parameter | Nilai | Keterangan |
|-----------|-------|------------|
| `DELAY_MIN` | 20s | Delay minimum antar pesan |
| `DELAY_MAX` | 90s | Delay maksimum antar pesan |
| `BATCH_SIZE` | 30-50 | Pesan per batch sebelum istirahat |
| `REST_MIN` | 10 menit | Istirahat minimum |
| `REST_MAX` | 20 menit | Istirahat maksimum |
| `DAILY_LIMIT` | 200/nomor | Batas harian per session |

### Alur Pengiriman

```
1. Campaign dimulai → pecah recipients ke queue
2. Worker ambil pesan dari queue
3. Anti-Ban Engine:
   a. Pilih session (round-robin, skip yg banned/full)
   b. Cek daily limit → skip jika penuh
   c. Generate variasi konten
   d. Hitung random delay
   e. Cek batch counter → istirahat jika sudah BATCH_SIZE
4. Typing simulation (1-3 detik)
5. Kirim pesan
6. Update status & log
7. Delay random sebelum pesan berikutnya
8. Jika gagal → retry dengan exponential backoff
9. Jika session banned → tandai & rotasi ke session lain
```

### Estimasi Kapasitas

| Jumlah Nomor | Kapasitas/Hari | Waktu untuk 1000 Kontak |
|:---:|:---:|:---:|
| 2 nomor | ~400 pesan | ~2.5 hari |
| 3 nomor | ~600 pesan | ~2 hari |
| 5 nomor | ~1000 pesan | ~1 hari |

---

## 8. Integrasi dengan Laravel SahabatIT

### Cara Integrasi

Laravel SahabatIT akan berkomunikasi ke WA Gateway melalui **HTTP REST API** dengan autentikasi API Key.

**Perubahan di Laravel (minimal):**

1. **Update `WhatsAppService.php`** — Tambahkan provider `self_hosted` yang memanggil WA Gateway lokal
2. **Update `WhatsappBroadcastController.php`** — Redirect broadcast ke WA Gateway API
3. **Tambah config `.env`** — `WA_GATEWAY_URL` dan `WA_GATEWAY_API_KEY`

### Contoh Alur

```
Laravel SahabatIT                    WA Gateway
      │                                  │
      │  POST /api/campaigns             │
      │  { name, template, recipients }  │
      │─────────────────────────────────▶│
      │                                  │ Masukkan ke BullMQ queue
      │  { campaign_id, status }         │
      │◀─────────────────────────────────│
      │                                  │
      │  GET /api/campaigns/:id/progress │
      │─────────────────────────────────▶│
      │  { sent: 450, total: 1000, ... } │
      │◀─────────────────────────────────│
```

### Sync Kontak

WA Gateway bisa pull data kontak dari tabel `customers` di database `laravel_radius` MySQL secara periodik, atau Laravel push kontak saat ada perubahan.

---

## 9. API Endpoints

### Auth: API Key via Header `X-API-Key`

### Sessions
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/sessions` | List semua session |
| POST | `/api/sessions` | Buat session baru |
| GET | `/api/sessions/:id/qr` | Ambil QR code (SSE stream) |
| GET | `/api/sessions/:id/status` | Status session |
| DELETE | `/api/sessions/:id` | Hapus session |
| POST | `/api/sessions/:id/restart` | Restart session |

### Campaigns
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/campaigns` | List campaigns |
| POST | `/api/campaigns` | Buat campaign + recipients |
| GET | `/api/campaigns/:id` | Detail campaign |
| POST | `/api/campaigns/:id/start` | Mulai broadcast |
| POST | `/api/campaigns/:id/pause` | Pause |
| POST | `/api/campaigns/:id/resume` | Resume |
| GET | `/api/campaigns/:id/progress` | Progress (SSE) |

### Contacts
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/contacts` | List kontak |
| POST | `/api/contacts` | Tambah kontak |
| POST | `/api/contacts/import` | Import CSV |
| POST | `/api/contacts/sync-laravel` | Sync dari Laravel DB |
| DELETE | `/api/contacts/:id` | Hapus |

### Dashboard
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/dashboard/stats` | Statistik keseluruhan |
| GET | `/api/dashboard/logs` | Log terbaru |

### Single Message (untuk Laravel)
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | `/api/send` | Kirim 1 pesan langsung |
| POST | `/api/send-bulk` | Kirim ke list nomor |

---

## 10. Antrian Pengerjaan (Task Queue)

### Phase 1 — Project Setup & Database *(Hari 1)*

| # | Task | Detail | Status |
|---|------|--------|--------|
| 1.1 | Init project Node.js + TypeScript | `package.json`, `tsconfig.json`, ESLint | ⬜ |
| 1.2 | Install dependencies | baileys, bullmq, express, mysql2, ioredis, uuid | ⬜ |
| 1.3 | Setup environment config | `.env.example`, config loader, validasi | ⬜ |
| 1.4 | Setup koneksi MySQL | Connection pool dengan `mysql2/promise` | ⬜ |
| 1.5 | Setup koneksi Redis | ioredis connection | ⬜ |
| 1.6 | Buat tabel MySQL | Jalankan semua CREATE TABLE dari schema | ⬜ |
| 1.7 | Setup Express server | Entry point, middleware, CORS, error handler | ⬜ |
| 1.8 | Setup API Key middleware | Auth middleware untuk proteksi endpoint | ⬜ |

---

### Phase 2 — Session Manager *(Hari 2-3)*

| # | Task | Detail | Status |
|---|------|--------|--------|
| 2.1 | `SessionManager` class | Map session, create/delete/restart | ⬜ |
| 2.2 | Baileys auth state persistence | Simpan auth state ke MySQL (`wa_session_auth`) | ⬜ |
| 2.3 | QR Code generation | Generate QR, stream via SSE ke client | ⬜ |
| 2.4 | Connection event handling | Handle `connection.update`, auto-reconnect | ⬜ |
| 2.5 | Session health monitor | Periodic check, update status di DB | ⬜ |
| 2.6 | Multi-session pool | Round-robin selector, skip banned/disconnected | ⬜ |
| 2.7 | Daily limit tracker | Reset counter tiap hari, enforce limit | ⬜ |
| 2.8 | Session API routes | CRUD endpoints + QR stream | ⬜ |

---

### Phase 3 — Anti-Ban Engine & Queue *(Hari 4-5)*

| # | Task | Detail | Status |
|---|------|--------|--------|
| 3.1 | BullMQ queue setup | Queue config, connection, named queues | ⬜ |
| 3.2 | MessageWorker | Worker processor dengan concurrency control | ⬜ |
| 3.3 | Random delay engine | Fungsi delay acak MIN-MAX detik | ⬜ |
| 3.4 | Batch rest logic | Counter per batch, istirahat otomatis | ⬜ |
| 3.5 | Typing simulation | `sendPresenceUpdate('composing')` + delay | ⬜ |
| 3.6 | Content variation engine | Template parser + variasi sinonim/emoji | ⬜ |
| 3.7 | Exponential backoff | Retry strategy saat gagal | ⬜ |
| 3.8 | Dead letter queue | Pisahkan pesan gagal permanen | ⬜ |
| 3.9 | Session rotation di worker | Pilih session sehat secara round-robin | ⬜ |

---

### Phase 4 — Campaign & Broadcast *(Hari 6-7)*

| # | Task | Detail | Status |
|---|------|--------|--------|
| 4.1 | Campaign CRUD API | Create, list, detail, update | ⬜ |
| 4.2 | Campaign start/pause/resume | Control flow broadcast | ⬜ |
| 4.3 | Broadcast orchestrator | Pecah recipients ke queue jobs | ⬜ |
| 4.4 | Progress tracking (SSE) | Real-time sent/failed/total stream | ⬜ |
| 4.5 | Template variable parser | Replace `{nama}`, `{amount}`, dll | ⬜ |
| 4.6 | Single message API | `/api/send` untuk Laravel integrasi | ⬜ |
| 4.7 | Bulk message API | `/api/send-bulk` untuk Laravel integrasi | ⬜ |

---

### Phase 5 — Contact Management *(Hari 8)*

| # | Task | Detail | Status |
|---|------|--------|--------|
| 5.1 | Contact CRUD API | Tambah, list, update, delete kontak | ⬜ |
| 5.2 | CSV import | Parse CSV, validasi nomor, dedup | ⬜ |
| 5.3 | Laravel sync | Pull dari tabel `customers` di MySQL | ⬜ |
| 5.4 | Opt-out handler | Deteksi incoming "STOP"/"BERHENTI" | ⬜ |
| 5.5 | Phone number formatter | Normalisasi format (+62, 08xx, dsb) | ⬜ |

---

### Phase 6 — Dashboard UI *(Hari 9-10)*

| # | Task | Detail | Status |
|---|------|--------|--------|
| 6.1 | Layout & design system | HTML/CSS, dark mode, glassmorphic | ⬜ |
| 6.2 | Session management page | QR scanner, status cards, controls | ⬜ |
| 6.3 | Campaign management page | List, create wizard, progress bar | ⬜ |
| 6.4 | Contact management page | Data table, import modal | ⬜ |
| 6.5 | Dashboard overview | Stats cards, charts, log stream | ⬜ |
| 6.6 | Real-time updates | SSE listener untuk live progress | ⬜ |

---

### Phase 7 — Integrasi Laravel *(Hari 11)*

| # | Task | Detail | Status |
|---|------|--------|--------|
| 7.1 | Update `WhatsAppService.php` | Tambah provider `self_hosted` | ⬜ |
| 7.2 | Update `WhatsappBroadcastController` | Redirect broadcast ke WA Gateway API | ⬜ |
| 7.3 | Tambah env config Laravel | `WA_GATEWAY_URL`, `WA_GATEWAY_API_KEY` | ⬜ |
| 7.4 | Webhook callback | WA Gateway → Laravel untuk update status | ⬜ |
| 7.5 | Test end-to-end | Laravel trigger → Gateway kirim → callback | ⬜ |

---

### Phase 8 — Testing & Deploy *(Hari 12)*

| # | Task | Detail | Status |
|---|------|--------|--------|
| 8.1 | Test session manager | Connect, disconnect, reconnect | ⬜ |
| 8.2 | Test anti-ban engine | Validasi delay, rotation, variation | ⬜ |
| 8.3 | Test broadcast 100 kontak | Simulasi kecil, monitor behavior | ⬜ |
| 8.4 | PM2 setup | ecosystem.config.js, auto-restart | ⬜ |
| 8.5 | Documentation | README.md, panduan penggunaan | ⬜ |

---

## Timeline Ringkasan

```
Hari 1      ████  Phase 1: Setup & Database
Hari 2-3    ████  Phase 2: Session Manager
Hari 4-5    ████  Phase 3: Anti-Ban & Queue
Hari 6-7    ████  Phase 4: Campaign & Broadcast
Hari 8      ██    Phase 5: Contact Management
Hari 9-10   ████  Phase 6: Dashboard UI
Hari 11     ██    Phase 7: Integrasi Laravel
Hari 12     ██    Phase 8: Testing & Deploy
```

**Total: ~12 hari kerja**

---

## Catatan Penting

> ⚠️ **Baileys adalah library tidak resmi.** Akun tetap berisiko di-ban.
> Untuk meminimalisir risiko:
> - Gunakan nomor khusus (bukan pribadi)
> - Siapkan 3-5 nomor cadangan
> - Jangan melebihi 200 pesan/nomor/hari
> - Pastikan semua kontak sudah opt-in
> - Monitor block rate — jika >5%, hentikan campaign

---

*Dokumen ini adalah acuan pengerjaan. Setiap phase akan dikerjakan secara berurutan.*
