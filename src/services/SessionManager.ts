import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  WASocket,
  proto,
  WAMessage,
  Browsers
} from '@whiskeysockets/baileys';
import pino from 'pino';
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
  client: WASocket;
  info: SessionInfo;
  contacts: Map<string, { id: string; name: string; notify?: string }>;
  chats: Map<string, any>;
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
    logger.info('📱 SessionManager initializing with Baileys (Super Lightweight WebSocket engine)...');
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
    const existing = this.sessions.get(sessionId);
    if (existing && existing.info.status === 'active') {
      logger.info(`[${name}] Sesi sudah aktif. Mengabaikan permintaan koneksi baru.`);
      return existing.info;
    }

    try {
      logger.info(`[DEBUG] Memulai Baileys socket untuk: ${sessionId} (${name})`);

      if (existing) {
        try {
          existing.client.ev.removeAllListeners('connection.update');
          existing.client.ev.removeAllListeners('messages.upsert');
          existing.client.ev.removeAllListeners('messages.update');
          existing.client.ws.close();
        } catch (e) {}
        this.sessions.delete(sessionId);
      }

      const sessionFolder = path.join(AUTH_DIR, `baileys_${sessionId}`);
      if (!fs.existsSync(sessionFolder)) {
        fs.mkdirSync(sessionFolder, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
      const { version } = await fetchLatestBaileysVersion();

      const db = getDb();
      const [rows]: any = await db.query(
        'SELECT daily_sent_count, daily_limit, phone_number, last_sent_at FROM wa_sessions WHERE id = ?',
        [sessionId]
      );
      const sessionDb = rows[0] || {};

      let dailySentCount = sessionDb.daily_sent_count || 0;
      const lastSentAt = sessionDb.last_sent_at ? new Date(sessionDb.last_sent_at) : null;
      const today = new Date();

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
        dailySentCount,
        dailyLimit: sessionDb.daily_limit || 200,
        lastSentAt,
      };

      const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }) as any,
        printQRInTerminal: false,
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false,
        generateHighQualityLinkPreview: true,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
      });

      const activeSession: ActiveSession = {
        client: sock,
        info,
        contacts: new Map(),
        chats: new Map(),
      };

      this.sessions.set(sessionId, activeSession);

      // Save credentials whenever updated
      sock.ev.on('creds.update', saveCreds);

      // Connection update handler (QR code & status)
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          logger.info(`⚡ [DEBUG] Baileys QR Received for ${name}. Instant QR Code ready.`);
          info.status = 'qr';
          info.qr = qr;
          try {
            const qrDataUrl = await QRCode.toDataURL(qr, {
              version: 15,
              errorCorrectionLevel: 'L',
              margin: 2,
            });
            this.emit('qr.updated', { sessionId, qr: qrDataUrl });
          } catch (err) {
            logger.error(`[ERROR] Gagal generate QR: ${err}`);
          }
        }

        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          logger.warn(`❌ [${name}] Baileys connection closed. Reason: ${statusCode}, Reconnect: ${shouldReconnect}`);

          info.status = 'disconnected';
          this.sessions.delete(sessionId);
          await this.updateSessionDb(sessionId, { status: 'disconnected' });
          this.emit('status.update', { sessionId, status: 'disconnected' });

          if (statusCode === DisconnectReason.loggedOut) {
            logger.warn(`[${name}] Logged out. Cleaning session files...`);
            try {
              fs.rmSync(sessionFolder, { recursive: true, force: true });
            } catch (e) {}
            await this.updateSessionDb(sessionId, { status: 'disconnected', phone_number: null });
          } else if (shouldReconnect) {
            // Check if session is enabled in DB before auto-reconnecting
            const dbCheck = getDb();
            const [rowsCheck]: any = await dbCheck.query('SELECT status, is_enabled FROM wa_sessions WHERE id = ?', [sessionId]);
            const isEnabled = rowsCheck[0]?.is_enabled !== 0;
            if (isEnabled) {
              setTimeout(() => {
                logger.info(`🔄 [${name}] Reconnecting session automatically...`);
                this.connectSession(sessionId, name).catch(() => {});
              }, 3000);
            }
          }
        } else if (connection === 'open') {
          const userJid = sock.user?.id ? sock.user.id.split(':')[0] + '@c.us' : '';
          info.status = 'active';
          info.phoneNumber = userJid;
          info.qr = undefined;

          logger.info(`✅ [${name}] WhatsApp is READY! Connected as: ${userJid}`);

          try {
            await this.updateSessionDb(sessionId, { status: 'active', phone_number: userJid || 'unknown' });
          } catch (e) {
            logger.warn(`[${name}] DB update failed: ${e}`);
          }

          this.emit('connected', { sessionId, phoneNumber: userJid });
        }
      });

      // Track contacts & group names from updates
      sock.ev.on('contacts.upsert', (newContacts) => {
        for (const c of newContacts) {
          activeSession.contacts.set(c.id, {
            id: c.id,
            name: c.name || c.notify || c.verifiedName || '',
            notify: c.notify,
          });
        }
      });

      sock.ev.on('contacts.update', (updates) => {
        for (const c of updates) {
          const existingContact = activeSession.contacts.get(c.id || '') || { id: c.id || '', name: '' };
          if (c.notify) existingContact.notify = c.notify;
          if (c.name) existingContact.name = c.name;
          if (c.id) activeSession.contacts.set(c.id, existingContact);
        }
      });

      sock.ev.on('chats.upsert', (newChats) => {
        for (const ch of newChats) {
          if (ch.id) {
            activeSession.chats.set(ch.id, ch);
          }
        }
      });

      // Handle incoming and outgoing messages
      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (!settingsService.isLiveChatEnabled()) return;

        for (const m of messages) {
          if (!m.message) continue;
          const fromMe = m.key.fromMe || false;
          const remoteJid = m.key.remoteJid;

          if (!remoteJid || remoteJid === 'status@broadcast' || remoteJid.endsWith('@newsletter')) continue;

          const text =
            m.message.conversation ||
            m.message.extendedTextMessage?.text ||
            m.message.imageMessage?.caption ||
            m.message.videoMessage?.caption ||
            (m.message.imageMessage ? '[Gambar]' : m.message.videoMessage ? '[Video]' : '[Pesan]');

          const pushName = m.pushName || 'User';
          const messageId = m.key.id || uuidv4();

          const eventData = {
            sessionId,
            phone_number: remoteJid,
            from: remoteJid,
            messageId,
            pushName,
            message_text: text,
            text,
            is_from_me: fromMe,
            created_at: new Date((Number(m.messageTimestamp) || Date.now() / 1000) * 1000),
          };

          // Emit to both listeners (index.ts listens to 'message.received', older listeners to 'message')
          this.emit('message', eventData);
          this.emit('message.received', eventData);
          logger.info(`[EVENT] WhatsApp message from ${remoteJid} (fromMe=${fromMe})`);
        }
      });

      // Message Ack / Status updates
      sock.ev.on('messages.update', async (updates: any[]) => {
        for (const update of updates) {
          const messageId = update.key?.id;
          const updateStatus = update.update?.status ?? update.status;
          if (!messageId || updateStatus === undefined) continue;

          let status = 'sent';
          if (updateStatus === proto.WebMessageInfo.Status.DELIVERY_ACK) status = 'delivered';
          if (updateStatus === proto.WebMessageInfo.Status.READ) status = 'read';
          if (updateStatus === proto.WebMessageInfo.Status.ERROR) status = 'failed';

          try {
            const db = getDb();
            await db.query('UPDATE wa_chats SET status = ? WHERE message_id = ?', [status, messageId]);
            await db.query(
              `UPDATE wa_message_logs 
               SET status = ? 
               WHERE metadata->'$.waMessageId' = ? OR metadata->'$.waMessageId' = ?`,
              [status, messageId, messageId]
            );

            this.emit('message.ack', { sessionId, messageId, status });
          } catch (e: any) {
            logger.warn(`[ACK] Error updating status: ${e.message}`);
          }
        }
      });

      return info;
    } catch (err: any) {
      logger.error(`[CRITICAL] connectSession failed: ${err.message}`);
      return { id: sessionId, name: 'Retry Required', status: 'disconnected' } as any;
    }
  }

  async createSession(name: string, dailyLimit: number = 200): Promise<SessionInfo> {
    const id = uuidv4();
    const db = getDb();
    await db.query('INSERT INTO wa_sessions (id, name, status, daily_limit) VALUES (?, ?, ?, ?)', [
      id,
      name,
      'connecting',
      dailyLimit,
    ]);
    return this.connectSession(id, name);
  }

  async disconnectSession(sessionId: string): Promise<void> {
    const active = this.sessions.get(sessionId);
    if (active) {
      try {
        try {
          await active.client.logout();
        } catch (e) {}
        active.client.ev.removeAllListeners('connection.update');
        active.client.ev.removeAllListeners('messages.upsert');
        active.client.ev.removeAllListeners('messages.update');
        active.client.ws.close();
      } catch (err: any) {}
      this.sessions.delete(sessionId);
    }

    // Clean up stored session credentials so another phone can link freshly
    const sessionDir = path.join(AUTH_DIR, `baileys_${sessionId}`);
    if (fs.existsSync(sessionDir)) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      } catch (err: any) {}
    }

    const db = getDb();
    await db.query('UPDATE wa_sessions SET status = "disconnected", phone_number = NULL WHERE id = ?', [sessionId]);
    this.emit('status.update', { sessionId, status: 'disconnected' });
    logger.info(`🔌 Sesi ${sessionId} diputuskan dan data kredensial dibersihkan untuk nomor baru.`);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const active = this.sessions.get(sessionId);
    if (active) {
      try {
        try {
          await active.client.logout();
        } catch (e) {}
        active.client.ws.close();
      } catch (err: any) {}
      this.sessions.delete(sessionId);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const db = getDb();
    await db.query('DELETE FROM wa_sessions WHERE id = ?', [sessionId]);

    const sessionDir = path.join(AUTH_DIR, `baileys_${sessionId}`);
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
    const today = new Date();
    return Array.from(this.sessions.values()).map((s) => {
      if (s.info.lastSentAt && !this.isSameDay(s.info.lastSentAt, today)) {
        s.info.dailySentCount = 0;
      }
      return s.info;
    });
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
      const s = dbSessions.find((x) => x.id === sessionId);
      if (s) await this.connectSession(sessionId, s.name);
    }
  }

  private async updateSessionDb(id: string, data: any): Promise<void> {
    const db = getDb();
    const fields = Object.keys(data)
      .map((f) => `${f} = ?`)
      .join(', ');
    const values = [...Object.values(data), id];
    await db.query(`UPDATE wa_sessions SET ${fields} WHERE id = ?`, values);
  }

  async restartSession(sessionId: string): Promise<SessionInfo> {
    const active = this.sessions.get(sessionId);
    const name = active?.info?.name || 'Unknown';

    if (active) {
      try {
        active.client.ws.close();
      } catch (e) {}
      this.sessions.delete(sessionId);
      await new Promise((resolve) => setTimeout(resolve, 1500));
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
      chatId = `${chatId}@s.whatsapp.net`;
    } else if (chatId.endsWith('@c.us')) {
      chatId = chatId.replace('@c.us', '@s.whatsapp.net');
    }

    // Typing simulation (anti-ban behavior)
    try {
      await active.client.presenceSubscribe(chatId);
      await active.client.sendPresenceUpdate('composing', chatId);
      const typingDelay = Math.floor(Math.random() * 1500) + 1000;
      await new Promise((resolve) => setTimeout(resolve, typingDelay));
      await active.client.sendPresenceUpdate('paused', chatId);
    } catch (e) {}

    const result = await active.client.sendMessage(chatId, { text });

    // Update daily count and handle reset
    const today = new Date();
    if (active.info.lastSentAt && !this.isSameDay(active.info.lastSentAt, today)) {
      active.info.dailySentCount = 1;
    } else {
      active.info.dailySentCount++;
    }
    active.info.lastSentAt = today;

    const db = getDb();
    await db.query(
      `UPDATE wa_sessions 
       SET 
         daily_sent_count = IF(DATE(last_sent_at) != CURDATE(), 1, daily_sent_count + 1), 
         last_sent_at = NOW() 
       WHERE id = ?`,
      [sessionId]
    );

    return {
      id: {
        id: result?.key?.id,
        _serialized: result?.key?.id,
      },
      raw: result,
    };
  }

  getBestSession(): SessionInfo | null {
    const today = new Date();
    const activeSessions = Array.from(this.sessions.values())
      .map((s) => {
        if (s.info.lastSentAt && !this.isSameDay(s.info.lastSentAt, today)) {
          s.info.dailySentCount = 0;
        }
        return s.info;
      })
      .filter((info) => info.status === 'active' && info.dailySentCount < info.dailyLimit)
      .sort((a, b) => a.dailySentCount - b.dailySentCount);

    return activeSessions.length > 0 ? activeSessions[0] : null;
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

    const { client, info, contacts } = active;
    const name = info.name;

    try {
      logger.info(`[SYNC] [${name}] Memulai sinkronisasi kontak & grup (Baileys)...`);
      this.emit('sync.progress', { sessionId, status: 'started', message: 'Mengambil data dari WhatsApp...' });

      // Fetch groups from Baileys
      let groupsList: any[] = [];
      try {
        const participatingGroups = await client.groupFetchAllParticipating();
        groupsList = Object.values(participatingGroups).map((g: any) => ({
          id: g.id,
          name: g.subject || g.id,
          phone: g.id.split('@')[0],
        }));
      } catch (e: any) {
        logger.warn(`[SYNC] Failed to fetch groups: ${e.message}`);
      }

      // Convert cached contacts
      const contactList = Array.from(contacts.values()).map((c) => ({
        id: c.id,
        name: c.name || c.notify || c.id.split('@')[0],
        phone: c.id.split('@')[0],
      }));

      const allSync = [...contactList, ...groupsList];

      this.emit('contacts.received', { sessionId, contacts: allSync });
      logger.info(`[SYNC] [${name}] Berhasil menarik ${contactList.length} kontak dan ${groupsList.length} grup.`);

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
      let resolvedChatId = chatId;
      if (!resolvedChatId.includes('@')) {
        resolvedChatId = `${resolvedChatId}@s.whatsapp.net`;
      } else if (resolvedChatId.endsWith('@c.us')) {
        resolvedChatId = resolvedChatId.replace('@c.us', '@s.whatsapp.net');
      }

      if (messageIds && messageIds.length > 0) {
        await active.client.readMessages(
          messageIds.map((id) => ({
            remoteJid: resolvedChatId,
            id,
          }))
        );
      } else {
        await active.client.sendPresenceUpdate('available');
      }
    } catch (e) {
      logger.warn(`[markAsRead] Failed: ${e}`);
    }
  }
}

export const getSessionManager = () => SessionManager.getInstance();
