# WhatsApp Gateway (Powered by whatsapp-web.js)

Sebuah API dan Dashboard Manajemen WhatsApp Gateway berbasis Puppeteer untuk sinkronisasi kontak, live chat, dan pengiriman pesan (campaign).

## Persyaratan Sistem
- Node.js (v18 atau terbaru)
- MySQL / MariaDB
- RAM Server minimal 1GB (Disarankan 2GB ke atas)
- (Ubuntu/Linux Server) Akses ROOT / Sudo untuk instalasi dependensi Puppeteer.

---

## 🚀 Panduan Instalasi (Development / Lokal)

1. **Persiapkan Database**
   Buat database baru di MySQL dengan nama `whatsapp_gateway` (atau sesuai konfigurasi lama Anda).

2. **Clone / Ekstrak Repository**
   Ekstrak *source code* ini ke dalam folder tujuan Anda.

3. **Install Dependensi**
   Buka terminal di dalam folder proyek, lalu jalankan:
   ```bash
   npm install
   ```

4. **Konfigurasi Lingkungan (.env)**
   Buat atau ubah file `.env` di direktori utama Anda dan sesuaikan dengan koneksi database:
   ```env
   APP_PORT=3100
   DB_HOST=127.0.0.1
   DB_USER=root
   DB_PASSWORD=
   DB_NAME=whatsapp_gateway
   ```

5. **Jalankan Aplikasi**
   ```bash
   npm run dev
   ```
   Aplikasi dan Dashboard Anda sekarang dapat diakses di `http://localhost:3100`.

---

## 🐧 Panduan Deploy ke Ubuntu Server (Production)

WhatsApp Web versi terbaru (whatsapp-web.js) menggunakan mesin browser Chromium secara *headless* (berjalan di balik layar). Secara default, sistem operasi Ubuntu Server polos tidak memiliki perangkat lunak pendukung grafis (GUI) yang memadai. Anda **wajib** menginstal pustaka-pustaka Linux berikut agar Chromium tidak *crash* saat dijalankan oleh Node.js.

### Langkah 1: Install Dependensi Puppeteer (Wajib)
Jalankan perintah ini di terminal Ubuntu Anda:
```bash
sudo apt update
sudo apt install -y gconf-service libgbm-dev libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils wget
```

### Langkah 2: Konfigurasi PM2
Gunakan PM2 agar aplikasi dapat berjalan 24 jam nonstop dan otomatis menyala kembali jika server mengalami *reboot*. Jika belum memiliki PM2:
```bash
sudo npm install -g pm2
```

Buat file bernama `ecosystem.config.js` di dalam folder aplikasi Anda yang berisi konfigurasi berikut:
```javascript
module.exports = {
  apps : [{
    name: 'wa-gateway',
    script: 'npm',
    args: 'run start', // Atau 'run dev' jika belum Anda build (ts-node)
    watch: false,      // PENTING: Jangan aktifkan watch agar PM2 tidak restart terus menerus
    ignore_watch: ['node_modules', 'wa_auth', 'logs', '*.log'],
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    }
  }]
};
```
> **PERINGATAN KRITIKAL:** WhatsApp terus-menerus menulis file cache ke dalam direktori `wa_auth/`. Jika Anda menjalankan PM2 dengan perintah `pm2 start --watch` tanpa atribut pengecualian direktori, PM2 akan mendeteksi penulisan file ini sebagai "perubahan sistem" dan akan me-restart server secara tiada henti. Hal ini menyebabkan WhatsApp gagal *sync*. Selalu gunakan skrip `ecosystem.config.js` di atas.

### Langkah 3: Menjalankan Aplikasi dengan PM2
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

Untuk melihat proses berjalannya mesin WhatsApp atau mencari tahu letak error jika gagal terkoneksi:
```bash
pm2 logs wa-gateway
```

---

## 🛠 Fitur & Panduan Maintenance

- **Tombol Sinkronisasi Cerdas:** 
  Sinkronisasi kontak sekarang beroperasi secara langsung ke browser tanpa perlu melakukan *restart* koneksi. Pastikan untuk menunggu **1 hingga 2 menit** setelah aplikasi berhasil terkoneksi (`ready`) sebelum Anda menekan tombol "Sync WhatsApp" di Web Dashboard. Hal ini sangat penting untuk memberi waktu bagi Chrome mendownload buku telepon dari HP secara *background*.
- **Membersihkan Sisa Format Baileys:** 
  Bila terjadi format data yang dobel atau penumpukan angka "topeng" WhatsApp (`@lid`), sangat disarankan untuk mereset seluruh kontak dan *cache* riwayat Live Chat dengan skrip yang telah tersedia:
  ```bash
  npx ts-node clean_data.ts
  ```
  (Pastikan server dalam keadaan dimatikan sementara saat menjalankan skrip ini, kemudian buka Dashboard dan lakukan Sinkronisasi Ulang).
