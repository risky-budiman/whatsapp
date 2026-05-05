# 💬 WhatsApp Gateway — Anti-Ban System

A robust, self-hosted WhatsApp Gateway designed for ISP Billing Systems (Laravel) to send bulk broadcast messages and invoices without getting banned.

## 🌟 Key Features

- **Multi-Session Architecture:** Connect multiple WhatsApp accounts simultaneously.
- **Round-Robin Rotation:** Automatically distributes outgoing messages evenly across all connected accounts.
- **Anti-Ban Jitter Engine:** Applies a dynamic, randomized delay (20s - 90s) between messages.
- **Batch Resting:** Simulates human behavior by "resting" for 10-20 minutes after sending a batch of messages.
- **Typing Simulation:** Displays the "typing..." status before sending a message.
- **Daily Limits:** Enforces a maximum limit (e.g., 200 messages/day per number) to avoid spam flags.
- **Laravel Auto-Sync:** Automatically pulls active customer contacts from the `laravel_radius` database.
- **Opt-Out Handler:** Detects keywords like "STOP", "BERHENTI", "UNSUBSCRIBE" and blacklists the number from future broadcasts.
- **Sleek Admin Dashboard:** Built-in SPA (Single Page Application) for managing sessions, scanning QR codes, and tracking campaigns.

## 🛠 Tech Stack

- **Backend:** Node.js, Express.js, TypeScript
- **WhatsApp Library:** `@whiskeysockets/baileys`
- **Database:** MySQL (Primary storage)
- **Queue Engine:** BullMQ & Redis (Memurai for Windows)
- **Frontend:** Vanilla HTML/CSS/JS (Zero framework, ultra-fast)

---

## 🚀 Installation & Setup

### Prerequisites
1. **Node.js** (v18 or higher)
2. **MySQL Server** (XAMPP / native)
3. **Redis** (Install **[Memurai](https://www.memurai.com/get-memurai)** for Windows)

### 1. Clone & Install
```bash
git clone <your-repo>
cd Whatsapps-Gateway
npm install
```

### 2. Environment Configuration
Copy the `.env.example` file to `.env`:
```bash
cp .env.example .env
```
Ensure your `DB_DATABASE` (default: `whatsapp_gateway`) exists. If you want Laravel Sync to work, ensure `LARAVEL_DB_DATABASE` matches your Laravel database name (default: `laravel_radius`).

### 3. Database Migration
Run the automated table creation script:
```bash
npm run migrate
```

### 4. Run Development Server
```bash
npm run dev
```
The Dashboard will be accessible at: **http://localhost:3100**

---

## 🔗 Laravel Integration

To connect your existing Laravel application to this Gateway, simply update your Laravel `.env`:

```env
WA_GATEWAY_URL=http://localhost:3100/api
WA_GATEWAY_KEY=dev-wa-gateway-key-2026
```

In your Laravel database, add or update a Gateway record with the provider set to `self_hosted`. Your `WhatsAppService.php` will automatically detect this and forward all outgoing messages to the new Anti-Ban Queue.

---

## 📦 Production Deployment (PM2)

For 24/7 background operation, use PM2:

```bash
# Compile TypeScript to JavaScript
npm run build

# Start with PM2 using ecosystem file
pm2 start ecosystem.config.js

# Setup PM2 to start on boot
pm2 save
pm2 startup
```

## 🔐 API Endpoints (For Third-Party Integrations)

*All requests must include the Header: `X-API-Key: <your-api-key>`*

- `POST /api/send` - Queue a single message
- `POST /api/send-bulk` - Queue multiple messages
- `GET /api/sessions` - List active sessions
- `POST /api/sessions` - Create a new session
- `POST /api/campaigns` - Create a broadcast campaign

---
*Built with ❤️ for SahabatIT*
