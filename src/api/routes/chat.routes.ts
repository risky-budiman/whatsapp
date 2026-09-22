import { Router, Request, Response } from 'express';
import { getDb } from '../../config/database';
import { getSessionManager } from '../../services/SessionManager';
import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { toWhatsAppJid } from '../../utils/phone';
import { queueMessage } from '../../services/QueueService';
import { getAntiBanEngine } from '../../services/AntiBanEngine';

const router = Router();
const chatClients: Set<Response> = new Set();

// Emit chat event to all connected SSE clients
export function emitChatEvent(data: any) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of chatClients) {
    try {
      client.write(payload);
    } catch (err) {
      chatClients.delete(client);
    }
  }
}

/**
 * @swagger
 * tags:
 *   name: Chats
 *   description: Real-time chat and history
 */

/**
 * @swagger
 * /api/chats/logs:
 *   get:
 *     summary: Get all message logs
 *     tags: [Chats]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of records to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *         description: Pagination offset
 *     responses:
 *       200:
 *         description: List of message logs with contact names
 */
// GET /api/chats/logs — List all message logs
router.get('/logs', async (req: Request, res: Response) => {
  try {
    const db = getDb();

    const limit = parseInt((req.query.limit as string) || '50', 10);
    const offset = parseInt((req.query.offset as string) || '0', 10);
    const q = ((req.query.q as string) || '').trim();
    const status = ((req.query.status as string) || 'all').trim();

    const conditions: string[] = [];
    const params: any[] = [];

    if (status && status !== 'all') {
      conditions.push('l.status = ?');
      params.push(status);
    }

    if (q) {
      conditions.push('(l.target_phone LIKE ? OR l.message_content LIKE ? OR s.name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows]: any = await db.query(
      `SELECT 
         l.id, 
         l.target_phone, 
         l.message_content, 
         l.status, 
         l.error,
         l.metadata,
         l.created_at, 
         l.session_id, 
         s.name as session_name,
         (SELECT wc.name FROM wa_contacts wc WHERE wc.phone_number = l.target_phone OR wc.phone_number = CONCAT(l.target_phone, '@c.us') OR wc.phone_number = CONCAT(l.target_phone, '@g.us') LIMIT 1) as contact_name
       FROM wa_message_logs l
       LEFT JOIN wa_sessions s ON l.session_id = s.id
       ${whereClause}
       ORDER BY l.created_at DESC 
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const countSql = `SELECT COUNT(*) as count FROM wa_message_logs l LEFT JOIN wa_sessions s ON l.session_id = s.id ${whereClause}`;
    const [totalRows]: any = await db.query(countSql, params);
    const total = Number(totalRows[0]?.count || 0);

    res.json({
      success: true,
      data: rows || [],
      meta: {
        total,
        limit,
        offset
      }
    });
  } catch (err: any) {
    logger.error(`GET /chats/logs error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /api/chats:
 *   get:
 *     summary: Get recent conversations
 *     tags: [Chats]
 *     responses:
 *       200:
 *         description: List of latest conversations
 */
// GET /api/chats — Get recent conversations
router.get('/', async (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const [rows] = await db.query(`
      WITH RankedChats AS (
        SELECT 
          c.phone_number as raw_jid,
          REPLACE(REPLACE(c.phone_number, '@c.us', ''), '@lid', '') as clean_phone,
          c.message_text, 
          c.created_at, 
          c.is_from_me, 
          c.status,
          ROW_NUMBER() OVER (PARTITION BY REPLACE(REPLACE(c.phone_number, '@c.us', ''), '@lid', '') ORDER BY c.created_at DESC) as rn
        FROM wa_chats c
      )
      SELECT 
        COALESCE(wjm.phone_number, r.clean_phone) as display_phone,
        r.raw_jid,
        r.message_text, 
        r.created_at, 
        r.is_from_me, 
        r.status, 
        wc.name as contact_name
      FROM RankedChats r
      LEFT JOIN wa_contacts wc ON wc.phone_number = r.raw_jid OR wc.phone_number = r.clean_phone OR wc.phone_number = CONCAT(r.clean_phone, '@c.us')
      LEFT JOIN wa_jid_mappings wjm ON wjm.jid = r.raw_jid OR wjm.jid = r.clean_phone OR wjm.jid = CONCAT(r.clean_phone, '@lid') OR wjm.jid = CONCAT(r.clean_phone, '@c.us')
      WHERE r.rn = 1
      ORDER BY r.created_at DESC
      LIMIT 100
    `);
    res.json({ success: true, data: rows });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /api/chats/send-message:
 *   get:
 *     summary: Send message via GET (for external alerts)
 *     tags: [Chats]
 *     parameters:
 *       - in: query
 *         name: phone
 *         required: true
 *         schema:
 *           type: string
 *         description: Target phone number
 *       - in: query
 *         name: message
 *         required: true
 *         schema:
 *           type: string
 *         description: Message content
 *       - in: query
 *         name: api_key
 *         required: true
 *         schema:
 *           type: string
 *         description: Your API Key
 *       - in: query
 *         name: sessionId
 *         schema:
 *           type: string
 *         description: Specific session ID (optional)
 *     responses:
 *       200:
 *         description: Message sent successfully
 *   post:
 *     summary: Send message via POST (Supports multiple numbers)
 *     tags: [Chats]
 *     parameters:
 *       - in: query
 *         name: api_key
 *         schema:
 *           type: string
 *         description: Your API Key (Optional if logged in or using x-api-key header)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               phone:
 *                 type: string
 *                 description: Target phone number (e.g. "628123...") or multiple numbers separated by comma
 *               phones:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of target phone numbers
 *               message:
 *                 type: string
 *               sessionId:
 *                 type: string
 *                 description: Session ID (Optional, defaults to best active session/Rotation)
 *     responses:
 *       200:
 *         description: Message(s) processed
 */
// GET /api/chats/send-message — Simplified endpoint for external alerts/monitoring
router.get('/send-message', async (req: Request, res: Response) => {
  try {
    const { phone, message, sessionId } = req.query;

    if (!phone || !message) {
      return res.status(400).json({ success: false, message: 'Missing phone or message query parameters' });
    }

    const db = getDb();
    let finalSessionId = sessionId as string;
    const sm = getSessionManager();

    // If no sessionId, pick the best active session (least load)
    if (!finalSessionId || finalSessionId === 'auto' || finalSessionId === 'string') {
      finalSessionId = sm.getBestSession()?.id as string;
      if (!finalSessionId) {
        return res.status(400).json({ success: false, message: 'No active WhatsApp session found' });
      }
    }

    const session = sm.getSession(finalSessionId);
    if (!session || session.info.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Session not found or not initialized' });
    }

    const targetJid = toWhatsAppJid(phone as string);
    const result = await sm.sendMessage(finalSessionId, targetJid, message as string);
    const waMessageId = result?.id?._serialized || result?.id?.id || null;

    // Log to Database
    const chatId = uuidv4();
    await db.query(`
      INSERT INTO wa_chats (id, session_id, phone_number, message_id, message_text, is_from_me, status)
      VALUES (?, ?, ?, ?, ?, true, 'sent')
    `, [chatId, finalSessionId, phone, waMessageId, message]);

    try {
      await db.query(`
        INSERT INTO wa_message_logs (id, session_id, target_phone, message_content, direction, status, metadata)
        VALUES (?, ?, ?, ?, 'outgoing', 'sent', ?)
      `, [uuidv4(), finalSessionId, phone, message, JSON.stringify({ waMessageId })]);
    } catch (logErr: any) {
      logger.error(`[GET_SEND_ERROR] Database log error: ${logErr.message}`);
    }

    // Emit to Live Chat UI (SSE)
    emitChatEvent({
      type: 'message',
      id: chatId,
      session_id: finalSessionId,
      phone_number: phone,
      message_text: message,
      is_from_me: true,
      status: 'sent',
      created_at: new Date()
    });

    res.json({
      success: true,
      message: 'Message sent successfully via GET',
      data: { waMessageId, sessionId: finalSessionId }
    });
  } catch (err: any) {
    logger.error(`GET /send-message error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/chats/send-message — Send message via POST (Supports multiple numbers with queue & anti-ban protection)
router.post('/send-message', async (req: Request, res: Response) => {
  try {
    const { phone, phones, message, sessionId, queue: forceQueue } = req.body;

    let targetPhones: string[] = [];
    if (phones && Array.isArray(phones)) {
      targetPhones = phones;
    } else if (phone && typeof phone === 'string') {
      targetPhones = phone.split(',').map(p => p.trim()).filter(p => p);
    }

    if (targetPhones.length === 0 || !message) {
      return res.status(400).json({ success: false, message: 'Missing phone/phones array or message in body' });
    }

    const sm = getSessionManager();
    const db = getDb();
    let finalSessionId = sessionId as string;

    // Check if queue should be used:
    // If sending to > 1 number OR forceQueue is set to true, use queue to protect from Meta suspension
    const shouldQueue = targetPhones.length > 1 || forceQueue === true;

    if (shouldQueue) {
      let queuedViaRedis = false;
      const queueJobIds: string[] = [];

      try {
        for (const p of targetPhones) {
          const msgId = uuidv4();
          await queueMessage({
            messageId: msgId,
            sessionId: finalSessionId || undefined,
            targetPhone: p,
            messageContent: message
          });
          queueJobIds.push(msgId);
        }
        queuedViaRedis = true;
      } catch (queueErr: any) {
        logger.warn(`[SEND_MESSAGE] Redis queue not available, falling back to throttled direct sending: ${queueErr.message}`);
        queuedViaRedis = false;
      }

      if (queuedViaRedis) {
        logger.info(`📦 Enqueued ${targetPhones.length} messages into Anti-Ban Queue safely`);
        return res.json({
          success: true,
          status: 'queued',
          message: `Berhasil memasukkan ${targetPhones.length} nomor ke dalam antrean pengiriman anti-ban (delay jitter & rotasi sesi otomatis)`,
          data: {
            total: targetPhones.length,
            queued: true,
            jobIds: queueJobIds
          }
        });
      }
    }

    // Single message OR Fallback if Redis is not running:
    // Direct send with anti-ban jitter between numbers to prevent suspension
    if (!finalSessionId || finalSessionId === 'auto' || finalSessionId === 'string') {
      finalSessionId = sm.getBestSession()?.id as string;
      if (!finalSessionId) {
        return res.status(400).json({ success: false, message: 'No active WhatsApp session found' });
      }
    }

    const session = sm.getSession(finalSessionId);
    if (!session || session.info.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Session not found or not initialized' });
    }

    const antiBan = getAntiBanEngine();
    const results = [];

    for (let i = 0; i < targetPhones.length; i++) {
      const p = targetPhones[i];
      try {
        const targetJid = toWhatsAppJid(p);
        const result = await sm.sendMessage(finalSessionId, targetJid, message);
        const waMessageId = result?.id?._serialized || result?.id?.id || null;

        const chatId = uuidv4();
        await db.query(`
          INSERT INTO wa_chats (id, session_id, phone_number, message_id, message_text, is_from_me, status)
          VALUES (?, ?, ?, ?, ?, true, 'sent')
        `, [chatId, finalSessionId, p, waMessageId, message]);

        try {
          await db.query(`
            INSERT INTO wa_message_logs (id, session_id, target_phone, message_content, direction, status, metadata)
            VALUES (?, ?, ?, ?, 'outgoing', 'sent', ?)
          `, [uuidv4(), finalSessionId, p, message, JSON.stringify({ waMessageId })]);
        } catch (logErr: any) {}

        emitChatEvent({
          type: 'message',
          id: chatId,
          session_id: finalSessionId,
          phone_number: p,
          message_text: message,
          is_from_me: true,
          status: 'sent',
          created_at: new Date()
        });

        results.push({ phone: p, success: true, messageId: waMessageId });

        // If sending to multiple numbers directly without queue, apply jitter delay between numbers
        if (targetPhones.length > 1 && i < targetPhones.length - 1) {
          await antiBan.applyJitter();
        }
      } catch (err: any) {
        results.push({ phone: p, success: false, error: err.message });
      }
    }

    res.json({
      success: true,
      message: `Processed sending to ${targetPhones.length} numbers`,
      data: { sessionId: finalSessionId, results }
    });
  } catch (err: any) {
    logger.error(`POST /send-message error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /api/chats/{phone}:
 *   get:
 *     summary: Get chat history for a specific phone/JID
 *     tags: [Chats]
 *     parameters:
 *       - in: path
 *         name: phone
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of messages
 */
// GET /api/chats/:phone — Get chat history
router.get('/:phone', async (req: Request, res: Response) => {
  try {
    const phone = req.params.phone as string;
    const db = getDb();
    
    // We must match any form of the phone (raw, @s.whatsapp.net, @c.us, @lid)
    const cleanParam = phone.replace('@c.us', '').replace('@lid', '').replace('@s.whatsapp.net', '');
    
    const [rows] = await db.query(`
      SELECT c.*, COALESCE(wjm.phone_number, REPLACE(REPLACE(c.phone_number, '@c.us', ''), '@lid', '')) as display_phone 
      FROM wa_chats c
      LEFT JOIN wa_jid_mappings wjm ON wjm.jid = c.phone_number
      WHERE c.phone_number LIKE ? 
      ORDER BY c.created_at ASC 
      LIMIT 200
    `, [`${cleanParam}%`]);
    res.json({ success: true, data: rows });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});



/**
 * @swagger
 * /api/chats/{phone}:
 *   post:
 *     summary: Send a manual reply
 *     tags: [Chats]
 *     parameters:
 *       - in: path
 *         name: phone
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *               sessionId:
 *                 type: string
 *                 description: ID perangkat (Opsional). Jika dikosongkan, sistem akan otomatis memilih perangkat dengan beban pengiriman terendah (Rotation).
 *     responses:
 *       200:
 *         description: Pesan berhasil dikirim (Sent/Queued)
 */
// POST /api/chats/:phone — Send manual reply
router.post('/:phone', async (req: Request, res: Response) => {
  const phone = req.params.phone as string;
  const { message, sessionId } = req.body;
  
  try {
    const sm = getSessionManager();
    const finalSessionId = (sessionId && sessionId !== 'auto' && sessionId !== 'string') ? sessionId : sm.getBestSession()?.id;

    if (!finalSessionId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Tidak ada perangkat aktif yang tersedia' 
      });
    }

    const session = sm.getSession(finalSessionId);
    if (!session || session.info.status !== 'active') {
      return res.status(400).json({ 
        success: false, 
        message: 'Perangkat tidak ditemukan atau tidak aktif' 
      });
    }

    const targetJid = toWhatsAppJid(phone);
    const result = await sm.sendMessage(finalSessionId, targetJid, message);
    const waMessageId = result?.id?._serialized || result?.id?.id || null;
    
    if (result) {
      const db = getDb();
      const chatId = uuidv4();
      
      // 1. Simpan ke wa_chats (Live Chat)
      await db.query(`
        INSERT INTO wa_chats (id, session_id, phone_number, message_id, message_text, is_from_me, status)
        VALUES (?, ?, ?, ?, ?, true, 'sent')
      `, [chatId, finalSessionId, phone, waMessageId, message]);

      // 2. Simpan ke wa_message_logs (Riwayat)
      try {
        await db.query(`
          INSERT INTO wa_message_logs (id, session_id, target_phone, message_content, direction, status, metadata)
          VALUES (?, ?, ?, ?, 'outgoing', 'sent', ?)
        `, [uuidv4(), finalSessionId, phone, message, JSON.stringify({ waMessageId })]);
      } catch (logErr: any) {
        logger.error(`[LOG_ERROR] Gagal simpan ke wa_message_logs: ${logErr.message}`);
      }
      
      // 3. Emit to Live Chat UI (SSE)
      const chatData = {
        type: 'message',
        id: chatId,
        session_id: finalSessionId,
        phone_number: phone,
        message_text: message,
        is_from_me: true,
        status: 'sent',
        created_at: new Date()
      };
      emitChatEvent(chatData);
      res.json({ success: true, message: 'Message sent', messageId: waMessageId });
    } else {
      res.status(500).json({ success: false, message: 'Failed to send' });
    }
  } catch (err: any) {
    logger.error(`[CHAT_ERROR] POST /api/chats/${phone}: ${err.message || err}`, { stack: err.stack });
    res.status(500).json({ 
      success: false, 
      message: err.message || 'Internal Server Error',
      error_details: {
        name: err.name,
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
      }
    });
  }
});

// POST /api/chats/:phone/read — Mark as read
router.post('/:phone/read', async (req: Request, res: Response) => {
  try {
    const phone = req.params.phone as string;
    const db = getDb();
    const [rows]: any = await db.query(`
      SELECT message_id FROM wa_chats 
      WHERE phone_number = ? AND is_from_me = false AND status = 'received' AND message_id IS NOT NULL
      ORDER BY created_at DESC LIMIT 50
    `, [phone]);

    if (rows && rows.length > 0) {
      const messageIds = rows.map((r: any) => r.message_id);
      const sm = getSessionManager();
      const activeSession = sm.getAllSessions().find(s => s.status === 'active');
      if (activeSession) {
        await sm.markAsRead(activeSession.id, phone, messageIds);
        await db.query(`UPDATE wa_chats SET status = 'read' WHERE phone_number = ? AND message_id IN (?)`, [phone, messageIds]);
      }
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/chats/message/:id — Delete a single message
router.delete('/message/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const db = getDb();
    await db.query('DELETE FROM wa_chats WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/chats/logs/bulk-delete — Delete selected message logs by IDs
router.post('/logs/bulk-delete', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Array of ids is required' });
    }
    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    await db.query(`DELETE FROM wa_message_logs WHERE id IN (${placeholders})`, ids);
    res.json({ success: true, message: `${ids.length} riwayat pesan berhasil dihapus` });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/chats/logs/all — Delete all message logs
router.delete('/logs/all', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    await db.query('DELETE FROM wa_message_logs');
    res.json({ success: true, message: 'Semua riwayat pesan berhasil dihapus' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/chats/log/:id — Delete a message log entry
router.delete('/log/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const db = getDb();
    await db.query('DELETE FROM wa_message_logs WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/chats/history/:phone — Clear entire history for a contact
router.delete('/history/:phone', async (req: Request, res: Response) => {
  try {
    const phone = req.params.phone;
    const db = getDb();
    await db.query('DELETE FROM wa_chats WHERE phone_number = ?', [phone]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /api/chats/stream/events:
 *   get:
 *     summary: Real-time event stream via SSE
 *     tags: [Chats]
 *     responses:
 *       200:
 *         description: SSE stream for new messages and sync updates
 */
// GET /api/chats/stream — SSE for real-time updates and sync notifications
router.get('/stream/events', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const onSync = (data: any) => {
    res.write(`data: ${JSON.stringify({ type: 'sync_progress', ...data })}\n\n`);
  };

  const onAck = (data: any) => {
    res.write(`data: ${JSON.stringify({ type: 'message_ack', ...data })}\n\n`);
  };

  const onQr = (data: any) => {
    res.write(`data: ${JSON.stringify({ type: 'qr', ...data })}\n\n`);
  };

  const onStatus = (data: any) => {
    res.write(`data: ${JSON.stringify({ type: 'status', ...data })}\n\n`);
  };

  const onMessage = (data: any) => {
    res.write(`data: ${JSON.stringify({ type: 'message', ...data })}\n\n`);
  };

  const sm = getSessionManager();
  sm.on('sync.progress', onSync);
  sm.on('message.ack', onAck);
  sm.on('qr.updated', onQr);
  sm.on('connected', onStatus);
  sm.on('message', onMessage);
  chatClients.add(res);

  req.on('close', () => {
    sm.removeListener('sync.progress', onSync);
    sm.removeListener('message.ack', onAck);
    sm.removeListener('qr.updated', onQr);
    sm.removeListener('connected', onStatus);
    sm.removeListener('message', onMessage);
    chatClients.delete(res);
  });
});

export default router;
