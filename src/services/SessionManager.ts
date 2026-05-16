import { Client, LocalAuth, Message, Events } from 'whatsapp-web.js';
import { getAntiBanEngine } from './AntiBanEngine';
import { settingsService } from './SettingsService';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { getDb } from '../config/database';
import { logger } from '../utils/logger';
import QRCode from 'qrcode';

const AUTH_DIR = path.join(process.cwd(), 'wa_auth');

export interface SessionInfo {
  id: string;
  name: string;
  phoneNumber: string | null;
  status: string;
  dailySentCount: number;
  dailyLimit: number;
  lastSentAt: Date | null;
  qr?: string;
}

interface ActiveSession {
  client: Client;
  info: SessionInfo;
}

export class SessionManager extends EventEmitter {
  private static instance: SessionManager;
  private sessions: Map<string, ActiveSession> = new Map();

  private constructor() {
    super();
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }
  }

  public static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  private isSameDay(date1: Date, date2: Date): boolean {
    return (
      date1.getFullYear() === date2.getFullYear() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getDate() === date2.getDate()
    );
  }

  async init(): Promise<void> {
    logger.info('📱 SessionManager initializing with WhatsApp-Web.js...');
    const db = getDb();
    const [rows]: any = await db.query('SELECT * FROM wa_sessions WHERE status != "banned" AND is_enabled = 1');
    
    for (const session of rows) {
      try {
        await this.connectSession(session.id, session.name);
      } catch (err) {
        logger.error(`Failed to resume session ${session.id}: ${err}`);
      }
    }
    logger.info(`📱 SessionManager initialized with ${rows.length} session(s)`);
  }

  async connectSession(sessionId: string, name: string): Promise<SessionInfo> {
    // 1. Jika sesi sudah ada dan aktif, jangan buat lagi
    const existing = this.sessions.get(sessionId);
    if (existing && (existing.info.status === 'active' || existing.info.status === 'qr' || existing.info.status === 'connecting')) {
      logger.info(`[${name}] Sesi sudah dalam proses atau aktif. Mengabaikan permintaan koneksi baru.`);
      return existing.info;
    }
    
    try {
      logger.info(`[DEBUG] Memulai WhatsApp-Web.js untuk: ${sessionId} (${name})`);
      
      // Cleanup existing if any (shouldn't happen with the check above, but for safety)
      if (existing) {
        try { await existing.client.destroy(); } catch (e) {}
        this.sessions.delete(sessionId);
      }

      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: sessionId,
          dataPath: AUTH_DIR
        }),
        puppeteer: {
          headless: true, // Set to true for production
          handleSIGINT: false,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-software-rasterizer',
            '--ignore-certificate-errors',
            '--no-default-browser-check',
            '--single-process'
          ]
        }
      });

      logger.info(`[${name}] Browser launching...`);

      const db = getDb();
      const [rows]: any = await db.query('SELECT daily_sent_count, daily_limit, phone_number, last_sent_at FROM wa_sessions WHERE id = ?', [sessionId]);
      const sessionDb = rows[0] || {};

      let dailySentCount = sessionDb.daily_sent_count || 0;
      const lastSentAt = sessionDb.last_sent_at ? new Date(sessionDb.last_sent_at) : null;
      const today = new Date();

      // Auto-reset daily count if it's a new day
      if (lastSentAt && !this.isSameDay(lastSentAt, today)) {
        logger.info(`[${name}] New day detected. Resetting daily_sent_count from ${dailySentCount} to 0.`);
        dailySentCount = 0;
        await db.query('UPDATE wa_sessions SET daily_sent_count = 0 WHERE id = ?', [sessionId]);
      }

      const info: SessionInfo = {
        id: sessionId,
        name,
        phoneNumber: sessionDb.phone_number || null,
        status: 'connecting',
        dailySentCount: dailySentCount,
        dailyLimit: sessionDb.daily_limit || 200,
        lastSentAt: lastSentAt,
      };

      this.sessions.set(sessionId, { client, info });

      client.on('qr', async (qr) => {
        logger.info(`[DEBUG] QR Received. Length: ${qr?.length}`);
        info.status = 'qr';
        info.qr = qr;
        try {
          const qrDataUrl = await QRCode.toDataURL(qr, { 
            version: 15,
            errorCorrectionLevel: 'L'
          });
          this.emit('qr.updated', { sessionId, qr: qrDataUrl });
        } catch (err) {
          logger.error(`[ERROR] Gagal generate QR: ${err}`);
        }
      });

      client.on('ready', async () => {
        logger.info(`✅ [${name}] WhatsApp is ready!`);
        info.status = 'active';
        info.qr = undefined;
        
        let fullJid = '';
        try {
          const myInfo = client.info;
          fullJid = myInfo?.wid?._serialized || myInfo?.wid?.user || '';
          info.phoneNumber = fullJid;
          logger.info(`✅ [${name}] Phone: ${fullJid}`);
        } catch (e) {
          logger.warn(`[${name}] Could not get phone info: ${e}`);
        }

        try {
          await this.updateSessionDb(sessionId, { status: 'active', phone_number: fullJid || 'unknown' });
        } catch (e) {
          logger.warn(`[${name}] DB update failed: ${e}`);
        }
        
        this.emit('connected', { sessionId, phoneNumber: fullJid });
        logger.info(`✅ [${name}] 'connected' event emitted!`);
      });

      client.on('authenticated', () => {
        logger.info(`[${name}] Authenticated!`);
      });

      client.on('auth_failure', async (msg) => {
        logger.error(`❌ [${name}] Auth failure: ${msg}`);
        info.status = 'disconnected';
        await this.updateSessionDb(sessionId, { status: 'disconnected' });
      });

      client.on('disconnected', async (reason) => {
        logger.warn(`❌ [${name}] Client was logged out: ${reason}`);
        info.status = 'disconnected';
        this.sessions.delete(sessionId);
        await this.updateSessionDb(sessionId, { status: 'disconnected' });
      });

      client.on('message', async (msg: any) => {
        if (msg.from === 'status@broadcast') return;
        if (!settingsService.isLiveChatEnabled()) return;

        let pushName = 'User';
        try {
          const contact = await msg.getContact();
          pushName = contact.name || contact.pushname || contact.number || 'User';
        } catch (e) {}

        const eventData = {
          sessionId,
          phone_number: msg.from,
          messageId: msg.id.id,
          pushName,
          message_text: msg.body || (msg.hasMedia ? '[Media]' : '[Pesan]'),
          is_from_me: msg.fromMe,
          created_at: new Date()
        };

        this.emit('message', eventData);
        logger.info(`[EVENT] Incoming message from ${msg.from}`);
      });

      // Handle self-sent messages (e.g. from phone)
      client.on('message_create', async (msg: any) => {
        if (!msg.fromMe) return; // 'message' event handles incoming
        if (msg.to === 'status@broadcast') return;
        
        const eventData = {
          sessionId,
          phone_number: msg.to,
          messageId: msg.id.id,
          message_text: msg.body || (msg.hasMedia ? '[Media]' : '[Pesan]'),
          is_from_me: true,
          created_at: new Date()
        };
        
        this.emit('message', eventData);
      });

      client.on('message_ack', async (msg: any, ack: number) => {
        let status = 'sent';
        if (ack === 2) status = 'delivered';
        if (ack === 3) status = 'read';
        if (ack === 0) status = 'failed';

        try {
          const db = getDb();
          const messageId = msg.id._serialized || msg.id.id;
          
          await db.query('UPDATE wa_chats SET status = ? WHERE message_id = ?', [status, messageId]);
          await db.query(`
            UPDATE wa_message_logs 
            SET status = ? 
            WHERE metadata->'$.waMessageId' = ? OR metadata->'$.waMessageId' = ?
          `, [status, messageId, msg.id.id]);
          
          this.emit('message.ack', { sessionId, messageId, status });
        } catch (e: any) {
          logger.warn(`[ACK] Error updating status: ${e.message}`);
        }
      });

      client.initialize().catch((err: any) => {
        if (!err.message.includes('EBUSY') && !err.message.includes('locked')) {
          logger.error(`[CRITICAL] Error initializing client ${sessionId}: ${err.message}`);
        }
      });

      return info;
    } catch (err: any) {
      if (!err.message.includes('EBUSY')) {
        logger.error(`[CRITICAL] connectSession failed: ${err.message}`);
      }
      return { id: sessionId, name: 'Retry Required', status: 'disconnected' } as any;
    }
  }

  async createSession(name: string, dailyLimit: number = 200): Promise<SessionInfo> {
    const id = uuidv4();
    const db = getDb();
    await db.query('INSERT INTO wa_sessions (id, name, status, daily_limit) VALUES (?, ?, ?, ?)', [id, name, 'connecting', dailyLimit]);
    return this.connectSession(id, name);
  }

  async disconnectSession(sessionId: string): Promise<void> {
    const active = this.sessions.get(sessionId);
    if (active) {
      try {
        await active.client.destroy();
      } catch (err: any) {}
      this.sessions.delete(sessionId);
      const db = getDb();
      await db.query('UPDATE wa_sessions SET status = "disconnected" WHERE id = ?', [sessionId]);
      this.emit('status.update', { sessionId, status: 'disconnected' });
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const active = this.sessions.get(sessionId);
    if (active) {
      try {
        try { await active.client.logout(); } catch (e) {}
        await active.client.destroy();
      } catch (err: any) {}
      this.sessions.delete(sessionId);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    const db = getDb();
    await db.query('DELETE FROM wa_sessions WHERE id = ?', [sessionId]);
    
    const sessionDir = path.join(AUTH_DIR, `session-${sessionId}`);
    if (fs.existsSync(sessionDir)) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      } catch (err: any) {}
    }
  }

  getSession(id: string): ActiveSession | undefined {
    return this.sessions.get(id);
  }

  getAllSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map(s => s.info);
  }

  async getAllSessionsFromDb(): Promise<any[]> {
    const db = getDb();
    const [rows]: any = await db.query('SELECT * FROM wa_sessions');
    return rows;
  }

  async updateSessionEnabledStatus(sessionId: string, enabled: boolean): Promise<void> {
    const db = getDb();
    await db.query('UPDATE wa_sessions SET is_enabled = ? WHERE id = ?', [enabled ? 1 : 0, sessionId]);
    
    if (!enabled) {
      await this.disconnectSession(sessionId);
    } else {
      const dbSessions = await this.getAllSessionsFromDb();
      const s = dbSessions.find(x => x.id === sessionId);
      if (s) await this.connectSession(sessionId, s.name);
    }
  }

  private async updateSessionDb(id: string, data: any): Promise<void> {
    const db = getDb();
    const fields = Object.keys(data).map(f => `${f} = ?`).join(', ');
    const values = [...Object.values(data), id];
    await db.query(`UPDATE wa_sessions SET ${fields} WHERE id = ?`, values);
  }

  async restartSession(sessionId: string): Promise<SessionInfo> {
    const active = this.sessions.get(sessionId);
    const name = active?.info?.name || 'Unknown';
    
    if (active) {
      try { await active.client.destroy().catch(() => {}); } catch (e) {}
      this.sessions.delete(sessionId);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    return this.connectSession(sessionId, name);
  }

  async sendMessage(sessionId: string, to: string, text: string): Promise<any> {
    const active = this.sessions.get(sessionId);
    if (!active || active.info.status !== 'active') {
      throw new Error('Session not active');
    }
    
    let chatId = to;
    if (!chatId.includes('@')) {
      chatId = `${chatId}@c.us`;
    }

    const result = await (async () => {
      try {
        const chat = await active.client.getChatById(chatId);
        await chat.sendSeen();
        await chat.sendStateTyping();
        const typingDelay = Math.floor(Math.random() * 2000) + 1000;
        await new Promise(resolve => setTimeout(resolve, typingDelay));
        return await active.client.sendMessage(chatId, text);
      } catch (err) {
        return await active.client.sendMessage(chatId, text);
      }
    })();
    
    // Update daily count and handle reset
    const today = new Date();
    if (active.info.lastSentAt && !this.isSameDay(active.info.lastSentAt, today)) {
      active.info.dailySentCount = 1;
    } else {
      active.info.dailySentCount++;
    }
    active.info.lastSentAt = today;
    
    const db = getDb();
    await db.query(`
      UPDATE wa_sessions 
      SET 
        daily_sent_count = IF(DATE(last_sent_at) != CURDATE(), 1, daily_sent_count + 1), 
        last_sent_at = NOW() 
      WHERE id = ?
    `, [sessionId]);
    
    return result;
  }

  getBestSession(): SessionInfo | null {
    const activeSessions = Array.from(this.sessions.values())
      .filter(s => s.info.status === 'active' && s.info.dailySentCount < s.info.dailyLimit)
      .sort((a, b) => a.info.dailySentCount - b.info.dailySentCount);

    return activeSessions.length > 0 ? activeSessions[0].info : null;
  }

  async updateSession(sessionId: string, data: { name?: string; dailyLimit?: number }): Promise<void> {
    const active = this.sessions.get(sessionId);
    if (active) {
      if (data.name) active.info.name = data.name;
      if (data.dailyLimit) active.info.dailyLimit = data.dailyLimit;
    }

    const db = getDb();
    const sets: string[] = [];
    const values: any[] = [];

    if (data.name) {
      sets.push('name = ?');
      values.push(data.name);
    }
    if (data.dailyLimit) {
      sets.push('daily_limit = ?');
      values.push(data.dailyLimit);
    }

    if (sets.length > 0) {
      values.push(sessionId);
      await db.query(`UPDATE wa_sessions SET ${sets.join(', ')} WHERE id = ?`, values);
    }
  }

  async syncSession(sessionId: string): Promise<void> {
    const active = this.sessions.get(sessionId);
    if (!active || active.info.status !== 'active') {
      logger.warn(`[SYNC] Sesi ${sessionId} tidak aktif, mengabaikan sinkronisasi.`);
      return;
    }

    const { client, info } = active;
    const name = info.name;

    try {
      logger.info(`[SYNC] [${name}] Memulai sinkronisasi kontak & grup...`);
      this.emit('sync.progress', { sessionId, status: 'started', message: 'Mengambil data dari WhatsApp...' });

      const contacts = await client.getContacts();
      const validContacts = contacts.filter((c: any) => 
        c.isMyContact && !c.isGroup && c.id._serialized !== 'status@broadcast'
      );

      const chats = await client.getChats();
      const groups = chats.filter((c: any) => c.isGroup);
      
      const allSync = [
        ...validContacts.map((c: any) => ({
          id: c.id._serialized,
          name: c.name || c.pushname || c.id.user,
          phone: c.id.user,
        })),
        ...groups.map((c: any) => ({
          id: c.id._serialized,
          name: c.name || c.id.user,
          phone: c.id.user,
        }))
      ];

      this.emit('contacts.received', { sessionId, contacts: allSync });
      logger.info(`[SYNC] [${name}] Berhasil menarik ${validContacts.length} kontak dan ${groups.length} grup.`);

      if (settingsService.isLiveChatEnabled()) {
        logger.info(`[SYNC] [${name}] Menarik riwayat obrolan (Live Chat)...`);
        let allMessages: any[] = [];
        const recentChats = chats.slice(0, 20); 
        for (const chat of recentChats) {
          try {
            const msgs = await chat.fetchMessages({ limit: 15 });
            allMessages.push(...msgs);
          } catch (e) {}
        }
        this.emit('history.received', { sessionId, messages: allMessages });
      }

      this.emit('sync.progress', { sessionId, status: 'completed', message: 'Sinkronisasi selesai' });
      logger.info(`✅ [SYNC] [${name}] Sinkronisasi selesai.`);

    } catch (err: any) {
      logger.error(`❌ [SYNC] [${name}] Gagal: ${err.message}`);
      this.emit('sync.progress', { sessionId, status: 'failed', message: `Gagal: ${err.message}` });
      throw err;
    }
  }

  async markAsRead(sessionId: string, chatId: string, messageIds?: string[]): Promise<void> {
    const active = this.sessions.get(sessionId);
    if (!active || active.info.status !== 'active') return;
    
    try {
      const chat = await active.client.getChatById(chatId);
      if (chat) {
        await chat.sendSeen();
      }
    } catch (e) {
      logger.warn(`[markAsRead] Failed: ${e}`);
    }
  }
}

export const getSessionManager = () => SessionManager.getInstance();
