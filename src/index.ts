import express from 'express';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';
import { env, validateEnv } from './config/env';
import { getDb, testDbConnection } from './config/database';
import { testRedisConnection } from './config/redis';
import { getSessionManager } from './services/SessionManager';
import { getContactSync } from './services/ContactSync';
import { logger } from './utils/logger';
import { settingsService } from './services/SettingsService';
import { initQueue } from './services/QueueService';
import { initWorker } from './workers/MessageWorker';

// Routes
import sessionRoutes from './api/routes/session.routes';
import contactRoutes from './api/routes/contact.routes';
import campaignRoutes from './api/routes/campaign.routes';
import chatRoutes, { emitChatEvent } from './api/routes/chat.routes';
import settingsRoutes from './api/routes/settings.routes';
import dashboardRoutes from './api/routes/dashboard.routes';
import authRoutes from './api/routes/auth.routes';
import userRoutes from './api/routes/user.routes';
import cookieParser from 'cookie-parser';
import { sessionAuth } from './api/middleware/sessionAuth';
import { apiKeyAuth } from './api/middleware/apiKey';
import { hashPassword } from './utils/crypto';

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
const PORT = env.APP_PORT || 3100;

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
  logger.info(`🔍 [${req.method}] ${req.url}`);
  next();
});

// Swagger Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Public Auth Routes
app.use('/api/auth', authRoutes);

// Hybrid Authentication (Session OR API Key)
app.use('/api', async (req, res, next) => {
  // 1. Skip for Public Auth Routes (already handled)
  if (req.path.startsWith('/auth/')) return next();

  // 2. Try Web Session First (Best for UI)
  const sid = req.cookies?.wa_sid;
  if (sid) {
    try {
      const db = getDb();
      const [sessions]: any = await db.query(`
        SELECT user_id FROM wa_web_sessions 
        WHERE sid = ? AND expires_at > NOW()
      `, [sid]);

      if (sessions.length > 0) {
        (req as any).userId = sessions[0].user_id;
        return next();
      }
    } catch (err) {}
  }

  // 3. Fallback to API Key (Integrations)
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (apiKey) {
    if (apiKey === settingsService.getApiKey()) {
      (req as any).userId = 'api-key-system';
      (req as any).isApiKeyAuth = true;
      return next();
    } else {
      return res.status(403).json({ success: false, message: 'Invalid API Key' });
    }
  }

  // 4. Fail if neither
  res.status(401).json({ success: false, message: 'Authentication required' });
});

app.use('/api/sessions', sessionRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/users', userRoutes);

// Global Error Handler for JSON Syntax Errors
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof SyntaxError && 'status' in err && (err as any).status === 400 && 'body' in err) {
    return res.status(400).json({ success: false, message: 'Invalid JSON format. Check your quotes and brackets.' });
  }
  next();
});

// Catch-all 404 handler for API
app.use('/api', (req, res) => {
  logger.warn(`🚫 [404] Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found on this server.` });
});

// Login Gate for Static Files
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

// Middleware to check session for the main dashboard
app.get('/', (req, res, next) => {
  const sid = req.cookies?.wa_sid;
  
  // Debug log
  logger.info(`🔍 [GET] / | SID: ${sid ? 'Found' : 'NOT FOUND'}`);

  if (!sid) {
    return res.redirect('/login');
  }
  next();
});

// Diagnostic route
app.get('/debug-session', (req, res) => {
  res.json({
    env: process.env.NODE_ENV,
    cookies: req.cookies,
    wa_sid_cookie: req.cookies?.wa_sid || 'MISSING'
  });
});

app.use(express.static(path.join(__dirname, '../public')));

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check
 *     responses:
 *       200:
 *         description: Server is up
 */
// Health check
app.get('/health', async (req, res) => {
  const memory = process.memoryUsage();
  const dbOk = await testDbConnection().catch(() => false);
  const redisOk = await testRedisConnection().catch(() => false);
  const sm = getSessionManager();
  const sessions = sm.getAllSessions();

  res.json({
    status: (dbOk && redisOk) ? 'ok' : 'warning',
    uptime: process.uptime(),
    memory: {
      heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
      rss: Math.round(memory.rss / 1024 / 1024)
    },
    services: {
      database: dbOk ? 'online' : 'offline',
      redis: redisOk ? 'online' : 'offline'
    },
    sessions: {
      total: sessions.length,
      active: sessions.filter(s => s.status === 'active').length,
      disconnected: sessions.filter(s => s.status !== 'active').length
    },
    platform: process.platform,
    load: os.loadavg(),
    version: '1.9.5'
  });
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

        // Ensure wa_users and sessions table exists
        await db.query(`CREATE TABLE IF NOT EXISTS wa_users (
          id VARCHAR(36) PRIMARY KEY,
          username VARCHAR(100) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          role ENUM('admin','staff') DEFAULT 'admin',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await db.query(`CREATE TABLE IF NOT EXISTS wa_web_sessions (
          sid VARCHAR(255) PRIMARY KEY,
          user_id VARCHAR(36) NOT NULL,
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        // Create default admin if not exists
        const [users]: any = await db.query('SELECT id FROM wa_users LIMIT 1');
        if (users.length === 0) {
          logger.info('👤 Creating default admin user (admin / admin123)...');
          const adminPassword = hashPassword('admin123');
          await db.query('INSERT INTO wa_users (id, username, password, role) VALUES (?, ?, ?, ?)', [
            uuidv4(), 'admin', adminPassword, 'admin'
          ]);
        }

        // Init settings
        await settingsService.init();
        logger.info('✅ Database schema and users verified.');

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
              // Use native format directly
              const fullId = contact.id || `${phoneNumber}@c.us`;

              if (!phoneNumber) return;

              await db.query(`
                INSERT INTO wa_contacts (id, session_id, phone_number, name, source)
                VALUES (?, ?, ?, ?, 'device_sync')
                ON DUPLICATE KEY UPDATE 
                  session_id = VALUES(session_id),
                  name = IF(VALUES(name) != VALUES(phone_number), VALUES(name), name),
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
        if (!settingsService.isLiveChatEnabled()) return;
        try {
          const db = getDb();
          const messages = data.messages || [];
          if (messages.length === 0) return;
          
          logger.info(`📥 [DEBUG] Menerima ${messages.length} data riwayat pesan dari WhatsApp...`);
          
          let savedCount = 0;
          for (const msg of messages) {
            if (!msg.id) continue;
            
            // In whatsapp-web.js, msg.from is the chat ID (could be fromMe=true, so it's our own number sometimes, but the 'chat' is the 'to')
            const jid = msg.fromMe ? msg.to : msg.from;
            if (!jid || jid === 'status@broadcast' || jid.endsWith('@newsletter')) continue;

            const text = msg.body || (msg.hasMedia ? '[Media]' : '[Pesan]');

            // Keep original JID from whatsapp-web.js
            let cleanJid = jid;

            await db.query(`
              INSERT IGNORE INTO wa_chats (id, session_id, phone_number, message_id, message_text, is_from_me, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              uuidv4(), 
              data.sessionId, 
              cleanJid, 
              msg.id._serialized || msg.id.id, 
              text, 
              msg.fromMe ? 1 : 0,
              msg.fromMe ? 'sent' : 'received',
              new Date((msg.timestamp || Date.now()/1000) * 1000)
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
        if (!settingsService.isLiveChatEnabled()) return;
        try {
          if (data.from === 'status@broadcast' || data.from.endsWith('@newsletter')) return;

          const db = getDb();
          const chatId = uuidv4();
          
          let resolvedJid = data.from;

          // Auto-save/update contact name from pushName
          const cleanPhone = resolvedJid.split('@')[0];
          await db.query(`
            INSERT INTO wa_contacts (id, session_id, phone_number, name, source)
            VALUES (?, ?, ?, ?, 'live_chat')
            ON DUPLICATE KEY UPDATE 
              name = IF(name IS NULL OR name = '' OR name = phone_number, VALUES(name), name),
              updated_at = CURRENT_TIMESTAMP
          `, [uuidv4(), data.sessionId, resolvedJid, data.pushName || cleanPhone]);

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

      // Cleanup ghost active sessions before init
      const db = getDb();
      await db.query("UPDATE wa_sessions SET status = 'disconnected' WHERE status = 'active'");
      
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
