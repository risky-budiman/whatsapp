import { Client, LocalAuth, Message, Events } from 'whatsapp-web.js';
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

  async init(): Promise<void> {
    logger.info('📱 SessionManager initializing with WhatsApp-Web.js...');
    const db = getDb();
    const [rows]: any = await db.query('SELECT * FROM wa_sessions WHERE status != "banned"');
    
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
    try {
      logger.info(`[DEBUG] Memulai WhatsApp-Web.js untuk: ${sessionId} (${name})`);
      
      // Cleanup existing
      const existing = this.sessions.get(sessionId);
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
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-software-rasterizer'
          ]
        }
      });

      const info: SessionInfo = {
        id: sessionId,
        name,
        phoneNumber: null,
        status: 'connecting',
        dailySentCount: 0,
        dailyLimit: 200,
        lastSentAt: null,
      };

      this.sessions.set(sessionId, { client, info });

      client.on('qr', async (qr) => {
        logger.info(`[DEBUG] QR Received. Length: ${qr?.length}`);
        info.status = 'qr';
        info.qr = qr;
        try {
          // Force Version 15 which has huge capacity
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
        
        // Always emit connected, even if DB failed
        this.emit('connected', { sessionId, phoneNumber: fullJid });
        logger.info(`✅ [${name}] 'connected' event emitted!`);

        // Sync contacts, groups, and history
        try {
          logger.info(`[SYNC] Menarik daftar kontak & grup dari WhatsApp...`);
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
          logger.info(`[SYNC] Berhasil menarik ${validContacts.length} kontak dan ${groups.length} grup.`);

          // Sync recent messages for Live Chat
          logger.info(`[SYNC] Menarik riwayat obrolan (Live Chat)...`);
          let allMessages: any[] = [];
          const recentChats = chats.slice(0, 20); // Top 20 recent chats
          for (const chat of recentChats) {
            try {
              const msgs = await chat.fetchMessages({ limit: 15 });
              allMessages.push(...msgs);
            } catch (e) {}
          }
          this.emit('history.received', { sessionId, messages: allMessages });

          // Signal frontend to close modal
          this.emit('sync.progress', { sessionId, status: 'completed', message: 'Sinkronisasi selesai' });
        } catch (e) {
          logger.warn(`[SYNC] Gagal: ${e}`);
        }
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
        
        let pushName = 'User';
        try {
          const contact = await msg.getContact();
          pushName = contact.name || contact.pushname || contact.number || 'User';
        } catch (e) {}

        this.emit('message.received', {
          sessionId,
          from: msg.from,
          messageId: msg.id.id,
          pushName,
          text: msg.body || (msg.hasMedia ? '[Media]' : '[Pesan]'),
        });
      });

      // Start the client
      client.initialize().catch(err => {
        logger.error(`[CRITICAL] Error initializing client ${sessionId}: ${err.message}`);
      });

      return info;
    } catch (err: any) {
      logger.error(`[CRITICAL] connectSession failed: ${err.message}`);
      throw err;
    }
  }

  async createSession(name: string): Promise<SessionInfo> {
    const id = uuidv4();
    const db = getDb();
    await db.query('INSERT INTO wa_sessions (id, name, status, daily_limit) VALUES (?, ?, ?, ?)', [id, name, 'connecting', 200]);
    return this.connectSession(id, name);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const active = this.sessions.get(sessionId);
    if (active) {
      try {
        await active.client.logout();
        await active.client.destroy();
      } catch (err) {}
      this.sessions.delete(sessionId);
    }
    const db = getDb();
    await db.query('DELETE FROM wa_sessions WHERE id = ?', [sessionId]);
    
    const sessionDir = path.join(AUTH_DIR, `session-${sessionId}`);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
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
      logger.info(`🔄 Restarting session ${name}...`);
      try {
        await active.client.destroy();
      } catch (e) {}
      this.sessions.delete(sessionId);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return this.connectSession(sessionId, name);
  }

  async sendMessage(sessionId: string, to: string, text: string): Promise<any> {
    const active = this.sessions.get(sessionId);
    if (!active || active.info.status !== 'active') {
      throw new Error('Session not active');
    }
    
    // Use native @c.us format
    let chatId = to;
    if (!chatId.includes('@')) {
      chatId = `${chatId}@c.us`;
    }

    const result = await active.client.sendMessage(chatId, text);
    
    // Update daily count
    active.info.dailySentCount++;
    active.info.lastSentAt = new Date();
    
    const db = getDb();
    await db.query('UPDATE wa_sessions SET daily_sent_count = daily_sent_count + 1, last_sent_at = NOW() WHERE id = ?', [sessionId]);
    
    return result;
  }

  getBestSession(): SessionInfo | null {
    const activeSessions = Array.from(this.sessions.values())
      .filter(s => s.info.status === 'active' && s.info.dailySentCount < s.info.dailyLimit)
      .sort((a, b) => a.info.dailySentCount - b.info.dailySentCount);

    return activeSessions.length > 0 ? activeSessions[0].info : null;
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
