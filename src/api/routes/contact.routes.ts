import { Router, Request, Response } from 'express';
import { getDb } from '../../config/database';
import { getContactSync } from '../../services/ContactSync';
import { normalizePhone, toWhatsAppJid } from '../../utils/phone';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Contacts
 *   description: WhatsApp contact management
 */

/**
 * @swagger
 * /api/contacts:
 *   get:
 *     summary: List all individual contacts
 *     tags: [Contacts]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 500
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: List of contacts
 */
// GET /api/contacts — List individual contacts (excluding groups) with resolved JIDs
router.get('/', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = parseInt((req.query.limit as string) || '500', 10);
    const offset = parseInt((req.query.offset as string) || '0', 10);
    
    // DEBUG: Check total counts
    const [allCount]: any = await db.query("SELECT COUNT(*) as total FROM wa_contacts");
    const [jidCount]: any = await db.query("SELECT COUNT(*) as total FROM wa_contacts WHERE phone_number LIKE '%@c.us'");
    logger.info(`[DEBUG] Contacts Table: Total=${allCount[0].total}, JID_Format=${jidCount[0].total}`);

    // Let's be more lenient: show everything that isn't a group
    const [rows] = await db.query(
      `SELECT 
        wc.id,
        wc.name,
        wc.phone_number,
        wc.tags,
        wc.source,
        wc.created_at
      FROM wa_contacts wc
      WHERE wc.phone_number NOT LIKE '%@g.us'
      ORDER BY wc.created_at DESC 
      LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const [countRows] = await db.query("SELECT COUNT(*) as total FROM wa_contacts WHERE phone_number NOT LIKE '%@g.us'");
    const total = (countRows as any[])[0].total;

    res.json({ success: true, data: rows, meta: { total, limit, offset } });
  } catch (err: any) {
    logger.error(`Error fetching contacts: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /api/contacts:
 *   post:
 *     summary: Add a single contact
 *     tags: [Contacts]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phone
 *             properties:
 *               phone:
 *                 type: string
 *                 example: "62812345678"
 *               name:
 *                 type: string
 *                 example: "John Doe"
 *     responses:
 *       200:
 *         description: Contact saved
 */
// POST /api/contacts — Add single contact
router.post('/', async (req: Request, res: Response) => {
  try {
    const { phone, name, tags } = req.body;
    
    if (!phone) {
      res.status(400).json({ success: false, message: 'phone is required' });
      return;
    }

    const jid = toWhatsAppJid(phone);
    const db = getDb();

    logger.info(`[DEBUG] Attempting to save manual contact: Phone=${phone}, JID=${jid}, Name=${name}`);

    const [existing]: any = await db.query('SELECT id FROM wa_contacts WHERE phone_number = ? LIMIT 1', [jid]);

    if (existing.length > 0) {
      // Edit existing
      await db.query(
        `UPDATE wa_contacts 
         SET name = ?, tags = ?, source = 'manual'
         WHERE phone_number = ?`,
        [name || null, tags ? JSON.stringify(tags) : null, jid]
      );
    } else {
      // Insert new
      await db.query(
        `INSERT INTO wa_contacts (id, phone_number, name, tags, source) 
         VALUES (?, ?, ?, ?, 'manual')`,
        [uuidv4(), jid, name || null, tags ? JSON.stringify(tags) : null]
      );
    }

    logger.info(`[DEBUG] Contact saved successfully`);

    res.json({ success: true, message: 'Contact saved successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /api/contacts/import:
 *   post:
 *     summary: Import contacts from JSON array
 *     tags: [Contacts]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               contacts:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     phone:
 *                       type: string
 *                     name:
 *                       type: string
 *     responses:
 *       200:
 *         description: Contacts imported
 */
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
        const jid = toWhatsAppJid(contact.phone);
        await db.query(
          `INSERT INTO wa_contacts (id, phone_number, name, source) 
           VALUES (?, ?, ?, 'import')
           ON DUPLICATE KEY UPDATE name = VALUES(name)`,
          [uuidv4(), jid, contact.name || null]
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



/**
 * @swagger
 * /api/contacts/groups:
 *   get:
 *     summary: List all WhatsApp groups
 *     tags: [Contacts]
 *     responses:
 *       200:
 *         description: List of groups
 */
// GET /api/contacts/groups — List groups with pagination
router.get('/groups', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = parseInt((req.query.limit as string) || '500', 10);
    const offset = parseInt((req.query.offset as string) || '0', 10);

    const [rows] = await db.query(
      `SELECT * FROM wa_contacts 
       WHERE phone_number LIKE '%@g.us' 
       ORDER BY name ASC 
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const [countRows] = await db.query("SELECT COUNT(*) as total FROM wa_contacts WHERE phone_number LIKE '%@g.us'");
    const total = (countRows as any[])[0].total;

    res.json({ success: true, data: rows, meta: { total, limit, offset } });
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
