import { Router, Request, Response } from 'express';
import { getSessionManager } from '../../services/SessionManager';
import * as QRCode from 'qrcode';
import { logger } from '../../utils/logger';

const router = Router();

// GET /api/sessions — List all sessions
router.get('/', async (_req: Request, res: Response) => {
  try {
    const sm = getSessionManager();
    const dbSessions = await sm.getAllSessionsFromDb();
    const liveSessions = sm.getAllSessions();

    // Merge live status into DB records
    const merged = dbSessions.map((dbRow: any) => {
      const live = liveSessions.find((s) => s.id === dbRow.id);
      return {
        id: dbRow.id,
        name: dbRow.name,
        phone_number: live?.phoneNumber || dbRow.phone_number,
        status: live?.status || dbRow.status,
        daily_sent_count: live?.dailySentCount ?? dbRow.daily_sent_count,
        daily_limit: dbRow.daily_limit,
        last_sent_at: dbRow.last_sent_at,
        last_connected_at: dbRow.last_connected_at,
        created_at: dbRow.created_at,
      };
    });

    res.json({ success: true, data: merged });
  } catch (err: any) {
    logger.error(`GET /sessions error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/sessions — Create new session
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name) {
      res.status(400).json({ success: false, message: 'name is required' });
      return;
    }

    const sm = getSessionManager();
    const session = await sm.createSession(name);

    res.json({
      success: true,
      data: session,
      message: `Session "${name}" created. Scan QR code at /api/sessions/${session.id}/qr`,
    });
  } catch (err: any) {
    logger.error(`POST /sessions error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/sessions/:id/qr — QR Code via SSE (Server-Sent Events)
router.get('/:id/qr', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const sm = getSessionManager();
    const session = sm.getSession(id);

    if (!session) {
      res.status(404).json({ success: false, message: 'Session not found' });
      return;
    }

    // If already connected, no QR needed
    if (session.info.status === 'active') {
      res.json({
        success: true,
        status: 'connected',
        phone_number: session.info.phoneNumber,
        message: 'Already connected, no QR needed',
      });
      return;
    }

    // SSE stream for QR updates
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // Send current QR if available
    if (session.info.qr) {
      try {
        const qrDataUrl = await QRCode.toDataURL(session.info.qr, { version: 15, errorCorrectionLevel: 'L' } as any);
        res.write(`data: ${JSON.stringify({ type: 'qr', qr: qrDataUrl })}\n\n`);
      } catch (e) {
        logger.error(`QR encode error: ${e}`);
      }
    }

    const onQr = async (data: { sessionId: string; qr: string }) => {
      if (data.sessionId === id) {
        try {
          // data.qr is already a Data URL from SessionManager, send directly
          res.write(`data: ${JSON.stringify({ type: 'qr', qr: data.qr })}\n\n`);
        } catch (e) {
          logger.error(`QR stream error: ${e}`);
        }
      }
    };

    const onConnected = (data: { sessionId: string; phoneNumber: string }) => {
      if (data.sessionId === id) {
        res.write(`data: ${JSON.stringify({ type: 'connected', phone_number: data.phoneNumber })}\n\n`);
        cleanup();
        res.end();
      }
    };

    const onSyncProgress = (data: any) => {
      if (data.sessionId === id) {
        res.write(`data: ${JSON.stringify({ type: 'sync_progress', ...data })}\n\n`);
      }
    };

    sm.on('qr.updated', onQr);
    sm.on('connected', onConnected);
    sm.on('sync.progress', onSyncProgress);

    const cleanup = () => {
      sm.removeListener('qr.updated', onQr);
      sm.removeListener('connected', onConnected);
      sm.removeListener('sync.progress', onSyncProgress);
    };

    req.on('close', cleanup);
  } catch (err: any) {
    logger.error(`GET /sessions/:id/qr error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/sessions/:id/qr-image — Simple QR image (for dashboard)
router.get('/:id/qr-image', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const sm = getSessionManager();
    const session = sm.getSession(id);

    if (!session || !session.info.qr) {
      res.status(404).json({ success: false, message: 'No QR available' });
      return;
    }

    const qrDataUrl = await QRCode.toDataURL(session.info.qr, { version: 15, errorCorrectionLevel: 'L', width: 300, margin: 2 } as any);
    res.json({ success: true, qr: qrDataUrl, status: session.info.status });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/sessions/:id/status — Session status
router.get('/:id/status', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const sm = getSessionManager();
    const session = sm.getSession(id);

    if (!session) {
      // Check DB
      const db = (await import('../../config/database')).getDb();
      const [rows] = await db.query('SELECT * FROM wa_sessions WHERE id = ?', [id]);
      const dbRow = (rows as any[])[0];
      if (dbRow) {
        res.json({ success: true, data: { ...dbRow, live: false } });
        return;
      }
      res.status(404).json({ success: false, message: 'Session not found' });
      return;
    }

    res.json({
      success: true,
      data: {
        ...session.info,
        live: true,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/sessions/:id — Delete session
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const sm = getSessionManager();
    await sm.deleteSession(id);
    res.json({ success: true, message: 'Session deleted' });
  } catch (err: any) {
    logger.error(`DELETE /sessions/:id error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/sessions/:id/connect — Start/Re-start connection for existing session
router.post('/:id/connect', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const sm = getSessionManager();
    
    // Check if session exists in DB first
    const dbSessions = await sm.getAllSessionsFromDb();
    const sessionData = dbSessions.find(s => s.id === id);
    
    if (!sessionData) {
      res.status(404).json({ success: false, message: 'Session not found in database' });
      return;
    }

    logger.info(`🔄 [RE-CONNECT] User manually triggered reconnection for session: ${id}`);
    await sm.connectSession(id, sessionData.name);
    res.json({ success: true, message: 'Re-connection started' });
  } catch (err: any) {
    logger.error(`POST /sessions/:id/connect error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/sessions/:id/restart — Restart session
router.post('/:id/restart', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const sm = getSessionManager();
    const session = await sm.restartSession(id);

    if (!session) {
      res.status(404).json({ success: false, message: 'Session not found' });
      return;
    }

    res.json({ success: true, data: session, message: 'Session restarting...' });
  } catch (err: any) {
    logger.error(`POST /sessions/:id/restart error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/sessions/sync-all-contacts — Trigger contact sync from all active sessions without restarting
router.post('/sync-all-contacts', async (req: Request, res: Response) => {
  try {
    const sm = getSessionManager();
    const allSessions = sm.getAllSessions().filter(s => s.status === 'active');
    
    if (allSessions.length === 0) {
      return res.status(400).json({ success: false, message: 'Tidak ada sesi WhatsApp yang aktif untuk ditarik datanya.' });
    }

    logger.info(`🔄 Manual Sync Triggered. Menarik data kontak langsung dari ${allSessions.length} sesi aktif...`);

    // Fetch contacts from active clients without restarting!
    for (const session of allSessions) {
      try {
        const sessionData = sm.getSession(session.id);
        if (sessionData && sessionData.client) {
          const contacts = await sessionData.client.getContacts();
          const validContacts = contacts.filter((c: any) => 
            c.isMyContact && !c.isGroup && c.id._serialized !== 'status@broadcast'
          );

          const chats = await sessionData.client.getChats();
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

          sm.emit('contacts.received', { sessionId: session.id, contacts: allSync });
          logger.info(`✅ [SYNC] Berhasil menarik ulang ${validContacts.length} kontak secara manual.`);

          // ALSO Pull History for Live Chat
          logger.info(`🔄 [SYNC] Menarik riwayat pesan terbaru (Live Chat)...`);
          let allMessages: any[] = [];
          const recentChats = chats.slice(0, 20); 
          for (const chat of recentChats) {
            try {
              const msgs = await chat.fetchMessages({ limit: 15 });
              allMessages.push(...msgs);
            } catch (e) {}
          }
          sm.emit('history.received', { sessionId: session.id, messages: allMessages });
        }
      } catch (err) {
        logger.error(`Error pulling contacts/history for session ${session.id}: ${err}`);
      }
    }
    
    res.json({ success: true, message: 'Sinkronisasi berhasil ditarik tanpa restart.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/sessions/:id/clear-data — Clear chats and contacts for a specific session (Chunked for performance)
router.post('/:id/clear-data', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const db = (await import('../../config/database')).getDb();
    
    logger.info(`🧹 Starting chunked cleanup for session: ${id}`);
    
    // Ensure index exists (even if it takes time, it will help next chunks)
    db.query("ALTER TABLE wa_contacts ADD INDEX IF NOT EXISTS idx_session_id (session_id)").catch(() => {});
    db.query("ALTER TABLE wa_chats ADD INDEX IF NOT EXISTS idx_session_id (session_id)").catch(() => {});
    
    let totalChatsDeleted = 0;
    let totalContactsDeleted = 0;
    
    // Chunked delete for chats
    let affectedChats = 1;
    while (affectedChats > 0) {
      const [res]: any = await db.query('DELETE FROM wa_chats WHERE session_id = ? LIMIT 2000', [id]);
      affectedChats = res.affectedRows;
      totalChatsDeleted += affectedChats;
      if (affectedChats > 0) await new Promise(r => setTimeout(r, 100)); // Small pause
    }
    
    // Chunked delete for contacts
    let affectedContacts = 1;
    while (affectedContacts > 0) {
      const [res]: any = await db.query('DELETE FROM wa_contacts WHERE session_id = ? LIMIT 2000', [id]);
      affectedContacts = res.affectedRows;
      totalContactsDeleted += affectedContacts;
      if (affectedContacts > 0) await new Promise(r => setTimeout(r, 100)); // Small pause
    }
    
    res.json({ 
      success: true, 
      message: 'Data cleared successfully in chunks',
      details: {
        chats_deleted: totalChatsDeleted,
        contacts_deleted: totalContactsDeleted
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/sessions/reset-all-data — Nuclear option to clear everything except sessions
router.post('/reset-all-data', async (_req: Request, res: Response) => {
  try {
    const db = (await import('../../config/database')).getDb();
    logger.warn('🚨 NUCLEAR RESET INITIATED: Clearing all chats, contacts, and mappings...');
    
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    await db.query('TRUNCATE TABLE wa_chats');
    await db.query('TRUNCATE TABLE wa_contacts');
    await db.query('TRUNCATE TABLE wa_jid_mappings');
    await db.query('SET FOREIGN_KEY_CHECKS = 1');
    
    res.json({ success: true, message: 'All data has been wiped. Refresh to start fresh sync.' });
  } catch (err: any) {
    logger.error(`POST /sessions/reset-all-data error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
