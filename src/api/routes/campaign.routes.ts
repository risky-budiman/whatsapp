import { Router, Request, Response } from 'express';
import { getBroadcastEngine } from '../../services/BroadcastEngine';
import { getDb } from '../../config/database';
import { logger } from '../../utils/logger';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Campaigns
 *   description: WhatsApp broadcasting campaigns
 */

/**
 * @swagger
 * /api/campaigns:
 *   get:
 *     summary: List all campaigns
 *     tags: [Campaigns]
 *     responses:
 *       200:
 *         description: List of campaigns
 */
// GET /api/campaigns — List campaigns
router.get('/', async (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const [rows] = await db.query('SELECT id, name, status, total_recipients, sent_count, failed_count, scheduled_at, created_at FROM wa_campaigns ORDER BY created_at DESC');
    res.json({ success: true, data: rows });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /api/campaigns/send-tag:
 *   get:
 *     summary: Broadcast by Tag via GET (for alerts)
 *     tags: [Campaigns]
 *     parameters:
 *       - in: query
 *         name: tag
 *         required: true
 *         schema:
 *           type: string
 *         description: Contact tag name
 *       - in: query
 *         name: message
 *         required: true
 *         schema:
 *           type: string
 *         description: Broadcast message content
 *       - in: query
 *         name: api_key
 *         required: true
 *         schema:
 *           type: string
 *         description: Your API Key
 *       - in: query
 *         name: name
 *         schema:
 *           type: string
 *         description: Campaign name (optional)
 *     responses:
 *       200:
 *         description: Campaign started successfully
 */
// GET /api/campaigns/send-tag — Quick broadcast by tag via URL
router.get('/send-tag', async (req: Request, res: Response) => {
  try {
    const { tag, message, name } = req.query;

    if (!tag || !message) {
      return res.status(400).json({ success: false, message: 'Missing tag or message query parameters' });
    }

    const db = getDb();
    
    // 1. Get recipients by tag
    // Handle JSON search for tags column
    const [contacts]: any = await db.query(
      "SELECT phone_number as phone, name FROM wa_contacts WHERE JSON_CONTAINS(tags, ?)",
      [JSON.stringify(tag)]
    );

    if (contacts.length === 0) {
      return res.status(404).json({ success: false, message: `No contacts found with tag: ${tag}` });
    }

    // 2. Create Campaign
    const engine = getBroadcastEngine();
    const campaignId = await engine.createCampaign({
      name: (name as string) || `Broadcast API - ${tag}`,
      template: message as string,
      recipients: contacts,
      createdBy: 'api_get'
    });

    // 3. Start Campaign Immediately (Auto-Start)
    await engine.startCampaign(campaignId);

    res.json({
      success: true,
      message: `Campaign created and started for ${contacts.length} recipients`,
      data: { campaignId, recipientCount: contacts.length }
    });
  } catch (err: any) {
    logger.error(`GET /campaigns/send-tag error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /api/campaigns:
 *   post:
 *     summary: Create a new campaign
 *     tags: [Campaigns]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - template
 *               - recipients
 *             properties:
 *               name:
 *                 type: string
 *               template:
 *                 type: string
 *               recipients:
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
 *         description: Campaign created
 */
// POST /api/campaigns — Create campaign
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, template, recipients, variationPool } = req.body;
    
    if (!name || !template || !Array.isArray(recipients) || recipients.length === 0) {
      res.status(400).json({ success: false, message: 'Invalid payload. name, template, and recipients array are required.' });
      return;
    }

    const engine = getBroadcastEngine();
    const campaignId = await engine.createCampaign({
      name,
      template,
      recipients,
      variationPool
    });

    res.json({ success: true, data: { campaignId }, message: 'Campaign created successfully' });
  } catch (err: any) {
    logger.error(`Create campaign error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /api/campaigns/{id}:
 *   get:
 *     summary: Get campaign detail
 *     tags: [Campaigns]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Campaign detail with messages
 */
// GET /api/campaigns/:id — Campaign detail
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const db = getDb();
    
    const [rows] = await db.query('SELECT * FROM wa_campaigns WHERE id = ?', [id]);
    const campaign = (rows as any[])[0];
    
    if (!campaign) {
      res.status(404).json({ success: false, message: 'Campaign not found' });
      return;
    }

    const [msgRows] = await db.query('SELECT target_phone, target_name, status, error_message, sent_at FROM wa_campaign_messages WHERE campaign_id = ?', [id]);
    
    res.json({ 
      success: true, 
      data: {
        ...campaign,
        messages: msgRows
      } 
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /api/campaigns/{id}/start:
 *   post:
 *     summary: Start campaign broadcast
 *     tags: [Campaigns]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Campaign started
 */
// POST /api/campaigns/:id/start — Start broadcast
router.post('/:id/start', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const engine = getBroadcastEngine();
    await engine.startCampaign(id);
    
    res.json({ success: true, message: 'Campaign started and messages queued' });
  } catch (err: any) {
    logger.error(`Start campaign error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/campaigns/:id/pause — Pause broadcast
router.post('/:id/pause', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const engine = getBroadcastEngine();
    await engine.pauseCampaign(id);
    
    res.json({ success: true, message: 'Campaign paused' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/campaigns/:id/resume — Resume broadcast
router.post('/:id/resume', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const engine = getBroadcastEngine();
    await engine.startCampaign(id); // start handles resume logic
    
    res.json({ success: true, message: 'Campaign resumed' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/campaigns/:id/resend-failed — Resend only failed messages
router.post('/:id/resend-failed', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const engine = getBroadcastEngine();
    const count = await engine.resendFailed(id);
    
    res.json({ success: true, message: `Resending ${count} failed messages...`, data: { count } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /api/campaigns/{id}/progress:
 *   get:
 *     summary: Get campaign progress via SSE
 *     tags: [Campaigns]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: SSE stream for progress
 */
// GET /api/campaigns/:id/progress — Progress SSE stream
router.get('/:id/progress', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const db = getDb();
    
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // Send progress every 3 seconds
    const interval = setInterval(async () => {
      try {
        const [rows] = await db.query(`
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
            SUM(CASE WHEN status IN ('pending', 'queued', 'sending') THEN 1 ELSE 0 END) as pending
          FROM wa_campaign_messages 
          WHERE campaign_id = ?
        `, [id]);
        
        const stats = (rows as any[])[0];
        res.write(`data: ${JSON.stringify(stats)}\n\n`);
      } catch (err) {
        // ignore interval errors
      }
    }, 3000);

    req.on('close', () => clearInterval(interval));

  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /api/campaigns/{id}:
 *   delete:
 *     summary: Delete a campaign
 *     tags: [Campaigns]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Campaign deleted successfully
 */
// POST /api/campaigns/bulk-delete — Delete selected campaigns
router.post('/bulk-delete', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Array of ids is required' });
    }
    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    await db.query(`DELETE FROM wa_campaign_messages WHERE campaign_id IN (${placeholders})`, ids);
    await db.query(`DELETE FROM wa_campaigns WHERE id IN (${placeholders})`, ids);
    res.json({ success: true, message: `${ids.length} campaign berhasil dihapus` });
  } catch (err: any) {
    logger.error(`Error bulk deleting campaigns: ${err.message}`);
    res.status(500).json({ success: false, message: 'Failed to bulk delete campaigns' });
  }
});

// DELETE /api/campaigns/all — Delete all campaigns
router.delete('/all', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    await db.query('DELETE FROM wa_campaign_messages');
    await db.query('DELETE FROM wa_campaigns');
    res.json({ success: true, message: 'Semua campaign berhasil dihapus' });
  } catch (err: any) {
    logger.error(`Error deleting all campaigns: ${err.message}`);
    res.status(500).json({ success: false, message: 'Failed to delete all campaigns' });
  }
});

// DELETE /api/campaigns/:id — Delete campaign
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const db = getDb();
    
    // Check if campaign exists
    const [campaigns]: any = await db.query('SELECT * FROM wa_campaigns WHERE id = ?', [id]);
    if (campaigns.length === 0) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    
    // Delete associated messages first
    await db.query('DELETE FROM wa_campaign_messages WHERE campaign_id = ?', [id]);
    
    // Delete campaign
    await db.query('DELETE FROM wa_campaigns WHERE id = ?', [id]);
    
    res.json({ success: true, message: 'Campaign deleted successfully' });
  } catch (err: any) {
    logger.error(`Error deleting campaign: ${err.message}`);
    res.status(500).json({ success: false, message: 'Failed to delete campaign' });
  }
});

export default router;
