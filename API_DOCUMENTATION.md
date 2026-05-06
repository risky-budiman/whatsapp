# WhatsApp Gateway API Documentation

This document provides a comprehensive overview of the available API endpoints for the WhatsApp Gateway.

## Base URL
The default base URL is `http://your-server-ip:3101`. All endpoints start with `/api`.

---

## 1. Sessions Management (`/api/sessions`)

### List All Sessions
`GET /api/sessions`
Returns a list of all WhatsApp sessions stored in the database with their current live status.

### Create New Session
`POST /api/sessions`
**Body:** `{ "name": "Session Name" }`

### Connect/Start Session
`POST /api/sessions/:id/connect`
Triggers the connection process for an existing session ID.

### QR Code Stream (SSE)
`GET /api/sessions/:id/qr`
A Server-Sent Events stream that sends the QR Code as a Data URL ketika tersedia.
- Event types: `qr`, `connected`, `sync_progress`.

### Sync All Contacts
`POST /api/sessions/sync-all-contacts`
Triggers a manual pull of contacts, groups, and message history from all currently active sessions.

---

## 2. Contacts Management (`/api/contacts`)

### List Contacts
`GET /api/contacts?limit=500&offset=0`
Returns individual WhatsApp contacts (excluding groups).

### Add Manual Contact
`POST /api/contacts`
**Body:** `{ "phone": "628xxx", "name": "John Doe", "tags": ["VIP"] }`

### Sync from Laravel
`POST /api/contacts/sync-laravel`
Triggers a synchronization process from the configured Laravel database.

### List Groups
`GET /api/contacts/groups`
Returns a list of all detected WhatsApp groups.

---

## 3. Campaigns / Broadcast (`/api/campaigns`)

### Create Campaign
`POST /api/campaigns`
**Body:**
```json
{
  "name": "Promo Mei",
  "template": "Halo {{nama}}, ada promo baru!",
  "recipients": [
    { "phone": "62812345678", "name": "Budi" },
    { "phone": "62898765432", "name": "Ani" }
  ],
  "variationPool": {
    "halo": ["Halo", "Selamat siang", "Hi"]
  }
}
```

### Start Campaign
`POST /api/campaigns/:id/start`
Starts or resumes the broadcast process for the specified campaign.

### Campaign Progress (SSE)
`GET /api/campaigns/:id/progress`
A Server-Sent Events stream that sends real-time statistics (`total`, `sent`, `failed`, `pending`) every 3 seconds.

---

## 4. Live Chat (`/api/chats`)

### Get Recent Conversations
`GET /api/chats`
Returns a list of the most recent conversations (one per contact).

### Get Chat History
`GET /api/chats/:phone`
Returns the message history for a specific phone number or JID.

### Send Reply
`POST /api/chats/:phone`
**Body:** `{ "message": "Your reply here" }`

### Real-time Event Stream (SSE)
`GET /api/chats/stream/events?api_key=your_key`
A Server-Sent Events stream for real-time incoming messages and sync updates.
- Use this to build a reactive UI.

---

## 5. System Maintenance

### Clear Session Data
`POST /api/sessions/:id/clear-data`
Deletes all chats and contacts associated with a specific session ID.

### Reset All Data (Nuclear)
`POST /api/sessions/reset-all-data`
Wipes all chats, contacts, and mappings from the database while keeping session configurations intact.
