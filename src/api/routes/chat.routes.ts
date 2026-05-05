import { Router, Request, Response } from 'express';
import { getDb } from '../../config/database';
import { getSessionManager } from '../../services/SessionManager';
import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

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

// GET /api/chats/:phone — Get chat history
router.get('/:phone', async (req: Request, res: Response) => {
  try {
    const phone = req.params.phone as string;
    const db = getDb();
    
    // We must match any form of the phone (raw, @s.whatsapp.net, @c.us, @lid)
    const cleanParam = phone.replace('@c.us', '').replace('@lid', '');
    
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

// POST /api/chats/:phone — Send manual reply
router.post('/:phone', async (req: Request, res: Response) => {
  try {
    const phone = req.params.phone as string;
    const { message } = req.body;
    if (!message) return res.status(400).json({ success: false, message: 'Message required' });

    const sm = getSessionManager();
    const activeSession = sm.getAllSessions().find(s => s.status === 'active');
    if (!activeSession) return res.status(500).json({ success: false, message: 'No active session' });

    const targetJid = phone.includes('@') ? phone : `${phone}@c.us`;
    const success = await sm.sendMessage(activeSession.id, targetJid, message);
    
    if (success) {
      const db = getDb();
      const chatId = uuidv4();
      const chatData = {
        id: chatId,
        session_id: activeSession.id,
        phone_number: phone,
        message_text: message,
        is_from_me: true,
        status: 'sent',
        created_at: new Date()
      };
      await db.query(`
        INSERT INTO wa_chats (id, session_id, phone_number, message_text, is_from_me, status)
        VALUES (?, ?, ?, ?, true, 'sent')
      `, [chatId, activeSession.id, phone, message]);
      emitChatEvent(chatData);
      res.json({ success: true, data: chatData });
    } else {
      res.status(500).json({ success: false, message: 'Failed to send' });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
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

  const sm = getSessionManager();
  sm.on('sync.progress', onSync);
  chatClients.add(res);

  req.on('close', () => {
    sm.removeListener('sync.progress', onSync);
    chatClients.delete(res);
  });
});

export default router;
