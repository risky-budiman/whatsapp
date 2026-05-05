import express from 'express';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { env, validateEnv } from './config/env';
import { getDb, testDbConnection } from './config/database';
import { testRedisConnection } from './config/redis';
import { getSessionManager } from './services/SessionManager';
import { getContactSync } from './services/ContactSync';
import { logger } from './utils/logger';
import { initQueue } from './services/QueueService';
import { initWorker } from './workers/MessageWorker';

// Routes
import sessionRoutes from './api/routes/session.routes';
import contactRoutes from './api/routes/contact.routes';
import campaignRoutes from './api/routes/campaign.routes';
import chatRoutes, { emitChatEvent } from './api/routes/chat.routes';

const app = express();

// Global Error Handlers to swallow Baileys noise
process.on('unhandledRejection', (reason: any) => {
  if (reason?.message?.includes('Connection Closed')) return;
  logger.error(`Unhandled Rejection: ${reason}`);
});

process.on('uncaughtException', (err: any) => {
  if (err?.message?.includes('Connection Closed')) return;
  logger.error(`Uncaught Exception: ${err}`);
});

// Use APP_PORT to match env.ts
const PORT = env.APP_PORT || 3101;

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  logger.info(`🔍 [${req.method}] ${req.url}`);
  next();
});
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api/sessions', sessionRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/chats', chatRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Start Server
async function start() {
  validateEnv();
  
  const dbOk = await testDbConnection();
  const redisOk = await testRedisConnection();

  if (dbOk) {
    const db = getDb();
    // Run cleanup in background to prevent startup delay
    setTimeout(async () => {
      try {
        const db = getDb();
        logger.info('🧬 Running self-healing database check...');
        const [cols]: any = await db.query("SHOW COLUMNS FROM wa_contacts LIKE 'session_id'");
        if (cols.length === 0) {
          logger.info('➕ Adding missing session_id to wa_contacts...');
          await db.query("ALTER TABLE wa_contacts ADD COLUMN session_id VARCHAR(36) AFTER id");
        }
        
        const [idx]: any = await db.query("SHOW INDEX FROM wa_contacts WHERE Key_name = 'idx_session_phone'");
        if (idx.length === 0) {
          logger.info('➕ Upgrading wa_contacts unique constraints...');
          await db.query("ALTER TABLE wa_contacts DROP INDEX IF EXISTS phone_number");
          await db.query("ALTER TABLE wa_contacts ADD UNIQUE INDEX idx_session_phone (session_id, phone_number)");
        }
        logger.info('✅ Database schema verified.');

        logger.info('🧹 Background cleanup: Ensuring no duplicate messages...');
        
        // 1. Add temporary index to make deletion fast
        await db.query("CREATE INDEX IF NOT EXISTS idx_msg_temp ON wa_chats (message_id)").catch(() => {});
        
        // 2. Fast join-based deletion
        await db.query(`
          DELETE c1 FROM wa_chats c1
          INNER JOIN wa_chats c2 
          WHERE c1.id < c2.id AND c1.message_id = c2.message_id
        `);

        // 3. Enforce unique constraint
        try {
          await db.query("ALTER TABLE wa_chats ADD UNIQUE INDEX idx_message_id (message_id)");
          logger.info('✅ Message uniqueness enforced successfully.');
        } catch (e: any) {}
        
        // 4. Drop temp index
        await db.query("DROP INDEX idx_msg_temp ON wa_chats").catch(() => {});

        // 5. Cleanup duplicate contacts (prefer named ones over @lid/numbers)
        logger.info('🧹 Background cleanup: Merging duplicate contacts...');
        await db.query(`
          DELETE c1 FROM wa_contacts c1
          INNER JOIN wa_contacts c2 ON 
            (c1.phone_number = c2.phone_number OR SUBSTRING_INDEX(c1.phone_number, '@', 1) = SUBSTRING_INDEX(c2.phone_number, '@', 1))
          WHERE c1.id != c2.id 
            AND (c1.name IS NULL OR c1.name = '' OR c1.phone_number LIKE '%@lid%')
            AND (c2.name IS NOT NULL AND c2.name != '' AND c2.phone_number NOT LIKE '%@lid%')
        `).catch(() => {});

        // 6. Enforce unique index on contacts
        await db.query("ALTER TABLE wa_contacts ADD UNIQUE INDEX IF NOT EXISTS idx_phone_unique (phone_number)").catch(() => {});
        logger.info('✅ Contact list integrity ensured.');
      } catch (err: any) {
        logger.warn(`⚠️ Background cleanup note: ${err.message}`);
      }
    }, 5000); // Wait 5s after startup to begin cleanup
  }

  if (!dbOk) {
    logger.warn('⚠️  MySQL not available — run "npm run migrate" first');
  }
  if (!redisOk) {
    logger.warn('⚠️  Redis not available — queue features will not work');
  }

  // Initialize SessionManager & Events
  if (dbOk) {
    try {
      const sm = getSessionManager();

      // 1. Listen for contacts from WhatsApp
      sm.on('contacts.received', async (data: { sessionId: string; contacts: any[] }) => {
        try {
          const db = getDb();
          const contacts = data.contacts || [];
          if (contacts.length === 0) return;

          logger.info(`[SYNC] Memproses ${contacts.length} kontak...`);
          
          for (let i = 0; i < contacts.length; i += 100) {
            const batch = contacts.slice(i, i + 100);
            await Promise.all(batch.map(async (contact: any) => {
              const phoneNumber = contact.phone || contact.id?.split('@')[0] || '';
              const contactName = contact.name || phoneNumber;
              const fullId = contact.id || `${phoneNumber}@c.us`;

              if (!phoneNumber) return;

              await db.query(`
                INSERT INTO wa_contacts (id, session_id, phone_number, name, source)
                VALUES (?, ?, ?, ?, 'device_sync')
                ON DUPLICATE KEY UPDATE 
                  session_id = VALUES(session_id),
                  name = IF(name IS NULL OR name = '' OR name = phone_number, VALUES(name), name),
                  phone_number = VALUES(phone_number),
                  updated_at = CURRENT_TIMESTAMP
              `, [uuidv4(), data.sessionId, fullId, contactName]);
            }));
          }
          logger.info(`[SYNC] Berhasil memproses ${contacts.length} kontak.`);
        } catch (err) {
          logger.error(`Error syncing contacts: ${err}`);
        }
      });

      // 2. Listen for historical messages (sync like WhatsApp Web)
      sm.on('history.received', async (data: { sessionId: string; messages: any[] }) => {
        try {
          const db = getDb();
          const messages = data.messages || [];
          if (messages.length === 0) return;
          
          logger.info(`📥 [DEBUG] Menerima ${messages.length} data riwayat pesan dari WhatsApp...`);
          
          let savedCount = 0;
          for (const msg of messages) {
            if (!msg.message) continue;
            
            const jid = msg.key.remoteJid;
            if (!jid || jid === 'status@broadcast' || jid.endsWith('@newsletter')) continue;

            const text = msg.message.conversation || 
                         msg.message.extendedTextMessage?.text || 
                         msg.message.imageMessage?.caption ||
                         msg.message.videoMessage?.caption ||
                         msg.message.documentMessage?.caption ||
                         '';

            // Preserve group JID, only split LID/legacy if necessary
            let cleanJid = jid.endsWith('@g.us') ? jid : jid.split(':')[0].split('@')[0] + '@' + jid.split('@')[1];
            
            // Resolve LID if necessary
            if (cleanJid.endsWith('@lid')) {
              const [rows]: any = await db.query('SELECT phone_number FROM wa_jid_mappings WHERE jid = ?', [cleanJid]);
              if (rows && rows.length > 0) {
                cleanJid = `${rows[0].phone_number}@s.whatsapp.net`;
              }
            }

            // Log a sample message to verify sync
            if (savedCount === 0) logger.info(`📥 [DEBUG] Contoh pesan riwayat: ${text.substring(0, 30)}...`);

            await db.query(`
              INSERT IGNORE INTO wa_chats (id, session_id, phone_number, message_id, message_text, is_from_me, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              uuidv4(), 
              data.sessionId, 
              cleanJid, 
              msg.key.id, 
              text || '[Media]', 
              msg.key.fromMe ? 1 : 0,
              msg.key.fromMe ? 'sent' : 'received',
              new Date((msg.messageTimestamp || Date.now()/1000) * 1000)
            ]);
            savedCount++;
          }
          if (savedCount > 0) logger.info(`✅ [DEBUG] Sukses menyimpan ${savedCount} riwayat pesan ke Live Chat.`);
        } catch (err) {
          logger.error(`Error syncing history: ${err}`);
        }
      });

      // 3. Listen for incoming messages
      sm.on('message.received', async (data: any) => {
        try {
          if (data.from === 'status@broadcast' || data.from.endsWith('@newsletter')) return;

          const db = getDb();
          const chatId = uuidv4();
          
          let resolvedJid = data.from;

          // Save message to DB
          await db.query(`
            INSERT INTO wa_chats (id, session_id, phone_number, message_id, message_text, is_from_me, status)
            VALUES (?, ?, ?, ?, ?, ?, 'received')
          `, [chatId, data.sessionId, resolvedJid, data.messageId, data.text || '[Pesan]', 0]);

          // Emit to UI
          emitChatEvent({
            type: 'message',
            id: chatId,
            session_id: data.sessionId,
            phone_number: resolvedJid,
            message_text: data.text,
            is_from_me: false,
            status: 'received',
            created_at: new Date(),
            contact_name: data.pushName
          });
        } catch (err) {
          logger.error(`Error handling incoming message: ${err}`);
        }
      });

      // 4. Listen for QR updates
      sm.on('qr.updated', (data: { sessionId: string; qr: string }) => {
        emitChatEvent({
          type: 'qr',
          session_id: data.sessionId,
          qr: data.qr
        });
      });

      // 5. Listen for connection success
      sm.on('connected', (data: { sessionId: string; phoneNumber: string }) => {
        emitChatEvent({
          type: 'status',
          session_id: data.sessionId,
          status: 'active',
          phoneNumber: data.phoneNumber
        });
      });

      // NOW initialize sessions
      await sm.init();
    } catch (err: any) {
      logger.warn(`⚠️  SessionManager init warning: ${err.message}`);
    }
  }

  // Initialize BullMQ & Workers
  if (redisOk) {
    try {
      initQueue();
      initWorker();
      logger.info('📦 Message Queue [wa-messages] initialized');
      logger.info('👷 Message Worker initialized');
    } catch (err: any) {
      logger.error(`Queue init failed: ${err.message}`);
    }
  }

  app.listen(PORT, () => {
    logger.info(`🚀 Server running on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  logger.error(`Critical startup error: ${err.message}`);
  process.exit(1);
});
