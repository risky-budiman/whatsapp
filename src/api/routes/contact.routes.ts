import { Router, Request, Response } from 'express';
import { getDb } from '../../config/database';
import { getContactSync } from '../../services/ContactSync';
import { normalizePhone } from '../../utils/phone';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';

const router = Router();

// GET /api/contacts — List individual contacts (excluding groups) with resolved JIDs
router.get('/', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = parseInt((req.query.limit as string) || '500', 10);
    const offset = parseInt((req.query.offset as string) || '0', 10);
    // Strictly exclude @lid and @g.us to show only valid individual contacts
    const [rows] = await db.query(
      `SELECT 
        wc.id,
        wc.name,
        wc.phone_number,
        wc.source,
        wc.created_at
      FROM wa_contacts wc
      WHERE wc.phone_number LIKE '%@c.us'
      ORDER BY wc.created_at DESC 
      LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const [countRows] = await db.query("SELECT COUNT(*) as total FROM wa_contacts WHERE phone_number LIKE '%@c.us'");
    const total = (countRows as any[])[0].total;

    res.json({ success: true, data: rows, meta: { total, limit, offset } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/contacts — Add single contact
router.post('/', async (req: Request, res: Response) => {
  try {
    const { phone, name, tags } = req.body;
    
    if (!phone) {
      res.status(400).json({ success: false, message: 'phone is required' });
      return;
    }

    const normalizedPhone = normalizePhone(phone);
    const db = getDb();

    // Upsert contact
    await db.query(
      `INSERT INTO wa_contacts (id, phone_number, name, tags, source) 
       VALUES (?, ?, ?, ?, 'manual')
       ON DUPLICATE KEY UPDATE name = VALUES(name), tags = VALUES(tags)`,
      [uuidv4(), normalizedPhone, name || null, tags ? JSON.stringify(tags) : null]
    );

    res.json({ success: true, message: 'Contact saved successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/contacts/import — Import CSV
// Expects raw text CSV in body or JSON array of {phone, name}
router.post('/import', async (req: Request, res: Response) => {
  try {
    const contacts = req.body.contacts; // Expecting { contacts: [ { phone: "...", name: "..." } ] }
    if (!Array.isArray(contacts)) {
      res.status(400).json({ success: false, message: 'Body must contain "contacts" array' });
      return;
    }

    const db = getDb();
    let imported = 0;

    for (const contact of contacts) {
      if (contact.phone) {
        const normalizedPhone = normalizePhone(contact.phone);
        await db.query(
          `INSERT INTO wa_contacts (id, phone_number, name, source) 
           VALUES (?, ?, ?, 'import')
           ON DUPLICATE KEY UPDATE name = VALUES(name)`,
          [uuidv4(), normalizedPhone, contact.name || null]
        );
        imported++;
      }
    }

    res.json({ success: true, message: `Imported ${imported} contacts` });
  } catch (err: any) {
    logger.error(`Import error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/contacts/sync-laravel — Sync from Laravel DB
router.post('/sync-laravel', async (_req: Request, res: Response) => {
  try {
    const syncer = getContactSync();
    const result = await syncer.syncFromLaravel();
    res.json({ success: true, data: result, message: 'Laravel sync completed' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/contacts/groups — List groups
router.get('/groups', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const [rows] = await db.query(
      "SELECT * FROM wa_contacts WHERE phone_number LIKE '%@g.us' ORDER BY name ASC"
    );
    res.json({ success: true, data: rows });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/contacts/:id — Delete contact
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = getDb();
    await db.query('DELETE FROM wa_contacts WHERE id = ?', [id]);
    res.json({ success: true, message: 'Contact deleted' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
